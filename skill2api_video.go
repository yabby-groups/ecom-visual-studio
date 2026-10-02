package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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

func aiVideoReplicaPendingStatus(status string) bool {
	switch status {
	case "queued", "preparing", "submitting", "prompting", "generating", "running", "retrieving", "downloading", "merging":
		return true
	default:
		return false
	}
}

func aiVideoReplicaTerminableStatus(status string) bool {
	return aiVideoReplicaPendingStatus(status) || status == "waiting_for_input"
}

func aiVideoReplicaResumableStatus(status string) bool {
	return status == "interrupted" || status == "terminated"
}

func (s *Studio) CreateAIVideoReplica(input AIVideoReplicaInput) (map[string]string, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("请填写复刻说明")
	}
	if math.IsNaN(input.Budget) || math.IsInf(input.Budget, 0) || input.Budget <= 0 {
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
	sourcePath, err := s.replicaSourcePath(input.SourceVideoPath)
	if err != nil {
		return nil, err
	}
	seconds, err := videoDuration(sourcePath)
	if err != nil {
		return nil, errors.New("无法读取视频时长，请确认已安装 ffprobe")
	}
	if _, err = s.uploadedImagePath(input.ProductPath); err != nil {
		return nil, err
	}
	id := newID("video-ai-replica")
	refs, _ := json.Marshal([]string{input.ProductPath})
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		_, e := tx.Exec("insert into video_replica_jobs(id,user_id,source_video_path,reference_paths,product_reference_path,task_type,model,prompt,storyboard,storyboard_confirmed,duration,resolution,ratio,status,current_run_id,created_at,ai_person_prompt,ai_budget) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", id, localWorkspaceID, input.SourceVideoPath, string(refs), input.ProductPath, "ai_replica", input.Model, input.Prompt, "[]", 1, int(math.Ceil(seconds)), input.Resolution, input.Ratio, "queued", "", time.Now().Unix(), input.PersonPrompt, input.Budget)
		return e
	}); err != nil {
		return nil, err
	}
	go s.runAIVideoReplica(id, user.ID, input)
	return map[string]string{"id": id}, nil
}

// resumeAIVideoReplicaJobs reattaches in-process workers after a desktop restart.
// The request id is durable, so an already submitted provider job is polled instead
// of being submitted a second time.
func (s *Studio) resumeAIVideoReplicaJobs() {
	user, err := s.currentUser()
	if err != nil {
		return
	}
	rows, err := s.db.Query(`select id,source_video_path,product_reference_path,prompt,ai_person_prompt,model,resolution,ratio,ai_budget
		from video_replica_jobs where user_id=? and task_type='ai_replica' and status in ('interrupted','queued','preparing','submitting','generating','retrieving')`, localWorkspaceID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, source, product, prompt, person, model, resolution, ratio string
		var budget float64
		if err := rows.Scan(&id, &source, &product, &prompt, &person, &model, &resolution, &ratio, &budget); err != nil {
			continue
		}
		go s.runAIVideoReplica(id, user.ID, AIVideoReplicaInput{SourceVideoPath: source, ProductPath: product, Prompt: prompt, PersonPrompt: person, Model: model, Resolution: resolution, Ratio: ratio, Budget: budget})
	}
}

