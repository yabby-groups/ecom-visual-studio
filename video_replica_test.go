package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeVideoGenerationErrorMapsUnauthorized(t *testing.T) {
	err := normalizeVideoGenerationError(errors.New("Huabot 请求失败：HTTP 401：Unauthorized"))
	if err == nil || err.Error() != authorizationExpiredMessage {
		t.Fatalf("normalized error = %v, want %q", err, authorizationExpiredMessage)
	}
}

func TestHuabotOmniReferenceTaskTypeMapsReplaceToReference(t *testing.T) {
	payload := videoReplicaPayload("doubao-seedance-2.5", "替换商品", 30, "480p", "16:9", "replace", 1, true)
	if got := payload["omni_reference_task_type"]; got != "reference" {
		t.Fatalf("omni_reference_task_type = %v, want reference", got)
	}
}

func TestValidateVideoReplicaReplaceRequiresSingleProductImage(t *testing.T) {
	input := VideoReplicaInput{TaskType: "replace", Model: "seedance-2.5", Prompt: "把苹果替换成香蕉", Duration: 10, Resolution: "480p", Ratio: "16:9"}
	if err := validateVideoReplicaInput(input); err == nil {
		t.Fatal("expected product image validation error")
	}
	input.ReferencePaths = []string{"uploads/product.png"}
	input.ProductReferencePath = "uploads/product.png"
	if err := validateVideoReplicaInput(input); err != nil {
		t.Fatalf("valid replace input rejected: %v", err)
	}
}

func TestValidateVideoReplicaReplaceAllowsPreprocessingLongerSource(t *testing.T) {
	input := VideoReplicaInput{TaskType: "replace", Model: "seedance-2.0", Prompt: "把苹果替换成香蕉", Duration: 16, Resolution: "480p", Ratio: "16:9", ReferencePaths: []string{"uploads/product.png"}, ProductReferencePath: "uploads/product.png"}
	if err := validateVideoReplicaInput(input); err != nil {
		t.Fatalf("replace input should be accepted for preprocessing: %v", err)
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
	}, 20)
	if err == nil || !strings.Contains(err.Error(), "结束时间无效") {
		t.Fatalf("error = %v, want invalid end time", err)
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
	payload := videoReplicaPayload("doubao-seedance-2.5", "生成同步音效", 10, "480p", "16:9", "reference", 2, true)
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
