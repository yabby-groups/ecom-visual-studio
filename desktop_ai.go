package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

var imageSizes = map[string][2]int{"1:1": {1024, 1024}, "3:2": {1536, 1024}, "2:3": {1024, 1536}, "16:9": {1536, 864}}

func imageSize(ratio string) ([2]int, error) {
	size, ok := imageSizes[ratio]
	if !ok {
		return [2]int{}, errors.New("图像服务仅支持画面比例: 1:1、3:2、2:3、16:9")
	}
	return size, nil
}
func validPNG(data []byte, expected [2]int) error {
	if len(data) < 24 || !bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) || !bytes.Equal(data[12:16], []byte("IHDR")) {
		return errors.New("图像服务没有返回 PNG 图片")
	}
	w := int(data[16])<<24 | int(data[17])<<16 | int(data[18])<<8 | int(data[19])
	h := int(data[20])<<24 | int(data[21])<<16 | int(data[22])<<8 | int(data[23])
	if w < 1 || h < 1 {
		return errors.New("图像服务返回的 PNG 尺寸无效")
	}
	if w*expected[1] != h*expected[0] {
		return fmt.Errorf("图像服务返回比例 %d:%d，但请求的是 %d:%d", w, h, expected[0], expected[1])
	}
	return nil
}

func (s *Studio) GenerateAsset(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	var owned int
	if err = s.db.QueryRow("select count(*) from assets a join projects p on p.id=a.project_id where a.id=? and p.user_id=?", id, user.ID).Scan(&owned); err != nil {
		return nil, err
	}
	if owned == 0 {
		return nil, errors.New("画面不存在")
	}
	if _, err = s.db.Exec("update assets set status='queued',generation_started_at=null where id=?", id); err != nil {
		return nil, err
	}
	go s.generateAsset(id)
	return map[string]bool{"ok": true}, nil
}
func (s *Studio) GeneratePack(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if _, err = s.projectOwned(id, user.ID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select id from assets where project_id=?", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var asset string
		if err = rows.Scan(&asset); err != nil {
			return nil, err
		}
		_, _ = s.db.Exec("update assets set status='queued',generation_started_at=null where id=?", asset)
		go s.generateAsset(asset)
	}
	return map[string]bool{"ok": true}, rows.Err()
}
func (s *Studio) generateAsset(id string) {
	var userID, projectID, prompt, ratio, reference string
	if err := s.db.QueryRow("select p.user_id,a.project_id,a.prompt,a.ratio,p.reference from assets a join projects p on p.id=a.project_id where a.id=?", id).Scan(&userID, &projectID, &prompt, &ratio, &reference); err != nil {
		return
	}
	_, _ = s.db.Exec("update assets set status='generating',generation_started_at=? where id=?", time.Now().Unix(), id)
	s.NotifyGeneration(id, "generating")
	config, key, image, _, _, err := s.activeProvider(userID)
	if err == nil {
		size, sizeErr := imageSize(ratio)
		if sizeErr != nil {
			err = sizeErr
		} else {
			client := s.openAIClient(config, key)
			var raw *openai.ImagesResponse
			if reference != "" {
				raw, err = s.imageEdit(client, image, prompt, size, []string{reference})
			} else {
				raw, err = client.Images.Generate(context.Background(), openai.ImageGenerateParams{
					Model:  openai.ImageModel(image),
					Prompt: prompt,
					N:      openai.Int(1),
					Size:   openai.ImageGenerateParamsSize(fmt.Sprintf("%dx%d", size[0], size[1])),
				})
			}
			if err == nil {
				err = s.saveImageResponse(raw, projectID, id, size, "asset_versions", "asset_id")
			}
		}
	}
	if err != nil {
		_, _ = s.db.Exec("update assets set status=? where id=?", "failed: "+truncate(err.Error()), id)
		s.NotifyGeneration(id, "failed")
	} else {
		_, _ = s.db.Exec("update assets set status='ready' where id=?", id)
		s.NotifyGeneration(id, "ready")
	}
}

func (s *Studio) openAIClient(config huabotConfig, key string) openai.Client {
	return openai.NewClient(
		option.WithBaseURL(config.APIBase),
		option.WithAPIKey(key),
		option.WithHTTPClient(s.httpClient),
	)
}

