package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
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

type videoSegmentPlan struct {
	Start    int
	Duration int
	Prompt   string
}

type videoSegment struct {
	ID       string
	Index    int
	Start    int
	Duration int
	Prompt   string
	Status   string
	Path     string
}

var seedanceModels = map[string]string{
	"seedance-2.0": "doubao-seedance-2.0-mini",
	"seedance-2.5": "doubao-seedance-2.5",
}

var seedanceMaxDuration = map[string]int{
	"seedance-2.0": 15,
	"seedance-2.5": 30,
}

func segmentVideo(duration, maxDuration int, storyboard []map[string]any, prompt string) ([]videoSegmentPlan, error) {
	if duration < 4 || duration > 300 || maxDuration < 4 {
		return nil, errors.New("视频时长须在 4 到 300 秒之间")
	}
	count := (duration + maxDuration - 1) / maxDuration
	for duration/count < 4 {
		count--
	}
	plans := make([]videoSegmentPlan, 0, count)
	start := 0
	for index := 0; index < count; index++ {
		length := duration / count
		if index < duration%count {
			length++
		}
		end := start + length
		lines := []string{strings.TrimSpace(prompt), fmt.Sprintf("片段 %d/%d，目标时间 %d-%d 秒。保持人物、商品、色彩和镜头运动连续。", index+1, count, start, end)}
		for _, shot := range storyboard {
			shotStart, startOK := storyboardSecond(shot["start"])
			shotEnd, endOK := storyboardSecond(shot["end"])
			if !startOK || !endOK || shotEnd <= float64(start) || shotStart >= float64(end) {
				continue
			}
			lines = append(lines, fmt.Sprintf("%v-%v 秒：镜头 %v；动作 %v；对白 %v；连续性 %v", shot["start"], shot["end"], shot["shot"], shot["action"], shot["dialogue"], shot["continuity"]))
		}
		plans = append(plans, videoSegmentPlan{Start: start, Duration: length, Prompt: strings.Join(lines, "\n")})
		start = end
	}
	return plans, nil
}

func storyboardSecond(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	default:
		return 0, false
	}
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
	runID := newID("video-run")
	plans, err := segmentVideo(input.Duration, seedanceMaxDuration[input.Model], input.Storyboard, input.Prompt)
	if err != nil {
		return nil, err
	}
	refs, _ := json.Marshal(input.ReferencePaths)
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec("insert into video_replica_jobs(id,user_id,source_video_path,reference_paths,task_type,model,prompt,storyboard,storyboard_confirmed,duration,resolution,ratio,status,current_run_id,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, localWorkspaceID, input.SourceVideoPath, string(refs), input.TaskType, seedanceModels[input.Model], input.Prompt, string(storyboard), 1, input.Duration, input.Resolution, input.Ratio, "queued", runID, time.Now().Unix()); err != nil {
			return err
		}
		return insertVideoSegments(tx, id, runID, plans)
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
		if err = s.populateVideoReplicaSegments(job); err != nil {
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
	if err = s.populateVideoReplicaSegments(job); err != nil {
		return nil, err
	}
	return job, nil
}

