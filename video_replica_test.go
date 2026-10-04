package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func newAIVideoReplicaTestStudio(t *testing.T) *Studio {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "studio.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	studio := &Studio{db: db, dataDir: t.TempDir(), httpClient: http.DefaultClient, masterKey: make([]byte, 32), user: &User{ID: "test-user"}}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	return studio
}

func insertAIVideoReplicaTestJob(t *testing.T, studio *Studio, id, status, requestID string) {
	t.Helper()
	_, err := studio.db.Exec(`insert into video_replica_jobs
		(id,user_id,source_video_path,reference_paths,product_reference_path,task_type,model,prompt,storyboard,duration,resolution,ratio,status,created_at,skill2api_request_id)
		values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, localWorkspaceID, "uploads/source.mp4", "[]", "uploads/product.png", "ai_replica", "qwen3.8-flash", "replace", "[]", 0, "480p", "9:16", status, time.Now().Unix(), requestID)
	if err != nil {
		t.Fatal(err)
	}
}

func TestMigrateDropsStoryboardConfirmedWithoutLosingVideoJobs(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	if _, err := studio.db.Exec("alter table video_replica_jobs add column storyboard_confirmed integer not null default 0"); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.db.Exec(`insert into video_replica_jobs
		(id,user_id,source_video_path,task_type,model,duration,resolution,ratio,status,created_at)
		values(?,?,?,?,?,?,?,?,?,?)`, "job-migrate-storyboard", localWorkspaceID, "uploads/source.mp4", "reference", "seedance-2.5", 30, "480p", "16:9", "ready", 1); err != nil {
		t.Fatal(err)
	}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	rows, err := studio.db.Query("pragma table_info(video_replica_jobs)")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		if name == "storyboard_confirmed" {
			t.Fatal("obsolete storyboard_confirmed column still exists")
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-migrate-storyboard").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "ready" {
		t.Fatalf("job status = %q, want ready", status)
	}
}

func TestDeleteVideoReplicaRemovesTerminalJobAndGeneratedFiles(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	const id = "job-delete-video"
	const outputPath = "generated/video-replica/job-delete-video/result.mp4"
	insertAIVideoReplicaTestJob(t, studio, id, "ready", "")
	if err := os.MkdirAll(filepath.Join(studio.dataDir, "storage", "generated", "video-replica", id), 0o700); err != nil {
		t.Fatal(err)
	}
	fullPath := filepath.Join(studio.dataDir, "storage", filepath.FromSlash(outputPath))
	if err := os.WriteFile(fullPath, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	previewPath := filepath.Join(studio.dataDir, "storage", "generated", "video-replica", id, "result.jpg")
	if err := os.WriteFile(previewPath, []byte("cover"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.db.Exec("update video_replica_jobs set file_path=? where id=?", outputPath, id); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.db.Exec("insert into video_replica_versions(id,job_id,file_path,created_at) values(?,?,?,?)", "version-delete-video", id, outputPath, time.Now().Unix()); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.DeleteVideoReplica(id); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := studio.db.QueryRow("select count(*) from video_replica_jobs where id=?", id).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("deleted video job still exists: %d", count)
	}
	if _, err := os.Stat(fullPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("generated output still exists: %v", err)
	}
	if _, err := os.Stat(previewPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("generated preview still exists: %v", err)
	}
}

func TestEnsureVideoReplicaPreviewCreatesStaticCover(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	const videoPath = "generated/video-replica/job-cover/result.mp4"
	videoFile := filepath.Join(studio.dataDir, "storage", filepath.FromSlash(videoPath))
	if err := os.MkdirAll(filepath.Dir(videoFile), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(videoFile, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	toolDir := t.TempDir()
	ffmpeg := filepath.Join(toolDir, "ffmpeg")
	if err := os.WriteFile(ffmpeg, []byte("#!/bin/sh\nout=\"\"\nfor arg do out=\"$arg\"; done\nprintf cover > \"$out\"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	oldPath := os.Getenv("PATH")
	if err := os.Setenv("PATH", toolDir+string(os.PathListSeparator)+oldPath); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Setenv("PATH", oldPath) })

	preview, err := studio.ensureVideoReplicaPreview(videoPath)
	if err != nil {
		t.Fatal(err)
	}
	if preview != "generated/video-replica/job-cover/result.jpg" {
		t.Fatalf("preview path = %q", preview)
	}
	cover, err := os.ReadFile(filepath.Join(studio.dataDir, "storage", filepath.FromSlash(preview)))
	if err != nil || string(cover) != "cover" {
		t.Fatalf("preview contents = %q, error = %v", cover, err)
	}
}

func TestVideoReplicaPreviewPathRejectsUnsafeInputs(t *testing.T) {
	for _, path := range []string{"uploads/video.mp4", "generated/../uploads/video.mp4", "/tmp/video.mp4", "generated/video/result.mov"} {
		if _, err := videoReplicaPreviewPath(path); err == nil {
			t.Fatalf("unsafe preview path accepted: %q", path)
		}
	}
}

func TestDeleteVideoReplicaRejectsActiveJob(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-delete-active", "generating", "")
	if _, err := studio.DeleteVideoReplica("job-delete-active"); err == nil || !strings.Contains(err.Error(), "不能删除") {
		t.Fatalf("active delete error = %v", err)
	}
}

func TestAIVideoReplicaJobReturnsSavedBudget(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-person-settings", "ready", "")
	if _, err := studio.db.Exec("update video_replica_jobs set ai_person_prompt=?,ai_budget=? where id=?", "短发女性模特，微笑展示商品", 3.5, "job-person-settings"); err != nil {
		t.Fatal(err)
	}

	job, err := studio.VideoReplicaJob("job-person-settings")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := job["ai_person_prompt"]; ok {
		t.Fatal("person prompt must not be returned")
	}
	if got := job["ai_budget"]; got != 3.5 {
		t.Fatalf("budget = %v", got)
	}

	page, err := studio.VideoReplicaJobs(12, 0, "ai_replica")
	if err != nil {
		t.Fatal(err)
	}
	items := page["items"].([]map[string]any)
	if _, ok := items[0]["ai_person_prompt"]; ok {
		t.Fatal("list person prompt must not be returned")
	}
	if got := items[0]["ai_budget"]; got != 3.5 {
		t.Fatalf("list budget = %v", got)
	}
}

func TestAvatarAssetSelectionsRejectInvalidAndDuplicateValues(t *testing.T) {
	valid := []AvatarAssetSelection{{Source: "personal", ID: "12"}, {Source: "public", ID: "7"}}
	if err := validateAvatarAssetSelections(valid); err != nil {
		t.Fatalf("valid selections rejected: %v", err)
	}
	if err := validateAvatarAssetSelections([]AvatarAssetSelection{{Source: "public", ID: "7"}, {Source: "public", ID: "7"}}); err == nil {
		t.Fatal("duplicate avatar selection accepted")
	}
	if err := validateAvatarAssetSelections([]AvatarAssetSelection{{Source: "unknown", ID: "7"}}); err == nil {
		t.Fatal("unknown source accepted")
	}
	if err := validateAvatarAssetSelections([]AvatarAssetSelection{{Source: "public", ID: "1"}, {Source: "public", ID: "2"}, {Source: "public", ID: "3"}, {Source: "public", ID: "4"}, {Source: "public", ID: "5"}}); err == nil {
		t.Fatal("more than four avatar selections accepted")
	}
}

func TestAIVideoReplicaProductPathsValidateAndPreserveOrder(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	empty, err := studio.aiVideoReplicaProductPaths(nil, "")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty paths = %v, %v", empty, err)
	}
	uploads := filepath.Join(studio.dataDir, "storage", "uploads")
	if err := os.MkdirAll(uploads, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"front.png", "detail.png", "side.png", "back.png"} {
		if err := os.WriteFile(filepath.Join(uploads, name), []byte("image"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	paths := []string{"uploads/front.png", "uploads/detail.png", "uploads/side.png", "uploads/back.png"}
	got, err := studio.aiVideoReplicaProductPaths(paths, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != strings.Join(paths, ",") {
		t.Fatalf("paths = %v, want %v", got, paths)
	}
	legacy, err := studio.aiVideoReplicaProductPaths(nil, paths[0])
	if err != nil || len(legacy) != 1 || legacy[0] != paths[0] {
		t.Fatalf("legacy path = %v, %v", legacy, err)
	}
	if _, err := studio.aiVideoReplicaProductPaths(append(paths, paths[0]), ""); err == nil {
		t.Fatal("more than four product images accepted")
	}
	if _, err := studio.aiVideoReplicaProductPaths([]string{"uploads/missing.png"}, ""); err == nil {
		t.Fatal("missing product image accepted")
	}
}

func TestVideoReplicaJobReturnsSavedAvatarSelections(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-avatar-settings", "ready", "")
	if _, err := studio.db.Exec("update video_replica_jobs set avatar_assets=? where id=?", `[{"source":"public","id":"31"},{"source":"personal","id":"9"}]`, "job-avatar-settings"); err != nil {
		t.Fatal(err)
	}
	job, err := studio.VideoReplicaJob("job-avatar-settings")
	if err != nil {
		t.Fatal(err)
	}
	items, ok := job["avatar_assets"].([]AvatarAssetSelection)
	if !ok || len(items) != 2 || items[0].Source != "public" || items[1].ID != "9" {
		t.Fatalf("avatar selections = %#v", job["avatar_assets"])
	}
}

func TestTerminateAIVideoReplicaPersistsBeforeRemoteSubmission(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-preparing", "preparing", "")

	result, err := studio.TerminateAIVideoReplica("job-preparing")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["status"]; got != "terminated" {
		t.Fatalf("result status = %v, want terminated", got)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-preparing").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "terminated" {
		t.Fatalf("stored status = %q, want terminated", status)
	}
}

func TestRefreshAIVideoReplicaKeepsLocalPreSubmissionPhase(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-preparing", "preparing", "")

	result, err := studio.RefreshAIVideoReplica("job-preparing")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["status"]; got != "preparing" {
		t.Fatalf("result status = %v, want preparing", got)
	}
}

func TestRefreshAIVideoReplicaDoesNotLetRemoteRunningReplaceLocalPhase(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/skill2api/status/" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"status":"running","stdout":"still working"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-running", "generating", "remote-request")

	result, err := studio.RefreshAIVideoReplica("job-running")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["status"]; got != "generating" {
		t.Fatalf("display status = %v, want generating", got)
	}
	if got := result["remote_status"]; got != "running" {
		t.Fatalf("remote status = %v, want running", got)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-running").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "generating" {
		t.Fatalf("stored status = %q, want generating", status)
	}
}

func TestRefreshAIVideoReplicaRefreshesBearerAfterForbidden(t *testing.T) {
	statusRequests := 0
	refreshes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/skill2api/status/":
			statusRequests++
			if r.Header.Get("Authorization") == "Bearer stale-access" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if r.Header.Get("Authorization") != "Bearer fresh-access" {
				t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
			}
			_, _ = w.Write([]byte(`{"status":"running"}`))
		case "/oauth/token":
			refreshes++
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "refresh-secret" {
				t.Fatalf("refresh form = %#v", r.Form)
			}
			_, _ = w.Write([]byte(`{"access_token":"fresh-access","expires_in":3600}`))
		default:
			t.Fatalf("path = %q", r.URL.Path)
		}
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "stale-access"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	if _, err := studio.db.Exec("insert into users(id,username,created_at,nick_name,avatar_url) values(?,?,?,?,?)", "test-user", "tester", 1, "", ""); err != nil {
		t.Fatal(err)
	}
	credential, err := seal(studio.masterKey, "refresh-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = studio.db.Exec("insert into auth_credentials(user_id,kind,secret) values(?,?,?)", "test-user", oauthRefreshCredentialKind, credential); err != nil {
		t.Fatal(err)
	}
	insertAIVideoReplicaTestJob(t, studio, "job-forbidden", "generating", "remote-request")

	result, err := studio.RefreshAIVideoReplica("job-forbidden")
	if err != nil {
		t.Fatal(err)
	}
	if result["remote_status"] != "running" {
		t.Fatalf("result = %#v", result)
	}
	if statusRequests != 2 || refreshes != 1 {
		t.Fatalf("status requests = %d, refreshes = %d; want 2, 1", statusRequests, refreshes)
	}
}

func TestRefreshAIVideoReplicaReturnsLogsAfterLocalTermination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"terminated","error":"terminated by user","stdout":"before termination","stderr":"final detail"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-terminated", "terminated", "remote-request")

	result, err := studio.RefreshAIVideoReplica("job-terminated")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["status"]; got != "terminated" {
		t.Fatalf("display status = %v, want terminated", got)
	}
	if got := result["stdout"]; got != "before termination" {
		t.Fatalf("stdout = %v", got)
	}
	if got := result["stderr"]; got != "final detail" {
		t.Fatalf("stderr = %v", got)
	}
}

func TestRefreshAIVideoReplicaFallsBackToLocalSnapshotWhenRemoteIsDeleted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"request deleted"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-deleted", "terminated", "remote-request")
	if _, err := studio.db.Exec("update video_replica_jobs set skill2api_status_snapshot=? where id=?", `{"stdout":"saved output","stderr":"saved error"}`, "job-deleted"); err != nil {
		t.Fatal(err)
	}

	result, err := studio.RefreshAIVideoReplica("job-deleted")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["stdout"]; got != "saved output" {
		t.Fatalf("stdout = %v", got)
	}
	if got := result["remote_status"]; got != "not_found" {
		t.Fatalf("remote status = %v, want not_found", got)
	}
}

func TestPullAIVideoReplicaResultFallsBackToSynchronousFile(t *testing.T) {
	var syncFallback bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/skill2api/status/":
			_, _ = w.Write([]byte(`{"status":"succeeded","started_at":"2026-09-30T09:34:29.749128869Z","finished_at":"2026-09-30T09:46:22.391744493Z","files":["deliverable/final.mp4"]}`))
		case "/api/skill2api/file/":
			if r.Method == http.MethodPost {
				w.WriteHeader(http.StatusAccepted)
				_, _ = w.Write([]byte(`{"delivery_id":"delivery-failed","status":"queued"}`))
				return
			}
			syncFallback = true
			_, _ = w.Write([]byte(`{"url":"/upload/aa/bb/final.mp4"}`))
		case "/api/skill2api/file/delivery/":
			_, _ = w.Write([]byte(`{"status":"failed"}`))
		case "/upload/aa/bb/final.mp4":
			_, _ = w.Write([]byte("fake mp4 bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-manual-pull", "retrieving", "remote-request")

	ok, err := studio.PullAIVideoReplicaResult("job-manual-pull")
	if err != nil || !ok {
		t.Fatalf("pull result = %v, %v", ok, err)
	}
	if !syncFallback {
		t.Fatal("synchronous file fallback was not used")
	}
	var status, path string
	if err := studio.db.QueryRow("select status,file_path from video_replica_jobs where id=?", "job-manual-pull").Scan(&status, &path); err != nil {
		t.Fatal(err)
	}
	if status != "ready" || !strings.HasPrefix(path, "generated/video-replica/job-manual-pull/") {
		t.Fatalf("stored result = %q, %q", status, path)
	}
	var started, completed, elapsed int64
	if err := studio.db.QueryRow("select generation_started_at,completed_at,generation_duration_seconds from video_replica_versions where job_id=?", "job-manual-pull").Scan(&started, &completed, &elapsed); err != nil {
		t.Fatal(err)
	}
	if completed <= started || elapsed != completed-started {
		t.Fatalf("version timing = %d, %d, %d", started, completed, elapsed)
	}
	if _, err := os.Stat(filepath.Join(studio.dataDir, "storage", path)); err != nil {
		t.Fatalf("saved file missing: %v", err)
	}
}

func TestAIVideoReplicaMP4PathRejectsUnsafeFiles(t *testing.T) {
	if _, err := aiVideoReplicaMP4Path(map[string]any{"files": []any{"../escape.mp4", "/absolute.mp4"}}); err == nil {
		t.Fatal("unsafe MP4 path accepted")
	}
}

func TestAIVideoReplicaMP4PathPrefersTerminalLogLink(t *testing.T) {
	status := map[string]any{
		"files":  []any{"segments/01.mp4", "deliverable/final.mp4"},
		"stdout": "完成： [最终视频](deliverable/final.mp4)",
	}
	path, err := aiVideoReplicaMP4Path(status)
	if err != nil || path != "deliverable/final.mp4" {
		t.Fatalf("selected path = %q, err = %v", path, err)
	}
}

func TestAIVideoReplicaMP4PathDoesNotInventFromStdout(t *testing.T) {
	path, err := aiVideoReplicaMP4Path(map[string]any{
		"files":  []any{},
		"stdout": "Delivered productions/product-swap/out/final.mp4",
	})
	if err == nil || path != "" {
		t.Fatalf("selected path = %q, err = %v", path, err)
	}
}

func TestAIVideoReplicaMP4PathResolvesPartialStdoutNameToListedPath(t *testing.T) {
	path, err := aiVideoReplicaMP4Path(map[string]any{
		"files":  []any{"productions/product-swap/out/final.mp4"},
		"stdout": "Delivered final.mp4",
	})
	if err != nil || path != "productions/product-swap/out/final.mp4" {
		t.Fatalf("selected path = %q, err = %v", path, err)
	}
}

func TestTerminateAIVideoReplicaKeepsLocalTerminationWhenRemoteFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/skill2api/terminate/" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"remote unavailable"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-remote", "generating", "remote-request")

	result, err := studio.TerminateAIVideoReplica("job-remote")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := result["remote_error"]; !ok {
		t.Fatalf("result = %#v, want remote_error", result)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-remote").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "terminated" {
		t.Fatalf("stored status = %q, want terminated", status)
	}
}

func TestTerminateAIVideoReplicaReconcilesRemoteTermination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/skill2api/status/" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"status":"terminated","error":"already stopped"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-stale", "interrupted", "remote-request")

	result, err := studio.TerminateAIVideoReplica("job-stale")
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "terminated" {
		t.Fatalf("result = %#v", result)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-stale").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "terminated" {
		t.Fatalf("stored status = %q", status)
	}
}

func TestRefreshAIVideoReplicaPersistsRemoteFailureReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"failed","error":"provider quota exceeded"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-failed-remote", "generating", "remote-request")

	result, err := studio.RefreshAIVideoReplica("job-failed-remote")
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "failed: provider quota exceeded" {
		t.Fatalf("result = %#v", result)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-failed-remote").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed: provider quota exceeded" {
		t.Fatalf("stored status = %q", status)
	}
}

func TestTerminateAIVideoReplicaIsIdempotent(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-already-terminated", "terminated", "remote-request")

	result, err := studio.TerminateAIVideoReplica("job-already-terminated")
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "terminated" {
		t.Fatalf("result = %#v", result)
	}
}

func TestResumeAIVideoReplicaUsesDefaultInstructionWhenInterrupted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"status":"interrupted"}`))
			return
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if got := payload["request_id"]; got != "remote-request" {
			t.Fatalf("request_id = %q", got)
		}
		if got := payload["instruction"]; got != "继续执行当前任务" {
			t.Fatalf("instruction = %q", got)
		}
		_, _ = w.Write([]byte(`{"status":"running"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-resume", "interrupted", "remote-request")
	if _, err := studio.ResumeAIVideoReplica("job-resume", "", ""); err != nil {
		t.Fatal(err)
	}
}

func TestResumeAIVideoReplicaResumesRecentSucceededTask(t *testing.T) {
	finished := time.Now().UTC().Add(-time.Hour)
	started := finished.Add(-12 * time.Second)
	var resumed bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"status":"succeeded","started_at":"` + started.Format(time.RFC3339Nano) + `","finished_at":"` + finished.Format(time.RFC3339Nano) + `"}`))
			return
		}
		resumed = true
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["request_id"] != "remote-request" || payload["instruction"] != "继续执行当前任务" {
			t.Fatalf("resume payload = %#v", payload)
		}
		_, _ = w.Write([]byte(`{"status":"running"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-ready-resume", "ready", "remote-request")
	if _, err := studio.ResumeAIVideoReplica("job-ready-resume", "", ""); err != nil {
		t.Fatal(err)
	}
	if !resumed {
		t.Fatal("resume endpoint was not called")
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-ready-resume").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "generating" {
		t.Fatalf("stored status = %q", status)
	}
}

func TestResumeAIVideoReplicaAdoptsRemoteRunningTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected %s %s request", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"status":"running","stdout":"still working"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-running-resume", "interrupted", "remote-request")

	result, err := studio.ResumeAIVideoReplica("job-running-resume", "", "继续执行")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["status"]; got != "generating" {
		t.Fatalf("result status = %v, want generating", got)
	}
	if got := result["remote_status"]; got != "running" {
		t.Fatalf("remote status = %v, want running", got)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-running-resume").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "generating" {
		t.Fatalf("stored status = %q, want generating", status)
	}
}

func TestRefreshAIVideoReplicaPersistsWaitingForInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"waiting_for_input","question":"请选择素材"}`))
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)

	studio := newAIVideoReplicaTestStudio(t)
	studio.httpClient = server.Client()
	studio.huabotBearer = "test-token"
	studio.huabotBearerExpiry = time.Now().Add(time.Hour)
	insertAIVideoReplicaTestJob(t, studio, "job-waiting", "generating", "remote-request")

	result, err := studio.RefreshAIVideoReplica("job-waiting")
	if err != nil {
		t.Fatal(err)
	}
	if got := result["status"]; got != "waiting_for_input" {
		t.Fatalf("status = %v, want waiting_for_input", got)
	}
	var status string
	if err := studio.db.QueryRow("select status from video_replica_jobs where id=?", "job-waiting").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "waiting_for_input" {
		t.Fatalf("stored status = %q, want waiting_for_input", status)
	}
}

