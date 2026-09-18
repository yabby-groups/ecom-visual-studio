package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	_ "modernc.org/sqlite"
)

const (
	maxUploadBytes         = 15 << 20
	imageImportTimeout     = 300 * time.Second
	imageImportMaxAttempts = 3
	localWorkspaceID       = "desktop-workspace"
	browserUserAgent       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

type Studio struct {
	ctx              context.Context
	db               *sql.DB
	dataDir          string
	masterKey        []byte
	httpClient       *http.Client
	mu               sync.RWMutex
	dbWriteMu        sync.Mutex
	storageMu        sync.RWMutex
	migrationPending bool
	user             *User
	huabotBearer     string
}

type User struct {
	ID       string  `json:"id"`
	Username string  `json:"username"`
	Profile  Profile `json:"profile"`
}

type Profile struct {
	NickName  string `json:"nick_name"`
	AvatarURL string `json:"avatar_url"`
}

type SettingsInput struct {
	TokenID    string `json:"token_id"`
	ImageModel string `json:"image_model"`
	TextModel  string `json:"text_model"`
	ChatModel  string `json:"chat_model"`
}

func NewStudio() (*Studio, error) {
	dataDir, location, err := configuredDataDir()
	if err != nil {
		return nil, err
	}
	if err := verifyMigrationTarget(dataDir, location); err != nil {
		return nil, err
	}
	if err := ensureDataDir(dataDir); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", sqliteDSN(filepath.Join(dataDir, "studio.db")))
	if err != nil {
		return nil, err
	}
	masterKey, err := loadOrCreateMasterKey(dataDir)
	if err != nil {
		db.Close()
		return nil, err
	}
	studio := &Studio{db: db, dataDir: dataDir, masterKey: masterKey, httpClient: &http.Client{Timeout: 300 * time.Second}}
	if err := studio.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := studio.restoreLogin(); err != nil {
		db.Close()
		return nil, err
	}
	if location.CleanupPath != "" && filepath.Clean(location.CleanupPath) != filepath.Clean(dataDir) {
		// The new root has opened successfully; remove only application-owned entries
		// from the previous user-selected directory, leaving unrelated user files intact.
		if err := removeManagedData(location.CleanupPath); err == nil {
			_ = writeDataLocation(dataLocation{ActivePath: dataDir})
		}
	}
	return studio, nil
}

func sqliteDSN(path string) string {
	databaseURL := &url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	query := databaseURL.Query()
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "journal_mode(WAL)")
	databaseURL.RawQuery = query.Encode()
	return databaseURL.String()
}

// Generation writes are short and serialized locally; provider requests never hold this lock.
func (s *Studio) writeTransaction(fn func(*sql.Tx) error) error {
	done, err := s.beginDataWrite()
	if err != nil {
		return err
	}
	defer done()
	s.dbWriteMu.Lock()
	defer s.dbWriteMu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Studio) execDataWrite(query string, args ...any) (sql.Result, error) {
	done, err := s.beginDataWrite()
	if err != nil {
		return nil, err
	}
	defer done()
	return s.db.Exec(query, args...)
}

func (s *Studio) startup(ctx context.Context) { s.ctx = ctx }
func (s *Studio) shutdown(context.Context)    { _ = s.db.Close() }

