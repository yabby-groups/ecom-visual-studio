package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
)

type VideoReplicaInput struct {
	SourceVideoPath string           `json:"source_video_path"`
	ReferencePaths  []string         `json:"reference_paths"`
	TaskType        string           `json:"task_type"`
	Model           string           `json:"model"`
	Prompt          string           `json:"prompt"`
	Storyboard      []map[string]any `json:"storyboard"`
	Duration        int              `json:"duration"`
	Resolution      string           `json:"resolution"`
	Ratio           string           `json:"ratio"`
}

var seedanceModels = map[string]string{
	"seedance-2.0": "doubao-seedance-2.0-mini",
	"seedance-2.5": "doubao-seedance-2.5",
}

func (s *Studio) UploadVideoReplicaVideo(name, contentType string, data []byte) (map[string]string, error) {
	if len(data) == 0 || len(data) > maxVideoUploadBytes {
		return nil, errors.New("视频大小必须在 200MB 以内")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".mp4" && ext != ".webm" && ext != ".mov" {
		return nil, errors.New("仅支持 MP4、WebM 或 MOV 视频")
	}
	detected := strings.ToLower(strings.Split(http.DetectContentType(data), ";")[0])
	if !strings.HasPrefix(detected, "video/") && !(ext == ".mp4" && detected == "application/octet-stream") {
		return nil, errors.New("所选文件不是有效视频")
	}
	path := filepath.Join(s.dataDir, "storage", "uploads", newID("video-upload")+ext)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return nil, err
	}
	seconds, err := videoDuration(path)
	if err != nil || seconds > 300 {
		_ = os.Remove(path)
		if err != nil {
			return nil, errors.New("无法读取视频时长，请确认已安装 ffprobe")
		}
		return nil, errors.New("视频时长不能超过 5 分钟")
	}
	return map[string]string{"path": "uploads/" + filepath.Base(path)}, nil
}

func (s *Studio) AnalyzeVideoReplica(path string) (map[string]any, error) {
	file, err := s.uploadedMediaPath(path)
	if err != nil {
		return nil, err
	}
	frames, cleanup, err := extractVideoFrames(file)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	config, key, _, textModel, _, err := s.activeProvider(user.ID)
	if err != nil {
		return nil, err
	}
	content := responses.ResponseInputMessageContentListParam{
		responses.ResponseInputContentParamOfInputText("分析这些视频关键帧，生成可编辑的视频复刻分镜。只返回 JSON：{\"storyboard\":[{\"start\":0,\"end\":5,\"shot\":\"镜头\",\"action\":\"动作\",\"dialogue\":\"对白\",\"continuity\":\"连续性约束\"}]}。按时间顺序覆盖完整视频，不能编造不存在的对白。"),
	}
	for _, frame := range frames {
		data, readErr := os.ReadFile(frame)
		if readErr != nil {
			return nil, readErr
		}
		content = append(content, responses.ResponseInputContentUnionParam{OfInputImage: &responses.ResponseInputImageParam{
			Detail:   responses.ResponseInputImageDetailAuto,
			ImageURL: openai.String("data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)),
		}})
	}
	client := s.openAIClient(config, key)
	response, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: textModel,
		Input: responses.ResponseNewParamsInputUnion{OfInputItemList: responses.ResponseInputParam{responses.ResponseInputItemParamOfMessage(content, responses.EasyInputMessageRoleUser)}},
	})
	if err != nil {
		return nil, fmt.Errorf("视频分析失败：%w", err)
	}
	var result map[string]any
	clean := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(response.OutputText(), "```json"), "```"))
	if err := json.Unmarshal([]byte(clean), &result); err != nil {
		return nil, errors.New("视频分析结果不是有效的分镜 JSON")
	}
	if _, ok := result["storyboard"].([]any); !ok {
		return nil, errors.New("视频分析结果缺少分镜")
	}
	return result, nil
}