func (s *Studio) runAIVideoReplica(id, userID string, input AIVideoReplicaInput) {
	isTerminated := func() bool {
		var status string
		return s.db.QueryRow("select status from video_replica_jobs where id=?", id).Scan(&status) == nil && status == "terminated"
	}
	fail := func(err error) {
		if isTerminated() {
			return
		}
		if err == nil {
			err = errors.New("未知错误")
		}
		if writeErr := s.writeTransaction(func(tx *sql.Tx) error {
			_, e := tx.Exec("update video_replica_jobs set status=? where id=? and status <> 'terminated'", "failed: "+truncate(err.Error()), id)
			return e
		}); writeErr != nil {
			// There is no caller to return this asynchronous error to; retain it in the process log.
			fmt.Printf("video replica %s: failed to persist failure: %v (cause: %v)\n", id, writeErr, err)
		}
	}
	setStatus := func(status string) {
		if isTerminated() {
			return
		}
		if err := s.writeTransaction(func(tx *sql.Tx) error {
			_, e := tx.Exec("update video_replica_jobs set status=?,generation_started_at=coalesce(generation_started_at,?) where id=? and status <> 'terminated'", status, time.Now().Unix(), id)
			return e
		}); err != nil {
			fmt.Printf("video replica %s: failed to persist status %q: %v\n", id, status, err)
		}
	}
	if isTerminated() {
		return
	}
	bearer, err := s.currentHuabotBearer(userID)
	if err != nil {
		fail(err)
		return
	}
	config := s.huabotConfig()
	var requestID string
	for attempt := 0; attempt < 5; attempt++ {
		err = s.db.QueryRow("select coalesce(skill2api_request_id,'') from video_replica_jobs where id=?", id).Scan(&requestID)
		if err != sql.ErrNoRows {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		log.Printf("video replica %s: load skill2api request id failed: %v", id, err)
		fail(fmt.Errorf("读取 AI 复刻任务失败（任务 %s）：%w", id, err))
		return
	}
	if requestID == "" {
		setStatus("preparing")
		if isTerminated() {
			return
		}
		videoURL, uploadErr := s.uploadSkill2APIMedia(config.WebBase, bearer, input.SourceVideoPath)
		if uploadErr != nil {
			fail(uploadErr)
			return
		}
		if isTerminated() {
			return
		}
		imageURL, uploadErr := s.uploadSkill2APIMedia(config.WebBase, bearer, input.ProductPath)
		if uploadErr != nil {
			fail(uploadErr)
			return
		}
		if isTerminated() {
			return
		}
		setStatus("submitting")
		prompt := fmt.Sprintf("克隆参考视频的镜头节奏、动作和构图，将目标商品替换为参考商品。参考视频：%s ；商品参考图：%s 。", videoURL, imageURL)
		if strings.TrimSpace(input.PersonPrompt) != "" {
			prompt += " 替换人物为: " + strings.TrimSpace(input.PersonPrompt)
		}
		prompt += fmt.Sprintf("\n%s\n尺寸 %s %s\n预算 %s 美元", input.Prompt, input.Resolution, input.Ratio, strconv.FormatFloat(input.Budget, 'f', -1, 64))
		var submitted struct {
			RequestID string `json:"request_id"`
		}
		if isTerminated() {
			return
		}
		if err = jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/skill2api/generate/", bearer, map[string]any{"prompt": prompt, "skill_name": "hypit", "model": input.Model}, &submitted); err != nil {
			fail(err)
			return
		}
		requestID = submitted.RequestID
		if requestID == "" {
			fail(errors.New("Skill2API 未返回 request_id"))
			return
		}
		if err = s.writeTransaction(func(tx *sql.Tx) error {
			// Retain a raced submission id, but never restore a terminated task.
			_, e := tx.Exec("update video_replica_jobs set skill2api_request_id=?,status=case when status='terminated' then status else ? end where id=?", requestID, "generating", id)
			return e
		}); err != nil {
			fail(err)
			return
		}
		if isTerminated() {
			var ignored map[string]any
			if terminateErr := jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/skill2api/terminate/", bearer, map[string]string{"request_id": requestID}, &ignored); terminateErr != nil {
				log.Printf("video replica %s: terminate raced submission %s: %v", id, requestID, terminateErr)
			}
			return
		}
	}
	deadline := time.Now().Add(45 * time.Minute)
	for time.Now().Before(deadline) {
		if isTerminated() {
			return
		}
		status, statusErr := s.skill2APIStatus(requestID, bearer)
		if statusErr != nil {
			if isSkill2APIStatusNotFound(statusErr) {
				_, _ = s.reconcileAIVideoReplicaRemoteStatus(id, map[string]any{"status": "not_found", "error": statusErr.Error()})
				return
			}
			fail(statusErr)
			return
		}
		state := normalizeAIVideoReplicaRemoteState(stringValue(status["status"]))
		localState, reconcileErr := s.reconcileAIVideoReplicaRemoteStatus(id, status)
		if reconcileErr != nil {
			fail(reconcileErr)
			return
		}
		switch state {
		case "waiting_for_input":
			return
		case "failed", "terminated", "not_found":
			return
		case "succeeded":
			if localState != "retrieving" {
				return
			}
			filePath, pathErr := aiVideoReplicaMP4Path(status)
			if pathErr != nil {
				fail(pathErr)
				return
			}
			var delivery struct {
				DeliveryID string `json:"delivery_id"`
			}
			if isTerminated() {
				return
			}
			if err = jsonRequest(s.httpClient, http.MethodPost, config.WebBase+"/api/skill2api/file/", bearer, map[string]string{"request_id": requestID, "file_path": filePath}, &delivery); err != nil {
				fail(err)
				return
			}
			if delivery.DeliveryID == "" {
				fail(errors.New("Skill2API 未返回 delivery_id"))
				return
			}
			if err = s.writeTransaction(func(tx *sql.Tx) error {
				_, e := tx.Exec("update video_replica_jobs set skill2api_delivery_id=?,status='retrieving' where id=? and status <> 'terminated'", delivery.DeliveryID, id)
				return e
			}); err != nil {
				fail(err)
				return
			}
			for i := 0; i < 180; i++ {
				time.Sleep(2 * time.Second)
				if isTerminated() {
					return
				}
				var result map[string]any
				if err = jsonRequest(s.httpClient, http.MethodGet, config.WebBase+"/api/skill2api/file/delivery/?request_id="+url.QueryEscape(requestID)+"&delivery_id="+url.QueryEscape(delivery.DeliveryID), bearer, nil, &result); err != nil {
					fail(err)
					return
				}
				deliveryState := stringValue(result["status"])
				if deliveryState == "failed" {
					fail(errors.New(stringValue(result["error"])))
					return
				}
				if deliveryState == "succeeded" {
					rawURL := stringValue(result["url"])
					if rawURL == "" {
						fail(errors.New("Skill2API 文件 URL 为空"))
						return
					}
					if isTerminated() {
						return
					}
					if err = s.downloadAIVideo(id, rawURL, bearer); err != nil {
						fail(err)
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

func (s *Studio) skill2APIRequest(id string) (string, User, error) {
	user, err := s.currentUser()
	if err != nil {
		return "", User{}, err
	}
	var requestID string
	err = s.db.QueryRow("select skill2api_request_id from video_replica_jobs where id=?", id).Scan(&requestID)
	if err == sql.ErrNoRows {
		var count int
		_ = s.db.QueryRow("select count(*) from video_replica_jobs").Scan(&count)
		log.Printf("video replica %s: no job row while loading skill2api request id; total jobs=%d", id, count)
		return "", User{}, fmt.Errorf("历史任务不存在（id=%s）", id)
	}
	if err != nil {
		return "", User{}, err
	}
	if requestID == "" {
		return "", User{}, errors.New("任务尚未提交")
	}
	return requestID, user, nil
}

func (s *Studio) RefreshAIVideoReplica(id string) (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	var localStatus, rid, snapshotJSON string
	if err = s.db.QueryRow("select status,coalesce(skill2api_request_id,''),coalesce(skill2api_status_snapshot,'{}') from video_replica_jobs where id=? and task_type='ai_replica'", id).Scan(&localStatus, &rid, &snapshotJSON); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("历史任务不存在")
		}
		return nil, err
	}
	log.Printf("RefreshAIVideoReplica: rid: %s localstatus: %s\n", rid, localStatus)
	result := map[string]any{"request_id": rid, "status": localStatus}
	snapshot := decodeSkill2APIStatusSnapshot(snapshotJSON)
	// Terminal local states still need a remote status read so the console can
	// hydrate its final stdout/stderr without allowing remote state to overwrite
	// the durable local display state.
	if rid == "" {
		return result, nil
	}
	bearer, err := s.currentHuabotBearer(user.ID)
	if err != nil {
		return nil, err
	}
	status, err := s.skill2APIStatus(rid, bearer)
	if err != nil {
		if isSkill2APIStatusNotFound(err) {
			status = map[string]any{"status": "not_found", "error": err.Error()}
			localStatus, reconcileErr := s.reconcileAIVideoReplicaRemoteStatus(id, status)
			if reconcileErr != nil {
				return nil, reconcileErr
			}
			status["request_id"] = rid
			status["remote_status"] = "not_found"
			status["status"] = localStatus
			mergeSkill2APIStatus(status, snapshot)
			return status, nil
		}
		mergeSkill2APIStatus(result, snapshot)
		result["remote_status"] = "unavailable"
		result["remote_error"] = err.Error()
		return result, nil
	}
	remoteState := normalizeAIVideoReplicaRemoteState(stringValue(status["status"]))
	localStatus, err = s.reconcileAIVideoReplicaRemoteStatus(id, status)
	if err != nil {
		return nil, err
	}
	status["remote_status"] = remoteState
	status["status"] = localStatus
	return status, nil
}

func remoteStatusFailureReason(status map[string]any, fallback string) string {
	for _, key := range []string{"error", "err"} {
		if reason := strings.TrimSpace(stringValue(status[key])); reason != "" {
			return reason
		}
	}
	return fallback
}

func normalizeAIVideoReplicaRemoteState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "cancelled", "canceled", "stopped":
		return "terminated"
	case "completed", "complete":
		return "succeeded"
	case "error":
		return "failed"
	default:
		return strings.ToLower(strings.TrimSpace(state))
	}
}

// reconcileAIVideoReplicaRemoteStatus is the single local state authority for
// a Skill2API status read. Explicit local termination and a completed local
// file are protected from stale remote responses.
func (s *Studio) reconcileAIVideoReplicaRemoteStatus(id string, remote map[string]any) (string, error) {
	s.saveSkill2APIStatusSnapshot(id, remote)
	remoteState := normalizeAIVideoReplicaRemoteState(stringValue(remote["status"]))
	desired := ""
	switch remoteState {
	case "waiting_for_input":
		desired = "waiting_for_input"
	case "succeeded":
		desired = "retrieving"
	case "terminated":
		desired = "terminated"
	case "failed":
		desired = "failed: " + truncate(remoteStatusFailureReason(remote, "Skill2API 任务失败"))
	case "not_found":
		desired = "not_found"
	}
	if desired != "" {
		if err := s.writeTransaction(func(tx *sql.Tx) error {
			_, err := tx.Exec("update video_replica_jobs set status=? where id=? and task_type='ai_replica' and status not in ('terminated','ready')", desired, id)
			return err
		}); err != nil {
			return "", err
		}
	}
	var localStatus string
	if err := s.db.QueryRow("select status from video_replica_jobs where id=? and task_type='ai_replica'", id).Scan(&localStatus); err != nil {
		return "", err
	}
	return localStatus, nil
}

func decodeSkill2APIStatusSnapshot(raw string) map[string]any {
	var snapshot map[string]any
	if json.Unmarshal([]byte(raw), &snapshot) != nil {
		return map[string]any{}
	}
	return snapshot
}

func mergeSkill2APIStatus(result, snapshot map[string]any) {
	for key, value := range snapshot {
		result[key] = value
	}
}

func (s *Studio) saveSkill2APIStatusSnapshot(id string, status map[string]any) {
	snapshot := map[string]any{}
	for _, key := range []string{"stdout", "stderr", "files", "question", "options", "phase", "error"} {
		if value, ok := status[key]; ok {
			snapshot[key] = value
		}
	}
	if len(snapshot) == 0 {
		return
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		_, queryErr := tx.Exec("update video_replica_jobs set skill2api_status_snapshot=? where id=?", string(raw), id)
		return queryErr
	}); err != nil {
		log.Printf("video replica %s: persist Skill2API log snapshot: %v", id, err)
	}
}

