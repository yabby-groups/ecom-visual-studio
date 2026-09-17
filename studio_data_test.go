package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestStableIDIsDeterministicAndScoped(t *testing.T) {
	if stableID("project-a") != stableID("project-a") {
		t.Fatal("stable IDs must be deterministic")
	}
	if stableID("project-a") == stableID("project-b") {
		t.Fatal("different values must not share an ID")
	}
}

func TestExtensionForImageTypes(t *testing.T) {
	if got := extensionFor("image/webp; charset=binary"); got != ".webp" {
		t.Fatalf("extensionFor() = %q", got)
	}
}

func TestDesktopLoginPersistsAndRestoresWithoutCredentials(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	studio := &Studio{db: db}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	user := User{ID: "user-1", Username: "alice", Profile: Profile{NickName: "Alice"}}
	if _, err := db.Exec("insert into users values(?,?,?,?,?)", user.ID, user.Username, 1, user.Profile.NickName, user.Profile.AvatarURL); err != nil {
		t.Fatal(err)
	}
	if err := studio.persistLogin(user.ID); err != nil {
		t.Fatal(err)
	}
	restarted := &Studio{db: db}
	if err := restarted.restoreLogin(); err != nil {
		t.Fatal(err)
	}
	if restarted.user == nil || restarted.user.Username != "alice" {
		t.Fatalf("restored user = %#v, want alice", restarted.user)
	}
	if _, err := db.Exec("delete from desktop_session"); err != nil {
		t.Fatal(err)
	}
	if err := restarted.restoreLogin(); err != nil {
		t.Fatal(err)
	}
	if restarted.user != nil {
		t.Fatalf("restored user after logout = %#v, want nil", restarted.user)
	}
}

func TestHuabotLoginUsesWebBaseAndEncryptsToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/signin/":
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			if r.Form.Get("name") != "alice" || r.Form.Get("passwd") != "secret" || r.Form.Get("totp_code") != "123456" {
				t.Fatalf("signin form = %#v", r.Form)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "session", "user": map[string]any{"profile": map[string]any{"nick_name": "Alice"}}})
		case "/api/token_base/token/my/list/":
			if r.Header.Get("Authorization") != "Bearer session" {
				t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tokens": []map[string]any{{"id": "token-1", "token_name": "Primary", "token_key": "sk-secret", "token_key_masked": "sk-...", "status": 1}}})
		case "/api/token_base/model/list/":
			_ = json.NewEncoder(w).Encode(map[string]any{"models": []map[string]any{{"id": "image", "alias": "gpt-image-2", "title": "Image"}, {"id": "chat", "alias": "gpt-5.6-luna", "title": "Chat"}}})
		default:
			t.Fatalf("unexpected URL %s", r.URL.String())
		}
	}))
	defer server.Close()
	t.Setenv("HUABOT_WEB_BASE_URL", server.URL)
	t.Setenv("HUABOT_BASE_URL", "https://api.example/v1")
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	studio := &Studio{db: db, dataDir: t.TempDir(), httpClient: server.Client(), masterKey: make([]byte, 32)}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.Login("alice", "secret", "123456"); err != nil {
		t.Fatal(err)
	}
	var stored string
	if err := db.QueryRow("select secret from tokens where id='token-1'").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, "sk-secret") {
		t.Fatal("raw provider token was stored in SQLite")
	}
	settings, err := studio.TokenSettings()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings["tokens"].([]map[string]any)) != 1 {
		t.Fatalf("tokens = %#v", settings)
	}
}

func TestSaveSettingsPersistsModelsForCurrentUser(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	studio := &Studio{db: db, user: &User{ID: "user-1"}}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	secret, err := seal(make([]byte, 32), "sk-test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into tokens(id,user_id,name,secret,status) values(?,?,?,?,1)", "token-1", "user-1", "Token", secret); err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"gpt-image-2", "gpt-5.6-luna"} {
		if _, err := db.Exec("insert into models(id,user_id,name,alias) values(?,?,?,?)", model, "user-1", model, model); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := studio.SaveSettings(SettingsInput{
		TokenID:    "token-1",
		ImageModel: "gpt-image-2",
		TextModel:  "gpt-5.6-luna",
		ChatModel:  "gpt-5.6-luna",
	}); err != nil {
		t.Fatal(err)
	}
	settings, err := studio.TokenSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings["image_model"] != "gpt-image-2" || settings["text_model"] != "gpt-5.6-luna" || settings["chat_model"] != "gpt-5.6-luna" {
		t.Fatalf("saved settings = %#v", settings)
	}
}

func TestAnalyzeAndChatReadResponsesOutputTextViaOfficialSDK(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/v1/responses" {
			t.Fatalf("request path = %q, want /v1/responses", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		output := "商品分析"
		if request["instructions"] == nil {
			output = `{"description":"轻便耐用的旅行收纳包，适合日常通勤与短途出行。","benefits":["防水耐磨","大容量分区","轻巧便携","简约百搭"]}`
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "resp-test", "object": "response", "created_at": 1, "model": request["model"], "status": "completed",
			"output": []map[string]any{{
				"id": "msg-test", "type": "message", "role": "assistant", "status": "completed",
				"content": []map[string]any{{"type": "output_text", "text": output, "annotations": []any{}}},
			}},
		})
	}))
	defer server.Close()
	t.Setenv("HUABOT_BASE_URL", server.URL+"/v1")

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	studio := &Studio{db: db, dataDir: t.TempDir(), httpClient: server.Client(), masterKey: make([]byte, 32), user: &User{ID: "user-1"}}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	secret, err := seal(studio.masterKey, "sk-test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into tokens(id,user_id,name,secret,status) values(?,?,?,?,1)", "token-1", "user-1", "Token", secret); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into settings(user_id,token_id,image_model,text_model,chat_model) values(?,?,?,?,?)", "user-1", "token-1", "gpt-image-2", "text-model", "chat-model"); err != nil {
		t.Fatal(err)
	}

	analysis, err := studio.Analyze(map[string]string{"product": "旅行收纳包"})
	if err != nil {
		t.Fatal(err)
	}
	if analysis["description"] == "" || len(analysis["benefits"].([]any)) != 4 {
		t.Fatalf("analysis = %#v", analysis)
	}
	chat, err := studio.Chat([]map[string]string{{"role": "user", "content": "给我一个标题"}})
	if err != nil {
		t.Fatal(err)
	}
	if chat["text"] != "商品分析" {
		t.Fatalf("chat = %#v", chat)
	}
}

func TestDeleteTryOnDoesNotDeleteAnotherUsersVersions(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	studio := &Studio{db: db, user: &User{ID: "alice"}}
	if err := studio.migrate(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into try_on_jobs(id,user_id,person_paths,garment_paths,generation_mode,ratio,status,created_at) values('job-bob','bob','[\"uploads/person.png\"]','[\"uploads/garment.png\"]','combined','2:3','ready',1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("insert into try_on_versions(id,job_id,file_path,created_at) values('version-bob','job-bob','generated/bob.png',1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := studio.DeleteTryOn("job-bob"); err == nil {
		t.Fatal("DeleteTryOn() unexpectedly deleted another user's job")
	}
	var versions int
	if err := db.QueryRow("select count(*) from try_on_versions where job_id='job-bob'").Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatalf("versions after rejected delete = %d, want 1", versions)
	}
}