func (s *Studio) CreateVideoReplica(input VideoReplicaInput) (map[string]string, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if err := validateVideoReplicaInput(input); err != nil {
		return nil, err
	}
	if _, _, _, _, _, err = s.activeProvider(user.ID); err != nil {
		return nil, err
	}
	if _, err = s.replicaSourcePath(input.SourceVideoPath); err != nil {
		return nil, err
	}
	for _, path := range input.ReferencePaths {
		if _, err = s.uploadedImagePath(path); err != nil {
			return nil, err
		}
	}
	storyboard, _ := json.Marshal(input.Storyboard)
	id := newID("video-replica")
	refs, _ := json.Marshal(input.ReferencePaths)
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("insert into video_replica_jobs(id,user_id,source_video_path,reference_paths,task_type,model,prompt,storyboard,storyboard_confirmed,duration,resolution,ratio,status,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, localWorkspaceID, input.SourceVideoPath, string(refs), input.TaskType, seedanceModels[input.Model], input.Prompt, string(storyboard), 1, input.Duration, input.Resolution, input.Ratio, "queued", time.Now().Unix())
		return err
	}); err != nil {
		return nil, err
	}
	go s.generateVideoReplica(id, user.ID)
	return map[string]string{"id": id}, nil
}

func (s *Studio) UpdateVideoReplicaStoryboard(id string, storyboard []map[string]any) (map[string]bool, error) {
	if len(storyboard) == 0 {
		return nil, errors.New("分镜不能为空")
	}
	raw, err := json.Marshal(storyboard)
	if err != nil {
		return nil, err
	}
	result, err := s.execDataWrite("update video_replica_jobs set storyboard=?,storyboard_confirmed=0 where id=?", string(raw), id)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil, errors.New("视频任务不存在")
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) ConfirmVideoReplicaStoryboard(id string) (map[string]bool, error) {
	result, err := s.execDataWrite("update video_replica_jobs set storyboard_confirmed=1 where id=?", id)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil, errors.New("视频任务不存在")
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) VideoReplicaJobs(limit, offset int) (map[string]any, error) {
	if limit < 1 || limit > 48 || offset < 0 {
		return nil, errors.New("分页参数无效")
	}
	var total int
	if err := s.db.QueryRow("select count(*) from video_replica_jobs").Scan(&total); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select id,source_video_path,reference_paths,task_type,model,prompt,storyboard,storyboard_confirmed,duration,resolution,ratio,status,file_path,generation_started_at,created_at from video_replica_jobs order by created_at desc,id desc limit ? offset ?", limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		job, scanErr := scanVideoReplicaRow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if err = s.populateVideoReplicaVersions(job); err != nil {
			return nil, err
		}
		items = append(items, job)
	}
	return map[string]any{"items": items, "total": total, "has_more": offset+len(items) < total}, rows.Err()
}

func (s *Studio) VideoReplicaJob(id string) (map[string]any, error) {
	row := s.db.QueryRow("select id,source_video_path,reference_paths,task_type,model,prompt,storyboard,storyboard_confirmed,duration,resolution,ratio,status,file_path,generation_started_at,created_at from video_replica_jobs where id=?", id)
	job, err := scanVideoReplicaRow(row)
	if err != nil {
		return nil, errors.New("视频任务不存在")
	}
	if err = s.populateVideoReplicaVersions(job); err != nil {
		return nil, err
	}
	return job, nil
}

