import base64
import json
import sqlite3
import shutil
import struct
import threading
import time
import zlib
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import assistant, auth_routes, generation, huabot, projects, references, settings, try_on
from backend.auth import crypt
from backend.config import GENERATED, UPLOADS
from backend.db import db, init_db, try_on_jobs
from backend.main import app


def authenticated_client():
    init_db()
    connection = db()
    connection.execute("insert or ignore into users(id,username,password_hash,created_at) values(?,?,?,?)", ("test-user", "test-user", "hash", 1))
    connection.execute("delete from sessions where id='test-session'")
    connection.execute("insert into sessions values(?,?,?)", ("test-session", "test-user", 4102444800))
    connection.commit()
    connection.close()
    client = TestClient(app)
    client.cookies.set("session", "test-session")
    return client


def test_database_initialization_enables_fk_and_expected_indexes():
    init_db()
    connection = db()
    try:
        assert connection.execute("pragma foreign_keys").fetchone()[0] == 1
        assert connection.execute("pragma journal_mode").fetchone()[0] == "wal"
        assert connection.execute("pragma busy_timeout").fetchone()[0] == 5000
        assert connection.execute("pragma synchronous").fetchone()[0] == 1
        assert connection.execute("pragma wal_autocheckpoint").fetchone()[0] == 1000
        assert {row[1] for row in connection.execute("pragma index_list(projects)")} >= {"projects_user_created_idx"}
        assert {row[1] for row in connection.execute("pragma index_list(assets)")} >= {"assets_project_created_idx"}
        assert {row[1] for row in connection.execute("pragma index_list(asset_versions)")} >= {"asset_versions_asset_created_idx"}
        assert {row[1] for row in connection.execute("pragma index_list(try_on_jobs)")} >= {"try_on_jobs_user_created_idx"}
        assert {row[1] for row in connection.execute("pragma index_list(try_on_versions)")} >= {"try_on_versions_job_created_idx"}
    finally:
        connection.close()


def test_try_on_jobs_migration_defaults_legacy_generation_mode():
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        connection.execute(
            "create table try_on_jobs (id text primary key, user_id text not null, person_path text not null, garment_path text not null, person_paths text, garment_paths text, instructions text not null default '', ratio text not null, status text not null, file_path text, generation_started_at integer, created_at integer not null)"
        )
        connection.execute(
            "insert into try_on_jobs(id,user_id,person_path,garment_path,instructions,ratio,status,created_at) values('legacy','user','uploads/person.png','uploads/garment.png','','2:3','ready',1)"
        )
        try_on_jobs.ensure(connection)
        assert connection.execute("select generation_mode from try_on_jobs where id='legacy'").fetchone()[0] == "combined"
    finally:
        connection.close()


def test_database_waits_for_a_short_concurrent_write_lock():
    init_db()
    writer_id = "sqlite-lock-test-writer"
    waiter_id = "sqlite-lock-test-waiter"
    connection = db()
    connection.execute("delete from users where id in (?, ?)", (writer_id, waiter_id))
    connection.commit()

    started = threading.Event()
    completed = threading.Event()
    errors = []

    def write_while_locked():
        waiting_connection = db()
        try:
            started.set()
            waiting_connection.execute(
                "insert into users(id,username,password_hash,created_at) values(?,?,?,?)",
                (waiter_id, waiter_id, "hash", 1),
            )
            waiting_connection.commit()
        except Exception as error:
            errors.append(error)
        finally:
            waiting_connection.close()
            completed.set()

    try:
        connection.execute(
            "insert into users(id,username,password_hash,created_at) values(?,?,?,?)",
            (writer_id, writer_id, "hash", 1),
        )
        thread = threading.Thread(target=write_while_locked)
        thread.start()
        assert started.wait(timeout=1)
        time.sleep(0.05)
        assert not completed.is_set()
        connection.commit()
        thread.join(timeout=1)
        assert completed.is_set()
        assert errors == []
    finally:
        connection.rollback()
        connection.execute("delete from users where id in (?, ?)", (writer_id, waiter_id))
        connection.commit()
        connection.close()