func (s *Studio) imageEdit(client openai.Client, model, prompt string, size [2]int, paths []string) (*openai.ImagesResponse, error) {
	readers := make([]io.Reader, 0, len(paths))
	closers := make([]io.Closer, 0, len(paths))
	defer func() {
		for _, closer := range closers {
			_ = closer.Close()
		}
	}()
	for _, path := range paths {
		file, err := safeUpload(s.dataDir, path)
		if err != nil {
			return nil, err
		}
		closers = append(closers, file)
		readers = append(readers, openai.File(file, filepath.Base(path), mime.TypeByExtension(filepath.Ext(path))))
	}
	return client.Images.Edit(context.Background(), openai.ImageEditParams{
		Image:  openai.ImageEditParamsImageUnion{OfFileArray: readers},
		Model:  openai.ImageModel(model),
		Prompt: prompt,
		N:      openai.Int(1),
		Size:   openai.ImageEditParamsSize(fmt.Sprintf("%dx%d", size[0], size[1])),
	})
}
func safeUpload(dataDir, path string) (*os.File, error) {
	clean := filepath.Clean(path)
	if !strings.HasPrefix(clean, "uploads"+string(filepath.Separator)) || strings.HasPrefix(clean, "..") {
		return nil, errors.New("项目参考图必须先通过上传功能添加")
	}
	full := filepath.Join(dataDir, "storage", clean)
	root := filepath.Join(dataDir, "storage", "uploads") + string(filepath.Separator)
	if !strings.HasPrefix(full, root) {
		return nil, errors.New("项目参考图片不存在")
	}
	return os.Open(full)
}
func (s *Studio) saveImageResponse(raw *openai.ImagesResponse, folder, entity string, size [2]int, table, column string) error {
	if raw == nil || len(raw.Data) == 0 {
		return errors.New("图像服务没有返回图片")
	}
	image, err := base64.StdEncoding.DecodeString(raw.Data[0].B64JSON)
	if err != nil {
		return errors.New("图像服务返回图片无效")
	}
	if err = validPNG(image, size); err != nil {
		return err
	}
	dir := filepath.Join(s.dataDir, "storage", "generated", folder)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	name := newID(entity) + ".png"
	if err = os.WriteFile(filepath.Join(dir, name), image, 0o600); err != nil {
		return err
	}
	path := filepath.ToSlash(filepath.Join("generated", folder, name))
	if _, err = s.db.Exec(fmt.Sprintf("insert into %s(id,%s,file_path,created_at) values(?,?,?,?)", table, column), newID("version"), entity, path, time.Now().Unix()); err != nil {
		return err
	}
	if table == "asset_versions" {
		if _, err = s.db.Exec("update assets set file_path=? where id=?", path, entity); err != nil {
			return err
		}
	}
	return nil
}

type TryOnInput struct {
	PersonPaths    []string `json:"person_paths"`
	GarmentPaths   []string `json:"garment_paths"`
	GenerationMode string   `json:"generation_mode"`
	Instructions   string   `json:"instructions"`
	Ratio          string   `json:"ratio"`
}