// skill2APIStatus intentionally accepts a terminal task's error field. The
// status endpoint uses it for states such as "terminated by user" while still
// returning stdout/stderr that the desktop must display.
func (s *Studio) skill2APIStatus(requestID, bearer string) (map[string]any, error) {
	req, err := http.NewRequest(http.MethodGet, s.huabotConfig().WebBase+"/api/skill2api/status/?request_id="+url.QueryEscape(requestID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, skill2APIStatusError{statusCode: resp.StatusCode}
	}
	var status map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&status); err != nil {
		return nil, fmt.Errorf("Skill2API 状态响应无效：%w", err)
	}
	return status, nil
}

type skill2APIStatusError struct {
	statusCode int
}

func (e skill2APIStatusError) Error() string {
	return fmt.Sprintf("Skill2API 状态查询失败：HTTP %d", e.statusCode)
}

func isSkill2APIStatusNotFound(err error) bool {
	var statusErr skill2APIStatusError
	return errors.As(err, &statusErr) && statusErr.statusCode == http.StatusNotFound
}

func (s *Studio) ResumeAIVideoReplica(id, answer, instruction string) (map[string]any, error) {
	answer = strings.TrimSpace(answer)
	instruction = strings.TrimSpace(instruction)
	if answer != "" && instruction != "" {
		return nil, errors.New("answer 和 instruction 只能填写一个")
	}
	rid, user, err := s.skill2APIRequest(id)
	if err != nil {
		return nil, err
	}
	var localStatus string
	if err = s.db.QueryRow("select status from video_replica_jobs where id=? and task_type='ai_replica'", id).Scan(&localStatus); err != nil {
		return nil, err
	}
	if localStatus != "waiting_for_input" && !aiVideoReplicaResumableStatus(localStatus) {
		return nil, errors.New("当前任务不能恢复")
	}
	bearer, err := s.currentHuabotBearer(user.ID)
	if err != nil {
		return nil, err
	}
	remoteStatus, err := s.skill2APIStatus(rid, bearer)
	if err != nil {
		if isSkill2APIStatusNotFound(err) {
			remoteStatus = map[string]any{"status": "not_found", "error": err.Error()}
			reconciledStatus, reconcileErr := s.reconcileAIVideoReplicaRemoteStatus(id, remoteStatus)
			if reconcileErr != nil {
				return nil, reconcileErr
			}
			remoteStatus["status"] = reconciledStatus
			remoteStatus["remote_status"] = "not_found"
			remoteStatus["request_id"] = rid
			return remoteStatus, nil
		}
		return nil, err
	}
	remoteState := normalizeAIVideoReplicaRemoteState(stringValue(remoteStatus["status"]))
	reconciledStatus, err := s.reconcileAIVideoReplicaRemoteStatus(id, remoteStatus)
	if err != nil {
		return nil, err
	}
	if remoteState == "terminated" || remoteState == "failed" || remoteState == "succeeded" || remoteState == "not_found" {
		remoteStatus["status"] = reconciledStatus
		remoteStatus["remote_status"] = remoteState
		remoteStatus["request_id"] = rid
		return remoteStatus, nil
	}
	if remoteState == "running" {
		if err = s.writeTransaction(func(tx *sql.Tx) error {
			updated, queryErr := tx.Exec("update video_replica_jobs set status='generating',generation_started_at=coalesce(generation_started_at,?) where id=? and task_type='ai_replica' and status=?", time.Now().Unix(), id, localStatus)
			if queryErr != nil {
				return queryErr
			}
			count, queryErr := updated.RowsAffected()
			if queryErr != nil {
				return queryErr
			}
			if count != 1 {
				return errors.New("任务状态已变化，请刷新后重试")
			}
			return nil
		}); err != nil {
			return nil, err
		}
		remoteStatus["status"] = "generating"
		remoteStatus["remote_status"] = "running"
		remoteStatus["request_id"] = rid
		return remoteStatus, nil
	}
	if remoteState != "waiting_for_input" && remoteState != "interrupted" {
		return nil, errors.New("远端任务当前不能恢复")
	}
	if localStatus == "waiting_for_input" {
		if answer == "" {
			return nil, errors.New("请先填写任务回答")
		}
	} else if answer != "" {
		return nil, errors.New("当前任务不等待回答，请使用追加题词继续")
	}
	payload := map[string]string{"request_id": rid}
	if answer != "" {
		payload["answer"] = answer
	} else {
		if instruction == "" {
			instruction = "继续执行当前任务"
		}
		payload["instruction"] = instruction
	}
	var result map[string]any
	err = jsonRequest(s.httpClient, http.MethodPost, s.huabotConfig().WebBase+"/api/skill2api/resume/", bearer, payload, &result)
	if err != nil {
		return result, err
	}
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		updated, queryErr := tx.Exec("update video_replica_jobs set status='generating',generation_started_at=coalesce(generation_started_at,?) where id=? and task_type='ai_replica' and status=?", time.Now().Unix(), id, localStatus)
		if queryErr != nil {
			return queryErr
		}
		count, queryErr := updated.RowsAffected()
		if queryErr != nil {
			return queryErr
		}
		if count != 1 {
			return errors.New("任务状态已变化，请刷新后重试")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	var input AIVideoReplicaInput
	if err = s.db.QueryRow("select source_video_path,product_reference_path,prompt,ai_person_prompt,model,resolution,ratio,ai_budget from video_replica_jobs where id=?", id).Scan(&input.SourceVideoPath, &input.ProductPath, &input.Prompt, &input.PersonPrompt, &input.Model, &input.Resolution, &input.Ratio, &input.Budget); err != nil {
		return nil, err
	}
	result["status"] = "generating"
	go s.runAIVideoReplica(id, user.ID, input)
	return result, err
}

func (s *Studio) TerminateAIVideoReplica(id string) (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	var rid, localStatus string
	if err = s.db.QueryRow("select status,coalesce(skill2api_request_id,'') from video_replica_jobs where id=? and task_type='ai_replica'", id).Scan(&localStatus, &rid); err != nil {
		if err == sql.ErrNoRows {
			return nil, errors.New("历史任务不存在")
		}
		return nil, err
	}
	if localStatus == "terminated" {
		return map[string]any{"request_id": rid, "status": "terminated"}, nil
	}
	if !aiVideoReplicaTerminableStatus(localStatus) {
		if rid == "" || localStatus == "ready" {
			return nil, errors.New("当前任务不能终止")
		}
		bearer, bearerErr := s.currentHuabotBearer(user.ID)
		if bearerErr != nil {
			return nil, bearerErr
		}
		remote, statusErr := s.skill2APIStatus(rid, bearer)
		if isSkill2APIStatusNotFound(statusErr) {
			reconciledStatus, reconcileErr := s.reconcileAIVideoReplicaRemoteStatus(id, map[string]any{"status": "not_found", "error": statusErr.Error()})
			if reconcileErr != nil {
				return nil, reconcileErr
			}
			return map[string]any{"request_id": rid, "status": reconciledStatus, "remote_status": "not_found"}, nil
		}
		if statusErr == nil {
			reconciledStatus, reconcileErr := s.reconcileAIVideoReplicaRemoteStatus(id, remote)
			if reconcileErr != nil {
				return nil, reconcileErr
			}
			if reconciledStatus == "terminated" {
				return map[string]any{"request_id": rid, "status": "terminated", "remote_status": stringValue(remote["status"])}, nil
			}
		}
		return nil, errors.New("当前任务不能终止")
	}
	if err = s.writeTransaction(func(tx *sql.Tx) error {
		updated, queryErr := tx.Exec("update video_replica_jobs set status='terminated' where id=? and task_type='ai_replica' and status=?", id, localStatus)
		if queryErr != nil {
			return queryErr
		}
		count, queryErr := updated.RowsAffected()
		if queryErr != nil {
			return queryErr
		}
		if count != 1 {
			return errors.New("任务状态已变化，请刷新后重试")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	result := map[string]any{"request_id": rid, "status": "terminated"}
	if rid == "" {
		return result, nil
	}
	bearer, err := s.currentHuabotBearer(user.ID)
	if err != nil {
		result["remote_error"] = err.Error()
		return result, nil
	}
	var remote map[string]any
	if err = jsonRequest(s.httpClient, http.MethodPost, s.huabotConfig().WebBase+"/api/skill2api/terminate/", bearer, map[string]string{"request_id": rid}, &remote); err != nil {
		result["remote_error"] = err.Error()
		return result, nil
	}
	result["remote_status"] = stringValue(remote["status"])
	return result, nil
}

func (s *Studio) DeliverAIVideoReplicaFile(id, filePath string) (map[string]any, error) {
	clean := filepath.Clean(filepath.FromSlash(filePath))
	if filepath.IsAbs(filePath) || clean != filepath.FromSlash(filePath) || strings.HasPrefix(filePath, "../") {
		return nil, errors.New("文件路径无效")
	}
	rid, user, err := s.skill2APIRequest(id)
	if err != nil {
		return nil, err
	}
	bearer, err := s.currentHuabotBearer(user.ID)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	err = jsonRequest(s.httpClient, http.MethodPost, s.huabotConfig().WebBase+"/api/skill2api/file/", bearer, map[string]string{"request_id": rid, "file_path": filePath}, &result)
	return result, err
}

func (s *Studio) AIVideoReplicaDelivery(id, deliveryID string) (map[string]any, error) {
	rid, user, err := s.skill2APIRequest(id)
	if err != nil {
		return nil, err
	}
	bearer, err := s.currentHuabotBearer(user.ID)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, s.huabotConfig().WebBase+"/api/skill2api/file/delivery/?request_id="+url.QueryEscape(rid)+"&delivery_id="+url.QueryEscape(deliveryID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("文件投递查询失败：HTTP %d", resp.StatusCode)
	}
	var result map[string]any
	err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&result)
	if err != nil {
		return nil, fmt.Errorf("文件投递响应无效：%w", err)
	}
	if err == nil && strings.HasPrefix(stringValue(result["url"]), "/") {
		result["url"] = s.huabotConfig().WebBase + stringValue(result["url"])
	}
	return result, err
}

func (s *Studio) DownloadAIVideoReplicaFile(id, filePath string) (bool, error) {
	delivery, err := s.DeliverAIVideoReplicaFile(id, filePath)
	if err != nil {
		return false, err
	}
	deliveryID := stringValue(delivery["delivery_id"])
	if deliveryID == "" {
		return false, errors.New("远程未返回文件投递 ID")
	}
	var result map[string]any
	for i := 0; i < 180; i++ {
		result, err = s.AIVideoReplicaDelivery(id, deliveryID)
		if err != nil {
			return false, err
		}
		if stringValue(result["status"]) == "failed" {
			return false, errors.New(stringValue(result["error"]))
		}
		if stringValue(result["status"]) == "succeeded" {
			break
		}
		time.Sleep(2 * time.Second)
	}
	rawURL := stringValue(result["url"])
	if rawURL == "" {
		return false, errors.New("文件获取超时或下载地址为空")
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return false, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return false, fmt.Errorf("文件下载失败：HTTP %d", resp.StatusCode)
	}
	destination, err := runtime.SaveFileDialog(s.ctx, runtime.SaveDialogOptions{Title: "导出远程文件", DefaultFilename: filepath.Base(filePath), CanCreateDirectories: true})
	if err != nil || destination == "" {
		return false, err
	}
	out, err := os.Create(destination)
	if err != nil {
		return false, err
	}
	defer out.Close()
	_, err = io.Copy(out, resp.Body)
	return err == nil, err
}

// PullAIVideoReplicaResult retries result retrieval for a completed remote task.
// The asynchronous delivery endpoint is preferred for large media; the legacy
// synchronous endpoint is a fallback when delivery upload failed.
func (s *Studio) PullAIVideoReplicaResult(id string) (bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return false, err
	}
	rid, _, err := s.skill2APIRequest(id)
	if err != nil {
		return false, err
	}
	bearer, err := s.currentHuabotBearer(user.ID)
	if err != nil {
		return false, err
	}
	status, err := s.skill2APIStatus(rid, bearer)
	if err != nil {
		return false, err
	}
	filePath, err := aiVideoReplicaMP4Path(status)
	if err != nil {
		return false, err
	}
	if delivery, deliveryErr := s.DeliverAIVideoReplicaFile(id, filePath); deliveryErr == nil {
		if deliveryID := stringValue(delivery["delivery_id"]); deliveryID != "" {
			for i := 0; i < 180; i++ {
				result, pollErr := s.AIVideoReplicaDelivery(id, deliveryID)
				if pollErr == nil {
					switch stringValue(result["status"]) {
					case "succeeded":
						if rawURL := stringValue(result["url"]); rawURL != "" {
							if err = s.downloadAIVideo(id, rawURL, bearer); err == nil {
								return true, nil
							}
						}
					case "failed":
						i = 180
					}
				}
				if i < 179 {
					time.Sleep(2 * time.Second)
				}
			}
		}
	}

	// The synchronous endpoint can still retrieve a valid task-local file when
	// the worker could not create an asynchronous temporary upload.
	config := s.huabotConfig()
	rawURL := config.WebBase + "/api/skill2api/file/?request_id=" + url.QueryEscape(rid) + "&file_path=" + url.QueryEscape(filePath)
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	var fileResult struct {
		URL string `json:"url"`
	}
	if err = decodeResponse(resp, &fileResult); err != nil {
		return false, err
	}
	if fileResult.URL == "" {
		return false, errors.New("远程未返回结果文件地址")
	}
	if err = s.downloadAIVideo(id, fileResult.URL, bearer); err != nil {
		return false, err
	}
	return true, nil
}

func aiVideoReplicaMP4Path(status map[string]any) (string, error) {
	files, _ := status["files"].([]any)
	available := map[string]bool{}
	byBase := map[string][]string{}
	for _, item := range files {
		path := stringValue(item)
		clean := filepath.Clean(filepath.FromSlash(path))
		if path == "" || clean != filepath.FromSlash(path) || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			continue
		}
		if strings.HasSuffix(strings.ToLower(path), ".mp4") {
			available[path] = true
			base := filepath.Base(filepath.FromSlash(path))
			byBase[base] = append(byBase[base], path)
		}
	}
	// The worker's terminal response can identify the final artifact in either
	// stdout or stderr. Prefer that explicit link over intermediates in files.
	linkPattern := regexp.MustCompile(`\]\(([^)]+\.mp4)(?:\?[^)]*)?\)`)
	plainPathPattern := regexp.MustCompile(`(?:^|[\s(])((?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.mp4)(?:$|[\s)])`)
	isSafeMP4 := func(candidate string) bool {
		clean := filepath.Clean(filepath.FromSlash(candidate))
		return candidate != "" && clean == filepath.FromSlash(candidate) && !filepath.IsAbs(clean) && !strings.HasPrefix(clean, ".."+string(filepath.Separator)) && strings.HasSuffix(strings.ToLower(candidate), ".mp4")
	}
	resolveListedPath := func(candidate string) string {
		if available[candidate] {
			return candidate
		}
		matches := byBase[filepath.Base(filepath.FromSlash(candidate))]
		if len(matches) == 1 {
			return matches[0]
		}
		return ""
	}
	for _, key := range []string{"stderr", "stdout"} {
		stream := stringValue(status[key])
		matches := linkPattern.FindAllStringSubmatch(stream, -1)
		for i := len(matches) - 1; i >= 0; i-- {
			candidate := strings.TrimSpace(matches[i][1])
			parsed, parseErr := url.Parse(candidate)
			if parseErr != nil || parsed.Host != "" || (parsed.IsAbs() && !strings.HasPrefix(parsed.Path, "/workspace/")) {
				continue
			}
			candidate = filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimPrefix(parsed.Path, "/workspace/"))))
			if isSafeMP4(candidate) {
				if listed := resolveListedPath(candidate); listed != "" {
					return listed, nil
				}
			}
		}
		plainMatches := plainPathPattern.FindAllStringSubmatch(stream, -1)
		for i := len(plainMatches) - 1; i >= 0; i-- {
			candidate := filepath.ToSlash(filepath.Clean(filepath.FromSlash(plainMatches[i][1])))
			if isSafeMP4(candidate) {
				if listed := resolveListedPath(candidate); listed != "" {
					return listed, nil
				}
			}
		}
	}
	for i := len(files) - 1; i >= 0; i-- {
		candidate := stringValue(files[i])
		if available[candidate] {
			return candidate, nil
		}
	}
	return "", errors.New("远端没有可拉取的 MP4 结果")
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
	config := s.huabotConfig()
	downloadURL := rawURL
	if strings.HasPrefix(rawURL, "/") {
		downloadURL = config.WebBase + rawURL
	} else {
		parsed, parseErr := url.Parse(rawURL)
		base, baseErr := url.Parse(config.WebBase)
		if parseErr != nil || baseErr != nil || parsed.Scheme != base.Scheme || parsed.Host != base.Host {
			return errors.New("Skill2API 下载地址无效")
		}
	}
	req, err := http.NewRequest(http.MethodGet, downloadURL, nil)
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
	full, err := s.generatedAssetOutputPath(path)
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
	if _, previewErr := s.ensureVideoReplicaPreview(path); previewErr != nil {
		log.Printf("video replica %s: preview generation failed: %v", id, previewErr)
	}
	return s.writeTransaction(func(tx *sql.Tx) error {
		_, e := tx.Exec("insert into video_replica_versions(id,job_id,source_version_id,file_path,created_at) values(?,?,?,?,?)", newID("video-version"), id, nil, path, time.Now().Unix())
		if e != nil {
			return e
		}
		_, e = tx.Exec("update video_replica_jobs set status='ready',file_path=? where id=? and status <> 'terminated'", path, id)
		return e
	})
}
