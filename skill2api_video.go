package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type AIVideoReplicaInput struct {
	SourceVideoPath string  `json:"source_video_path"`
	ProductPath     string  `json:"product_path"`
	Prompt          string  `json:"prompt"`
	PersonPrompt    string  `json:"person_prompt"`
	Model           string  `json:"model"`
	Resolution      string  `json:"resolution"`
	Ratio           string  `json:"ratio"`
	Budget          float64 `json:"budget"`
}

func (s *Studio) CreateAIVideoReplica(input AIVideoReplicaInput) (map[string]string, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("请填写复刻说明")
	}
	if input.Budget <= 0 {
		return nil, errors.New("预算必须大于 0")
	}
	if input.Model == "" {
		input.Model = "qwen3.8-flash"
	}
	if input.Resolution == "" {
		input.Resolution = "480p"
	}
	if input.Ratio == "" {
		input.Ratio = "9:16"
	}
	if _, err = s.replicaSourcePath(input.SourceVideoPath); err != nil {
		return nil, err
	}
	if _, err = s.uploadedImagePath(input.ProductPath); err != nil {
		return nil, err
	}
	id := newID("video-ai-replica")
	refs, _ := json.Marshal([]string{input.ProductPath})
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		_, e := tx.Exec("insert into video_replica_jobs(id,user_id,source_video_path,reference_paths,product_reference_path,task_type,model,prompt,storyboard,storyboard_confirmed,duration,resolution,ratio,status,current_run_id,created_at,ai_person_prompt,ai_budget) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, user.ID, input.SourceVideoPath, string(refs), input.ProductPath, "ai_replica", input.Model, input.Prompt, "[]", 1, 0, input.Resolution, input.Ratio, "queued", "", time.Now().Unix(), input.PersonPrompt, input.Budget)
		return e
	}); err != nil {
		return nil, err
	}
	go s.runAIVideoReplica(id, user.ID, input)
	return map[string]string{"id": id}, nil
}