func (s *Studio) CreateTryOn(input TryOnInput) (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if len(input.PersonPaths) == 0 || len(input.GarmentPaths) == 0 || len(input.PersonPaths) > 4 || len(input.GarmentPaths) > 4 {
		return nil, errors.New("人物照片和服装图片最多各添加 4 张，且不能为空")
	}
	if _, err = imageSize(input.Ratio); err != nil {
		return nil, err
	}
	if input.GenerationMode != "combined" && input.GenerationMode != "combinations" {
		return nil, errors.New("换装生成模式无效")
	}
	for _, p := range append(append([]string{}, input.PersonPaths...), input.GarmentPaths...) {
		f, e := safeUpload(s.dataDir, p)
		if e != nil {
			return nil, e
		}
		f.Close()
	}
	persons, _ := json.Marshal(input.PersonPaths)
	garments, _ := json.Marshal(input.GarmentPaths)
	pairs := [][2][]string{{input.PersonPaths, input.GarmentPaths}}
	if input.GenerationMode == "combinations" {
		pairs = nil
		for _, p := range input.PersonPaths {
			for _, g := range input.GarmentPaths {
				pairs = append(pairs, [2][]string{{p}, {g}})
			}
		}
	}
	ids := []string{}
	for _, pair := range pairs {
		pp, _ := json.Marshal(pair[0])
		gg, _ := json.Marshal(pair[1])
		id := newID("tryon")
		if _, err = s.db.Exec("insert into try_on_jobs(id,user_id,person_paths,garment_paths,generation_mode,instructions,ratio,status,created_at) values(?,?,?,?,?,?,?,?,?)", id, user.ID, string(pp), string(gg), input.GenerationMode, input.Instructions, input.Ratio, "queued", time.Now().Unix()); err != nil {
			return nil, err
		}
		ids = append(ids, id)
		go s.generateTryOn(id)
	}
	_ = persons
	_ = garments
	return map[string]any{"id": ids[0], "ids": ids}, nil
}
func (s *Studio) generateTryOn(id string) {
	var user, persons, garments, instructions, ratio string
	if err := s.db.QueryRow("select user_id,person_paths,garment_paths,instructions,ratio from try_on_jobs where id=?", id).Scan(&user, &persons, &garments, &instructions, &ratio); err != nil {
		return
	}
	_, _ = s.db.Exec("update try_on_jobs set status='generating',generation_started_at=? where id=?", time.Now().Unix(), id)
	var pp, gg []string
	_ = json.Unmarshal([]byte(persons), &pp)
	_ = json.Unmarshal([]byte(garments), &gg)
	config, key, image, _, _, err := s.activeProvider(user)
	if err == nil {
		size, e := imageSize(ratio)
		if e != nil {
			err = e
		} else {
			client := s.openAIClient(config, key)
			prompt := "Create a realistic full-body fashion try-on image. Preserve the person's identity, pose, body proportions, hair, and background. Replace only their clothing with the supplied garment. Do not add text, watermarks, logos, extra garments, or unrelated objects.\nAdditional direction: " + strings.TrimSpace(instructions)
			raw, requestErr := s.imageEdit(client, image, prompt, size, append(pp, gg...))
			err = requestErr
			if err == nil {
				err = s.saveImageResponse(raw, filepath.Join("try-on", user), id, size, "try_on_versions", "job_id")
			}
		}
	}
	if err != nil {
		_, _ = s.db.Exec("update try_on_jobs set status=? where id=?", "failed: "+truncate(err.Error()), id)
	} else {
		var path string
		_ = s.db.QueryRow("select file_path from try_on_versions where job_id=? order by created_at desc limit 1", id).Scan(&path)
		_, _ = s.db.Exec("update try_on_jobs set status='ready',file_path=? where id=?", path, id)
	}
}
func truncate(value string) string {
	if len(value) > 180 {
		return value[:180]
	}
	return value
}
func (s *Studio) TryOnJobs(limit, offset int) (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 48 || offset < 0 {
		return nil, errors.New("分页参数无效")
	}
	var total int
	if err = s.db.QueryRow("select count(*) from try_on_jobs where user_id=?", user.ID).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select id,person_paths,garment_paths,generation_mode,instructions,ratio,status,file_path,generation_started_at,created_at from try_on_jobs where user_id=? order by created_at desc limit ? offset ?", user.ID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		job, err := s.scanTryOn(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, job)
	}
	return map[string]any{"items": items, "total": total, "has_more": offset+len(items) < total}, rows.Err()
}

type rowScanner interface{ Scan(...any) error }