func (s *Studio) RegenerateVideoReplica(id string) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	err = s.writeTransaction(func(tx *sql.Tx) error {
		var status, runID, model, prompt, rawStoryboard string
		var duration int
		if err := tx.QueryRow("select status,current_run_id,model,prompt,storyboard,duration from video_replica_jobs where id=?", id).Scan(&status, &runID, &model, &prompt, &rawStoryboard, &duration); err != nil {
			return errors.New("视频任务不存在")
		}
		if status == "queued" || status == "preparing" || status == "generating" || status == "downloading" || status == "merging" {
			return errors.New("视频任务正在生成")
		}
		var remaining int
		if (strings.HasPrefix(status, "failed") || status == "interrupted") && runID != "" {
			if err := tx.QueryRow("select count(*) from video_replica_segments where job_id=? and run_id=? and status<>'ready'", id, runID).Scan(&remaining); err != nil {
				return err
			}
		}
		if remaining == 0 {
			var storyboard []map[string]any
			_ = json.Unmarshal([]byte(rawStoryboard), &storyboard)
			maxDuration := 0
			for alias, providerModel := range seedanceModels {
				if providerModel == model {
					maxDuration = seedanceMaxDuration[alias]
				}
			}
			plans, err := segmentVideo(duration, maxDuration, storyboard, prompt)
			if err != nil {
				return err
			}
			runID = newID("video-run")
			if err := insertVideoSegments(tx, id, runID, plans); err != nil {
				return err
			}
		}
		_, err := tx.Exec("update video_replica_jobs set status='queued',generation_started_at=null,current_run_id=? where id=?", runID, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	go s.generateVideoReplica(id, user.ID)
	return map[string]bool{"ok": true}, nil
}

func insertVideoSegments(tx *sql.Tx, jobID, runID string, plans []videoSegmentPlan) error {
	for index, plan := range plans {
		if _, err := tx.Exec("insert into video_replica_segments(id,job_id,run_id,segment_index,start_second,duration,prompt,status,created_at) values(?,?,?,?,?,?,?,?,?)", newID("video-segment"), jobID, runID, index, plan.Start, plan.Duration, plan.Prompt, "queued", time.Now().Unix()); err != nil {
			return err
		}
	}
	return nil
}

func (s *Studio) generateVideoReplica(id, providerUserID string) {
	log.Printf("video generation started: job=%s user=%s", id, providerUserID)
	var source, refsJSON, taskType, model, ratio, resolution, runID string
	var duration int
	if err := s.db.QueryRow("select source_video_path,reference_paths,task_type,model,duration,resolution,ratio,current_run_id from video_replica_jobs where id=?", id).Scan(&source, &refsJSON, &taskType, &model, &duration, &resolution, &ratio, &runID); err != nil {
		log.Printf("video generation load failed: job=%s error=%v", id, err)
		return
	}
	started := time.Now().Unix()
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update video_replica_jobs set status='preparing',generation_started_at=? where id=?", started, id)
		return err
	}); err != nil {
		log.Printf("video generation state failed: job=%s error=%v", id, err)
		return
	}
	err := s.runVideoSegments(id, runID, providerUserID, source, refsJSON, taskType, model, resolution, ratio, duration)
	if err != nil {
		log.Printf("video generation failed: job=%s error=%v", id, err)
		_ = s.writeTransaction(func(tx *sql.Tx) error {
			_, e := tx.Exec("update video_replica_jobs set status=? where id=?", "failed: "+truncate(err.Error()), id)
			return e
		})
	}
}

func (s *Studio) runVideoSegments(id, runID, providerUserID, source, refsJSON, taskType, model, resolution, ratio string, duration int) error {
	_, key, _, _, _, err := s.activeProvider(providerUserID)
	if err != nil {
		return err
	}
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update video_replica_jobs set status='generating' where id=?", id)
		return err
	}); err != nil {
		return err
	}
	var refs []string
	if err := json.Unmarshal([]byte(refsJSON), &refs); err != nil {
		return err
	}
	inputRefs := make([]map[string]any, 0, len(refs)+1)
	if taskType == "extend" {
		videoURL, err := s.mediaDataURL(source, true)
		if err != nil {
			return err
		}
		inputRefs = append(inputRefs, map[string]any{"type": "video_url", "video_url": map[string]string{"url": videoURL}})
	}
	for _, ref := range refs {
		refURL, err := s.mediaDataURL(ref, false)
		if err != nil {
			return err
		}
		inputRefs = append(inputRefs, map[string]any{"type": "image_url", "image_url": map[string]string{"url": refURL}})
	}
	rows, err := s.db.Query("select id,segment_index,start_second,duration,prompt,status,coalesce(file_path,'') from video_replica_segments where job_id=? and run_id=? order by segment_index", id, runID)
	if err != nil {
		return err
	}
	segments := []videoSegment{}
	for rows.Next() {
		var segment videoSegment
		if err := rows.Scan(&segment.ID, &segment.Index, &segment.Start, &segment.Duration, &segment.Prompt, &segment.Status, &segment.Path); err != nil {
			rows.Close()
			return err
		}
		segments = append(segments, segment)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if len(segments) == 0 {
		return errors.New("视频片段计划不存在")
	}
	config := s.huabotConfig()
	for index := range segments {
		segment := &segments[index]
		if segment.Status == "ready" && segment.Path != "" {
			if _, err := s.generatedAssetPath(segment.Path); err == nil {
				continue
			}
		}
		if err := s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update video_replica_segments set status='submitting' where id=?", segment.ID)
			return err
		}); err != nil {
			return err
		}
		payload := map[string]any{"model": model, "prompt": segment.Prompt, "duration": segment.Duration, "resolution": resolution, "ratio": ratio, "omni_reference_task_type": taskType}
		if len(inputRefs) > 0 {
			payload["input_references"] = inputRefs
		}
		var submitted struct {
			ID         string `json:"id"`
			PollingURL string `json:"polling_url"`
		}
		log.Printf("video segment submitting: job=%s segment=%d/%d model=%s duration=%d", id, index+1, len(segments), model, segment.Duration)
		err = jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/v1/videos?url_mode=original", key, payload, &submitted)
		if err != nil {
			return s.failVideoSegment(segment.ID, err)
		}
		if submitted.PollingURL == "" {
			return s.failVideoSegment(segment.ID, errors.New("视频服务没有返回 polling_url"))
		}
		if err := s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update video_replica_segments set remote_id=?,polling_url=? where id=?", submitted.ID, submitted.PollingURL, segment.ID)
			return err
		}); err != nil {
			return err
		}
		if err := s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update video_replica_segments set status='generating' where id=?", segment.ID)
			return err
		}); err != nil {
			return err
		}
		segment.Path, err = s.pollVideoReplica(submitted.PollingURL, key, id, segment.ID)
		if err != nil {
			return s.failVideoSegment(segment.ID, err)
		}
		if err := s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update video_replica_segments set status='ready',file_path=? where id=?", segment.Path, segment.ID)
			return err
		}); err != nil {
			return err
		}
	}
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update video_replica_jobs set status='merging' where id=?", id)
		return err
	}); err != nil {
		return err
	}
	path, err := s.mergeVideoSegments(id, runID, source, segments, duration)
	if err != nil {
		return err
	}
	return s.writeTransaction(func(tx *sql.Tx) error {
		var previous sql.NullString
		_ = tx.QueryRow("select id from video_replica_versions where job_id=? order by created_at desc,id desc limit 1", id).Scan(&previous)
		if _, err := tx.Exec("insert into video_replica_versions(id,job_id,source_version_id,file_path,created_at) values(?,?,?,?,?)", newID("video-version"), id, previous, path, time.Now().Unix()); err != nil {
			return err
		}
		_, err := tx.Exec("update video_replica_jobs set status='ready',file_path=? where id=?", path, id)
		return err
	})
}