func TestResumeAIVideoReplicaRejectsActiveTask(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-active", "generating", "remote-request")

	if _, err := studio.ResumeAIVideoReplica("job-active", "", "continue"); err == nil || err.Error() != "当前任务不能恢复" {
		t.Fatalf("resume error = %v", err)
	}
}

func TestTerminateAIVideoReplicaRejectsTerminalTask(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	insertAIVideoReplicaTestJob(t, studio, "job-ready", "ready", "remote-request")

	if _, err := studio.TerminateAIVideoReplica("job-ready"); err == nil || err.Error() != "当前任务不能终止" {
		t.Fatalf("terminate error = %v", err)
	}
}

func TestDecodeResponseReturnsJSONErrorEnvelopeOnSuccessStatus(t *testing.T) {
	recorder := httptest.NewRecorder()
	recorder.WriteHeader(http.StatusOK)
	_, _ = recorder.Write([]byte(`{"err":"没有权限"}`))
	response := recorder.Result()
	if err := decodeResponse(response, &map[string]any{}); err == nil || err.Error() != "没有权限" {
		t.Fatalf("decodeResponse error = %v, want permission message", err)
	}
}

func TestNormalizeVideoGenerationErrorMapsUnauthorized(t *testing.T) {
	err := normalizeVideoGenerationError(errors.New("Huabot 请求失败：HTTP 401：Unauthorized"))
	if err == nil || err.Error() != authorizationExpiredMessage {
		t.Fatalf("normalized error = %v, want %q", err, authorizationExpiredMessage)
	}
}

