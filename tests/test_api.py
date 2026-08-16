from fastapi.testclient import TestClient

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

    packed = client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": [template_id]})
    assert packed.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert len(detail["assets"]) == 8
    assert detail["assets"][-1]["template"] == template_id

    asset_id = detail["assets"][0]["id"]
    updated = client.patch(f"/api/assets/{asset_id}", json={"ratio": "16:9", "prompt": "Custom prompt"})
    assert updated.status_code == 200
    assert client.get(f"/api/projects/{project_id}").json()["assets"][0]["prompt"] == "Custom prompt"
