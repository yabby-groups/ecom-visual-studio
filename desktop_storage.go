package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const dataLocationFile = "EcomVisualStudio-location.json"

type dataLocation struct {
	ActivePath      string `json:"active_path"`
	CleanupPath     string `json:"cleanup_path,omitempty"`
	MigrationDigest string `json:"migration_digest,omitempty"`
}

func defaultDataDir() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("find application data directory: %w", err)
	}
	return filepath.Join(root, "EcomVisualStudio"), nil
}

func dataLocationPath() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("find application data directory: %w", err)
	}
	return filepath.Join(root, dataLocationFile), nil
}

func configuredDataDir() (string, dataLocation, error) {
	defaultPath, err := defaultDataDir()
	if err != nil {
		return "", dataLocation{}, err
	}
	locationPath, err := dataLocationPath()
	if err != nil {
		return "", dataLocation{}, err
	}
	raw, err := os.ReadFile(locationPath)
	if errors.Is(err, os.ErrNotExist) {
		return defaultPath, dataLocation{}, nil
	}
	if err != nil {
		return "", dataLocation{}, fmt.Errorf("read data location: %w", err)
	}
	var location dataLocation
	if err := json.Unmarshal(raw, &location); err != nil || location.ActivePath == "" {
		return "", dataLocation{}, errors.New("本地存储目录配置无效，请恢复配置文件后重试")
	}
	path, err := filepath.Abs(location.ActivePath)
	if err != nil {
		return "", dataLocation{}, err
	}
	return path, location, nil
}

func ensureDataDir(dataDir string) error {
	if err := os.MkdirAll(filepath.Join(dataDir, "storage", "uploads"), 0o700); err != nil {
		return err
	}
	return os.MkdirAll(filepath.Join(dataDir, "storage", "generated"), 0o700)
}

func writeDataLocation(location dataLocation) error {
	path, err := dataLocationPath()
	if err != nil {
		return err
	}
	return writeDataLocationFile(path, location)
}

func writeDataLocationFile(path string, location dataLocation) error {
	raw, err := json.Marshal(location)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".ecom-location-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	// Windows does not implement POSIX modes. A best-effort permission change
	// must not prevent the location record from being written there.
	_ = tmp.Chmod(0o600)
	if _, err = tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// os.Rename replaces a file destination on Windows as well as Unix. Keeping
	// both files in this directory also avoids cross-volume move restrictions.
	return os.Rename(tmpName, path)
}

func managedDataExists(dir string) bool {
	for _, name := range []string{"studio.db", "studio.db-shm", "studio.db-wal", "token.key", ".env", "storage"} {
		if _, err := os.Lstat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}

func copyFile(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	return err
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported storage entry: %s", path)
		}
		return copyFile(path, target)
	})
}

func treeHashes(root string) (map[string][sha256.Size]byte, error) {
	result := map[string][sha256.Size]byte{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("unsupported storage entry: %s", path)
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		hash := sha256.New()
		_, err = io.Copy(hash, file)
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		var sum [sha256.Size]byte
		copy(sum[:], hash.Sum(nil))
		result[filepath.ToSlash(rel)] = sum
		return nil
	})
	return result, err
}

func sameTree(source, destination string) error {
	left, err := treeHashes(source)
	if err != nil {
		return err
	}
	right, err := treeHashes(destination)
	if err != nil {
		return err
	}
	if len(left) != len(right) {
		return errors.New("迁移文件数量校验失败")
	}
	keys := make([]string, 0, len(left))
	for key := range left {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if right[key] != left[key] {
			return fmt.Errorf("迁移文件校验失败: %s", key)
		}
	}
	return nil
}

func managedDataDigest(dir string) (string, error) {
	for _, name := range []string{"studio.db", "token.key", "storage"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return "", fmt.Errorf("迁移数据不完整: %s: %w", name, err)
		}
	}
	hash := sha256.New()
	for _, name := range []string{"studio.db", "token.key", ".env", "storage"} {
		root := filepath.Join(dir, name)
		if _, err := os.Lstat(root); errors.Is(err, os.ErrNotExist) && name == ".env" {
			continue
		} else if err != nil {
			return "", err
		}
		if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if !entry.Type().IsRegular() {
				return fmt.Errorf("unsupported storage entry: %s", path)
			}
			rel, err := filepath.Rel(dir, path)
			if err != nil {
				return err
			}
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			_, _ = io.WriteString(hash, filepath.ToSlash(rel)+"\x00")
			_, copyErr := io.Copy(hash, file)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			return closeErr
		}); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func verifyMigrationTarget(dir string, location dataLocation) error {
	if location.CleanupPath == "" {
		return nil
	}
	if location.MigrationDigest == "" {
		return errors.New("存储迁移记录缺少校验信息，原目录已保留")
	}
	digest, err := managedDataDigest(dir)
	if err != nil {
		return fmt.Errorf("新存储目录校验失败，原目录已保留: %w", err)
	}
	if digest != location.MigrationDigest {
		return errors.New("新存储目录内容已变化，原目录已保留")
	}
	return nil
}

