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
	args := strings.Join(batchImageFFmpegArgs("input.png", "output.jpg", 1200, "jpg"), " ")
	if !strings.Contains(args, "min(iw\\,1200)") || !strings.Contains(args, "color=c=white") || !strings.Contains(args, "mjpeg") {
		t.Fatalf("unexpected JPEG arguments: %s", args)
	}
	webp := strings.Join(batchImageFFmpegArgs("input.png", "output.webp", 800, "webp"), " ")
	if !strings.Contains(webp, "libwebp") || !strings.Contains(webp, "-q:v 90") {
		t.Fatalf("unexpected WebP arguments: %s", webp)
	}
	gif := strings.Join(batchImageFFmpegArgs("input.png", "output.gif", 800, "gif"), " ")
	if !strings.Contains(gif, "-c:v gif") {
		t.Fatalf("unexpected GIF arguments: %s", gif)
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
	if err := convertBatchImage(source, target, 4, "jpg"); err != nil {
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