func (s *Studio) failVideoSegment(id string, cause error) error {
	_ = s.writeTransaction(func(tx *sql.Tx) error {
		_, err := tx.Exec("update video_replica_segments set status=? where id=?", "failed: "+truncate(cause.Error()), id)
		return err
	})
	return cause
}

func (s *Studio) pollVideoReplica(pollingURL, key, jobID, segmentID string) (string, error) {
	deadline := time.Now().Add(40 * time.Minute)
	lastStatus := ""
	for time.Now().Before(deadline) {
		var status struct {
			Status string   `json:"status"`
			Error  string   `json:"error"`
			URLs   []string `json:"unsigned_urls"`
		}
		if err := jsonRequest(s.httpClient, http.MethodGet, pollingURL, key, nil, &status); err != nil {
			log.Printf("video generation poll failed: job=%s error=%v", jobID, err)
			return "", err
		}
		if status.Status != lastStatus {
			log.Printf("video generation status: job=%s status=%s", jobID, status.Status)
			lastStatus = status.Status
		}
		switch status.Status {
		case "completed":
			log.Printf("video generation completed remotely: job=%s", jobID)
			if len(status.URLs) == 0 {
				return "", errors.New("视频服务没有返回结果地址")
			}
			if err := s.writeTransaction(func(tx *sql.Tx) error {
				_, err := tx.Exec("update video_replica_jobs set status='downloading' where id=?", jobID)
				if err != nil {
					return err
				}
				_, err = tx.Exec("update video_replica_segments set status='downloading' where id=?", segmentID)
				return err
			}); err != nil {
				return "", err
			}
			response, err := s.httpClient.Get(status.URLs[0])
			if err != nil {
				return "", err
			}
			defer response.Body.Close()
			if response.StatusCode < 200 || response.StatusCode >= 300 {
				return "", fmt.Errorf("获取视频失败：HTTP %d", response.StatusCode)
			}
			path := filepath.Join(s.dataDir, "storage", "generated", "video-replica", jobID, segmentID+".mp4")
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return "", err
			}
			file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
			if err != nil {
				return "", err
			}
			_, copyErr := io.Copy(file, response.Body)
			closeErr := file.Close()
			if copyErr != nil {
				return "", copyErr
			}
			if closeErr != nil {
				return "", closeErr
			}
			rel, _ := filepath.Rel(filepath.Join(s.dataDir, "storage"), path)
			return filepath.ToSlash(rel), nil
		case "failed":
			if status.Error == "" {
				status.Error = "视频服务生成失败"
			}
			log.Printf("video generation failed remotely: job=%s error=%s", jobID, status.Error)
			return "", errors.New(status.Error)
		}
		time.Sleep(5 * time.Second)
	}
	return "", errors.New("视频生成超时")
}