func (s *Studio) RegenerateVideoReplica(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	result, err := s.execDataWrite("update video_replica_jobs set status='queued',generation_started_at=null where id=? and status not in ('queued','generating')", id)
	if err != nil {
		return nil, err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return nil, errors.New("视频任务不存在或正在生成")
	}
	go s.generateVideoReplica(id, user.ID)
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) generateVideoReplica(id, providerUserID string) {
	var source, refsJSON, taskType, model, prompt, storyboard, ratio, resolution string
	var duration int
	if err := s.db.QueryRow("select source_video_path,reference_paths,task_type,model,prompt,storyboard,duration,resolution,ratio from video_replica_jobs where id=?", id).Scan(&source, &refsJSON, &taskType, &model, &prompt, &storyboard, &duration, &resolution, &ratio); err != nil {
		return
	}
	started := time.Now().Unix()
	_ = s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update video_replica_jobs set status='generating',generation_started_at=? where id=?", started, id)
		return err
	})
	_, key, _, _, _, err := s.activeProvider(providerUserID)
	if err == nil {
		var refs []string
		_ = json.Unmarshal([]byte(refsJSON), &refs)
		inputRefs := []map[string]any{{"type": "video_url", "video_url": map[string]string{"url": "asset://" + filepath.Base(source)}}}
		for _, ref := range refs {
			inputRefs = append(inputRefs, map[string]any{"type": "image_url", "image_url": map[string]string{"url": "asset://" + filepath.Base(ref)}})
		}
		payload := map[string]any{"model": model, "prompt": prompt + "\n\n复刻分镜：" + storyboard, "duration": duration, "resolution": resolution, "ratio": ratio, "omni_reference_task_type": taskType, "input_references": inputRefs}
		var submitted struct {
			ID         string `json:"id"`
			PollingURL string `json:"polling_url"`
		}
		config := s.huabotConfig()
		err = jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/v1/videos", key, payload, &submitted)
		if err == nil && submitted.PollingURL == "" {
			err = errors.New("视频服务没有返回 polling_url")
		}
		if err == nil {
			_ = s.writeTransaction(func(tx *sql.Tx) error {
				_, e := tx.Exec("update video_replica_jobs set remote_id=?,polling_url=? where id=?", submitted.ID, submitted.PollingURL, id)
				return e
			})
			err = s.pollVideoReplica(submitted.PollingURL, key, id, started)
		}
	}
	if err != nil {
		_ = s.writeTransaction(func(tx *sql.Tx) error {
			_, e := tx.Exec("update video_replica_jobs set status=? where id=?", "failed: "+truncate(err.Error()), id)
			return e
		})
	}
}

func (s *Studio) pollVideoReplica(pollingURL, key, id string, started int64) error {
	deadline := time.Now().Add(40 * time.Minute)
	for time.Now().Before(deadline) {
		var status struct {
			Status string   `json:"status"`
			Error  string   `json:"error"`
			URLs   []string `json:"unsigned_urls"`
		}
		if err := jsonRequest(s.httpClient, http.MethodGet, pollingURL, key, nil, &status); err != nil {
			return err
		}
		switch status.Status {
		case "completed":
			if len(status.URLs) == 0 {
				return errors.New("视频服务没有返回结果地址")
			}
			response, err := s.httpClient.Get(status.URLs[0])
			if err != nil {
				return err
			}
			defer response.Body.Close()
			if response.StatusCode < 200 || response.StatusCode >= 300 {
				return fmt.Errorf("获取视频失败：HTTP %d", response.StatusCode)
			}
			path := filepath.Join(s.dataDir, "storage", "generated", "video-replica", id, fmt.Sprintf("%d.mp4", time.Now().UnixNano()))
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return err
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(file, response.Body)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			rel, _ := filepath.Rel(filepath.Join(s.dataDir, "storage"), path)
			return s.writeTransaction(func(tx *sql.Tx) error {
				if _, err := tx.Exec("update video_replica_jobs set status='ready',file_path=? where id=?", filepath.ToSlash(rel), id); err != nil {
					return err
				}
				_, err := tx.Exec("insert into video_replica_versions(id,job_id,file_path,created_at) values(?,?,?,?)", newID("video-version"), id, filepath.ToSlash(rel), time.Now().Unix())
				return err
			})
		case "failed":
			if status.Error == "" {
				status.Error = "视频服务生成失败"
			}
			return errors.New(status.Error)
		}
		time.Sleep(5 * time.Second)
	}
	return errors.New("视频生成超时")
}

func scanVideoReplicaRow(row rowScanner) (map[string]any, error) {
	var id, source, refsJSON, taskType, model, prompt, storyboardJSON, resolution, ratio, status string
	var confirmed, duration int
	var path sql.NullString
	var started sql.NullInt64
	var created int64
	if err := row.Scan(&id, &source, &refsJSON, &taskType, &model, &prompt, &storyboardJSON, &confirmed, &duration, &resolution, &ratio, &status, &path, &started, &created); err != nil {
		return nil, err
	}
	var refs []string
	var storyboard []map[string]any
	_ = json.Unmarshal([]byte(refsJSON), &refs)
	_ = json.Unmarshal([]byte(storyboardJSON), &storyboard)
	return map[string]any{"id": id, "source_video_path": source, "reference_paths": refs, "task_type": taskType, "model": model, "prompt": prompt, "storyboard": storyboard, "storyboard_confirmed": confirmed == 1, "duration": duration, "resolution": resolution, "ratio": ratio, "status": status, "file_path": nullableString(path), "generation_started_at": nullableInt(started), "created_at": created, "versions": []map[string]any{}}, nil
}

