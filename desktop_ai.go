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
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var imageSizes = map[string][2]int{"1:1": {1024, 1024}, "3:2": {1536, 1024}, "2:3": {1024, 1536}, "16:9": {1536, 864}}

const (
	imageAttemptTimeout    = 3 * time.Minute
	imageGenerationTimeout = 10 * time.Minute
)

func imageSize(ratio string) ([2]int, error) {
	size, ok := imageSizes[ratio]
	if !ok {
		return [2]int{}, errors.New("图像服务仅支持画面比例: 1:1、3:2、2:3、16:9")
	}
	return size, nil
}
func validPNG(data []byte) error {
	if len(data) < 24 || !bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) || !bytes.Equal(data[12:16], []byte("IHDR")) {
		return fmt.Errorf("图像服务未按请求返回 PNG 图片（收到 %s，%d 字节）", imageFormat(data), len(data))
	}
	w := int(data[16])<<24 | int(data[17])<<16 | int(data[18])<<8 | int(data[19])
	h := int(data[20])<<24 | int(data[21])<<16 | int(data[22])<<8 | int(data[23])
	if w < 1 || h < 1 {
		return errors.New("图像服务返回的 PNG 尺寸无效")
	}
	return nil
}

func imageFormat(data []byte) string {
	switch {
	case len(data) >= 8 && bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}):
		return "PNG"
	case len(data) >= 3 && bytes.Equal(data[:3], []byte{255, 216, 255}):
		return "JPEG"
	case len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "WebP"
	case len(data) == 0:
		return "空数据"
	default:
		return fmt.Sprintf("未知数据 % x", data[:min(len(data), 12)])
	}
}

func (s *Studio) GenerateAsset(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	var owned int
	if err = s.db.QueryRow("select count(*) from assets where id=?", id).Scan(&owned); err != nil {
		return nil, err
	}
	if owned == 0 {
		return nil, errors.New("画面不存在")
	}
	if _, _, _, _, _, err = s.activeProvider(user.ID); err != nil {
		return nil, err
	}
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update assets set status='queued',generation_started_at=null where id=?", id)
		return err
	}); err != nil {
		return nil, err
	}
	go s.generateAsset(id, user.ID)
	return map[string]bool{"ok": true}, nil
}
func (s *Studio) GeneratePack(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if _, err = s.localProject(id); err != nil {
		return nil, err
	}
	if _, _, _, _, _, err = s.activeProvider(user.ID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select id from assets where project_id=?", id)
	if err != nil {
		return nil, err
	}
	assets := []string{}
	for rows.Next() {
		var asset string
		if err = rows.Scan(&asset); err != nil {
			rows.Close()
			return nil, err
		}
		assets = append(assets, asset)
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		for _, asset := range assets {
			if _, err := tx.Exec("update assets set status='queued',generation_started_at=null where id=?", asset); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for _, asset := range assets {
		go s.generateAsset(asset, user.ID)
	}
	return map[string]bool{"ok": true}, nil
}
func (s *Studio) generateAsset(id, providerUserID string) {
	var projectID, prompt, ratio, reference string
	if err := s.db.QueryRow("select a.project_id,a.prompt,a.ratio,p.reference from assets a join projects p on p.id=a.project_id where a.id=?", id).Scan(&projectID, &prompt, &ratio, &reference); err != nil {
		return
	}
	startedAt := time.Now().Unix()
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update assets set status='generating',generation_started_at=? where id=?", startedAt, id)
		return err
	}); err != nil {
		return
	}
	s.NotifyGeneration(id, "generating")
	config, key, image, _, _, err := s.activeProvider(providerUserID)
	if err == nil {
		size, sizeErr := imageSize(ratio)
		if sizeErr != nil {
			err = sizeErr
		} else {
			requestContext, cancel := context.WithTimeout(context.Background(), imageGenerationTimeout)
			defer cancel()
			client := s.imageOpenAIClient(config, key)
			var raw *openai.ImagesResponse
			if reference != "" {
				raw, err = s.imageEdit(requestContext, client, image, prompt, size, []string{reference})
			} else {
				raw, err = client.Images.Generate(requestContext, openai.ImageGenerateParams{
					Model:        openai.ImageModel(image),
					Prompt:       prompt,
					N:            openai.Int(1),
					OutputFormat: openai.ImageGenerateParamsOutputFormatPNG,
					Size:         openai.ImageGenerateParamsSize(fmt.Sprintf("%dx%d", size[0], size[1])),
				})
			}
			if err == nil {
				err = s.saveImageResponse(raw, projectID, id, size, "asset_versions", startedAt)
			}
		}
	}
	if err != nil {
		_ = s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update assets set status=? where id=?", "failed: "+imageGenerationFailure(err), id)
			return err
		})
		s.NotifyGeneration(id, "failed")
	} else {
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

func (s *Studio) imageOpenAIClient(config huabotConfig, key string) openai.Client {
	client := *s.httpClient
	client.Timeout = imageAttemptTimeout
	return openai.NewClient(
		option.WithBaseURL(config.APIBase),
		option.WithAPIKey(key),
		option.WithHTTPClient(&client),
		option.WithRequestTimeout(imageAttemptTimeout),
	)
}

func imageGenerationFailure(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "Client.Timeout exceeded") {
		return "图像服务响应超时，请稍后重试"
	}
	return truncate(err.Error())
}