func TestVideoReplicaPayloadUsesReferenceTaskType(t *testing.T) {
	payload := videoReplicaPayload("doubao-seedance-2.5", "复刻商品", 30, "480p", "16:9", 1, true)
	if got := payload["omni_reference_task_type"]; got != "reference" {
		t.Fatalf("omni_reference_task_type = %v, want reference", got)
	}
}

func TestVideoReplicaPayloadWithoutProductReferenceHasNoImageAnchors(t *testing.T) {
	payload := videoReplicaPayload("doubao-seedance-2.5", "复刻视频", 30, "480p", "16:9", 0, false)
	prompt, ok := payload["prompt"].(string)
	if !ok || strings.Contains(prompt, "@Image") {
		t.Fatalf("prompt = %q, want no image anchors", prompt)
	}
}

func TestMigrateNormalizesRetiredVideoReplicaTaskTypes(t *testing.T) {
	studio := newAIVideoReplicaTestStudio(t)
	for _, taskType := range []string{"auto", "extend", "replace", "ai_replica"} {
		if _, err := studio.db.Exec(`insert into video_replica_jobs
			(id,user_id,source_video_path,task_type,model,duration,resolution,ratio,status,created_at)
			values(?,?,?,?,?,?,?,?,?,?)`, "legacy-"+taskType, localWorkspaceID, "uploads/source.mp4", taskType, "seedance-2.5", 10, "480p", "16:9", "ready", 1); err != nil {
			t.Fatal(err)
		}
	}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	for _, check := range []struct {
		id, want string
	}{
		{"legacy-auto", "reference"},
		{"legacy-extend", "reference"},
		{"legacy-replace", "reference"},
		{"legacy-ai_replica", "ai_replica"},
	} {
		var got string
		if err := studio.db.QueryRow("select task_type from video_replica_jobs where id=?", check.id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("task type for %s = %q, want %q", check.id, got, check.want)
		}
	}
}