def test_try_on_requires_owned_uploaded_references_and_scopes_history(monkeypatch):
    client = authenticated_client()
    person = UPLOADS / "try-on-test-person.png"
    garment = UPLOADS / "try-on-test-garment.png"
    person.write_bytes(png_bytes(2, 3))
    garment.write_bytes(png_bytes(2, 3))
    monkeypatch.setattr(try_on, "generate_try_on", lambda _: None)
    try:
        assert client.post("/api/try-on", json={"person_path": "uploads/missing.png", "garment_path": "uploads/try-on-test-garment.png"}).status_code == 422
        response = client.post("/api/try-on", json={"person_path": "uploads/try-on-test-person.png", "garment_path": "uploads/try-on-test-garment.png", "instructions": "Keep the background", "ratio": "2:3"})
        assert response.status_code == 200
        job_id = response.json()["id"]
        job = client.get(f"/api/try-on/{job_id}")
        assert job.status_code == 200
        assert job.json()["status"] == "queued"
        assert job.json()["person_path"] == "uploads/try-on-test-person.png"
        assert job.json()["person_paths"] == ["uploads/try-on-test-person.png"]
        assert job.json()["garment_paths"] == ["uploads/try-on-test-garment.png"]
        assert job.json()["generation_mode"] == "combined"
        history = client.get("/api/try-on?limit=48&offset=0").json()
        assert set(history) == {"items", "total", "has_more"}
        assert history["total"] >= 1
        assert any(item["id"] == job_id for item in history["items"])

        connection = db()
        connection.execute("insert or ignore into users(id,username,password_hash,created_at) values(?,?,?,?)", ("try-on-other", "try-on-other", "hash", 1))
        connection.execute("insert or replace into sessions values(?,?,?)", ("try-on-other-session", "try-on-other", 4102444800))
        connection.commit()
        connection.close()
        other = TestClient(app)
        other.cookies.set("session", "try-on-other-session")
        assert other.get(f"/api/try-on/{job_id}").status_code == 404
        assert other.post(f"/api/try-on/{job_id}/generate").status_code == 404
        assert other.delete(f"/api/try-on/{job_id}").status_code == 404
        assert client.delete(f"/api/try-on/{job_id}").status_code == 409
        connection = db()
        connection.execute("update try_on_jobs set status='failed: test' where id=?", (job_id,))
        connection.commit()
        connection.close()
        assert client.delete(f"/api/try-on/{job_id}").json() == {"ok": True}
    finally:
        connection = db()
        connection.execute("delete from try_on_versions where job_id in (select id from try_on_jobs where person_path=?)", ("uploads/try-on-test-person.png",))
        connection.execute("delete from try_on_jobs where person_path=?", ("uploads/try-on-test-person.png",))
        connection.execute("delete from sessions where id='try-on-other-session'")
        connection.execute("delete from users where id='try-on-other'")
        connection.commit()
        connection.close()
        person.unlink(missing_ok=True)
        garment.unlink(missing_ok=True)