func (s *Studio) populateVideoReplicaVersions(job map[string]any) error {
	rows, err := s.db.Query("select id,job_id,source_version_id,file_path,created_at from video_replica_versions where job_id=? order by created_at desc,id desc", job["id"])
	if err != nil {
		return err
	}
	defer rows.Close()
	versions := []map[string]any{}
	for rows.Next() {
		var id, jobID, sourceID, path string
		var created int64
		if err := rows.Scan(&id, &jobID, &sourceID, &path, &created); err != nil {
			return err
		}
		versions = append(versions, map[string]any{"id": id, "job_id": jobID, "source_version_id": sourceID, "file_path": path, "created_at": created})
	}
	job["versions"] = versions
	return rows.Err()
}

func validateVideoReplicaInput(input VideoReplicaInput) error {
	if input.TaskType != "auto" && input.TaskType != "reference" && input.TaskType != "extend" {
		return errors.New("视频复刻模式无效")
	}
	if _, ok := seedanceModels[input.Model]; !ok {
		return errors.New("请选择 Seedance 2.0 或 2.5")
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return errors.New("请确认复刻脚本")
	}
	if input.Duration < 1 || input.Duration > 60 {
		return errors.New("视频时长须在 1 到 60 秒之间")
	}
	if input.Resolution != "480p" && input.Resolution != "720p" {
		return errors.New("视频清晰度无效")
	}
	if input.Ratio != "adaptive" && input.Ratio != "16:9" && input.Ratio != "9:16" && input.Ratio != "1:1" {
		return errors.New("视频比例无效")
	}
	if len(input.ReferencePaths) > 4 {
		return errors.New("参考图片最多 4 张")
	}
	return nil
}

func (s *Studio) uploadedMediaPath(path string) (string, error) {
	rel := filepath.Clean(filepath.FromSlash(path))
	root := filepath.Join(s.dataDir, "storage", "uploads")
	file := filepath.Join(s.dataDir, "storage", rel)
	if rel == "." || strings.HasPrefix(rel, "..") || !strings.HasPrefix(rel, "uploads"+string(filepath.Separator)) || !isWithin(root, file) {
		return "", errors.New("视频文件路径无效")
	}
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("视频文件不存在")
	}
	return file, nil
}

func (s *Studio) replicaSourcePath(path string) (string, error) {
	if strings.HasPrefix(path, "generated/") {
		rel := filepath.Clean(filepath.FromSlash(path))
		root := filepath.Join(s.dataDir, "storage", "generated")
		file := filepath.Join(s.dataDir, "storage", rel)
		if rel == "." || strings.HasPrefix(rel, "..") || !isWithin(root, file) {
			return "", errors.New("视频结果路径无效")
		}
		info, err := os.Stat(file)
		if err != nil || !info.Mode().IsRegular() {
			return "", errors.New("视频结果不存在")
		}
		return file, nil
	}
	return s.uploadedMediaPath(path)
}

func videoDuration(path string) (float64, error) {
	command := exec.Command(mediaToolPath("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path)
	output, err := command.Output()
	if err != nil {
		return 0, err
	}
	return strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
}

func extractVideoFrames(path string) ([]string, func(), error) {
	dir, err := os.MkdirTemp("", "ecom-video-frames-")
	if err != nil {
		return nil, func() {}, err
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	command := exec.Command(mediaToolPath("ffmpeg"), "-y", "-i", path, "-vf", "fps=1/5,scale=768:-1", "-frames:v", "12", filepath.Join(dir, "frame-%02d.jpg"))
	if output, err := command.CombinedOutput(); err != nil {
		cleanup()
		return nil, func() {}, fmt.Errorf("抽取视频关键帧失败：%s", strings.TrimSpace(string(output)))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		cleanup()
		return nil, func() {}, err
	}
	frames := make([]string, 0, len(entries))
	for _, entry := range entries {
		frames = append(frames, filepath.Join(dir, entry.Name()))
	}
	return frames, cleanup, nil
}
