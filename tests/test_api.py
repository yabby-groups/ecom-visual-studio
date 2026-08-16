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


def test_auth_me_without_session():
    with TestClient(app) as client:
        assert client.get("/api/auth/me").json() == {"user": None}


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

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b'{"data":[{"b64_json":"aW1hZ2U="}]}'

    monkeypatch.setattr(main, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "test-model"})
    monkeypatch.setattr(main, "urlopen", lambda *_args, **_kwargs: FakeResponse())
    monkeypatch.setattr(main.time, "time", lambda: 1_700_000_000)

    main.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "ready"
    assert generated["generation_started_at"] == 1_700_000_000
    assert len(generated["versions"]) == 1
    assert generated["versions"][0]["file_path"] == generated["file_path"]

    monkeypatch.setattr(main, "generate_asset", lambda _: None)
    assert client.post(f"/api/assets/{asset_id}/generate").status_code == 200
    requeued = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert requeued["status"] == "queued"
    assert requeued["generation_started_at"] == 1_700_000_000


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