func TestValidateVideoReplicaRejectsRetiredTaskTypes(t *testing.T) {
	for _, taskType := range []string{"auto", "extend", "replace"} {
		input := VideoReplicaInput{TaskType: taskType, Model: "seedance-2.5", Prompt: "复刻商品", Duration: 10, Resolution: "480p", Ratio: "16:9"}
		if err := validateVideoReplicaInput(input); err == nil {
			t.Fatalf("retired task type %q was accepted", taskType)
		}
	}
}

func TestValidateVideoReplicaRequiresSelectedProductReference(t *testing.T) {
	input := VideoReplicaInput{TaskType: "reference", Model: "seedance-2.5", Prompt: "复刻商品", Duration: 10, Resolution: "480p", Ratio: "16:9", ReferencePaths: []string{"uploads/product.png"}}
	if err := validateVideoReplicaInput(input); err == nil {
		t.Fatal("expected missing product reference error")
	}
	input.ProductReferencePath = "uploads/other.png"
	if err := validateVideoReplicaInput(input); err == nil {
		t.Fatal("expected unknown product reference error")
	}
	input.ProductReferencePath = "uploads/product.png"
	if err := validateVideoReplicaInput(input); err != nil {
		t.Fatalf("selected product reference rejected: %v", err)
	}
}

