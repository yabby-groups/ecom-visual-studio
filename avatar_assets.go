package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
)

const avatarCDNBase = "https://cdn.huabot.com"

// AvatarAssets exposes display-only metadata. Provider IDs remain confined to
// this process and are resolved again immediately before generation.
func (s *Studio) AvatarAssets() (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	base := s.huabotConfig().WebBase
	var public struct {
		Personas []map[string]any `json:"personas"`
	}
	var mine struct {
		Assets []map[string]any `json:"assets"`
	}
	if err := s.withHuabotBearer(user.ID, func(bearer string) error {
		if err := s.webRequest(http.MethodGet, base+"/api/avatar_asset/public/personas/", bearer, nil, &public); err != nil {
			return err
		}
		return s.webRequest(http.MethodGet, base+"/api/avatar_asset/assets/?size=100", bearer, nil, &mine)
	}); err != nil {
		return nil, err
	}
	personas := make([]map[string]any, 0, len(public.Personas))
	for _, persona := range public.Personas {
		if stringValue(persona["status"]) != "active" {
			continue
		}
		assets := []map[string]any{}
		for _, raw := range mapsValue(persona["assets"]) {
			if stringValue(raw["status"]) != "active" || stringValue(raw["provider_asset_id"]) == "" {
				continue
			}
			assets = append(assets, avatarAssetView(raw))
		}
		if len(assets) > 0 {
			id := stringValue(persona["id"])
			personas = append(personas, map[string]any{
				"id":          id,
				"group_id":    firstString(persona, "provider_group_id", "group_id", "groupId", "id"),
				"name":        stringValue(persona["name"]),
				"tags":        firstString(persona, "tags", "labels"),
				"description": firstString(persona, "description", "bio", "intro", "story"),
				"status":      "active",
				"assets":      assets,
			})
		}
	}
	assets := []map[string]any{}
	for _, raw := range mine.Assets {
		if stringValue(raw["status"]) != "active" || stringValue(raw["provider_asset_id"]) == "" {
			continue
		}
		assets = append(assets, avatarAssetView(raw))
	}
	return map[string]any{"personas": personas, "assets": assets}, nil
}

func avatarAssetView(raw map[string]any) map[string]any {
	previewURL := avatarPreviewURL(raw["file"])
	id := stringValue(raw["id"])
	return map[string]any{
		"id":              id,
		"name":            stringValue(raw["name"]),
		"status":          stringValue(raw["status"]),
		"asset_uri":       firstString(raw, "asset_uri", "uri", "assetURI"),
		"preview_url":     previewURL,
		"preview_url_512": avatarImageVariant(previewURL, 512),
		"preview_url_64":  avatarImageVariant(previewURL, 64),
	}
}

func firstString(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringValue(raw[key]); value != "" {
			return value
		}
	}
	return ""
}

func avatarPreviewURL(file any) string {
	var value string
	if value, ok := file.(string); ok {
		return normalizeAvatarPreviewURL(value)
	}
	if raw, ok := file.(map[string]any); ok {
		for _, key := range []string{"url", "original_url", "path"} {
			if value := stringValue(raw[key]); value != "" {
				return normalizeAvatarPreviewURL(value)
			}
		}
		fileKey := strings.ReplaceAll(stringValue(raw["file_key"]), "-", "")
		fileExt := strings.TrimPrefix(strings.ToLower(stringValue(raw["file_ext"])), ".")
		if len(fileKey) >= 4 && fileExt != "" {
			return normalizeAvatarPreviewURL(fmt.Sprintf("/upload/%s/%s/%s.%s", fileKey[:2], fileKey[2:4], fileKey, fileExt))
		}
	}
	return value
}

func normalizeAvatarPreviewURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "//") {
		return value
	}
	return avatarCDNBase + "/" + strings.TrimLeft(value, "/")
}

func avatarImageVariant(value string, width int) string {
	value = normalizeAvatarPreviewURL(value)
	if value == "" || width <= 0 {
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Path == "" {
		return value
	}
	ext := path.Ext(parsed.Path)
	if ext == "" {
		return value
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, ext) + fmt.Sprintf("_fw%d.webp", width)
	return parsed.String()
}

func mapsValue(value any) []map[string]any {
	items, _ := value.([]any)
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			result = append(result, mapped)
		}
	}
	return result
}

func (s *Studio) videoReplicaAvatarSelections(jobID string) ([]AvatarAssetSelection, error) {
	var raw string
	if err := s.db.QueryRow("select avatar_assets from video_replica_jobs where id=?", jobID).Scan(&raw); err != nil {
		return nil, err
	}
	var selections []AvatarAssetSelection
	if err := json.Unmarshal([]byte(raw), &selections); err != nil {
		return nil, errors.New("虚拟人素材记录无效")
	}
	if err := validateAvatarAssetSelections(selections); err != nil {
		return nil, err
	}
	return selections, nil
}

func (s *Studio) resolveAvatarAssetIDs(userID string, selections []AvatarAssetSelection) ([]string, error) {
	if err := validateAvatarAssetSelections(selections); err != nil {
		return nil, err
	}
	if len(selections) == 0 {
		return nil, nil
	}
	base := s.huabotConfig().WebBase
	var public struct {
		Personas []map[string]any `json:"personas"`
	}
	var mine struct {
		Assets []map[string]any `json:"assets"`
	}
	if err := s.withHuabotBearer(userID, func(bearer string) error {
		if err := s.webRequest(http.MethodGet, base+"/api/avatar_asset/public/personas/", bearer, nil, &public); err != nil {
			return err
		}
		return s.webRequest(http.MethodGet, base+"/api/avatar_asset/assets/?size=100", bearer, nil, &mine)
	}); err != nil {
		return nil, err
	}
	available := map[string]string{}
	for _, persona := range public.Personas {
		if stringValue(persona["status"]) != "active" {
			continue
		}
		for _, asset := range mapsValue(persona["assets"]) {
			if stringValue(asset["status"]) == "active" {
				available["public:"+stringValue(asset["id"])] = stringValue(asset["provider_asset_id"])
			}
		}
	}
	for _, asset := range mine.Assets {
		if stringValue(asset["status"]) == "active" {
			available["personal:"+stringValue(asset["id"])] = stringValue(asset["provider_asset_id"])
		}
	}
	result := make([]string, 0, len(selections))
	for _, selection := range selections {
		providerID := available[selection.Source+":"+selection.ID]
		if providerID == "" {
			return nil, fmt.Errorf("所选虚拟人素材不可用")
		}
		result = append(result, "asset://"+providerID)
	}
	return result, nil
}