func (s *Studio) imageEdit(ctx context.Context, client openai.Client, model, prompt string, size [2]int, paths []string) (*openai.ImagesResponse, error) {
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
	return client.Images.Edit(ctx, openai.ImageEditParams{
		Image:        openai.ImageEditParamsImageUnion{OfFileArray: readers},
		Model:        openai.ImageModel(model),
		Prompt:       prompt,
		N:            openai.Int(1),
		OutputFormat: openai.ImageEditParamsOutputFormatPNG,
		Size:         openai.ImageEditParamsSize(fmt.Sprintf("%dx%d", size[0], size[1])),
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
func (s *Studio) saveImageResponse(raw *openai.ImagesResponse, folder, entity string, size [2]int, table string, startedAt int64) error {
	if raw == nil || len(raw.Data) == 0 {
		return errors.New("图像服务没有返回图片")
	}
	image, err := s.imageBytes(raw.Data[0])
	if err != nil {
		return err
	}
	if err = validPNG(image); err != nil {
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
	return s.writeTransaction(func(tx *sql.Tx) error {
		switch table {
		case "asset_versions":
			if _, err := tx.Exec("insert into asset_versions(id,asset_id,file_path,generation_started_at,created_at) values(?,?,?,?,?)", newID("version"), entity, path, startedAt, time.Now().Unix()); err != nil {
				return err
			}
			_, err := tx.Exec("update assets set file_path=?,status='ready' where id=?", path, entity)
			return err
		case "try_on_versions":
			if _, err := tx.Exec("insert into try_on_versions(id,job_id,file_path,created_at) values(?,?,?,?)", newID("version"), entity, path, time.Now().Unix()); err != nil {
				return err
			}
			_, err := tx.Exec("update try_on_jobs set status='ready',file_path=? where id=?", path, entity)
			return err
		default:
			return errors.New("未知图像版本表")
		}
	})
}

func (s *Studio) imageBytes(result openai.Image) ([]byte, error) {
	if encoded := strings.TrimSpace(result.B64JSON); encoded != "" {
		image, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return nil, errors.New("图像服务返回的 b64_json 无效")
		}
		return image, nil
	}
	if result.URL == "" {
		return nil, errors.New("图像服务没有返回图像数据（b64_json 和 url 均为空）")
	}
	if _, err := publicImageURL(result.URL); err != nil {
		return nil, fmt.Errorf("图像服务返回的图片 URL 无效: %w", err)
	}
	client := *s.httpClient
	client.CheckRedirect = func(request *http.Request, _ []*http.Request) error {
		_, err := publicImageURL(request.URL.String())
		return err
	}
	response, err := client.Get(result.URL)
	if err != nil {
		return nil, fmt.Errorf("下载图像服务返回的 URL 失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("下载图像服务返回的 URL 失败: HTTP %d", response.StatusCode)
	}
	image, err := io.ReadAll(io.LimitReader(response.Body, maxUploadBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取图像服务返回的 URL 失败: %w", err)
	}
	if len(image) == 0 || len(image) > maxUploadBytes {
		return nil, fmt.Errorf("图像服务返回的 URL 图片大小无效: %d 字节", len(image))
	}
	return image, nil
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
	if err = validateTryOnInput(input); err != nil {
		return nil, err
	}
	if _, _, _, _, _, err = s.activeProvider(user.ID); err != nil {
		return nil, err
	}
	for _, p := range append(append([]string{}, input.PersonPaths...), input.GarmentPaths...) {
		f, e := safeUpload(s.dataDir, p)
		if e != nil {
			return nil, e
		}
		f.Close()
	}
	pairs := [][2][]string{{input.PersonPaths, input.GarmentPaths}}
	if input.GenerationMode == "combinations" {
		pairs = nil
		for _, p := range input.PersonPaths {
			for _, g := range input.GarmentPaths {
				pairs = append(pairs, [2][]string{{p}, {g}})
			}
		}
	}
	ids := make([]string, 0, len(pairs))
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		for _, pair := range pairs {
			pp, _ := json.Marshal(pair[0])
			gg, _ := json.Marshal(pair[1])
			id := newID("tryon")
			if _, err := tx.Exec("insert into try_on_jobs(id,user_id,person_paths,garment_paths,generation_mode,instructions,ratio,status,created_at) values(?,?,?,?,?,?,?,?,?)", id, localWorkspaceID, string(pp), string(gg), input.GenerationMode, input.Instructions, input.Ratio, "queued", time.Now().Unix()); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for _, id := range ids {
		go s.generateTryOn(id, user.ID)
	}
	return map[string]any{"id": ids[0], "ids": ids}, nil
}
func (s *Studio) generateTryOn(id, providerUserID string) {
	var persons, garments, instructions, ratio string
	if err := s.db.QueryRow("select person_paths,garment_paths,instructions,ratio from try_on_jobs where id=?", id).Scan(&persons, &garments, &instructions, &ratio); err != nil {
		return
	}
	startedAt := time.Now().Unix()
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update try_on_jobs set status='generating',generation_started_at=? where id=?", startedAt, id)
		return err
	}); err != nil {
		return
	}
	var pp, gg []string
	_ = json.Unmarshal([]byte(persons), &pp)
	_ = json.Unmarshal([]byte(garments), &gg)
	config, key, image, _, _, err := s.activeProvider(providerUserID)
	if err == nil {
		size, e := imageSize(ratio)
		if e != nil {
			err = e
		} else {
			requestContext, cancel := context.WithTimeout(context.Background(), imageGenerationTimeout)
			defer cancel()
			client := s.imageOpenAIClient(config, key)
			prompt := "Create a realistic full-body fashion try-on image. Preserve the person's identity, pose, body proportions, hair, and background. Replace only their clothing with the supplied garment. Do not add text, watermarks, logos, extra garments, or unrelated objects.\nAdditional direction: " + strings.TrimSpace(instructions)
			raw, requestErr := s.imageEdit(requestContext, client, image, prompt, size, append(pp, gg...))
			err = requestErr
			if err == nil {
				err = s.saveImageResponse(raw, filepath.Join("try-on", localWorkspaceID), id, size, "try_on_versions", startedAt)
			}
		}
	}
	if err != nil {
		_ = s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update try_on_jobs set status=? where id=?", "failed: "+imageGenerationFailure(err), id)
			return err
		})
	}
}
func truncate(value string) string {
	if len(value) > 180 {
		return value[:180]
	}
	return value
}
func (s *Studio) TryOnJobs(limit, offset int) (map[string]any, error) {
	if limit < 1 || limit > 48 || offset < 0 {
		return nil, errors.New("分页参数无效")
	}
	var total int
	if err := s.db.QueryRow("select count(*) from try_on_jobs").Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select id,person_paths,garment_paths,generation_mode,instructions,ratio,status,file_path,generation_started_at,created_at from try_on_jobs order by created_at desc, id desc limit ? offset ?", limit, offset)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		job, err := scanTryOnRow(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, job)
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for _, job := range items {
		if err = s.populateTryOnVersions(job); err != nil {
			return nil, err
		}
	}
	return map[string]any{"items": items, "total": total, "has_more": offset+len(items) < total}, nil
}

type rowScanner interface{ Scan(...any) error }

func scanTryOnRow(row rowScanner) (map[string]any, error) {
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

func (s *Studio) populateTryOnVersions(job map[string]any) error {
	rows, err := s.db.Query("select id,job_id,file_path,created_at from try_on_versions where job_id=? order by created_at desc, id desc", job["id"])
	if err != nil {
		return err
	}
	defer rows.Close()
	versions := []map[string]any{}
	for rows.Next() {
		var id, jobID, path string
		var created int64
		if err = rows.Scan(&id, &jobID, &path, &created); err != nil {
			return err
		}
		versions = append(versions, map[string]any{"id": id, "job_id": jobID, "file_path": path, "created_at": created})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	job["versions"] = versions
	return nil
}

func (s *Studio) scanTryOn(row rowScanner) (map[string]any, error) {
	job, err := scanTryOnRow(row)
	if err != nil {
		return nil, err
	}
	if err = s.populateTryOnVersions(job); err != nil {
		return nil, err
	}
	return job, nil
}
func (s *Studio) TryOnJob(id string) (map[string]any, error) {
	row := s.db.QueryRow("select id,person_paths,garment_paths,generation_mode,instructions,ratio,status,file_path,generation_started_at,created_at from try_on_jobs where id=?", id)
	return s.scanTryOn(row)
}
func (s *Studio) RegenerateTryOn(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if _, _, _, _, _, err = s.activeProvider(user.ID); err != nil {
		return nil, err
	}
	result, err := s.execDataWrite("update try_on_jobs set status='queued',generation_started_at=null where id=?", id)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil, errors.New("换装记录不存在")
	}
	go s.generateTryOn(id, user.ID)
	return map[string]bool{"ok": true}, nil
}
func (s *Studio) DeleteTryOn(id string) (map[string]bool, error) {
	paths := []string{}
	err := s.writeTransaction(func(tx *sql.Tx) error {
		var status string
		var currentPath sql.NullString
		if err := tx.QueryRow("select status,file_path from try_on_jobs where id=?", id).Scan(&status, &currentPath); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errors.New("换装记录不存在")
			}
			return err
		}
		if status == "queued" || status == "generating" {
			return errors.New("正在生成的换装任务不能删除")
		}
		if currentPath.Valid {
			paths = append(paths, currentPath.String)
		}
		rows, err := tx.Query("select file_path from try_on_versions where job_id=?", id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var path string
			if err = rows.Scan(&path); err != nil {
				rows.Close()
				return err
			}
			paths = append(paths, path)
		}
		if err = rows.Close(); err != nil {
			return err
		}
		if err = rows.Err(); err != nil {
			return err
		}
		if _, err = tx.Exec("delete from try_on_versions where job_id=?", id); err != nil {
			return err
		}
		_, err = tx.Exec("delete from try_on_jobs where id=?", id)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.removeTryOnFiles(paths)
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) removeTryOnFiles(paths []string) {
	allowed := filepath.Join(s.dataDir, "storage", "generated", "try-on")
	for _, path := range paths {
		relativePath := filepath.Clean(filepath.FromSlash(path))
		if filepath.IsAbs(relativePath) {
			continue
		}
		target := filepath.Join(s.dataDir, "storage", relativePath)
		relativeToAllowed, err := filepath.Rel(allowed, target)
		if err != nil || relativeToAllowed == "." || strings.HasPrefix(relativeToAllowed, ".."+string(filepath.Separator)) || filepath.IsAbs(relativeToAllowed) {
			continue
		}
		_ = os.Remove(target)
	}
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
		// Temperature: openai.Float(0.35),
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
func (s *Studio) Chat(requestID string, messages []map[string]string) (map[string]string, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(requestID) == "" || len(requestID) > 80 {
		return nil, errors.New("对话请求标识无效")
	}
	if err := validateChatMessages(messages); err != nil {
		return nil, err
	}
	config, key, _, _, chat, err := s.activeProvider(user.ID)
	if err != nil {
		return nil, err
	}
	input := make(responses.ResponseInputParam, 0, len(messages))
	for _, message := range messages {
		input = append(input, responses.ResponseInputItemParamOfMessage(message["content"], responses.EasyInputMessageRole(message["role"])))
	}
	client := s.openAIClient(config, key)
	stream := client.Responses.NewStreaming(context.Background(), responses.ResponseNewParams{
		Model:        chat,
		Instructions: openai.String("You are a helpful Chinese e-commerce creative assistant. Return copy-ready, accurate answers."),
		Input:        responses.ResponseNewParamsInputUnion{OfInputItemList: input},
	})
	defer stream.Close()
	var text strings.Builder
	for stream.Next() {
		event := stream.Current()
		if event.Type != "response.output_text.delta" || event.Delta == "" {
			continue
		}
		delta := event.Delta
		text.WriteString(delta)
		if s.ctx != nil {
			runtime.EventsEmit(s.ctx, "chat:delta:"+requestID, delta)
		}
	}
	if err := stream.Err(); err != nil {
		return nil, fmt.Errorf("AI 对话请求失败（模型 %s，地址 %s）: %w", chat, config.APIBase, err)
	}
	return map[string]string{"text": text.String()}, nil
}
