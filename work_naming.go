package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
)

const maxWorkTitleRunes = 120
const maxWorkNamingImageBytes = 5 << 20

type workTitleInput struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Title string `json:"title"`
}

type workTitleSource struct {
	Kind        string
	Title       string
	Description string
	ImagePaths  []string
}

func validateWorkTitle(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("请填写作品名称")
	}
	if utf8.RuneCountInString(value) > maxWorkTitleRunes {
		return "", fmt.Errorf("作品名称不能超过 %d 个字符", maxWorkTitleRunes)
	}
	return value, nil
}

func (s *Studio) UpdateWorkTitle(input workTitleInput) (map[string]string, error) {
	title, err := validateWorkTitle(input.Title)
	if err != nil {
		return nil, err
	}
	if _, err := s.workTitleSource(input.Kind, input.ID); err != nil {
		return nil, err
	}
	var result sql.Result
	switch input.Kind {
	case "project":
		result, err = s.execDataWrite("update projects set name=? where id=?", title, input.ID)
	case "try-on":
		result, err = s.execDataWrite("update try_on_jobs set title=? where id=?", title, input.ID)
	case "video":
		result, err = s.execDataWrite("update video_replica_jobs set title=? where id=?", title, input.ID)
	default:
		return nil, errors.New("作品类型无效")
	}
	if err != nil {
		return nil, err
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return nil, errors.New("作品名称保存失败")
	}
	return map[string]string{"title": title}, nil
}

func (s *Studio) SuggestWorkTitles(kind, id string) (map[string][]string, error) {
	source, err := s.workTitleSource(kind, id)
	if err != nil {
		return nil, err
	}
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	config, key, _, textModel, _, err := s.activeProvider(user.ID)
	if err != nil {
		return nil, err
	}
	content := responses.ResponseInputMessageContentListParam{
		responses.ResponseInputContentParamOfInputText(fmt.Sprintf("为下面的电商作品提供恰好 3 个简洁、可区分的中文作品名称。名称不得包含引号、编号、Markdown 或解释；不得虚构商品规格、认证或功效。仅返回 JSON：{\"titles\":[\"名称一\",\"名称二\",\"名称三\"]}。\n作品类型：%s\n作品信息：%s", source.Kind, source.Description)),
	}
	for _, path := range source.ImagePaths {
		dataURL, ok := workNamingImageDataURL(path)
		if !ok {
			continue
		}
		content = append(content, responses.ResponseInputContentUnionParam{OfInputImage: &responses.ResponseInputImageParam{
			Detail:   responses.ResponseInputImageDetailAuto,
			ImageURL: openai.String(dataURL),
		}})
	}
	client := s.openAIClient(config, key)
	response, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: textModel,
		Input: responses.ResponseNewParamsInputUnion{OfInputItemList: responses.ResponseInputParam{
			responses.ResponseInputItemParamOfMessage(content, responses.EasyInputMessageRoleUser),
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("AI 命名请求失败：%w", err)
	}
	titles, err := parseWorkTitleSuggestions(response.OutputText())
	if err != nil {
		return nil, err
	}
	return map[string][]string{"titles": titles}, nil
}

func (s *Studio) workTitleSource(kind, id string) (workTitleSource, error) {
	if strings.TrimSpace(id) == "" {
		return workTitleSource{}, errors.New("作品不存在")
	}
	switch kind {
	case "project":
		var title, product, description, benefits, color, reference string
		err := s.db.QueryRow("select name,product,description,benefits,color,reference from projects where id=?", id).Scan(&title, &product, &description, &benefits, &color, &reference)
		if err != nil {
			return workTitleSource{}, errors.New("项目不存在")
		}
		paths := []string{}
		if file, err := safeUpload(s.dataDir, reference); err == nil {
			paths = append(paths, file.Name())
			_ = file.Close()
		}
		return workTitleSource{Kind: "图片作品", Title: title, Description: strings.Join([]string{"商品：" + product, "描述：" + description, "卖点：" + benefits, "色彩：" + color}, "\n"), ImagePaths: paths}, nil
	case "try-on":
		var title, persons, garments, instructions, ratio string
		var output sql.NullString
		err := s.db.QueryRow("select title,person_paths,garment_paths,instructions,ratio,file_path from try_on_jobs where id=?", id).Scan(&title, &persons, &garments, &instructions, &ratio, &output)
		if err != nil {
			return workTitleSource{}, errors.New("换装作品不存在")
		}
		paths := []string{}
		if output.Valid {
			if path, err := s.generatedAssetPath(output.String); err == nil {
				paths = append(paths, path)
			}
		}
		var personPaths, garmentPaths []string
		_ = json.Unmarshal([]byte(persons), &personPaths)
		_ = json.Unmarshal([]byte(garments), &garmentPaths)
		for _, candidate := range append(personPaths, garmentPaths...) {
			if file, err := safeUpload(s.dataDir, candidate); err == nil {
				paths = append(paths, file.Name())
				_ = file.Close()
			}
		}
		return workTitleSource{Kind: "换装作品", Title: title, Description: "换装说明：" + instructions + "\n画面比例：" + ratio, ImagePaths: paths}, nil
	case "video":
		var title, taskType, model, prompt, ratio, resolution, product string
		var output sql.NullString
		err := s.db.QueryRow("select title,task_type,model,prompt,ratio,resolution,product_reference_path,file_path from video_replica_jobs where id=?", id).Scan(&title, &taskType, &model, &prompt, &ratio, &resolution, &product, &output)
		if err != nil {
			return workTitleSource{}, errors.New("视频作品不存在")
		}
		paths := []string{}
		if file, err := safeUpload(s.dataDir, product); err == nil {
			paths = append(paths, file.Name())
			_ = file.Close()
		}
		if output.Valid {
			if preview, err := videoReplicaPreviewPath(output.String); err == nil {
				if path, err := s.generatedAssetPath(preview); err == nil {
					paths = append(paths, path)
				}
			}
		}
		return workTitleSource{Kind: "视频作品", Title: title, Description: strings.Join([]string{"模式：" + taskType, "模型：" + model, "提示词：" + prompt, "画面比例：" + ratio, "清晰度：" + resolution}, "\n"), ImagePaths: paths}, nil
	default:
		return workTitleSource{}, errors.New("作品类型无效")
	}
}

func workNamingImageDataURL(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 || len(data) > maxWorkNamingImageBytes {
		return "", false
	}
	ext := strings.ToLower(filepath.Ext(path))
	contentType := map[string]string{".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}[ext]
	if contentType == "" {
		return "", false
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data), true
}

func parseWorkTitleSuggestions(raw string) ([]string, error) {
	var parsed struct {
		Titles []string `json:"titles"`
	}
	clean := strings.TrimSpace(raw)
	clean = strings.TrimPrefix(clean, "```json")
	clean = strings.TrimPrefix(clean, "```")
	clean = strings.TrimSuffix(strings.TrimSpace(clean), "```")
	if err := json.Unmarshal([]byte(strings.TrimSpace(clean)), &parsed); err != nil {
		return nil, errors.New("AI 返回的名称格式无效")
	}
	if len(parsed.Titles) != 3 {
		return nil, errors.New("AI 未返回 3 个名称")
	}
	seen := map[string]bool{}
	for index, title := range parsed.Titles {
		validated, err := validateWorkTitle(title)
		if err != nil || seen[validated] {
			return nil, errors.New("AI 返回的名称无效")
		}
		seen[validated] = true
		parsed.Titles[index] = validated
	}
	return parsed.Titles, nil
}
