package main

import "testing"

func TestNormalizeAvatarPreviewURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "relative path", input: "/upload/avatar.jpg", want: "https://cdn.huabot.com/upload/avatar.jpg"},
		{name: "relative path without slash", input: "upload/avatar.jpg", want: "https://cdn.huabot.com/upload/avatar.jpg"},
		{name: "absolute https", input: "https://other.example/avatar.jpg", want: "https://other.example/avatar.jpg"},
		{name: "absolute http", input: "http://other.example/avatar.jpg", want: "http://other.example/avatar.jpg"},
		{name: "protocol relative", input: "//other.example/avatar.jpg", want: "//other.example/avatar.jpg"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeAvatarPreviewURL(test.input); got != test.want {
				t.Fatalf("normalizeAvatarPreviewURL(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestAvatarImageVariant(t *testing.T) {
	tests := []struct {
		name  string
		input string
		width int
		want  string
	}{
		{
			name:  "cdn png",
			input: "https://cdn.huabot.com/upload/FY/gJ/file-key.png",
			width: 512,
			want:  "https://cdn.huabot.com/upload/FY/gJ/file-key_fw512.webp",
		},
		{
			name:  "relative jpeg",
			input: "/upload/FY/gJ/file-key.jpeg",
			width: 64,
			want:  "https://cdn.huabot.com/upload/FY/gJ/file-key_fw64.webp",
		},
		{
			name:  "query preserved",
			input: "https://cdn.huabot.com/upload/FY/gJ/file-key.png?token=abc",
			width: 768,
			want:  "https://cdn.huabot.com/upload/FY/gJ/file-key_fw768.webp?token=abc",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := avatarImageVariant(test.input, test.width); got != test.want {
				t.Fatalf("avatarImageVariant(%q, %d) = %q, want %q", test.input, test.width, got, test.want)
			}
		})
	}
}

func TestAvatarPreviewURLFromFileKey(t *testing.T) {
	file := map[string]any{"file_key": "FYgJ-Iul0", "file_ext": "png"}
	want := "https://cdn.huabot.com/upload/FY/gJ/FYgJIul0.png"
	if got := avatarPreviewURL(file); got != want {
		t.Fatalf("avatarPreviewURL(%#v) = %q, want %q", file, got, want)
	}
}

func TestAvatarAssetViewExposesDisplayMetadataOnly(t *testing.T) {
	raw := map[string]any{
		"id":                "asset-1",
		"name":              "水师提督",
		"status":            "active",
		"provider_asset_id": "provider-secret-id",
		"asset_uri":         "avatar://public/asset-1",
		"file":              "/upload/avatar.png",
	}
	view := avatarAssetView(raw)
	if got := view["asset_uri"]; got != "avatar://public/asset-1" {
		t.Fatalf("asset_uri = %#v", got)
	}
	if _, ok := view["provider_asset_id"]; ok {
		t.Fatal("provider asset ID leaked into display view")
	}
	if got := view["preview_url_512"]; got != "https://cdn.huabot.com/upload/avatar_fw512.webp" {
		t.Fatalf("preview_url_512 = %#v", got)
	}
}

func TestFirstStringUsesFirstNonEmptyAlias(t *testing.T) {
	raw := map[string]any{"provider_group_id": "group-provider-1", "bio": "人物小传"}
	if got := firstString(raw, "provider_group_id", "group_id", "id"); got != "group-provider-1" {
		t.Fatalf("provider group ID = %q", got)
	}
	if got := firstString(raw, "description", "bio", "intro"); got != "人物小传" {
		t.Fatalf("firstString() = %q", got)
	}
}