def test_try_on_generation_sends_two_images_and_persists_result(monkeypatch):
    client = authenticated_client()
    person = UPLOADS / "try-on-generation-person.png"
    garment = UPLOADS / "try-on-generation-garment.png"
    person.write_bytes(png_bytes(2, 3))
    garment.write_bytes(png_bytes(2, 3))
    captured = []
    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert kwargs == {"base_url": "https://images.example", "api_key": "test", "timeout": 300}
            self.images = self

        def edit(self, **kwargs):
            captured.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png_bytes(2, 3)).decode())])

    monkeypatch.setattr(try_on, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(try_on, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(try_on.time, "time", lambda: 1_700_000_000)
    try:
        response = client.post("/api/try-on", json={"person_path": "uploads/try-on-generation-person.png", "garment_path": "uploads/try-on-generation-garment.png", "ratio": "2:3"})
        assert response.status_code == 200
        job_id = response.json()["id"]
        job = client.get(f"/api/try-on/{job_id}").json()
        assert job["status"] == "ready"
        assert job["generation_started_at"] == 1_700_000_000
        assert job["file_path"].startswith("generated/try-on/test-user/")
        assert len(captured) == 1
        assert captured[0]["model"] == "gpt-image-2"
        assert captured[0]["size"] == "1024x1536"
        assert len(captured[0]["image"]) == 2
        assert "first group of reference images shows the person" in captured[0]["prompt"]
        assert len(job["versions"]) == 1
        first_path = job["file_path"]
        assert client.post(f"/api/try-on/{job_id}/generate").status_code == 200
        regenerated = client.get(f"/api/try-on/{job_id}").json()
        assert regenerated["status"] == "ready"
        assert regenerated["file_path"] != first_path
        assert {version["file_path"] for version in regenerated["versions"]} == {
            first_path,
            regenerated["file_path"],
        }
        for version in regenerated["versions"]:
            (GENERATED / version["file_path"].removeprefix("generated/")).unlink(missing_ok=True)
    finally:
        connection = db()
        connection.execute("delete from try_on_versions where job_id in (select id from try_on_jobs where person_path=?)", ("uploads/try-on-generation-person.png",))
        connection.execute("delete from try_on_jobs where person_path=?", ("uploads/try-on-generation-person.png",))
        connection.commit()
        connection.close()
        person.unlink(missing_ok=True)
        garment.unlink(missing_ok=True)


def test_try_on_accepts_multiple_references_and_creates_all_combinations(monkeypatch):
    client = authenticated_client()
    paths = [
        "try-on-multi-person-1.png",
        "try-on-multi-person-2.png",
        "try-on-multi-garment-1.png",
        "try-on-multi-garment-2.png",
    ]
    for name in paths:
        (UPLOADS / name).write_bytes(png_bytes(2, 3))
    monkeypatch.setattr(try_on, "generate_try_on", lambda _: None)
    people = [f"uploads/{name}" for name in paths[:2]]
    garments = [f"uploads/{name}" for name in paths[2:]]
    try:
        invalid = client.post("/api/try-on", json={
            "person_paths": people + [people[0], people[0], people[0]],
            "garment_paths": garments,
        })
        assert invalid.status_code == 422

        combined = client.post("/api/try-on", json={
            "person_paths": people,
            "garment_paths": garments,
            "generation_mode": "combined",
        })
        assert combined.status_code == 200
        assert combined.json()["ids"] == [combined.json()["id"]]
        combined_job = client.get(f"/api/try-on/{combined.json()['id']}").json()
        assert combined_job["person_paths"] == people
        assert combined_job["garment_paths"] == garments
        assert combined_job["generation_mode"] == "combined"

        combinations = client.post("/api/try-on", json={
            "person_paths": people,
            "garment_paths": garments,
            "generation_mode": "combinations",
        })
        assert combinations.status_code == 200
        assert len(combinations.json()["ids"]) == 4
        jobs = [client.get(f"/api/try-on/{job_id}").json() for job_id in combinations.json()["ids"]]
        assert {job["generation_mode"] for job in jobs} == {"combinations"}
        assert {(job["person_paths"][0], job["garment_paths"][0]) for job in jobs} == {
            (person, garment) for person in people for garment in garments
        }
        assert all(len(job["person_paths"]) == len(job["garment_paths"]) == 1 for job in jobs)
    finally:
        connection = db()
        connection.execute("delete from try_on_versions where job_id in (select id from try_on_jobs where person_path like 'uploads/try-on-multi-%')")
        connection.execute("delete from try_on_jobs where person_path like 'uploads/try-on-multi-%'")
        connection.commit()
        connection.close()
        for name in paths:
            (UPLOADS / name).unlink(missing_ok=True)


def test_try_on_generation_orders_multiple_references(monkeypatch):
    client = authenticated_client()
    names = [
        "try-on-order-person-1.png",
        "try-on-order-person-2.png",
        "try-on-order-garment-1.png",
        "try-on-order-garment-2.png",
    ]
    for name in names:
        (UPLOADS / name).write_bytes(png_bytes(2, 3))
    captured = []

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.images = self

        def edit(self, **kwargs):
            captured.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png_bytes(2, 3)).decode())])

    monkeypatch.setattr(try_on, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(try_on, "OpenAI", FakeOpenAI)
    try:
        response = client.post("/api/try-on", json={
            "person_paths": [f"uploads/{name}" for name in names[:2]],
            "garment_paths": [f"uploads/{name}" for name in names[2:]],
            "generation_mode": "combined",
        })
        assert response.status_code == 200
        assert [Path(image.name).name for image in captured[0]["image"]] == names
        job = client.get(f"/api/try-on/{response.json()['id']}").json()
        assert job["status"] == "ready"
        (GENERATED / job["file_path"].removeprefix("generated/")).unlink(missing_ok=True)
    finally:
        connection = db()
        connection.execute("delete from try_on_versions where job_id in (select id from try_on_jobs where person_path like 'uploads/try-on-order-%')")
        connection.execute("delete from try_on_jobs where person_path like 'uploads/try-on-order-%'")
        connection.commit()
        connection.close()
        for name in names:
            (UPLOADS / name).unlink(missing_ok=True)


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


def test_login_and_auth_me_return_huabot_profile(monkeypatch):
    username = "profile-test-user"
    monkeypatch.setenv("APP_SECRET_KEY", "test-secret")
    monkeypatch.setattr(
        auth_routes,
        "huabot_login",
        lambda *_: (
            [{"id": "profile-token", "name": "Profile Token", "key": "secret", "masked": "***", "status": 1, "today_cost": "0", "total_cost": "0"}],
            [{"id": "gpt-image-2", "name": "GPT Image", "alias": "gpt-image-2"}],
            {"nick_name": "测试昵称", "avatar_url": "https://example.test/avatar.png"},
        ),
    )
    connection = db()
    connection.execute("delete from users where username=?", (username,))
    connection.commit()
    connection.close()
    with TestClient(app) as client:
        logged_in = client.post("/api/auth/login", json={"name": username, "password": "secret"})
        expected = {
            "id": logged_in.json()["user"]["id"],
            "username": username,
            "profile": {"nick_name": "测试昵称", "avatar_url": "https://example.test/avatar.png"},
        }
        assert logged_in.status_code == 200
        assert logged_in.json() == {"user": expected}
        assert client.get("/api/auth/me").json() == {"user": expected}
    connection = db()
    connection.execute("delete from sessions where user_id in (select id from users where username=?)", (username,))
    connection.execute("delete from settings where user_id in (select id from users where username=?)", (username,))
    connection.execute("delete from tokens where user_id in (select id from users where username=?)", (username,))
    connection.execute("delete from models where user_id in (select id from users where username=?)", (username,))
    connection.execute("delete from users where username=?", (username,))
    connection.commit()
    connection.close()


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

    def fake_get(url, **_kwargs):
        captured.append(url)
        return httpx.Response(200, json={"models": [{"id": 7, "alias": "gpt-image-2", "title": "GPT Image"}]}, request=httpx.Request("GET", url))

    monkeypatch.setenv("HUABOT_WEB_BASE_URL", "https://models.example")
    monkeypatch.setattr(huabot.httpx, "get", fake_get)

    assert huabot.huabot_models() == [{"id": "7", "name": "GPT Image", "alias": "gpt-image-2"}]
    assert captured == ["https://models.example/api/token_base/model/list/?size=500&offset=0&enabled=1"]


def test_reference_url_downloads_an_image_with_httpx_stream(monkeypatch):
    client = authenticated_client()
    captured = []

    class FakeStream:
        def __enter__(self):
            return httpx.Response(200, content=b"image-data", headers={"content-type": "image/webp; charset=binary"}, request=httpx.Request("GET", "https://images.example/reference.webp"))

        def __exit__(self, *_):
            return False

    def fake_stream(method, url, **kwargs):
        captured.append((method, url, kwargs))
        return FakeStream()

    monkeypatch.setattr(references.httpx, "stream", fake_stream)
    response = client.post("/api/reference-url", json={"url": "https://images.example/reference.webp"})

    assert response.status_code == 200
    assert captured == [("GET", "https://images.example/reference.webp", {"headers": {"User-Agent": "EcomVisualStudio/1.0"}, "timeout": 20})]
    target = UPLOADS / response.json()["path"].removeprefix("uploads/")
    try:
        assert target.suffix == ".webp"
        assert target.read_bytes() == b"image-data"
    finally:
        target.unlink(missing_ok=True)


def test_huabot_login_only_sends_totp_after_the_challenge(monkeypatch):
    requests = []

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs))
        if url.endswith("/api/signin/"):
            request = httpx.Request(method, url)
            response = httpx.Response(400, json={"err": "totp required"}, request=request)
            raise httpx.HTTPStatusError("Bad Request", request=request, response=response)
        raise AssertionError(f"unexpected request: {url}")

    monkeypatch.setenv("HUABOT_BASE_URL", "https://huabot.example")
    monkeypatch.setattr(huabot.httpx, "request", fake_request)

    try:
        huabot.huabot_login("alice", "secret", "")
    except ValueError as error:
        assert str(error) == "totp required"
    else:
        raise AssertionError("TOTP challenge should fail the first login attempt")

    assert requests[0][2]["data"] == {"name": "alice", "passwd": "secret"}
    with TestClient(app) as client:
        response = client.post("/api/auth/login", json={"name": "alice", "password": "secret"})

    assert response.status_code == 400
    assert response.json() == {"detail": "totp required"}