func (s *Studio) mergeVideoSegments(jobID, runID, source string, segments []videoSegment, expectedDuration int) (string, error) {
	list, err := os.CreateTemp("", "ecom-video-concat-*.txt")
	if err != nil {
		return "", err
	}
	listPath := list.Name()
	defer os.Remove(listPath)
	for _, segment := range segments {
		path, err := s.generatedAssetPath(segment.Path)
		if err != nil {
			list.Close()
			return "", err
		}
		quoted := strings.ReplaceAll(filepath.ToSlash(path), "'", "'\\''")
		if _, err := fmt.Fprintf(list, "file '%s'\n", quoted); err != nil {
			list.Close()
			return "", err
		}
	}
	if err := list.Close(); err != nil {
		return "", err
	}
	output := filepath.Join(s.dataDir, "storage", "generated", "video-replica", jobID, runID+".mp4")
	if err := os.MkdirAll(filepath.Dir(output), 0o700); err != nil {
		return "", err
	}
	command := exec.Command(mediaToolPath("ffmpeg"), "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output)
	if outputLog, err := command.CombinedOutput(); err != nil {
		return "", fmt.Errorf("合并视频片段失败：%s", strings.TrimSpace(string(outputLog)))
	}
	actual, err := videoDuration(output)
	if err != nil {
		return "", errors.New("无法读取合并视频时长")
	}
	if actual < float64(expectedDuration)-1 || actual > float64(expectedDuration)+1 {
		return "", fmt.Errorf("合并视频时长异常：实际 %.1f 秒，目标 %d 秒", actual, expectedDuration)
	}
	rel, err := filepath.Rel(filepath.Join(s.dataDir, "storage"), output)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(rel), nil
}

func (s *Studio) mediaDataURL(localPath string, video bool) (string, error) {
	var path string
	var err error
	if video {
		path, err = s.replicaSourcePath(localPath)
	} else {
		path, err = s.uploadedImagePath(localPath)
	}
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if contentType == "" {
		if video {
			contentType = "video/mp4"
		} else {
			contentType = "image/jpeg"
		}
	}
	return "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
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
		var id, jobID, path string
		var sourceID sql.NullString
		var created int64
		if err := rows.Scan(&id, &jobID, &sourceID, &path, &created); err != nil {
			return err
		}
		versions = append(versions, map[string]any{"id": id, "job_id": jobID, "source_version_id": nullableString(sourceID), "file_path": path, "created_at": created})
	}
	job["versions"] = versions
	return rows.Err()
}

func (s *Studio) populateVideoReplicaSegments(job map[string]any) error {
	rows, err := s.db.Query("select id,segment_index,start_second,duration,prompt,status,coalesce(file_path,''),coalesce(remote_id,''),coalesce(polling_url,'') from video_replica_segments where job_id=? and run_id=(select current_run_id from video_replica_jobs where id=?) order by segment_index", job["id"], job["id"])
	if err != nil {
		return err
	}
	defer rows.Close()
	segments := []map[string]any{}
	completed := 0
	current := -1
	for rows.Next() {
		var id, prompt, status, path, remoteID, pollingURL string
		var index, start, duration int
		if err := rows.Scan(&id, &index, &start, &duration, &prompt, &status, &path, &remoteID, &pollingURL); err != nil {
			return err
		}
		if status == "ready" {
			completed++
		} else if current < 0 {
			current = index
		}
		segments = append(segments, map[string]any{
			"id": id, "index": index, "start_second": start, "duration": duration,
			"prompt": prompt, "status": status,
			"file_path":   nullableString(sql.NullString{String: path, Valid: path != ""}),
			"remote_id":   nullableString(sql.NullString{String: remoteID, Valid: remoteID != ""}),
			"polling_url": nullableString(sql.NullString{String: pollingURL, Valid: pollingURL != ""}),
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	job["segments"] = segments
	job["progress"] = map[string]any{
		"phase": job["status"], "completed_segments": completed,
		"total_segments": len(segments), "current_segment": current,
	}
	return nil
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
	if _, ok := seedanceMaxDuration[input.Model]; !ok {
		return errors.New("视频模型时长规则不存在")
	}
	if input.Duration < 4 || input.Duration > 300 {
		return errors.New("视频总时长须在 4 到 300 秒之间")
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