func TestValidateVideoReplicaAllowsNoReferenceVideo(t *testing.T) {
	input := VideoReplicaInput{
		TaskType:   "reference",
		Model:      "seedance-2.5",
		Prompt:     "为咖啡杯制作简洁的通勤短片",
		Duration:   10,
		Resolution: "480p",
		Ratio:      "9:16",
	}
	if err := validateVideoReplicaInput(input); err != nil {
		t.Fatalf("reference video should be optional: %v", err)
	}
}

func TestOrderedVideoReferencePathsPutsProductFirst(t *testing.T) {
	ordered := orderedVideoReferencePaths([]string{"uploads/style.png", "uploads/product.png", "uploads/person.png"}, "uploads/product.png")
	if got, want := strings.Join(ordered, ","), "uploads/product.png,uploads/style.png,uploads/person.png"; got != want {
		t.Fatalf("ordered references = %q, want %q", got, want)
	}
}

func TestSegmentVideoUsesModelLimit(t *testing.T) {
	storyboard := []map[string]any{
		{"start": 0, "end": 20, "shot": "开场", "action": "产品入镜"},
		{"start": 20, "end": 60, "shot": "主体", "action": "展示细节"},
	}
	segments, err := segmentVideo(60, 15, storyboard, "保持产品一致")
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 4 {
		t.Fatalf("segment count = %d, want 4", len(segments))
	}
	for index, segment := range segments {
		if segment.Start != index*15 || segment.Duration != 15 {
			t.Fatalf("segment %d = %#v, want start=%d duration=15", index, segment, index*15)
		}
	}
}

