package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type huabotConfig struct{ APIBase, WebBase string }
type providerToken struct {
	ID, Name, Key, Masked string
	Status                int
	TodayCost, TotalCost  string
}
type providerModel struct{ ID, Name, Alias string }

func desktopEnv(dataDir string) map[string]string {
	values := map[string]string{}
	for _, entry := range os.Environ() {
		if key, value, ok := strings.Cut(entry, "="); ok {
			values[key] = value
		}
	}
	path := filepath.Join(dataDir, ".env")
	if raw, err := os.ReadFile(path); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if key, value, ok := strings.Cut(line, "="); ok {
				if _, exists := values[strings.TrimSpace(key)]; !exists {
					values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), "\"'")
				}
			}
		}
	}
	return values
}

func (s *Studio) huabotConfig() huabotConfig {
	values := desktopEnv(s.dataDir)
	api := strings.TrimRight(values["HUABOT_BASE_URL"], "/")
	if api == "" {
		api = "https://huabot.com/v1"
	}
	web := strings.TrimRight(values["HUABOT_WEB_BASE_URL"], "/")
	if web == "" {
		web = "https://huabot.com"
	}
	return huabotConfig{APIBase: api, WebBase: web}
}

func decodeResponse(response *http.Response, target any) error {
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var message map[string]any
		_ = json.Unmarshal(body, &message)
		for _, key := range []string{"err", "detail", "error", "message"} {
			if text, ok := message[key].(string); ok && text != "" {
				return errors.New(text)
			}
		}
		return fmt.Errorf("huabot request failed: HTTP %d", response.StatusCode)
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("invalid huabot response: %w", err)
	}
	return nil
}

func (s *Studio) webRequest(method, rawURL, bearer string, body url.Values, target any) error {
	var reader io.Reader
	if body != nil {
		reader = strings.NewReader(body.Encode())
	}
	req, err := http.NewRequest(method, rawURL, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	response, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("无法连接 huabot: %w", err)
	}
	return decodeResponse(response, target)
}