func (s *Studio) scanTryOn(row rowScanner) (map[string]any, error) {
	var id, pp, gg, mode, instructions, ratio, status string
	var path sql.NullString
	var started sql.NullInt64
	var created int64
	if err := row.Scan(&id, &pp, &gg, &mode, &instructions, &ratio, &status, &path, &started, &created); err != nil {
		return nil, err
	}
	var persons, garments []string
	_ = json.Unmarshal([]byte(pp), &persons)
	_ = json.Unmarshal([]byte(gg), &garments)
	return map[string]any{"id": id, "person_paths": persons, "garment_paths": garments, "person_path": persons[0], "garment_path": garments[0], "generation_mode": mode, "instructions": instructions, "ratio": ratio, "status": status, "file_path": nullableString(path), "generation_started_at": nullableInt(started), "created_at": created, "versions": []map[string]any{}}, nil
}
func (s *Studio) TryOnJob(id string) (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow("select id,person_paths,garment_paths,generation_mode,instructions,ratio,status,file_path,generation_started_at,created_at from try_on_jobs where id=? and user_id=?", id, user.ID)
	return s.scanTryOn(row)
}
func (s *Studio) RegenerateTryOn(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	result, err := s.db.Exec("update try_on_jobs set status='queued',generation_started_at=null where id=? and user_id=?", id, user.ID)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil, errors.New("换装记录不存在")
	}
	go s.generateTryOn(id)
	return map[string]bool{"ok": true}, nil
}
func (s *Studio) DeleteTryOn(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var owned int
	if err = tx.QueryRow("select count(*) from try_on_jobs where id=? and user_id=?", id, user.ID).Scan(&owned); err != nil {
		return nil, err
	}
	if owned == 0 {
		return nil, errors.New("换装记录不存在")
	}
	if _, err = tx.Exec("delete from try_on_versions where job_id=?", id); err != nil {
		return nil, err
	}
	if _, err = tx.Exec("delete from try_on_jobs where id=? and user_id=?", id, user.ID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]bool{"ok": true}, nil
}
func (s *Studio) Analyze(input map[string]string) (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	config, key, _, text, _, err := s.activeProvider(user.ID)
	if err != nil {
		return nil, err
	}
	content := responses.ResponseInputMessageContentListParam{
		responses.ResponseInputContentParamOfInputText("Product: " + input["product"] + ". Return JSON only: {\"description\": Chinese 45-80 character description, \"benefits\": exactly four concise Chinese selling points}."),
	}
	if input["mode"] == "image" && input["reference"] != "" {
		file, e := safeUpload(s.dataDir, input["reference"])
		if e != nil {
			return nil, e
		}
		data, _ := io.ReadAll(file)
		file.Close()
		content = append(content, responses.ResponseInputContentUnionParam{OfInputImage: &responses.ResponseInputImageParam{
			Detail:   responses.ResponseInputImageDetailAuto,
			ImageURL: openai.String("data:image/png;base64," + base64.StdEncoding.EncodeToString(data)),
		}})
	}
	client := s.openAIClient(config, key)
	response, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model:       text,
		Temperature: openai.Float(0.35),
		Input: responses.ResponseNewParamsInputUnion{OfInputItemList: responses.ResponseInputParam{
			responses.ResponseInputItemParamOfMessage(content, responses.EasyInputMessageRoleUser),
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("AI 商品分析请求失败（模型 %s，地址 %s）: %w", text, config.APIBase, err)
	}
	var parsed map[string]any
	clean := strings.TrimSuffix(strings.TrimPrefix(response.OutputText(), "```json"), "```")
	if err = json.Unmarshal([]byte(strings.TrimSpace(clean)), &parsed); err != nil {
		return nil, fmt.Errorf("AI 返回的商品分析格式无效：%s", truncate(strings.TrimSpace(response.OutputText())))
	}
	return parsed, nil
}
func (s *Studio) Chat(messages []map[string]string) (map[string]string, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	config, key, _, _, chat, err := s.activeProvider(user.ID)
	if err != nil {
		return nil, err
	}
	if len(messages) == 0 || messages[len(messages)-1]["role"] != "user" {
		return nil, errors.New("请输入消息")
	}
	input := make(responses.ResponseInputParam, 0, len(messages))
	for _, message := range messages {
		input = append(input, responses.ResponseInputItemParamOfMessage(message["content"], responses.EasyInputMessageRole(message["role"])))
	}
	client := s.openAIClient(config, key)
	response, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model:        chat,
		Instructions: openai.String("You are a helpful Chinese e-commerce creative assistant. Return copy-ready, accurate answers."),
		Input:        responses.ResponseNewParamsInputUnion{OfInputItemList: input},
	})
	if err != nil {
		return nil, fmt.Errorf("AI 对话请求失败（模型 %s，地址 %s）: %w", chat, config.APIBase, err)
	}
	return map[string]string{"text": response.OutputText()}, nil
}