func TestSegmentVideoSplitsThirtySecondModelIntoTwoParts(t *testing.T) {
	segments, err := segmentVideo(60, 30, nil, "镜头级重制")
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 2 || segments[0].Duration != 30 || segments[1].Start != 30 {
		t.Fatalf("segments = %#v, want two 30-second parts", segments)
	}
}

func TestSegmentVideoIncludesStoryboardAudioDirection(t *testing.T) {
	segments, err := segmentVideo(10, 10, []map[string]any{{"start": 0, "end": 10, "shot": "近景", "action": "展示", "audio": "轻快配乐和开盖声"}}, "复刻咖啡杯")
	if err != nil {
		t.Fatal(err)
	}
	if got := segments[0].Prompt; !strings.Contains(got, "音频 轻快配乐和开盖声") {
		t.Fatalf("segment prompt = %q, want audio direction", got)
	}
}

func TestNormalizeVideoReplicaStoryboardFillsMissingEndTimes(t *testing.T) {
	storyboard, err := normalizeVideoReplicaStoryboard([]any{
		map[string]any{"start": float64(8), "end": float64(12), "shot": "近景"},
		map[string]any{"start": float64(12), "shot": "中景"},
		map[string]any{"start": float64(16), "shot": "全景"},
	}, 20)
	if err != nil {
		t.Fatal(err)
	}
	if got := storyboard[1]["end"]; got != float64(16) {
		t.Fatalf("second shot end = %v, want 16", got)
	}
	if got := storyboard[2]["end"]; got != float64(20) {
		t.Fatalf("last shot end = %v, want 20", got)
	}
}