func (s *Studio) runAIVideoReplica(id, userID string, input AIVideoReplicaInput) {
	fail := func(err error) {
		_ = s.writeTransaction(func(tx *sql.Tx) error {
			_, e := tx.Exec("update video_replica_jobs set status=? where id=?", "failed: "+truncate(err.Error()), id)
			return e
		})
	}
	setStatus := func(status string) {
		_ = s.writeTransaction(func(tx *sql.Tx) error {
			_, e := tx.Exec("update video_replica_jobs set status=?,generation_started_at=coalesce(generation_started_at,?) where id=?", status, time.Now().Unix(), id)
			return e
		})
	}
	setStatus("preparing")
	bearer, err := s.currentHuabotBearer(userID)
	if err != nil {
		fail(err)
		return
	}
	config := s.huabotConfig()
	videoURL, err := s.uploadSkill2APIMedia(config.WebBase, bearer, input.SourceVideoPath)
	if err != nil {
		fail(err)
		return
	}
	imageURL, err := s.uploadSkill2APIMedia(config.WebBase, bearer, input.ProductPath)
	if err != nil {
		fail(err)
		return
	}
	setStatus("submitting")
	prompt := fmt.Sprintf("克隆参考视频的镜头节奏、动作和构图，将目标商品替换为参考商品。参考视频：%s；商品参考图：%s。", videoURL, imageURL)
	if strings.TrimSpace(input.PersonPrompt) != "" {
		prompt += " 替换人物为 " + strings.TrimSpace(input.PersonPrompt)
	}
	prompt += fmt.Sprintf("\n%s\n尺寸 %s %s\n预算 %s 美元", input.Prompt, input.Resolution, input.Ratio, strconv.FormatFloat(input.Budget, 'f', -1, 64))
	var submitted struct {
		RequestID string `json:"request_id"`
	}
	err = jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/skill2api/generate/", bearer, map[string]any{"prompt": prompt, "skill_name": "hypit", "model": input.Model}, &submitted)
	if err != nil || submitted.RequestID == "" {
		if err == nil {
			err = errors.New("Skill2API 未返回 request_id")
		}
		fail(err)
		return
	}
	_ = s.writeTransaction(func(tx *sql.Tx) error {
		_, e := tx.Exec("update video_replica_jobs set skill2api_request_id=?,status=? where id=?", submitted.RequestID, "generating", id)
		return e
	})
	deadline := time.Now().Add(45 * time.Minute)
	for time.Now().Before(deadline) {
		var status map[string]any
		err = jsonRequest(s.httpClient, http.MethodGet, config.WebBase+"/api/skill2api/status/?request_id="+url.QueryEscape(submitted.RequestID), bearer, nil, &status)
		if err != nil {
			fail(err)
			return
		}
		state := stringValue(status["status"])
		if state == "waiting_for_input" {
			fail(errors.New("Skill2API 需要补充输入，请重新提交"))
			return
		}
		if state == "failed" || state == "terminated" {
			fail(errors.New(stringValue(status["error"])))
			return
		}
		if state == "succeeded" {
			files, _ := status["files"].([]any)
			var filePath string
			for _, item := range files {
				p := stringValue(item)
				if strings.HasSuffix(strings.ToLower(p), ".mp4") {
					filePath = p
					break
				}
			}
			if filePath == "" {
				fail(errors.New("Skill2API 未返回 MP4"))
				return
			}
			cleanFile := filepath.Clean(filepath.FromSlash(filePath))
			if cleanFile != filepath.FromSlash(filePath) || strings.HasPrefix(cleanFile, ".."+string(filepath.Separator)) || filepath.IsAbs(cleanFile) {
				fail(errors.New("Skill2API 文件路径无效"))
				return
			}
			var delivery struct {
				DeliveryID string `json:"delivery_id"`
			}
			err = jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/skill2api/file/", bearer, map[string]string{"request_id": submitted.RequestID, "file_path": filePath}, &delivery)
			if err != nil {
				fail(err)
				return
			}
			_ = s.writeTransaction(func(tx *sql.Tx) error {
				_, e := tx.Exec("update video_replica_jobs set skill2api_delivery_id=? where id=?", delivery.DeliveryID, id)
				return e
			})
			for i := 0; i < 180; i++ {
				time.Sleep(2 * time.Second)
				var result map[string]any
				err = jsonRequest(s.httpClient, http.MethodGet, config.WebBase+"/api/skill2api/file/delivery/?request_id="+url.QueryEscape(submitted.RequestID)+"&delivery_id="+url.QueryEscape(delivery.DeliveryID), bearer, nil, &result)
				if err != nil {
					fail(err)
					return
				}
				ds := stringValue(result["status"])
				if ds == "failed" {
					fail(errors.New(stringValue(result["error"])))
					return
				}
				if ds == "succeeded" {
					rawURL := stringValue(result["url"])
					if rawURL == "" {
						fail(errors.New("Skill2API 文件 URL 为空"))
						return
					}
					_ = s.writeTransaction(func(tx *sql.Tx) error {
						_, e := tx.Exec("update video_replica_jobs set status='retrieving' where id=?", id)
						return e
					})
					if err = s.downloadAIVideo(id, rawURL, bearer); err != nil {
						fail(err)
						return
					}
					return
				}
			}
			fail(errors.New("Skill2API 文件投递超时"))
			return
		}
		time.Sleep(5 * time.Second)
	}
	fail(errors.New("Skill2API 生成超时"))
}

func (s *Studio) uploadSkill2APIMedia(baseURL, bearer, localPath string) (string, error) {
	path, err := s.replicaSourcePath(localPath)
	if err != nil {
		path, err = s.uploadedImagePath(localPath)
	}
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return "", err
	}
	if _, err = part.Write(data); err != nil {
		return "", err
	}
	_ = w.WriteField("temporary", "true")
	_ = w.Close()
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/file/run/", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	var result map[string]any
	if err = decodeResponse(resp, &result); err != nil {
		return "", err
	}
	file, _ := result["file"].(map[string]any)
	key, ext := stringValue(file["file_key"]), stringValue(file["file_ext"])
	if key == "" || ext == "" {
		return "", errors.New("Huabot 上传未返回文件地址")
	}
	return baseURL + "/upload/" + key[:2] + "/" + key[2:4] + "/" + key + "." + ext, nil
}

func (s *Studio) downloadAIVideo(id, rawURL, bearer string) error {
	if !strings.HasPrefix(rawURL, "/") {
		return errors.New("Skill2API 下载地址无效")
	}
	config := s.huabotConfig()
	req, err := http.NewRequest(http.MethodGet, config.WebBase+rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("下载视频失败：HTTP %d", resp.StatusCode)
	}
	path := filepath.ToSlash(filepath.Join("generated", "video-replica", id+".mp4"))
	full, err := s.generatedAssetPath(path)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(full, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = io.Copy(file, io.LimitReader(resp.Body, 512<<20))
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return s.writeTransaction(func(tx *sql.Tx) error {
		_, e := tx.Exec("insert into video_replica_versions(id,job_id,source_version_id,file_path,created_at) values(?,?,?,?,?)", newID("video-version"), id, nil, path, time.Now().Unix())
		if e != nil {
			return e
		}
		_, e = tx.Exec("update video_replica_jobs set status='ready',file_path=? where id=?", path, id)
		return e
	})
}
