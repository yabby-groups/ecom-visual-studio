package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const batchImageProgressEventPrefix = "batch-image:progress:"

type BatchImageInput struct {
	SourcePath      string `json:"source_path"`
	SourceType      string `json:"source_type"`
	OutputDirectory string `json:"output_directory"`
	Width           int    `json:"width"`
	Format          string `json:"format"`
	RequestID       string `json:"request_id"`
}

type BatchImageFailure struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

type BatchImageResult struct {
	Total     int                 `json:"total"`
	Converted int                 `json:"converted"`
	Skipped   int                 `json:"skipped"`
	Failed    int                 `json:"failed"`
	Failures  []BatchImageFailure `json:"failures"`
}

type batchImageSource struct {
	path     string
	relative string
}

func (s *Studio) BatchImageSourceType(path string) (map[string]string, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("无法解析输入路径: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("无法访问输入路径: %w", err)
	}
	if info.IsDir() {
		return map[string]string{"path": path, "source_type": "directory"}, nil
	}
	if !info.Mode().IsRegular() || !isSupportedBatchImage(path) {
		return nil, errors.New("仅支持拖入 JPG、PNG、WebP 图片或目录")
	}
	return map[string]string{"path": path, "source_type": "file"}, nil
}

func (s *Studio) ChooseBatchImageFile() (map[string]any, error) {
	if s.ctx == nil {
		return nil, errors.New("桌面窗口尚未就绪")
	}
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: "选择输入图片",
		Filters: []runtime.FileFilter{{
			DisplayName: "图片 (JPG、PNG、WebP)",
			Pattern:     "*.jpg;*.jpeg;*.png;*.webp",
		}},
	})
	if err != nil {
		return nil, fmt.Errorf("打开图片选择器失败: %w", err)
	}
	if path == "" {
		return map[string]any{"cancelled": true}, nil
	}
	return map[string]any{"path": path}, nil
}

func (s *Studio) ChooseBatchImageDirectory(title string) (map[string]any, error) {
	if s.ctx == nil {
		return nil, errors.New("桌面窗口尚未就绪")
	}
	if title != "选择输入图片目录" && title != "选择输出目录" {
		return nil, errors.New("无效的目录选择类型")
	}
	path, err := runtime.OpenDirectoryDialog(s.ctx, runtime.OpenDialogOptions{
		Title:                title,
		CanCreateDirectories: title == "选择输出目录",
	})
	if err != nil {
		return nil, fmt.Errorf("打开目录选择器失败: %w", err)
	}
	if path == "" {
		return map[string]any{"cancelled": true}, nil
	}
	return map[string]any{"path": path}, nil
}

func (s *Studio) BatchConvertImages(input BatchImageInput) (BatchImageResult, error) {
	done, err := s.beginDataWrite()
	if err != nil {
		return BatchImageResult{}, err
	}
	defer done()
	outputDirectory, err := s.validateBatchImageInput(&input)
	if err != nil {
		return BatchImageResult{}, err
	}
	sources, err := batchImageSources(input.SourcePath, input.SourceType, outputDirectory)
	if err != nil {
		return BatchImageResult{}, err
	}

	result := BatchImageResult{Total: len(sources), Failures: []BatchImageFailure{}}
	seenOutputs := make(map[string]struct{}, len(sources))
	for _, source := range sources {
		target := filepath.Join(outputDirectory, replaceImageExtension(source.relative, input.Format))
		key := filepath.Clean(target)
		if _, exists := seenOutputs[key]; exists {
			result.Skipped++
			s.emitBatchImageProgress(input.RequestID, result, source.relative)
			continue
		}
		seenOutputs[key] = struct{}{}
		if _, err := os.Lstat(target); err == nil {
			result.Skipped++
			s.emitBatchImageProgress(input.RequestID, result, source.relative)
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			result.Failed++
			result.Failures = append(result.Failures, BatchImageFailure{Path: source.relative, Reason: fmt.Sprintf("无法检查输出文件: %v", err)})
			s.emitBatchImageProgress(input.RequestID, result, source.relative)
			continue
		}
		if err := convertBatchImage(source.path, target, input.Width, input.Format); err != nil {
			result.Failed++
			result.Failures = append(result.Failures, BatchImageFailure{Path: source.relative, Reason: err.Error()})
		} else {
			result.Converted++
		}
		s.emitBatchImageProgress(input.RequestID, result, source.relative)
	}
	return result, nil
}