func TestNormalizeVideoReplicaStoryboardRejectsInvalidEndTime(t *testing.T) {
	_, err := normalizeVideoReplicaStoryboard([]any{
		map[string]any{"start": float64(8), "end": float64(8)},
		map[string]any{"start": float64(8), "end": float64(12)},
	}, 20)
	if err == nil || !strings.Contains(err.Error(), "结束时间无效") {
		t.Fatalf("error = %v, want invalid end time", err)
	}
}

func TestNormalizeVideoReplicaStoryboardReplacesInvalidEndTimes(t *testing.T) {
	storyboard, err := normalizeVideoReplicaStoryboard([]any{
		map[string]any{"start": float64(0), "end": float64(5)},
		map[string]any{"start": float64(5), "end": float64(5)},
		map[string]any{"start": float64(10), "end": float64(15)},
	}, 15)
	if err != nil {
		t.Fatal(err)
	}
	if got := storyboard[1]["end"]; got != float64(10) {
		t.Fatalf("second shot end = %v, want 10", got)
	}
}

func TestNormalizeVideoReplicaStoryboardClampsInvalidFinalShotEnd(t *testing.T) {
	storyboard, err := normalizeVideoReplicaStoryboard([]any{
		map[string]any{"start": float64(0), "end": float64(5)},
		map[string]any{"start": float64(5), "end": float64(10)},
		map[string]any{"start": float64(10), "end": float64(15)},
		map[string]any{"start": float64(15), "end": float64(20)},
		map[string]any{"start": float64(20), "end": float64(25)},
		map[string]any{"start": float64(25), "end": float64(32)},
	}, 30)
	if err != nil {
		t.Fatal(err)
	}
	if got := storyboard[5]["end"]; got != float64(30) {
		t.Fatalf("sixth shot end = %v, want 30", got)
	}
}

func TestParseVideoReplicaReview(t *testing.T) {
	result, err := parseVideoReplicaReview("```json\n{\"score\":86,\"issues\":[\"缺少时长\",\"动作不够具体\"],\"optimized_prompt\":\"制作一条 15 秒产品短片，先展示整体，再用近景呈现材质细节，保持镜头连贯。\"}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if result["score"] != 86 || len(result["issues"].([]string)) != 2 {
		t.Fatalf("review = %#v", result)
	}
}