def test_huabot_login_sends_the_totp_code_after_a_challenge(monkeypatch):
    requests = []

    def fake_request(method, url, **kwargs):
        requests.append((method, url, kwargs))
        if url.endswith("/api/signin/"):
            return httpx.Response(200, json={"err": "totp invalid"}, request=httpx.Request(method, url))
        raise AssertionError(f"unexpected request: {url}")

    monkeypatch.setenv("HUABOT_BASE_URL", "https://huabot.example")
    monkeypatch.setattr(huabot.httpx, "request", fake_request)

    try:
        huabot.huabot_login("alice", "secret", "123456")
    except ValueError as error:
        assert str(error) == "totp invalid"
    else:
        raise AssertionError("An invalid TOTP code should fail login")

    assert requests[0][2]["data"] == {"name": "alice", "passwd": "secret", "totp_code": "123456"}


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
        connection.execute("insert or ignore into users(id,username,password_hash,created_at) values(?,?,?,?)", ("other-user", "other-user", "hash", 1))
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
        ("lifestyle-scene", "生活场景", "场景展示", "2:3", "将商品置于真实使用环境，体现尺度、氛围和使用价值。"),
        ("detail-macro", "核心细节", "细节展示", "2:3", "特写呈现材质、结构、纹理和标志性细节。"),
        ("poster-banner", "卖点海报", "营销展示", "2:3", "突出商品，留出信息排版空间，适用于促销和传播。"),
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

    template = client.post("/api/templates", json={"name": "Custom scene", "ratio": "3:2", "direction": "Natural afternoon light."})
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
    assert [(asset["template"], asset["ratio"]) for asset in detail["assets"]] == [("lifestyle-scene", "2:3")]
    assert "真实使用环境" in detail["assets"][0]["prompt"]

    directed_custom = client.post(
        f"/api/projects/{project_id}/pack",
        json={"kind": "custom", "scene_template_ids": [], "template_id": template_id},
    )
    assert directed_custom.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert [(asset["template"], asset["ratio"]) for asset in detail["assets"]] == [(template_id, "3:2")]
    assert "Natural afternoon light." in detail["assets"][0]["prompt"]

    invalid_template = client.post(
        f"/api/projects/{project_id}/pack",
        json={"kind": "social", "scene_template_ids": [], "template_id": "missing-template"},
    )
    assert invalid_template.status_code == 200
    detail = client.get(f"/api/projects/{project_id}").json()
    assert len(detail["assets"]) == 3

    asset_id = detail["assets"][0]["id"]
    updated = client.patch(f"/api/assets/{asset_id}", json={"ratio": "3:2", "prompt": "Custom prompt"})
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

    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert kwargs == {"base_url": "https://images.example", "api_key": "test", "timeout": 300}
            self.images = self

        def generate(self, **kwargs):
            payloads.append(kwargs)
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png_bytes(2, 3)).decode())])

    assert client.patch(f"/api/assets/{asset_id}", json={"ratio": "2:3"}).status_code == 200
    monkeypatch.setattr(generation, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(generation, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(generation.time, "time", lambda: 1_700_000_000)

    generation.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "ready"
    assert generated["generation_started_at"] == 1_700_000_000
    assert len(generated["versions"]) == 1
    assert generated["versions"][0]["file_path"] == generated["file_path"]
    assert payloads == [{"model": "gpt-image-2", "prompt": generated["prompt"], "size": "1024x1536", "n": 1}]

    monkeypatch.setattr(projects, "generate_asset", lambda _: None)
    assert client.post(f"/api/assets/{asset_id}/generate").status_code == 200
    requeued = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert requeued["status"] == "queued"
    assert requeued["generation_started_at"] == 1_700_000_000


def test_generation_sends_project_reference_to_image_edit(monkeypatch):
    client = authenticated_client()
    reference = UPLOADS / "project-reference-generation.png"
    reference.write_bytes(png_bytes(2, 3))
    project_id = client.post("/api/projects", json={
        "name": "Reference generation",
        "product": "Reference product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "uploads/project-reference-generation.png",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]
    assert client.patch(f"/api/assets/{asset_id}", json={"ratio": "2:3"}).status_code == 200
    captured = []

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.images = self

        def edit(self, **kwargs):
            captured.append((Path(kwargs["image"].name).name, kwargs))
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png_bytes(2, 3)).decode())])

    monkeypatch.setattr(generation, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(generation, "OpenAI", FakeOpenAI)
    try:
        generation.generate_asset(asset_id)
        generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
        assert generated["status"] == "ready"
        assert captured[0][0] == "project-reference-generation.png"
        assert captured[0][1]["model"] == "gpt-image-2"
        assert captured[0][1]["prompt"] == generated["prompt"]
        assert captured[0][1]["size"] == "1024x1536"
        assert captured[0][1]["n"] == 1
        (GENERATED / generated["file_path"].removeprefix("generated/")).unlink(missing_ok=True)
    finally:
        connection = db()
        connection.execute("delete from asset_versions where asset_id in (select id from assets where project_id=?)", (project_id,))
        connection.execute("delete from assets where project_id=?", (project_id,))
        connection.execute("delete from projects where id=?", (project_id,))
        connection.commit()
        connection.close()
        reference.unlink(missing_ok=True)


def test_generation_marks_failed_when_project_reference_is_missing(monkeypatch):
    client = authenticated_client()
    project_id = client.post("/api/projects", json={
        "name": "Missing reference generation",
        "product": "Missing reference product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "uploads/missing-project-reference.png",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]

    monkeypatch.setattr(generation, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    generation.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "failed: 项目参考图片不存在"
    assert generated["file_path"] is None

    connection = db()
    connection.execute("delete from assets where project_id=?", (project_id,))
    connection.execute("delete from projects where id=?", (project_id,))
    connection.commit()
    connection.close()


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

    assert client.patch(f"/api/assets/{asset_id}", json={"ratio": "2:3"}).status_code == 200
    monkeypatch.setattr(generation, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.images = self

        def generate(self, **_kwargs):
            return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png_bytes(16, 9)).decode())])

    monkeypatch.setattr(generation, "OpenAI", FakeOpenAI)

    generation.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "failed: 图像服务返回比例 16:9，但请求的是 2:3"
    assert generated["file_path"] is None
    assert generated["versions"] == []


def test_generation_marks_failed_when_the_sdk_returns_no_image(monkeypatch):
    client = authenticated_client()
    project_id = client.post("/api/projects", json={
        "name": "Missing image",
        "product": "Missing image product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "amazon", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.images = self

        def generate(self, **_kwargs):
            return SimpleNamespace(data=[])

    monkeypatch.setattr(generation, "user_config", lambda _: {"base": "https://images.example", "key": "test", "image_model": "gpt-image-2"})
    monkeypatch.setattr(generation, "OpenAI", FakeOpenAI)

    generation.generate_asset(asset_id)
    generated = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert generated["status"] == "failed: 图像服务没有返回图片"
    assert generated["file_path"] is None
    assert generated["versions"] == []


def test_chat_uses_the_openai_responses_api(monkeypatch):
    client = authenticated_client()
    requests = []

    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert kwargs == {"base_url": "https://chat.example", "api_key": "test", "timeout": 90}
            self.responses = self

        def create(self, **kwargs):
            requests.append(kwargs)
            return iter([SimpleNamespace(type="response.output_text.delta", delta="可直接使用的"), SimpleNamespace(type="response.output_text.delta", delta="电商文案。")])

    monkeypatch.setattr(assistant, "user_config", lambda _: {"base": "https://chat.example", "key": "test", "chat_model": "gpt-5.6-luna"})
    monkeypatch.setattr(assistant, "OpenAI", FakeOpenAI)

    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": "帮我写标题"}]})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.text == 'data: {"delta": "可直接使用的"}\n\ndata: {"delta": "电商文案。"}\n\n'
    assert requests == [{
        "model": "gpt-5.6-luna",
        "instructions": "You are a helpful Chinese e-commerce creative assistant. Return copy-ready, accurate answers.",
        "input": [{"role": "user", "content": "帮我写标题"}],
        "stream": True,
    }]


def test_image_size_for_ratio_only_allows_supported_provider_sizes():
    assert generation.image_size_for_ratio("1:1") == (1024, 1024)
    assert generation.image_size_for_ratio("3:2") == (1536, 1024)
    assert generation.image_size_for_ratio("2:3") == (1024, 1536)
    assert generation.image_size_for_ratio("16:9") == (1536, 864)
    with pytest.raises(ValueError, match="仅支持画面比例"):
        generation.image_size_for_ratio("4:5")


def test_rejects_non_native_ratios_before_generation_is_queued():
    client = authenticated_client()
    project_id = client.post("/api/projects", json={
        "name": "Native ratio validation",
        "product": "Native ratio product",
        "description": "",
        "benefits": "",
        "color": "#A16207",
        "reference": "",
    }).json()["id"]
    assert client.post(f"/api/projects/{project_id}/pack", json={"kind": "custom", "scene_template_ids": []}).status_code == 200
    asset_id = client.get(f"/api/projects/{project_id}").json()["assets"][0]["id"]

    invalid_template = client.post("/api/templates", json={"name": "Legacy portrait", "ratio": "4:5", "direction": "Legacy ratio."})
    assert invalid_template.status_code == 422
    assert "仅支持画面比例" in invalid_template.json()["detail"]

    invalid_patch = client.patch(f"/api/assets/{asset_id}", json={"ratio": "4:5"})
    assert invalid_patch.status_code == 422

    connection = db()
    connection.execute("update assets set ratio='4:5' where id=?", (asset_id,))
    connection.commit()
    connection.close()
    invalid_generate = client.post(f"/api/assets/{asset_id}/generate")
    assert invalid_generate.status_code == 422
    asset = client.get(f"/api/projects/{project_id}").json()["assets"][0]
    assert asset["status"] == "draft"


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
    directory = GENERATED / project_id
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
        connection.execute("insert into users(id,username,password_hash,created_at) values(?,?,?,?)", (user_id, user_id, "hash", 1))
        connection.execute("insert into sessions values(?,?,?)", (session_id, user_id, 4_102_444_800))
        connection.execute(
            "insert into tokens values(?,?,?,?,?,?,?,?)",
            (user_id, "token", "Token", crypt("test-key"), "masked", 1, "0", "0"),
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
        monkeypatch.setattr(settings, "huabot_models", lambda: [
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

        class FakeOpenAI:
            def __init__(self, **kwargs):
                assert kwargs == {"base_url": "https://huabot.example", "api_key": "test-key", "timeout": 300}
                self.images = self

            def generate(self, **kwargs):
                requests.append(("sdk", kwargs))
                return SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png_bytes(1024, 1024)).decode())])

        class FakeResponsesOpenAI:
            def __init__(self, **kwargs):
                assert kwargs in [
                    {"base_url": "https://huabot.example", "api_key": "test-key", "timeout": 60},
                    {"base_url": "https://huabot.example", "api_key": "test-key", "timeout": 90},
                ]
                self.responses = self

            def create(self, **kwargs):
                requests.append(("responses", kwargs))
                if kwargs.get("stream"):
                    return iter([SimpleNamespace(type="response.output_text.delta", delta="Test reply")])
                if kwargs["model"] == "text-alias":
                    return SimpleNamespace(output_text='{"description":"Test description","benefits":["A","B","C","D"]}')
                return SimpleNamespace(output_text="Test reply")

        monkeypatch.setenv("HUABOT_BASE_URL", "https://huabot.example")
        monkeypatch.setattr(generation, "OpenAI", FakeOpenAI)
        monkeypatch.setattr(assistant, "OpenAI", FakeResponsesOpenAI)

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
        generation.generate_asset(asset_id)
        assert client.post("/api/analyze-product", json={"mode": "name", "product": "Alias product", "reference": ""}).status_code == 200
        assert client.post("/api/chat", json={"messages": [{"role": "user", "content": "hello"}]}).status_code == 200
        assert [payload["model"] for _, payload in requests] == ["gpt-image-2", "text-alias", "chat-alias"]
    finally:
        if project_id:
            shutil.rmtree(GENERATED / project_id, ignore_errors=True)
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
