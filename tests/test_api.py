import base64
import json
import struct
import zlib

from fastapi.testclient import TestClient

from backend import main
from backend.main import app, db, init_db


def authenticated_client():
    init_db()
    connection = db()
    connection.execute("insert or ignore into users values(?,?,?,?)", ("test-user", "test-user", "hash", 1))
    connection.execute("delete from sessions where id='test-session'")
    connection.execute("insert into sessions values(?,?,?)", ("test-session", "test-user", 4102444800))
    connection.commit()
    connection.close()
    client = TestClient(app)
    client.cookies.set("session", "test-session")
    return client


def png_bytes(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

    rows = b"".join(b"\0" + b"\0\0\0" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def test_auth_me_without_session():
    with TestClient(app) as client:
        assert client.get("/api/auth/me").json() == {"user": None}


def test_settings_reject_a_non_gpt_image_model():
    client = authenticated_client()
    connection = db()
    connection.execute(
        "insert or replace into tokens values(?,?,?,?,?,?,?,?)",
        ("test-user", "settings-token", "Settings token", "secret", "", 1, "0", "0"),
    )
    connection.executemany(
        "insert or replace into models values(?,?,?,?)",
        [
            ("test-user", "settings-image", "Other image", "other-image-model"),
            ("test-user", "settings-text", "Text model", "gpt-5.6-luna"),
        ],
    )
    connection.commit()
    connection.close()

    response = client.post("/api/settings", json={
        "token_id": "settings-token",
        "image_model": "other-image-model",
        "text_model": "gpt-5.6-luna",
        "chat_model": "gpt-5.6-luna",
    })

    assert response.status_code == 400
    assert response.json()["detail"] == "图像生成模型必须是 GPT Image 模型"


def test_huabot_models_use_the_public_alias_endpoint(monkeypatch):
    captured = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b'{"models":[{"id":7,"alias":"gpt-image-2","title":"GPT Image"}]}'

    def fake_urlopen(request, **_kwargs):
        captured.append(request)
        return FakeResponse()

    monkeypatch.setenv("HUABOT_WEB_BASE_URL", "https://models.example")
    monkeypatch.setattr(main, "urlopen", fake_urlopen)

    assert main.huabot_models() == [{"id": "7", "name": "GPT Image", "alias": "gpt-image-2"}]
    assert captured[0].full_url == "https://models.example/api/token_base/model/list/?size=500&offset=0&enabled=1"
    assert captured[0].get_header("Authorization") is None


def test_latest_creation_returns_only_the_users_newest_version():
    client = authenticated_client()
    connection = db()
    project_ids = ("latest-project", "older-project", "other-project")
    try:
        connection.execute(
            "delete from asset_versions where asset_id in (select id from assets where project_id in (?,?,?))",
            project_ids,
        )
        connection.execute("delete from assets where project_id in (?,?,?)", project_ids)
        connection.execute("delete from projects where id in (?,?,?)", project_ids)
        connection.execute("insert or ignore into users values(?,?,?,?)", ("other-user", "other-user", "hash", 1))
        connection.execute("insert into projects values(?,?,?,?,?,?,?,?,?)", ("latest-project", "test-user", "Latest", "Product", "", "", "", "", 1))
        connection.execute("insert into projects values(?,?,?,?,?,?,?,?,?)", ("older-project", "test-user", "Older", "Product", "", "", "", "", 1))
        connection.execute("insert into projects values(?,?,?,?,?,?,?,?,?)", ("other-project", "other-user", "Other", "Product", "", "", "", "", 1))
        connection.execute("insert into assets (id,project_id,title,template,ratio,prompt,status,file_path,created_at) values(?,?,?,?,?,?,?,?,?)", ("latest-asset", "latest-project", "Latest image", "hero-image", "1:1", "", "ready", "generated/latest.png", 1))
        connection.execute("insert into assets (id,project_id,title,template,ratio,prompt,status,file_path,created_at) values(?,?,?,?,?,?,?,?,?)", ("older-asset", "older-project", "Older image", "hero-image", "1:1", "", "ready", "generated/older.png", 1))
        connection.execute("insert into assets (id,project_id,title,template,ratio,prompt,status,file_path,created_at) values(?,?,?,?,?,?,?,?,?)", ("other-asset", "other-project", "Other image", "hero-image", "1:1", "", "ready", "generated/other.png", 1))
        connection.execute("insert into asset_versions values(?,?,?,?)", ("latest-version", "latest-asset", "generated/latest.png", 4_100_000_000))
        connection.execute("insert into asset_versions values(?,?,?,?)", ("older-version", "older-asset", "generated/older.png", 4_000_000_000))
        connection.execute("insert into asset_versions values(?,?,?,?)", ("other-version", "other-asset", "generated/other.png", 4_200_000_000))
        connection.commit()

        response = client.get("/api/creations/latest")

        assert response.status_code == 200
        assert response.json() == {"creation": {"project_id": "latest-project", "title": "Latest image", "file_path": "generated/latest.png", "created_at": 4_100_000_000}}
    finally:
        connection.execute(
            "delete from asset_versions where asset_id in (select id from assets where project_id in (?,?,?))",
            project_ids,
        )
        connection.execute("delete from assets where project_id in (?,?,?)", project_ids)
        connection.execute("delete from projects where id in (?,?,?)", project_ids)
        connection.commit()
        connection.close()


def test_latest_creation_requires_authentication():
    with TestClient(app) as client:
        assert client.get("/api/creations/latest").status_code == 401


def test_project_pack_and_custom_template_lifecycle():
    client = authenticated_client()
    templates = client.get("/api/templates")
    assert templates.status_code == 200
    assert [
        (item["id"], item["name"], item["group"], item["ratio"], item["direction"])
        for item in templates.json()
        if not item["custom"]
    ] == [
        ("hero-image", "商品主图", "商品展示", "1:1", "干净背景、完整展示商品轮廓、视觉焦点明确。"),
        ("lifestyle-scene", "生活场景", "场景展示", "4:5", "将商品置于真实使用环境，体现尺度、氛围和使用价值。"),
        ("detail-macro", "核心细节", "细节展示", "4:5", "特写呈现材质、结构、纹理和标志性细节。"),
        ("poster-banner", "卖点海报", "营销展示", "4:5", "突出商品，留出信息排版空间，适用于促销和传播。"),
    ]

    created = client.post("/api/projects", json={
        "name": "Test campaign",
        "product": "Test product",
        "description": "A product for API tests",
        "benefits": "Benefit one",
        "color": "#A16207",
        "reference": "",
    })
    assert created.status_code == 200
    project_id = created.json()["id"]

    template = client.post("/api/templates", json={"name": "Custom scene", "ratio": "4:5", "direction": "Natural afternoon light."})
    assert template.status_code == 200
    template_id = template.json()["id"]
    assert any(item["id"] == template_id and item["custom"] for item in client.get("/api/templates").json())

    packed = client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": [template_id]})
    assert packed.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert len(detail["assets"]) == 8
    assert detail["assets"][-1]["template"] == template_id

    directed_builtin = client.post(
        f"/api/projects/{project_id}/pack",
        json={"kind": "custom", "scene_template_ids": [], "template_id": "lifestyle-scene"},
    )
    assert directed_builtin.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert [(asset["template"], asset["ratio"]) for asset in detail["assets"]] == [("lifestyle-scene", "4:5")]
    assert "真实使用环境" in detail["assets"][0]["prompt"]

    directed_custom = client.post(
        f"/api/projects/{project_id}/pack",
        json={"kind": "custom", "scene_template_ids": [], "template_id": template_id},
    )
    assert directed_custom.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert [(asset["template"], asset["ratio"]) for asset in detail["assets"]] == [(template_id, "4:5")]
    assert "Natural afternoon light." in detail["assets"][0]["prompt"]

    invalid_template = client.post(
        f"/api/projects/{project_id}/pack",
        json={"kind": "social", "scene_template_ids": [], "template_id": "missing-template"},
    )
    assert invalid_template.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert len(detail["assets"]) == 3

    asset_id = detail["assets"][0]["id"]
    updated = client.patch(f"/api/assets/{asset_id}", json={"ratio": "16:9", "prompt": "Custom prompt"})
    assert updated.status_code == 200
    assert client.get(f"/api/projects/{project_id}").json()["assets"][0]["prompt"] == "Custom prompt"


def test_generation_started_at_is_persisted_from_enqueue_to_completion(monkeypatch):
    client = authenticated_client()
    project_id = client.post("/api/projects", json={
        "name": "Countdown campaign",
        "product": "Countdown product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]

    payloads = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps({"data": [{"b64_json": base64.b64encode(png_bytes(2, 3)).decode()}]}).encode()

    def fake_urlopen(request, *_args, **_kwargs):
        payloads.append(json.loads(request.data.decode()))
        return FakeResponse()

    assert client.patch(f"/api/assets/{asset_id}", json={"ratio": "2:3"}).status_code == 200
    monkeypatch.setattr(main, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(main, "urlopen", fake_urlopen)
    monkeypatch.setattr(main.time, "time", lambda: 1_700_000_000)

    main.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "ready"
    assert generated["generation_started_at"] == 1_700_000_000
    assert len(generated["versions"]) == 1
    assert generated["versions"][0]["file_path"] == generated["file_path"]
    assert payloads == [{"model": "gpt-image-2", "prompt": generated["prompt"], "size": "1024x1536", "n": 1}]

    monkeypatch.setattr(main, "generate_asset", lambda _: None)
    assert client.post(f"/api/assets/{asset_id}/generate").status_code == 200
    requeued = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert requeued["status"] == "queued"
    assert requeued["generation_started_at"] == 1_700_000_000


def test_generation_rejects_a_mismatched_image_ratio(monkeypatch):
    client = authenticated_client()
    project_id = client.post("/api/projects", json={
        "name": "Ratio validation",
        "product": "Ratio validation product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            image = base64.b64encode(png_bytes(16, 9)).decode()
            return json.dumps({"data": [{"b64_json": image}]}).encode()

    assert client.patch(f"/api/assets/{asset_id}", json={"ratio": "2:3"}).status_code == 200
    monkeypatch.setattr(main, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(main, "urlopen", lambda *_args, **_kwargs: FakeResponse())

    main.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "failed: 图像服务返回比例 16:9，但请求的是 2:3"
    assert generated["file_path"] is None
    assert generated["versions"] == []


def test_image_size_for_ratio_uses_the_short_edge_and_long_edge_limits():
    assert main.image_size_for_ratio("1:1") == (1024, 1024)
    assert main.image_size_for_ratio("4:5") == (1024, 1280)
    assert main.image_size_for_ratio("2:3") == (1024, 1536)
    assert main.image_size_for_ratio("16:9") == (1536, 864)


def test_existing_generated_images_are_backfilled_as_versions():
    client = authenticated_client()
    project_id = client.post("/api/projects", json={
        "name": "Version campaign",
        "product": "Version product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "custom", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]
    directory = main.GENERATED / project_id
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{asset_id}-legacy.png"
    (directory / filename).write_bytes(b"legacy")

    init_db()

    versions = client.get(f"/api/projects/{project_id}").json()["assets"][0]["versions"]
    assert len(versions) == 1
    assert versions[0]["file_path"] == f"generated/{project_id}/{filename}"


def test_settings_use_model_aliases_for_all_huabot_requests(monkeypatch):
    user_id = "model-alias-user"
    session_id = "model-alias-session"
    connection = db()
    project_id = ""
    try:
        connection.execute("delete from sessions where id=?", (session_id,))
        connection.execute("delete from settings where user_id=?", (user_id,))
        connection.execute("delete from tokens where user_id=?", (user_id,))
        connection.execute("delete from models where user_id=?", (user_id,))
        connection.execute("delete from users where id=?", (user_id,))
        connection.execute("insert into users values(?,?,?,?)", (user_id, user_id, "hash", 1))
        connection.execute("insert into sessions values(?,?,?)", (session_id, user_id, 4_102_444_800))
        connection.execute(
            "insert into tokens values(?,?,?,?,?,?,?,?)",
            (user_id, "token", "Token", main.crypt("test-key"), "masked", 1, "0", "0"),
        )
        connection.executemany(
            "insert into models(user_id,id,name,alias) values(?,?,?,?)",
            [
                (user_id, "101", "Image title", "gpt-image-2"),
                (user_id, "102", "Text title", "text-alias"),
                (user_id, "103", "Chat title", "chat-alias"),
            ],
        )
        connection.commit()

        client = TestClient(app)
        client.cookies.set("session", session_id)
        monkeypatch.setattr(main, "huabot_models", lambda: [
            {"id": "101", "name": "Image title", "alias": "gpt-image-2"},
            {"id": "102", "name": "Text title", "alias": "text-alias"},
            {"id": "103", "name": "Chat title", "alias": "chat-alias"},
        ])
        response = client.post(
            "/api/settings",
            json={
                "token_id": "token",
                "image_model": "gpt-image-2",
                "text_model": "text-alias",
                "chat_model": "chat-alias",
            },
        )
        assert response.status_code == 200
        assert client.get("/api/huabot/models").json() == {
            "models": [
                {"id": "chat-alias", "name": "Chat title"},
                {"id": "gpt-image-2", "name": "Image title"},
                {"id": "text-alias", "name": "Text title"},
            ],
        }
        invalid = client.post(
            "/api/settings",
            json={
                "token_id": "token",
                "image_model": "101",
                "text_model": "text-alias",
                "chat_model": "chat-alias",
            },
        )
        assert invalid.status_code == 400

        requests = []

        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return json.dumps(self.payload).encode()

        def fake_urlopen(request, **_kwargs):
            payload = json.loads(request.data.decode())
            requests.append((request.full_url, payload))
            if request.full_url.endswith("/images/generations"):
                image = base64.b64encode(png_bytes(1024, 1024)).decode()
                return FakeResponse({"data": [{"b64_json": image}]})
            if "Return JSON only" in str(payload["messages"][-1]["content"]):
                return FakeResponse({"choices": [{"message": {"content": '{"description":"Test description","benefits":["A","B","C","D"]}'}}]})
            return FakeResponse({"choices": [{"message": {"content": "Test reply"}}]})

        monkeypatch.setenv("HUABOT_BASE_URL", "https://huabot.example")
        monkeypatch.setattr(main, "urlopen", fake_urlopen)

        project = client.post("/api/projects", json={
            "name": "Alias project",
            "product": "Alias product",
            "description": "",
            "benefits": "",
            "color": "#A16207",
            "reference": "",
        })
        project_id = project.json()["id"]
        assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "custom", "scene_template_ids": []}).status_code == 200
        asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]
        assert client.patch(f"/api/assets/{asset_id}", json={"ratio": "1:1"}).status_code == 200
        main.generate_asset(asset_id)
        assert client.post("/api/analyze-product", json={"mode": "name", "product": "Alias product", "reference": ""}).status_code == 200
        assert client.post("/api/chat", json={"messages": [{"role": "user", "content": "hello"}]}).status_code == 200
        assert [payload["model"] for _, payload in requests] == ["gpt-image-2", "text-alias", "chat-alias"]
    finally:
        if project_id:
            main.shutil.rmtree(main.GENERATED / project_id, ignore_errors=True)
        connection.execute("delete from asset_versions where asset_id in (select id from assets where project_id=?)", (project_id,))
        connection.execute("delete from assets where project_id=?", (project_id,))
        connection.execute("delete from projects where id=?", (project_id,))
        connection.execute("delete from settings where user_id=?", (user_id,))
        connection.execute("delete from tokens where user_id=?", (user_id,))
        connection.execute("delete from models where user_id=?", (user_id,))
        connection.execute("delete from sessions where id=?", (session_id,))
        connection.execute("delete from users where id=?", (user_id,))
        connection.commit()
        connection.close()