func TestParseVideoReplicaReviewRejectsInvalidScore(t *testing.T) {
	if _, err := parseVideoReplicaReview(`{"score":101,"issues":[],"optimized_prompt":"优化稿"}`); err == nil {
		t.Fatal("expected invalid score error")
	}
}

func TestParseVideoReplicaReviewAllowsTwoThousandCharacterOptimization(t *testing.T) {
	optimized := strings.Repeat("描", 2000)
	result, err := parseVideoReplicaReview(`{"score":90,"issues":[],"optimized_prompt":"` + optimized + `"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := result["optimized_prompt"].(string); len([]rune(got)) != 2000 {
		t.Fatalf("optimized prompt length = %d, want 2000", len([]rune(got)))
	}
}

func TestVideoReplicaPayloadEnablesNativeAudio(t *testing.T) {
	payload := videoReplicaPayload("doubao-seedance-2.5", "生成同步音效", 10, "480p", "16:9", 2, true)
	if got, ok := payload["generate_audio"].(bool); !ok || !got {
		t.Fatalf("generate_audio = %#v, want true", payload["generate_audio"])
	}
	if got := payload["prompt"].(string); !strings.Contains(got, "@Image 1") || !strings.Contains(got, "@Image 2") {
		t.Fatalf("product reference prompt = %q, want image anchors", got)
	}
}

func TestHasAudioStream(t *testing.T) {
	if !hasAudioStream([]byte("1\n")) {
		t.Fatal("audio stream output should be accepted")
	}
	if hasAudioStream([]byte(" \n")) {
		t.Fatal("empty probe output should be rejected")
	}
}

func TestUploadVideoReplicaSourceUsesTemporaryFileUpload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/file/run/" {
			t.Fatalf("request path = %q, want /api/file/run/", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("authorization = %q, want bearer token", got)
		}
		if err := request.ParseMultipartForm(1024); err != nil {
			t.Fatalf("parse multipart form: %v", err)
		}
		if got := request.FormValue("temporary"); got != "true" {
			t.Fatalf("temporary = %q, want true", got)
		}
		file, _, err := request.FormFile("file")
		if err != nil {
			t.Fatalf("uploaded file: %v", err)
		}
		defer file.Close()
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"file":{"file_key":"abcdef","file_ext":"mp4"}}`))
	}))
	defer server.Close()

	dataDir := t.TempDir()
	uploadDir := filepath.Join(dataDir, "storage", "uploads")
	if err := os.MkdirAll(uploadDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploadDir, "source.mp4"), []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	studio := &Studio{dataDir: dataDir, httpClient: server.Client()}

	got, err := studio.uploadVideoReplicaSource(huabotConfig{WebBase: server.URL}, "test-token", "uploads/source.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if want := server.URL + "/upload/ab/cd/abcdef.mp4"; got != want {
		t.Fatalf("upload URL = %q, want %q", got, want)
	}
}

func TestUploadVideoReplicaVideoAllowsSourcesLongerThanFiveMinutes(t *testing.T) {
	toolDir := t.TempDir()
	ffprobe := filepath.Join(toolDir, "ffprobe")
	if err := os.WriteFile(ffprobe, []byte("#!/bin/sh\nprintf '301\\n'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	oldPath := os.Getenv("PATH")
	if err := os.Setenv("PATH", toolDir+string(os.PathListSeparator)+oldPath); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Setenv("PATH", oldPath) })

	dataDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataDir, "storage", "uploads"), 0o700); err != nil {
		t.Fatal(err)
	}
	studio := &Studio{dataDir: dataDir}
	result, err := studio.UploadVideoReplicaVideo("long.mp4", "video/mp4", []byte{0, 0, 0, 0, 'f', 't', 'y', 'p'})
	if err != nil {
		t.Fatalf("long video upload rejected: %v", err)
	}
	if result["duration_seconds"] != "301" {
		t.Fatalf("duration_seconds = %q, want 301", result["duration_seconds"])
	}
}

func TestAnalyzeVideoReplicaAcceptsGeneratedVideo(t *testing.T) {
	dataDir := t.TempDir()
	generatedDir := filepath.Join(dataDir, "storage", "generated", "video-replica")
	if err := os.MkdirAll(generatedDir, 0o700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(generatedDir, "result.mp4")
	if err := os.WriteFile(file, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}

	studio := &Studio{dataDir: dataDir}
	_, err := studio.AnalyzeVideoReplica("generated/video-replica/result.mp4", nil, "")
	if err != nil && err.Error() == "视频文件路径无效" {
		t.Fatalf("generated source rejected: %v", err)
	}
}