func (s *Studio) migrate() error {
	statements := []string{
		"pragma foreign_keys = on",
		"create table if not exists users (id text primary key, username text unique not null, created_at integer not null, nick_name text not null, avatar_url text not null)",
		"create table if not exists desktop_session (singleton integer primary key check(singleton=1), user_id text not null references users(id) on delete cascade)",
		"create table if not exists projects (id text primary key, user_id text not null, name text not null, product text not null, description text not null default '', benefits text not null default '', color text not null default '', reference text not null default '', created_at integer not null)",
		"create table if not exists assets (id text primary key, project_id text not null, title text not null, template text not null, ratio text not null, prompt text not null default '', status text not null, file_path text, generation_started_at integer, created_at integer not null)",
		"create table if not exists asset_versions (id text primary key, asset_id text not null, file_path text not null, created_at integer not null)",
		"create table if not exists custom_templates (id text primary key, user_id text not null, name text not null, ratio text not null, direction text not null, created_at integer not null)",
		"create table if not exists settings (user_id text primary key, token_id text not null default '', image_model text not null default '', text_model text not null default '', chat_model text not null default '')",
		"create table if not exists tokens (id text primary key, user_id text not null, name text not null, secret text not null, masked text not null default '', status integer not null default 1, today_cost text not null default '0', total_cost text not null default '0')",
		"create table if not exists models (id text primary key, user_id text not null, name text not null, alias text not null)",
		"create table if not exists try_on_jobs (id text primary key, user_id text not null, person_paths text not null, garment_paths text not null, generation_mode text not null, instructions text not null default '', ratio text not null, status text not null, file_path text, generation_started_at integer, created_at integer not null)",
		"create table if not exists try_on_versions (id text primary key, job_id text not null, file_path text not null, created_at integer not null)",
		"create index if not exists projects_user_created_idx on projects(user_id, created_at desc)",
		"create index if not exists assets_project_idx on assets(project_id)",
		"create index if not exists try_on_jobs_user_created_idx on try_on_jobs(user_id, created_at desc)",
		"create unique index if not exists try_on_versions_job_file_idx on try_on_versions(job_id, file_path)",
		"create index if not exists try_on_versions_job_created_idx on try_on_versions(job_id, created_at desc)",
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	// Local creations belong to this desktop installation, not to the Huabot
	// account that happens to provide AI credentials. Collapse records from
	// earlier account-scoped builds into the single local workspace.
	for _, statement := range []string{
		"update projects set user_id='" + localWorkspaceID + "' where user_id<>'" + localWorkspaceID + "'",
		"update custom_templates set user_id='" + localWorkspaceID + "' where user_id<>'" + localWorkspaceID + "'",
		"update try_on_jobs set user_id='" + localWorkspaceID + "' where user_id<>'" + localWorkspaceID + "'",
	} {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	// Early desktop builds did not persist the selected provider token.
	if _, err := s.db.Exec("alter table settings add column token_id text not null default ''"); err != nil && !strings.Contains(err.Error(), "duplicate column") {
		return err
	}
	return nil
}

func (s *Studio) restoreLogin() error {
	var user User
	err := s.db.QueryRow("select u.id,u.username,u.nick_name,u.avatar_url from desktop_session d join users u on u.id=d.user_id where d.singleton=1").Scan(&user.ID, &user.Username, &user.Profile.NickName, &user.Profile.AvatarURL)
	if errors.Is(err, sql.ErrNoRows) {
		s.mu.Lock()
		s.user = nil
		s.mu.Unlock()
		return nil
	}
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.user = &user
	s.mu.Unlock()
	return nil
}

func (s *Studio) persistLogin(userID string) error {
	_, err := s.execDataWrite("insert into desktop_session(singleton,user_id) values(1,?) on conflict(singleton) do update set user_id=excluded.user_id", userID)
	return err
}

func (s *Studio) currentUser() (User, error) {
	if err := s.dataWriteAllowed(); err != nil {
		return User{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.user == nil {
		return User{}, errors.New("登录状态已失效")
	}
	return *s.user, nil
}

// Me preserves the old API's nullable user envelope for the Zustand bootstrap.
func (s *Studio) Me() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.user == nil {
		return map[string]any{"user": nil}
	}
	return map[string]any{"user": s.user}
}

func (s *Studio) Login(name, password, totpCode string) (map[string]any, error) {
	if err := s.dataWriteAllowed(); err != nil {
		return nil, err
	}
	return s.loginHuabot(name, password, totpCode)
}

func (s *Studio) Logout() (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	if err := s.writeTransaction(func(tx *sql.Tx) error {
		if _, err := tx.Exec("delete from desktop_session where singleton=1"); err != nil {
			return err
		}
		if _, err := tx.Exec("delete from settings where user_id=?", user.ID); err != nil {
			return err
		}
		if _, err := tx.Exec("delete from tokens where user_id=?", user.ID); err != nil {
			return err
		}
		_, err := tx.Exec("delete from models where user_id=?", user.ID)
		return err
	}); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.user = nil
	s.huabotBearer = ""
	s.mu.Unlock()
	return map[string]bool{"ok": true}, nil
}

func (s *Studio) TokenSettings() (map[string]any, error) {
	return s.tokenSettings()
}

func (s *Studio) Models() (map[string]any, error) {
	return s.models()
}

func (s *Studio) SaveSettings(input SettingsInput) (map[string]bool, error) {
	if err := s.dataWriteAllowed(); err != nil {
		return nil, err
	}
	return s.saveSettings(input)
}

func (s *Studio) Upload(name, contentType string, data []byte) (map[string]string, error) {
	return s.storeUpload(name, contentType, data)
}

func (s *Studio) PickImage() (map[string]string, error) {
	if s.ctx == nil {
		return nil, errors.New("桌面窗口尚未就绪")
	}
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择图片",
		Filters: []runtime.FileFilter{{
			DisplayName: "图片 (JPG、PNG、WebP)",
			Pattern:     "*.jpg;*.jpeg;*.png;*.webp",
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("打开图片选择器失败: %w", err)
	}
	if path == "" {
		return nil, errors.New("未选择图片")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取选择的图片失败: %w", err)
	}
	return s.storeUpload(filepath.Base(path), "", data)
}

func (s *Studio) storeUpload(name, contentType string, data []byte) (map[string]string, error) {
	done, err := s.beginDataWrite()
	if err != nil {
		return nil, err
	}
	defer done()
	if len(data) == 0 || len(data) > maxUploadBytes {
		return nil, errors.New("图片大小必须在 15MB 以内")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
		return nil, errors.New("仅支持 JPG、PNG、WebP 图片")
	}
	if detected := http.DetectContentType(data); !strings.HasPrefix(detected, "image/") {
		return nil, errors.New("上传文件不是有效图片")
	}
	path := filepath.Join("uploads", stableID(fmt.Sprintf("%s-%d", name, time.Now().UnixNano()))+ext)
	if err := os.WriteFile(filepath.Join(s.dataDir, "storage", path), data, 0o600); err != nil {
		return nil, err
	}
	return map[string]string{"path": path}, nil
}

func (s *Studio) ImportURL(rawURL string) (map[string]string, error) {
	u, err := publicImageURL(rawURL)
	if err != nil {
		return nil, err
	}
	data, contentType, err := s.downloadPublicImage(rawURL)
	if err != nil {
		return nil, err
	}
	ext := filepath.Ext(u.Path)
	if ext == "" {
		ext = extensionFor(contentType)
	}
	return s.Upload("import"+ext, contentType, data)
}

func (s *Studio) downloadPublicImage(rawURL string) ([]byte, string, error) {
	baseClient := s.httpClient
	if baseClient == nil {
		baseClient = http.DefaultClient
	}
	client := *baseClient
	client.Timeout = imageImportTimeout
	client.CheckRedirect = func(request *http.Request, _ []*http.Request) error {
		if _, err := publicImageURL(request.URL.String()); err != nil {
			return err
		}
		setBrowserImageHeaders(request)
		return nil
	}

	var lastErr error
	for attempt := 0; attempt < imageImportMaxAttempts; attempt++ {
		request, err := http.NewRequest(http.MethodGet, rawURL, nil)
		if err != nil {
			return nil, "", fmt.Errorf("下载图片失败: %w", err)
		}
		setBrowserImageHeaders(request)
		response, err := client.Do(request)
		if err == nil && response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
			data, readErr := io.ReadAll(io.LimitReader(response.Body, maxUploadBytes+1))
			response.Body.Close()
			if readErr == nil {
				return data, response.Header.Get("Content-Type"), nil
			}
			err = readErr
		} else if err == nil {
			response.Body.Close()
			err = fmt.Errorf("下载图片失败: HTTP %d", response.StatusCode)
		}

		lastErr = err
		if !retryableImageImportError(err) || attempt == imageImportMaxAttempts-1 {
			break
		}
		time.Sleep(time.Duration(attempt+1) * 250 * time.Millisecond)
	}
	if isImageImportTimeout(lastErr) {
		return nil, "", errors.New("图片下载超时，请稍后重新导入")
	}
	return nil, "", lastErr
}

func setBrowserImageHeaders(request *http.Request) {
	request.Header.Set("User-Agent", browserUserAgent)
	request.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	request.Header.Set("Sec-Fetch-Dest", "image")
	request.Header.Set("Sec-Fetch-Mode", "no-cors")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
}

func retryableImageImportError(err error) bool {
	if isImageImportTimeout(err) {
		return true
	}
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return strings.Contains(err.Error(), "HTTP 408") || strings.Contains(err.Error(), "HTTP 429") || strings.Contains(err.Error(), "HTTP 5")
}

func isImageImportTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func publicImageURL(rawURL string) (*url.URL, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return nil, errors.New("请输入公开 HTTP(S) 图片链接")
	}
	addresses, err := net.DefaultResolver.LookupNetIP(context.Background(), "ip", u.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("无法解析公开图片链接")
	}
	for _, address := range addresses {
		if !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() {
			return nil, errors.New("图片链接不能指向本机或私有网络")
		}
	}
	return u, nil
}

func (s *Studio) serveFile(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/files/") {
		// BrowserRouter routes are served by the embedded SPA after a native refresh.
		index, err := assets.ReadFile("desktop_assets/index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
		return
	}
	rel := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/files/"))
	if rel == "." || strings.HasPrefix(rel, "..") {
		http.NotFound(w, r)
		return
	}
	file := filepath.Join(s.dataDir, "storage", rel)
	if !strings.HasPrefix(file, filepath.Join(s.dataDir, "storage")+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, file)
}

func extensionFor(contentType string) string {
	if ext, _ := mime.ExtensionsByType(strings.Split(contentType, ";")[0]); len(ext) > 0 {
		return ext[0]
	}
	return ".png"
}

func (s *Studio) NotifyGeneration(id, status string) {
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "generation:status", map[string]string{"id": id, "status": status})
	}
}
