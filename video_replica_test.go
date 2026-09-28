package main

import "testing"

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
