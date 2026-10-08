package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBatchImageSourcesRecursesAndExcludesOutput(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input")
	output := filepath.Join(input, "converted")
	for _, path := range []string{
		filepath.Join(input, "one.jpg"),
		filepath.Join(input, "nested", "two.PNG"),
		filepath.Join(input, "notes.txt"),
		filepath.Join(output, "old.webp"),
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	sources, err := batchImageSources(input, "directory", output)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 2 {
		t.Fatalf("source count = %d, want 2", len(sources))
	}
	if sources[0].relative != filepath.Join("nested", "two.PNG") || sources[1].relative != "one.jpg" {
		t.Fatalf("unexpected sources: %#v", sources)
	}
}

func TestValidateBatchImageInputAllowsExternalOutputDirectory(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.jpg")
	output := filepath.Join(root, "external-output")
	if err := os.WriteFile(input, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(output, 0o700); err != nil {
		t.Fatal(err)
	}
	canonicalOutput, err := filepath.EvalSymlinks(output)
	if err != nil {
		t.Fatal(err)
	}

	studio := &Studio{dataDir: filepath.Join(root, "application-data")}
	resolved, err := studio.validateBatchImageInput(&BatchImageInput{
		SourcePath:      input,
		SourceType:      "file",
		OutputDirectory: output,
		Width:           1080,
		Format:          "jpg",
		QualityMode:     "balanced",
		RequestID:       "test-request",
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved != canonicalOutput {
		t.Fatalf("output directory = %q, want %q", resolved, canonicalOutput)
	}
}

func TestBatchImageFFmpegArgs(t *testing.T) {
	args := strings.Join(batchImageFFmpegArgs("input.png", "output.jpg", 1200, "jpg", "balanced", 0), " ")
	if !strings.Contains(args, "min(iw\\,1200)") || !strings.Contains(args, "color=c=white") || !strings.Contains(args, "mjpeg") || !strings.Contains(args, "-q:v 7") {
		t.Fatalf("unexpected JPEG arguments: %s", args)
	}
	webp := strings.Join(batchImageFFmpegArgs("input.png", "output.webp", 800, "webp", "size", 0), " ")
	if !strings.Contains(webp, "libwebp") || !strings.Contains(webp, "-q:v 60") {
		t.Fatalf("unexpected WebP arguments: %s", webp)
	}
	gif := strings.Join(batchImageFFmpegArgs("input.png", "output.gif", 800, "gif", "quality", 0), " ")
	if !strings.Contains(gif, "-c:v gif") {
		t.Fatalf("unexpected GIF arguments: %s", gif)
	}
	png := strings.Join(batchImageFFmpegArgs("input.png", "output.png", 800, "png", "custom", 1), " ")
	if strings.Contains(png, "-q:v") {
		t.Fatalf("PNG should not receive a lossy quality argument: %s", png)
	}
}

func TestBatchImageCustomQualityFFmpegArgs(t *testing.T) {
	jpg := strings.Join(batchImageFFmpegArgs("input.png", "output.jpg", 800, "jpg", "custom", 1), " ")
	if !strings.Contains(jpg, "-q:v 31") {
		t.Fatalf("unexpected custom JPEG arguments: %s", jpg)
	}
	webp := strings.Join(batchImageFFmpegArgs("input.png", "output.webp", 800, "webp", "custom", 100), " ")
	if !strings.Contains(webp, "-q:v 100") {
		t.Fatalf("unexpected custom WebP arguments: %s", webp)
	}
}

func TestValidateBatchImageInputQualityMode(t *testing.T) {
	root := t.TempDir()
	input := filepath.Join(root, "input.jpg")
	output := filepath.Join(root, "output")
	if err := os.WriteFile(input, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(output, 0o700); err != nil {
		t.Fatal(err)
	}
	studio := &Studio{}
	base := BatchImageInput{SourcePath: input, SourceType: "file", OutputDirectory: output, Width: 1080, Format: "webp", RequestID: "test-request"}
	for _, mode := range []string{"size", "balanced", "quality"} {
		candidate := base
		candidate.QualityMode = mode
		if _, err := studio.validateBatchImageInput(&candidate); err != nil {
			t.Fatalf("mode %q should be valid: %v", mode, err)
		}
	}
	for _, quality := range []int{1, 100} {
		candidate := base
		candidate.QualityMode = "custom"
		candidate.CustomQuality = quality
		if _, err := studio.validateBatchImageInput(&candidate); err != nil {
			t.Fatalf("custom quality %d should be valid: %v", quality, err)
		}
	}
	for _, candidate := range []BatchImageInput{
		base,
		func() BatchImageInput { value := base; value.QualityMode = "unknown"; return value }(),
		func() BatchImageInput { value := base; value.QualityMode = "custom"; return value }(),
		func() BatchImageInput {
			value := base
			value.QualityMode = "custom"
			value.CustomQuality = 101
			return value
		}(),
	} {
		if _, err := studio.validateBatchImageInput(&candidate); err == nil {
			t.Fatalf("input %#v should be rejected", candidate)
		}
	}
}

func TestReplaceImageExtension(t *testing.T) {
	if got := replaceImageExtension(filepath.Join("nested", "photo.jpeg"), "png"); got != filepath.Join("nested", "photo.png") {
		t.Fatalf("replaceImageExtension() = %q", got)
	}
}

func TestConvertBatchImageWithFFmpeg(t *testing.T) {
	if _, err := exec.LookPath(mediaToolPath("ffmpeg")); err != nil {
		t.Skip("ffmpeg is not available")
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "source.png")
	if output, err := exec.Command(mediaToolPath("ffmpeg"), "-y", "-f", "lavfi", "-i", "color=c=red:s=8x4", "-frames:v", "1", source).CombinedOutput(); err != nil {
		t.Fatalf("create fixture: %v: %s", err, output)
	}
	target := filepath.Join(dir, "output.jpg")
	if err := convertBatchImage(source, target, 4, "jpg", "balanced", 0); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("converted image is empty")
	}
}
