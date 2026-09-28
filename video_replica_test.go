package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeVideoGenerationErrorMapsUnauthorized(t *testing.T) {
	err := normalizeVideoGenerationError(errors.New("Huabot 请求失败：HTTP 401：Unauthorized"))
	if err == nil || err.Error() != authorizationExpiredMessage {
		t.Fatalf("normalized error = %v, want %q", err, authorizationExpiredMessage)
	}
}

func TestValidateVideoReplicaReplaceRequiresSingleProductImage(t *testing.T) {
	input := VideoReplicaInput{TaskType: "replace", Model: "seedance-2.5", Prompt: "把苹果替换成香蕉", Duration: 10, Resolution: "480p", Ratio: "16:9"}
	if err := validateVideoReplicaInput(input); err == nil {
		t.Fatal("expected product image validation error")
	}
	input.ReferencePaths = []string{"uploads/product.png"}
	if err := validateVideoReplicaInput(input); err != nil {
		t.Fatalf("valid replace input rejected: %v", err)
	}
}

func TestValidateVideoReplicaReplaceAllowsPreprocessingLongerSource(t *testing.T) {
	input := VideoReplicaInput{TaskType: "replace", Model: "seedance-2.0", Prompt: "把苹果替换成香蕉", Duration: 16, Resolution: "480p", Ratio: "16:9", ReferencePaths: []string{"uploads/product.png"}}
	if err := validateVideoReplicaInput(input); err != nil {
		t.Fatalf("replace input should be accepted for preprocessing: %v", err)
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
	_, err := studio.AnalyzeVideoReplica("generated/video-replica/result.mp4")
	if err != nil && err.Error() == "视频文件路径无效" {
		t.Fatalf("generated source rejected: %v", err)
	}
}