func (s *Studio) validateBatchImageInput(input *BatchImageInput) (string, error) {
	if input.SourceType != "file" && input.SourceType != "directory" {
		return "", errors.New("请选择图片文件或图片目录")
	}
	if input.Width < 1 || input.Width > 20000 {
		return "", errors.New("图片宽度必须在 1 到 20000 像素之间")
	}
	input.Format = strings.ToLower(strings.TrimSpace(input.Format))
	if input.Format != "jpg" && input.Format != "png" && input.Format != "webp" && input.Format != "gif" {
		return "", errors.New("输出格式仅支持 JPG、PNG、WebP、GIF")
	}
	if strings.TrimSpace(input.RequestID) == "" {
		return "", errors.New("批处理请求标识不能为空")
	}
	sourcePath, err := filepath.Abs(input.SourcePath)
	if err != nil {
		return "", fmt.Errorf("无法解析输入路径: %w", err)
	}
	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return "", fmt.Errorf("无法访问输入路径: %w", err)
	}
	if (input.SourceType == "file" && !sourceInfo.Mode().IsRegular()) || (input.SourceType == "directory" && !sourceInfo.IsDir()) {
		return "", errors.New("输入类型与所选路径不匹配")
	}
	if input.SourceType == "file" && !isSupportedBatchImage(sourcePath) {
		return "", errors.New("仅支持 JPG、PNG、WebP 图片")
	}
	input.SourcePath = sourcePath

	outputDirectory, err := filepath.Abs(input.OutputDirectory)
	if err != nil {
		return "", fmt.Errorf("无法解析输出目录: %w", err)
	}
	outputDirectory, err = filepath.EvalSymlinks(outputDirectory)
	if err != nil {
		return "", fmt.Errorf("无法解析输出目录: %w", err)
	}
	outputInfo, err := os.Stat(outputDirectory)
	if err != nil || !outputInfo.IsDir() {
		return "", errors.New("请选择有效的输出目录")
	}
	return outputDirectory, nil
}

func batchImageSources(sourcePath, sourceType, outputDirectory string) ([]batchImageSource, error) {
	if sourceType == "file" {
		return []batchImageSource{{path: sourcePath, relative: filepath.Base(sourcePath)}}, nil
	}
	sources := []batchImageSource{}
	err := filepath.WalkDir(sourcePath, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if path != sourcePath && isWithin(path, outputDirectory) {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() || !isSupportedBatchImage(path) {
			return nil
		}
		relative, err := filepath.Rel(sourcePath, path)
		if err != nil {
			return err
		}
		sources = append(sources, batchImageSource{path: path, relative: relative})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("扫描输入目录失败: %w", err)
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i].relative < sources[j].relative })
	return sources, nil
}

func isSupportedBatchImage(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	default:
		return false
	}
}

func replaceImageExtension(path, format string) string {
	return strings.TrimSuffix(path, filepath.Ext(path)) + "." + format
}

func convertBatchImage(source, target string, width int, format string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return fmt.Errorf("无法创建输出目录: %w", err)
	}
	if _, err := os.Lstat(target); err == nil {
		return errors.New("输出文件已存在")
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("无法检查输出文件: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".batch-image-*."+format)
	if err != nil {
		return fmt.Errorf("无法创建临时输出文件: %w", err)
	}
	temporaryPath := temporary.Name()
	if err := temporary.Close(); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	_ = os.Remove(temporaryPath)
	defer os.Remove(temporaryPath)

	args := batchImageFFmpegArgs(source, temporaryPath, width, format)
	command := exec.Command(mediaToolPath("ffmpeg"), args...)
	if output, err := command.CombinedOutput(); err != nil {
		detail := strings.TrimSpace(string(output))
		if detail == "" {
			detail = err.Error()
		}
		return fmt.Errorf("图片转换失败: %s", detail)
	}
	if err := os.Link(temporaryPath, target); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return errors.New("输出文件已存在")
		}
		return fmt.Errorf("保存转换图片失败: %w", err)
	}
	return nil
}

func batchImageFFmpegArgs(source, target string, width int, format string) []string {
	scale := fmt.Sprintf("scale='min(iw\\,%d)':-2", width)
	args := []string{"-y", "-i", source, "-frames:v", "1"}
	switch format {
	case "jpg":
		filter := "[0:v]" + scale + ",format=rgba[image];color=c=white:s=1x1[white];[white][image]scale2ref[background][image];[background][image]overlay=shortest=1,format=yuvj420p"
		args = append(args, "-filter_complex", filter, "-c:v", "mjpeg", "-q:v", "2")
	case "png":
		args = append(args, "-vf", scale, "-c:v", "png")
	case "webp":
		args = append(args, "-vf", scale, "-c:v", "libwebp", "-q:v", "90")
	case "gif":
		args = append(args, "-vf", scale, "-c:v", "gif")
	}
	return append(args, target)
}

func (s *Studio) emitBatchImageProgress(requestID string, result BatchImageResult, current string) {
	if s.ctx == nil {
		return
	}
	completed := result.Converted + result.Skipped + result.Failed
	runtime.EventsEmit(s.ctx, batchImageProgressEventPrefix+requestID, map[string]any{
		"total": result.Total, "completed": completed, "converted": result.Converted,
		"skipped": result.Skipped, "failed": result.Failed, "current": current,
		"updated_at": time.Now().UnixMilli(),
	})
}