func parseModels(raw map[string]any) []providerModel {
	items, _ := raw["models"].([]any)
	if items == nil {
		items, _ = raw["data"].([]any)
	}
	result := []providerModel{}
	for _, item := range items {
		value, ok := item.(map[string]any)
		if !ok {
			continue
		}
		alias, _ := value["alias"].(string)
		if alias == "" {
			continue
		}
		result = append(result, providerModel{ID: stringValue(first(value, "id", "uuid", "alias")), Name: stringValue(first(value, "title", "alias")), Alias: alias})
	}
	return result
}
func first(value map[string]any, keys ...string) any {
	for _, key := range keys {
		if result := value[key]; result != nil {
			return result
		}
	}
	return ""
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func (s *Studio) fetchModels() ([]providerModel, error) {
	config := s.huabotConfig()
	var raw map[string]any
	if err := s.webRequest(http.MethodGet, config.WebBase+"/api/token_base/model/list/?size=500&offset=0&enabled=1", "", nil, &raw); err != nil {
		return nil, err
	}
	models := parseModels(raw)
	if len(models) == 0 {
		return nil, errors.New("huabot 没有返回可用模型")
	}
	return models, nil
}

func (s *Studio) loginHuabot(name, password, totp string) (map[string]any, error) {
	name, password = strings.TrimSpace(name), strings.TrimSpace(password)
	if name == "" || password == "" {
		return nil, errors.New("请输入账号和密码")
	}
	config := s.huabotConfig()
	signin := url.Values{"name": {name}, "passwd": {password}}
	if strings.TrimSpace(totp) != "" {
		signin.Set("totp_code", strings.TrimSpace(totp))
	}
	var login map[string]any
	if err := s.webRequest(http.MethodPost, config.WebBase+"/api/signin/", "", signin, &login); err != nil {
		return nil, err
	}
	bearer, _ := login["token"].(string)
	if bearer == "" {
		return nil, errors.New("huabot 未返回会话令牌")
	}
	var listed map[string]any
	if err := s.webRequest(http.MethodGet, config.WebBase+"/api/token_base/token/my/list/", bearer, nil, &listed); err != nil {
		return nil, err
	}
	rawTokens, _ := listed["tokens"].([]any)
	if len(rawTokens) == 0 {
		var created map[string]any
		if err := s.webRequest(http.MethodPost, config.WebBase+"/api/token_base/token/create/", bearer, nil, &created); err != nil {
			return nil, err
		}
		rawTokens = []any{created["token"]}
	}
	tokens := []providerToken{}
	for index, item := range rawTokens {
		value, ok := item.(map[string]any)
		if !ok {
			continue
		}
		key := stringValue(first(value, "token_key", "token", "key", "api_key", "secret"))
		if key == "" {
			continue
		}
		status := 1
		if number, ok := value["status"].(float64); ok {
			status = int(number)
		}
		tokens = append(tokens, providerToken{ID: stringValue(first(value, "id", "uuid")), Name: stringValue(first(value, "token_name", "name")), Key: key, Masked: stringValue(value["token_key_masked"]), Status: status, TodayCost: stringValue(value["today_used_cost"]), TotalCost: stringValue(value["total_used_cost"])})
		if tokens[len(tokens)-1].ID == "" {
			tokens[len(tokens)-1].ID = fmt.Sprint(index)
		}
		if tokens[len(tokens)-1].Name == "" {
			tokens[len(tokens)-1].Name = fmt.Sprintf("Token %d", index+1)
		}
	}
	if len(tokens) == 0 {
		return nil, errors.New("huabot 没有返回可用 Token")
	}
	models, err := s.fetchModels()
	if err != nil {
		return nil, err
	}
	profile := map[string]any{}
	if account, ok := login["user"].(map[string]any); ok {
		if value, ok := account["profile"].(map[string]any); ok {
			profile = value
		}
	}
	user := User{ID: stableID(name), Username: name, Profile: Profile{NickName: stringValue(profile["nick_name"]), AvatarURL: stringValue(profile["avatar_url"])}}
	if user.Profile.NickName == "" {
		user.Profile.NickName = name
	}
	if err := s.syncAccount(user, tokens, models); err != nil {
		return nil, err
	}
	if err := s.persistLogin(user.ID); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.user = &user
	s.mu.Unlock()
	return map[string]any{"user": user}, nil
}

func (s *Studio) syncAccount(user User, tokens []providerToken, models []providerModel) error {
	done, err := s.beginDataWrite()
	if err != nil {
		return err
	}
	defer done()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("insert into users(id,username,created_at,nick_name,avatar_url) values(?,?,?,?,?) on conflict(username) do update set nick_name=excluded.nick_name,avatar_url=excluded.avatar_url", user.ID, user.Username, time.Now().Unix(), user.Profile.NickName, user.Profile.AvatarURL); err != nil {
		return err
	}
	var oldToken, image, text, chat string
	_ = tx.QueryRow("select token_id,image_model,text_model,chat_model from settings where user_id=?", user.ID).Scan(&oldToken, &image, &text, &chat)
	if _, err = tx.Exec("delete from tokens where user_id=?", user.ID); err != nil {
		return err
	}
	if _, err = tx.Exec("delete from models where user_id=?", user.ID); err != nil {
		return err
	}
	for _, token := range tokens {
		encrypted, err := seal(s.masterKey, token.Key)
		if err != nil {
			return err
		}
		if _, err = tx.Exec("insert into tokens(id,user_id,name,secret,masked,status,today_cost,total_cost) values(?,?,?,?,?,?,?,?)", token.ID, user.ID, token.Name, encrypted, token.Masked, token.Status, token.TodayCost, token.TotalCost); err != nil {
			return err
		}
	}
	for _, model := range models {
		if _, err = tx.Exec("insert into models(id,user_id,name,alias) values(?,?,?,?)", model.ID, user.ID, model.Name, model.Alias); err != nil {
			return err
		}
	}
	valid := func(value, fallback string) string {
		for _, model := range models {
			if value == model.ID || value == model.Name || value == model.Alias {
				return model.Alias
			}
		}
		return fallback
	}
	image, text, chat = valid(image, "gpt-image-2"), valid(text, "gpt-5.6-luna"), valid(chat, "gpt-5.6-luna")
	if oldToken == "" {
		oldToken = tokens[0].ID
	}
	if _, err = tx.Exec("insert into settings(user_id,token_id,image_model,text_model,chat_model) values(?,?,?,?,?) on conflict(user_id) do update set token_id=excluded.token_id,image_model=excluded.image_model,text_model=excluded.text_model,chat_model=excluded.chat_model", user.ID, oldToken, image, text, chat); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Studio) tokenSettings() (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	result := map[string]any{"tokens": []map[string]any{}, "active_token_id": "", "image_model": "", "text_model": "", "chat_model": ""}
	rows, err := s.db.Query("select id,name,masked,status,today_cost,total_cost from tokens where user_id=? order by name", user.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := []map[string]any{}
	for rows.Next() {
		var id, name, masked, today, total string
		var status int
		if err := rows.Scan(&id, &name, &masked, &status, &today, &total); err != nil {
			return nil, err
		}
		tokens = append(tokens, map[string]any{"id": id, "name": name, "masked": masked, "status": status, "today_cost": today, "total_cost": total})
	}
	result["tokens"] = tokens
	var token, image, text, chat string
	if err := s.db.QueryRow("select token_id,image_model,text_model,chat_model from settings where user_id=?", user.ID).Scan(&token, &image, &text, &chat); err == nil {
		result["active_token_id"], result["image_model"], result["text_model"], result["chat_model"] = token, image, text, chat
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return result, nil
}

func (s *Studio) models() (map[string]any, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	refreshed, err := s.fetchModels()
	if err != nil {
		return nil, err
	}
	if err := s.refreshModels(user.ID, refreshed); err != nil {
		return nil, err
	}
	rows, err := s.db.Query("select alias,name from models where user_id=? order by name", user.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []map[string]string{}
	for rows.Next() {
		var alias, name string
		if err := rows.Scan(&alias, &name); err != nil {
			return nil, err
		}
		result = append(result, map[string]string{"id": alias, "name": name})
	}
	sort.Slice(result, func(i, j int) bool { return result[i]["name"] < result[j]["name"] })
	return map[string]any{"models": result}, rows.Err()
}

func (s *Studio) refreshModels(userID string, models []providerModel) error {
	done, err := s.beginDataWrite()
	if err != nil {
		return err
	}
	defer done()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var tokenID, image, text, chat string
	_ = tx.QueryRow("select token_id,image_model,text_model,chat_model from settings where user_id=?", userID).Scan(&tokenID, &image, &text, &chat)
	if _, err = tx.Exec("delete from models where user_id=?", userID); err != nil {
		return err
	}
	for _, model := range models {
		if _, err = tx.Exec("insert into models(id,user_id,name,alias) values(?,?,?,?)", model.ID, userID, model.Name, model.Alias); err != nil {
			return err
		}
	}
	selected := func(value, fallback string) string {
		for _, model := range models {
			if value == model.ID || value == model.Name || value == model.Alias {
				return model.Alias
			}
		}
		return fallback
	}
	_, err = tx.Exec("insert into settings(user_id,token_id,image_model,text_model,chat_model) values(?,?,?,?,?) on conflict(user_id) do update set image_model=excluded.image_model,text_model=excluded.text_model,chat_model=excluded.chat_model", userID, tokenID, selected(image, "gpt-image-2"), selected(text, "gpt-5.6-luna"), selected(chat, "gpt-5.6-luna"))
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Studio) saveSettings(input SettingsInput) (map[string]bool, error) {
	user, err := s.currentUser()
	if err != nil {
		return nil, err
	}
	var tokenOK int
	if err = s.db.QueryRow("select count(*) from tokens where id=? and user_id=? and status=1", input.TokenID, user.ID).Scan(&tokenOK); err != nil {
		return nil, err
	}
	if tokenOK == 0 {
		return nil, errors.New("请选择可用 Token")
	}
	if !strings.HasPrefix(input.ImageModel, "gpt-image-") {
		return nil, errors.New("图像生成模型必须是 GPT Image 模型")
	}
	for _, alias := range []string{input.ImageModel, input.TextModel, input.ChatModel} {
		var exists int
		if err = s.db.QueryRow("select count(*) from models where user_id=? and alias=?", user.ID, alias).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			return nil, errors.New("请选择当前账号可用的模型")
		}
	}
	_, err = s.execDataWrite("insert into settings(user_id,token_id,image_model,text_model,chat_model) values(?,?,?,?,?) on conflict(user_id) do update set token_id=excluded.token_id,image_model=excluded.image_model,text_model=excluded.text_model,chat_model=excluded.chat_model", user.ID, input.TokenID, input.ImageModel, input.TextModel, input.ChatModel)
	return map[string]bool{"ok": err == nil}, err
}

func (s *Studio) activeProvider(userID string) (huabotConfig, string, string, string, string, error) {
	var tokenID, image, text, chat, encrypted string
	err := s.db.QueryRow("select s.token_id,s.image_model,s.text_model,s.chat_model,t.secret from settings s join tokens t on t.id=s.token_id and t.user_id=s.user_id where s.user_id=? and t.status=1", userID).Scan(&tokenID, &image, &text, &chat, &encrypted)
	if err != nil {
		return huabotConfig{}, "", "", "", "", errors.New("请先在设置中选择 huabot Token")
	}
	key, err := unseal(s.masterKey, encrypted)
	if err != nil {
		return huabotConfig{}, "", "", "", "", err
	}
	return s.huabotConfig(), key, image, text, chat, nil
}

func jsonRequest(client *http.Client, method, rawURL, key string, payload any, target any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(method, rawURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	return decodeResponse(response, target)
}