func removeManagedData(dir string) error {
	for _, name := range []string{"studio.db", "studio.db-shm", "studio.db-wal", "token.key", ".env", "storage"} {
		if err := os.RemoveAll(filepath.Join(dir, name)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Studio) StorageLocation() map[string]any {
	s.storageMu.RLock()
	pending := s.migrationPending
	s.storageMu.RUnlock()
	return map[string]any{"current_path": s.dataDir, "restart_required": pending}
}

func (s *Studio) ChooseStorageDirectory() (map[string]any, error) {
	if s.ctx == nil {
		return nil, errors.New("桌面窗口尚未就绪")
	}
	dir, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{Title: "选择本地存储目录"})
	if err != nil {
		return nil, fmt.Errorf("打开目录选择器失败: %w", err)
	}
	if dir == "" {
		return map[string]any{"cancelled": true}, nil
	}
	return s.migrateStorageDirectory(dir)
}

func (s *Studio) migrateStorageDirectory(target string) (map[string]any, error) {
	target, err := filepath.Abs(target)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(target, 0o700); err != nil {
		return nil, fmt.Errorf("无法创建存储目录: %w", err)
	}
	target, err = filepath.EvalSymlinks(target)
	if err != nil {
		return nil, fmt.Errorf("无法解析存储目录: %w", err)
	}
	current, err := filepath.EvalSymlinks(s.dataDir)
	if err != nil {
		return nil, fmt.Errorf("无法解析当前存储目录: %w", err)
	}
	storageRoot, err := filepath.EvalSymlinks(filepath.Join(s.dataDir, "storage"))
	if err != nil {
		return nil, fmt.Errorf("无法解析当前素材目录: %w", err)
	}
	if samePath(target, current) {
		return nil, errors.New("所选目录已是当前存储目录")
	}
	if isWithin(storageRoot, target) {
		return nil, errors.New("不能选择当前存储目录的子目录")
	}
	if managedDataExists(target) {
		return nil, errors.New("所选目录已有 Ecom Visual Studio 数据，请选择其他目录")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if s.migrationPending {
		return nil, errors.New("存储迁移已完成，请重启应用后继续使用")
	}
	var active int
	if err := s.db.QueryRow("select (select count(*) from assets where status in ('queued','prompting','generating')) + (select count(*) from try_on_jobs where status in ('queued','generating'))").Scan(&active); err != nil {
		return nil, err
	}
	if active > 0 {
		return nil, errors.New("请等待所有生成任务完成后再迁移存储目录")
	}
	// Reject new protected requests before taking the database snapshot.
	s.migrationPending = true
	if err := s.exportStorage(target); err != nil {
		s.migrationPending = false
		_ = removeManagedData(target)
		return nil, err
	}
	digest, err := managedDataDigest(target)
	if err != nil {
		s.migrationPending = false
		_ = removeManagedData(target)
		return nil, fmt.Errorf("校验新存储目录失败: %w", err)
	}
	if err := writeDataLocation(dataLocation{ActivePath: target, CleanupPath: s.dataDir, MigrationDigest: digest}); err != nil {
		s.migrationPending = false
		_ = removeManagedData(target)
		return nil, fmt.Errorf("保存新存储目录失败: %w", err)
	}
	return map[string]any{"current_path": s.dataDir, "pending_path": target, "restart_required": true}, nil
}

func (s *Studio) exportStorage(target string) error {
	databasePath := filepath.Join(target, "studio.db")
	if _, err := s.db.Exec("vacuum into ?", databasePath); err != nil {
		return fmt.Errorf("导出数据库失败: %w", err)
	}
	for _, name := range []string{"token.key", ".env"} {
		source := filepath.Join(s.dataDir, name)
		if _, err := os.Stat(source); errors.Is(err, os.ErrNotExist) {
			continue
		} else if err != nil {
			return err
		}
		if err := copyFile(source, filepath.Join(target, name)); err != nil {
			return fmt.Errorf("复制 %s 失败: %w", name, err)
		}
	}
	if err := copyTree(filepath.Join(s.dataDir, "storage"), filepath.Join(target, "storage")); err != nil {
		return fmt.Errorf("复制素材失败: %w", err)
	}
	if err := ensureDataDir(target); err != nil {
		return err
	}
	check, err := sql.Open("sqlite", sqliteDSN(databasePath))
	if err != nil {
		return err
	}
	defer check.Close()
	var integrity string
	if err := check.QueryRow("pragma integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		if err != nil {
			return fmt.Errorf("校验迁移数据库失败: %w", err)
		}
		return errors.New("校验迁移数据库失败")
	}
	return sameTree(filepath.Join(s.dataDir, "storage"), filepath.Join(target, "storage"))
}

func (s *Studio) dataWriteAllowed() error {
	s.storageMu.RLock()
	pending := s.migrationPending
	s.storageMu.RUnlock()
	if pending {
		return errors.New("存储迁移已完成，请重启应用后继续使用")
	}
	return nil
}

func (s *Studio) beginDataWrite() (func(), error) {
	s.storageMu.RLock()
	if s.migrationPending {
		s.storageMu.RUnlock()
		return nil, errors.New("存储迁移已完成，请重启应用后继续使用")
	}
	return s.storageMu.RUnlock, nil
}

func isWithin(parent, child string) bool {
	rel, err := filepath.Rel(comparisonPath(parent), comparisonPath(child))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func samePath(left, right string) bool {
	return comparisonPath(left) == comparisonPath(right)
}

func comparisonPath(path string) string {
	path = filepath.Clean(path)
	if goruntime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}
