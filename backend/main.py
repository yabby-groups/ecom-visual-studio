from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import shutil
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import BackgroundTasks, Cookie, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "storage"
UPLOADS = DATA / "uploads"
GENERATED = DATA / "generated"
DB = DATA / "workspace.db"
SESSION_TTL = 60 * 60 * 24 * 14
MAX_UPLOAD = 15 * 1024 * 1024

TEMPLATES = [
    ("hero-image", "商品主图", "商品展示", "1:1", "干净背景、完整展示商品轮廓、视觉焦点明确。"),
    ("lifestyle-scene", "生活场景", "场景展示", "4:5", "将商品置于真实使用环境，体现尺度、氛围和使用价值。"),
    ("detail-macro", "核心细节", "细节展示", "4:5", "特写呈现材质、结构、纹理和标志性细节。"),
    ("poster-banner", "卖点海报", "营销展示", "4:5", "突出商品，留出信息排版空间，适用于促销和传播。"),
]


class Credentials(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)
    totp_code: str = Field(default="", max_length=32)


class ProjectInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    product: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=3000)
    benefits: str = Field(default="", max_length=3000)
    color: str = Field(default="#A16207", max_length=20)
    reference: str = Field(default="", max_length=500)


class PackInput(BaseModel):
    kind: str = "amazon"
    scene_template_ids: list[str] = Field(default_factory=list)


class AssetPatch(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    template: Optional[str] = Field(default=None, max_length=80)
    ratio: Optional[str] = Field(default=None, max_length=12)
    prompt: Optional[str] = Field(default=None, max_length=12000)


class TemplateInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    ratio: str = Field(default="4:5", max_length=12)
    direction: str = Field(min_length=1, max_length=1800)


class ChatInput(BaseModel):
    messages: list[dict[str, str]] = Field(max_length=12)


class AnalyzeInput(BaseModel):
    mode: str
    product: str = ""
    reference: str = ""


class SettingsInput(BaseModel):
    token_id: str
    image_model: str
    text_model: str
    chat_model: str


def env() -> dict[str, str]:
    values = dict(os.environ)
    env_file = ROOT / ".env"
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in raw and not raw.lstrip().startswith("#"):
                key, value = raw.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip("\"'"))
    return values


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    DATA.mkdir(exist_ok=True)
    UPLOADS.mkdir(exist_ok=True)
    GENERATED.mkdir(exist_ok=True)
    connection = db()
    connection.executescript("""
      create table if not exists users (id text primary key, username text unique not null, password_hash text not null, created_at integer not null);
      create table if not exists sessions (id text primary key, user_id text not null, expires_at integer not null);
      create table if not exists settings (user_id text primary key, token_id text, image_model text, text_model text, chat_model text);
      create table if not exists tokens (user_id text not null, id text not null, name text not null, secret text not null, masked text, status integer not null default 1, today_cost text, total_cost text, primary key(user_id, id));
      create table if not exists models (user_id text not null, id text not null, name text not null, primary key(user_id, id));
      create table if not exists projects (id text primary key, user_id text not null, name text not null, product text not null, description text, benefits text, color text, reference text, created_at integer not null);
      create table if not exists assets (id text primary key, project_id text not null, title text not null, template text not null, ratio text not null, prompt text not null, status text not null, file_path text, created_at integer not null);
      create table if not exists custom_templates (id text primary key, user_id text not null, name text not null, ratio text not null, direction text not null, created_at integer not null);
    """)
    connection.execute("update assets set status='failed: 服务在生成期间重启，请重新发起任务' where status in ('queued', 'prompting', 'generating')")
    connection.commit()
    connection.close()


def password_hash(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310000)
    return "pbkdf2_sha256$310000$%s$%s" % (base64.b64encode(salt).decode(), base64.b64encode(digest).decode())


def password_matches(password: str, encoded: str) -> bool:
    try:
        _, iterations, salt, expected = encoded.split("$", 3)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(actual, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


def crypt(value: str) -> str:
    secret = env().get("APP_SECRET_KEY", "")
    if not secret:
        raise ValueError("请在 .env 设置 APP_SECRET_KEY")
    key = hashlib.sha256(secret.encode()).digest()
    nonce = os.urandom(16)
    stream = hashlib.pbkdf2_hmac("sha256", key, nonce, 20000, dklen=len(value.encode()))
    encrypted = bytes(a ^ b for a, b in zip(value.encode(), stream))
    signature = hmac.new(key, nonce + encrypted, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(nonce + signature + encrypted).decode()


def decrypt(value: str) -> str:
    raw = base64.urlsafe_b64decode(value.encode())
    nonce, signature, encrypted = raw[:16], raw[16:48], raw[48:]
    key = hashlib.sha256(env()["APP_SECRET_KEY"].encode()).digest()
    if not hmac.compare_digest(signature, hmac.new(key, nonce + encrypted, hashlib.sha256).digest()):
        raise ValueError("保存的密钥无法验证")
    stream = hashlib.pbkdf2_hmac("sha256", key, nonce, 20000, dklen=len(encrypted))
    return bytes(a ^ b for a, b in zip(encrypted, stream)).decode()


def current_user(session_id: Optional[str]) -> Optional[dict[str, Any]]:
    if not session_id:
        return None
    connection = db()
    row = connection.execute("select u.* from sessions s join users u on u.id=s.user_id where s.id=? and s.expires_at>?", (session_id, int(time.time()))).fetchone()
    connection.close()
    return dict(row) if row else None


def require_user(session_id: Optional[str]) -> dict[str, Any]:
    user = current_user(session_id)
    if not user:
        raise HTTPException(401, "登录状态已失效")
    return user


def template_list(user_id: str) -> list[dict[str, Any]]:
    connection = db()
    customs = connection.execute("select * from custom_templates where user_id=? order by created_at desc", (user_id,)).fetchall()
    connection.close()
    return [dict(id=i, name=n, group=g, ratio=r, direction=d, custom=False) for i, n, g, r, d in TEMPLATES] + [dict(id=row["id"], name=row["name"], group="自定义", ratio=row["ratio"], direction=row["direction"], custom=True) for row in customs]


def project_detail(project_id: str, user_id: str) -> dict[str, Any]:
    connection = db()
    project = connection.execute("select * from projects where id=? and user_id=?", (project_id, user_id)).fetchone()
    if not project:
        connection.close()
        raise HTTPException(404, "项目不存在")
    payload = dict(project)
    payload["assets"] = [dict(row) for row in connection.execute("select * from assets where project_id=? order by created_at", (project_id,))]
    connection.close()
    return payload


def built_in_pack(kind: str) -> list[tuple[str, str, str, str, str]]:
    packs = {
        "custom": [("H1", "商品主图", "hero-image", "1:1", "A clear ecommerce hero shot on a clean background, centered and fully visible.")],
        "social": [("S1", "种草主视觉", "lifestyle-scene", "4:5", "A scroll-stopping lifestyle image with the product naturally featured."), ("S2", "产品细节", "detail-macro", "4:5", "A tactile close-up that highlights craftsmanship and product details."), ("S3", "品牌海报", "poster-banner", "4:5", "A premium campaign composition with generous copy space.")],
        "amazon": [("H1", "商品主图", "hero-image", "1:1", "A clean hero shot on #FFFFFF, product occupies 38%, with clear price-overlay whitespace."), ("H2", "核心细节", "detail-macro", "1:1", "A macro close-up of material, texture and construction."), ("H3", "使用场景", "lifestyle-scene", "1:1", "The product naturally used in a believable everyday setting."), ("H4", "多角度展示", "multi-angle-grid", "1:1", "An orderly product grid showing useful angles and silhouette."), ("D1", "核心卖点", "poster-banner", "2:3", "A benefit-led product poster with reserved copy space."), ("D2", "品质特写", "detail-macro", "2:3", "An elevated detail scene emphasizing material and purchase confidence."), ("D3", "购买场景", "lifestyle-scene", "2:3", "A polished lifestyle scene showing daily value.")],
    }
    return packs.get(kind, packs["amazon"])


def make_prompt(project: dict[str, Any], title: str, direction: str) -> str:
    return f"E-commerce commercial image. Purpose: {title}. Art direction: {direction}. Product: {project['product']}. Description: {project['description']}. Benefits: {project['benefits']}. Campaign Style Lock: brand accent {project['color']}, premium commercial lighting, clean composition and conversion focus. Preserve exact product identity from the supplied reference. Leave intentional whitespace. No watermark, unrelated products, fake logo or unreadable extra text."


def huabot_login(name: str, password: str, totp_code: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    values = env()
    base = (values.get("HUABOT_BASE_URL") or values.get("IMG_BASE_URL") or "https://huabot.com").removesuffix("/v1").rstrip("/")
    web_base = values.get("HUABOT_WEB_BASE_URL", "https://www.huabot.com").rstrip("/")

    def call(path: str, data: Optional[dict[str, str]] = None, bearer: str = "", form: bool = False) -> dict[str, Any]:
        from urllib.parse import urlencode
        body = (urlencode(data).encode() if form else json.dumps(data).encode()) if data else None
        headers = {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"} if body else {}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        try:
            with urlopen(Request(base + path, data=body, headers=headers, method="POST" if body else "GET"), timeout=30) as response:
                result = json.loads(response.read().decode())
        except HTTPError as error:
            raise ValueError(f"huabot 登录失败：HTTP {error.code}") from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ValueError(f"无法连接 huabot：{error}") from error
        if not isinstance(result, dict) or result.get("err"):
            raise ValueError(str(result.get("err", "huabot 返回异常")))
        return result

    signin = {"name": name, "passwd": password}
    if totp_code:
        signin["totp_code"] = totp_code
    bearer = call("/api/signin/", signin, form=True).get("token")
    if not bearer:
        raise ValueError("huabot 未返回会话令牌")
    raw_tokens = call("/api/token_base/token/my/list/", bearer=bearer).get("tokens") or []
    if not raw_tokens:
        raw_tokens = [call("/api/token_base/token/create/", {"name": "ecom-visual-studio"}, bearer).get("token")]
    tokens = []
    for index, token in enumerate(raw_tokens):
        if not isinstance(token, dict):
            continue
        key = next((str(token.get(field)) for field in ("token_key", "token", "key", "api_key", "secret") if token.get(field)), "")
        if key:
            tokens.append({"id": str(token.get("id") or token.get("uuid") or index), "name": str(token.get("token_name") or token.get("name") or f"Token {index + 1}"), "key": key, "masked": str(token.get("token_key_masked") or ""), "status": int(token.get("status", 1)), "today_cost": str(token.get("today_used_cost") or "0"), "total_cost": str(token.get("total_used_cost") or "0")})
    with urlopen(Request(f"{web_base}/api/token_base/model/list/?size=500&offset=0&enabled=1", headers={"Authorization": f"Bearer {bearer}"}), timeout=30) as response:
        raw_models = json.loads(response.read().decode())
    items = raw_models.get("models") or raw_models.get("data") or []
    models = [{"id": str(item.get("model") or item.get("model_name") or item.get("id")), "name": str(item.get("model_name") or item.get("model") or item.get("name") or item.get("id"))} for item in items if isinstance(item, dict) and (item.get("model") or item.get("model_name") or item.get("id"))]
    if not tokens or not models:
        raise ValueError("huabot 没有返回可用 Token 或模型")
    return tokens, models


def user_config(user_id: str) -> dict[str, str]:
    connection = db()
    row = connection.execute("select s.*, t.secret from settings s left join tokens t on t.user_id=s.user_id and t.id=s.token_id where s.user_id=?", (user_id,)).fetchone()
    connection.close()
    if not row or not row["secret"]:
        raise ValueError("请先在设置中选择 huabot Token")
    values = env()
    return {"base": (values.get("HUABOT_BASE_URL") or values.get("IMG_BASE_URL") or "").rstrip("/"), "key": decrypt(row["secret"]), "image_model": row["image_model"] or "gpt-image-2", "text_model": row["text_model"] or "gpt-5.6-luna", "chat_model": row["chat_model"] or "gpt-5.6-luna"}


def generate_asset(asset_id: str) -> None:
    connection = db()
    asset = connection.execute("select a.*, p.user_id, p.product, p.description, p.benefits, p.color, p.reference from assets a join projects p on p.id=a.project_id where a.id=?", (asset_id,)).fetchone()
    if not asset:
        connection.close()
        return
    connection.execute("update assets set status='generating' where id=?", (asset_id,))
    connection.commit()
    try:
        config = user_config(asset["user_id"])
        if not config["base"]:
            raise ValueError("请设置 HUABOT_BASE_URL 或 IMG_BASE_URL")
        size = {"1:1": "1024x1024", "4:5": "1024x1536", "2:3": "1024x1536", "16:9": "1536x1024"}.get(asset["ratio"], "1024x1024")
        payload = json.dumps({"model": config["image_model"], "prompt": asset["prompt"], "size": size, "n": 1}).encode()
        request = Request(f"{config['base']}/images/generations", data=payload, headers={"Authorization": f"Bearer {config['key']}", "Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=180) as response:
            result = json.loads(response.read().decode())
        image = (result.get("data") or [{}])[0]
        target_dir = GENERATED / asset["project_id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{asset_id}-{uuid.uuid4().hex[:8]}.png"
        if image.get("b64_json"):
            target.write_bytes(base64.b64decode(image["b64_json"]))
        elif image.get("url"):
            with urlopen(Request(image["url"], headers={"User-Agent": "EcomVisualStudio/1.0"}), timeout=90) as response:
                shutil.copyfileobj(response, target.open("wb"))
        else:
            raise ValueError("图像服务没有返回图片")
        connection.execute("update assets set status='ready', file_path=? where id=?", (str(target.relative_to(DATA)), asset_id))
    except Exception as error:
        connection.execute("update assets set status=? where id=?", (f"failed: {str(error)[:180]}", asset_id))
    finally:
        connection.commit()
        connection.close()


init_db()

app = FastAPI(title="Ecom Visual Studio API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/auth/me")
def auth_me(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = current_user(session)
    return {"user": {"id": user["id"], "username": user["username"]} if user else None}


@app.post("/api/auth/login")
def login(body: Credentials, response: Response) -> dict[str, Any]:
    try:
        tokens, models = huabot_login(body.name, body.password, body.totp_code)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    connection = db()
    user = connection.execute("select * from users where username=?", (body.name,)).fetchone()
    if not user:
        user_id = uuid.uuid4().hex
        connection.execute("insert into users values(?,?,?,?)", (user_id, body.name, password_hash(secrets.token_urlsafe(32)), int(time.time())))
    else:
        user_id = user["id"]
    connection.execute("delete from tokens where user_id=?", (user_id,))
    connection.execute("delete from models where user_id=?", (user_id,))
    try:
        for token in tokens:
            connection.execute("insert into tokens values(?,?,?,?,?,?,?,?)", (user_id, token["id"], token["name"], crypt(token["key"]), token["masked"], token["status"], token["today_cost"], token["total_cost"]))
    except ValueError as error:
        connection.close()
        raise HTTPException(400, str(error)) from error
    for model in models:
        connection.execute("insert into models values(?,?,?)", (user_id, model["id"], model["name"]))
    active = tokens[0]
    connection.execute("insert into settings(user_id,token_id,image_model,text_model,chat_model) values(?,?,?,?,?) on conflict(user_id) do update set token_id=excluded.token_id", (user_id, active["id"], "gpt-image-2", "gpt-5.6-luna", "gpt-5.6-luna"))
    session_id = uuid.uuid4().hex
    connection.execute("insert into sessions values(?,?,?)", (session_id, user_id, int(time.time()) + SESSION_TTL))
    connection.commit()
    connection.close()
    response.set_cookie("session", session_id, max_age=SESSION_TTL, httponly=True, samesite="lax")
    return {"user": {"id": user_id, "username": body.name}}


@app.post("/api/auth/logout")
def logout(response: Response, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    if session:
        connection = db(); connection.execute("delete from sessions where id=?", (session,)); connection.commit(); connection.close()
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/huabot/tokens")
def tokens(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session); connection = db()
    rows = connection.execute("select id,name,masked,status,today_cost,total_cost from tokens where user_id=? order by name", (user["id"],)).fetchall()
    setting = connection.execute("select * from settings where user_id=?", (user["id"],)).fetchone(); connection.close()
    return {"tokens": [dict(row) for row in rows], "active_token_id": setting["token_id"] if setting else "", "image_model": setting["image_model"] if setting else "", "text_model": setting["text_model"] if setting else "", "chat_model": setting["chat_model"] if setting else ""}


@app.get("/api/huabot/models")
def models(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session); connection = db(); rows = connection.execute("select id,name from models where user_id=? order by name", (user["id"],)).fetchall(); connection.close()
    return {"models": [dict(row) for row in rows]}


@app.post("/api/settings")
def update_settings(body: SettingsInput, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); connection = db()
    exists = connection.execute("select 1 from tokens where user_id=? and id=? and status=1", (user["id"], body.token_id)).fetchone()
    if not exists:
        connection.close(); raise HTTPException(400, "请选择可用 Token")
    connection.execute("insert into settings values(?,?,?,?,?) on conflict(user_id) do update set token_id=excluded.token_id,image_model=excluded.image_model,text_model=excluded.text_model,chat_model=excluded.chat_model", (user["id"], body.token_id, body.image_model, body.text_model, body.chat_model)); connection.commit(); connection.close()
    return {"ok": True}


@app.get("/api/projects")
def projects(session: Optional[str] = Cookie(default=None)) -> list[dict[str, Any]]:
    user = require_user(session); connection = db()
    rows = connection.execute("select p.*, count(a.id) as asset_count from projects p left join assets a on a.project_id=p.id where p.user_id=? group by p.id order by p.created_at desc", (user["id"],)).fetchall(); connection.close()
    return [dict(row) for row in rows]


@app.post("/api/projects")
def create_project(body: ProjectInput, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session); project_id = uuid.uuid4().hex; connection = db()
    connection.execute("insert into projects values(?,?,?,?,?,?,?,?,?)", (project_id, user["id"], body.name, body.product, body.description, body.benefits, body.color, body.reference, int(time.time()))); connection.commit(); connection.close()
    return {"id": project_id}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    return project_detail(project_id, require_user(session)["id"])


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); project_detail(project_id, user["id"]); connection = db()
    connection.execute("delete from assets where project_id=?", (project_id,)); connection.execute("delete from projects where id=? and user_id=?", (project_id, user["id"])); connection.commit(); connection.close(); shutil.rmtree(GENERATED / project_id, ignore_errors=True)
    return {"ok": True}


@app.post("/api/projects/{project_id}/pack")
def create_pack(project_id: str, body: PackInput, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); project = project_detail(project_id, user["id"]); templates = {item["id"]: item for item in template_list(user["id"])}; assets = built_in_pack(body.kind)
    if body.kind == "amazon":
        assets += [(f"C{i}", templates[item]["name"], item, templates[item]["ratio"], templates[item]["direction"]) for i, item in enumerate(dict.fromkeys(body.scene_template_ids), 1) if item in templates and templates[item]["custom"]]
    connection = db(); connection.execute("delete from assets where project_id=?", (project_id,))
    for code, title, template, ratio, direction in assets:
        connection.execute("insert into assets values(?,?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, project_id, f"{code} · {title}", template, ratio, make_prompt(project, title, direction), "draft", None, int(time.time())))
    connection.commit(); connection.close()
    return {"ok": True}


@app.patch("/api/assets/{asset_id}")
def patch_asset(asset_id: str, body: AssetPatch, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); connection = db(); asset = connection.execute("select a.* from assets a join projects p on p.id=a.project_id where a.id=? and p.user_id=?", (asset_id, user["id"])).fetchone()
    if not asset:
        connection.close(); raise HTTPException(404, "画面不存在")
    fields = {key: value for key, value in body.model_dump().items() if value is not None}
    if fields:
        connection.execute("update assets set " + ",".join(f"{key}=?" for key in fields) + " where id=?", (*fields.values(), asset_id)); connection.commit()
    connection.close(); return {"ok": True}


@app.post("/api/assets/{asset_id}/prompt")
def reset_prompt(asset_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session); connection = db(); asset = connection.execute("select a.*,p.* from assets a join projects p on p.id=a.project_id where a.id=? and p.user_id=?", (asset_id, user["id"])).fetchone()
    if not asset:
        connection.close(); raise HTTPException(404, "画面不存在")
    template = next((item for item in template_list(user["id"]) if item["id"] == asset["template"]), None)
    prompt = make_prompt(dict(asset), asset["title"], template["direction"] if template else "Create a commercially useful composition.")
    connection.execute("update assets set prompt=? where id=?", (prompt, asset_id)); connection.commit(); connection.close(); return {"prompt": prompt}


@app.post("/api/assets/{asset_id}/generate")
def generate_one(asset_id: str, tasks: BackgroundTasks, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); connection = db(); owned = connection.execute("select a.id from assets a join projects p on p.id=a.project_id where a.id=? and p.user_id=?", (asset_id, user["id"])).fetchone()
    if not owned:
        connection.close(); raise HTTPException(404, "画面不存在")
    connection.execute("update assets set status='queued' where id=?", (asset_id,)); connection.commit(); connection.close(); tasks.add_task(generate_asset, asset_id)
    return {"ok": True}


@app.post("/api/projects/{project_id}/generate-pack")
def generate_all(project_id: str, tasks: BackgroundTasks, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); project_detail(project_id, user["id"]); connection = db(); rows = connection.execute("select id from assets where project_id=? and status!='ready'", (project_id,)).fetchall()
    for row in rows:
        connection.execute("update assets set status='queued' where id=?", (row["id"],)); tasks.add_task(generate_asset, row["id"])
    connection.commit(); connection.close(); return {"ok": True}


@app.get("/api/templates")
def templates(session: Optional[str] = Cookie(default=None)) -> list[dict[str, Any]]:
    return template_list(require_user(session)["id"])


@app.post("/api/templates")
def add_template(body: TemplateInput, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session); template_id = uuid.uuid4().hex; connection = db(); connection.execute("insert into custom_templates values(?,?,?,?,?,?)", (template_id, user["id"], body.name, body.ratio, body.direction, int(time.time()))); connection.commit(); connection.close(); return {"id": template_id}


@app.delete("/api/templates/{template_id}")
def delete_template(template_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session); connection = db(); deleted = connection.execute("delete from custom_templates where id=? and user_id=?", (template_id, user["id"])).rowcount; connection.commit(); connection.close(); return {"ok": bool(deleted)}


@app.post("/api/reference-upload")
async def upload_reference(file: UploadFile = File(...), session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    require_user(session); extension = Path(file.filename or "image.jpg").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(400, "仅支持 JPG、PNG 或 WebP")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD:
        raise HTTPException(400, "图片不能超过 15MB")
    target = UPLOADS / f"{uuid.uuid4().hex}{extension}"; target.write_bytes(contents)
    return {"path": f"uploads/{target.name}"}


@app.post("/api/reference-url")
def import_reference(payload: dict[str, str], session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    require_user(session); url = payload.get("url", "")
    if not url.startswith(("https://", "http://")):
        raise HTTPException(400, "请输入公开可访问的图片 URL")
    try:
        with urlopen(Request(url, headers={"User-Agent": "EcomVisualStudio/1.0"}), timeout=20) as response:
            content = response.read(MAX_UPLOAD + 1); mime = response.headers.get_content_type()
    except (HTTPError, URLError, TimeoutError) as error:
        raise HTTPException(400, f"无法导入图片：{error}") from error
    if len(content) > MAX_UPLOAD or not mime.startswith("image/"):
        raise HTTPException(400, "图片格式无效或超过 15MB")
    extension = mimetypes.guess_extension(mime) or ".jpg"; target = UPLOADS / f"{uuid.uuid4().hex}{extension}"; target.write_bytes(content)
    return {"path": f"uploads/{target.name}"}


@app.post("/api/chat")
def chat(body: ChatInput, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session)
    try: config = user_config(user["id"])
    except ValueError as error: raise HTTPException(400, str(error)) from error
    messages = [{"role": item.get("role"), "content": str(item.get("content", ""))[:6000]} for item in body.messages if item.get("role") in {"user", "assistant"} and item.get("content")]
    if not messages or messages[-1]["role"] != "user": raise HTTPException(400, "请输入消息")
    payload = json.dumps({"model": config["chat_model"], "messages": [{"role": "system", "content": "You are a helpful Chinese e-commerce creative assistant. Return copy-ready, accurate answers."}, *messages]}).encode()
    try:
        with urlopen(Request(f"{config['base']}/chat/completions", data=payload, headers={"Authorization": f"Bearer {config['key']}", "Content-Type": "application/json"}, method="POST"), timeout=90) as response:
            result = json.loads(response.read().decode())
        return {"reply": str(result["choices"][0]["message"]["content"]).strip()}
    except Exception as error: raise HTTPException(502, f"AI 对话失败：{error}") from error


@app.post("/api/analyze-product")
def analyze(body: AnalyzeInput, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    if body.mode not in {"name", "image"} or (body.mode == "name" and not body.product.strip()): raise HTTPException(400, "请提供商品名称或已上传图片")
    try: config = user_config(user["id"])
    except ValueError as error: raise HTTPException(400, str(error)) from error
    content: Any = f"Product: {body.product}. Return JSON only: {{\"description\": Chinese 45-80 character description, \"benefits\": exactly four concise Chinese selling points}}. Do not invent unprovided specifications, certifications or claims."
    if body.mode == "image":
        image = (DATA / body.reference).resolve()
        if not image.is_file() or DATA not in image.parents: raise HTTPException(400, "请先上传图片")
        content = [{"type": "text", "text": content}, {"type": "image_url", "image_url": {"url": f"data:{mimetypes.guess_type(image)[0] or 'image/jpeg'};base64,{base64.b64encode(image.read_bytes()).decode()}"}}]
    payload = json.dumps({"model": config["text_model"], "temperature": 0.35, "messages": [{"role": "user", "content": content}]}).encode()
    try:
        with urlopen(Request(f"{config['base']}/chat/completions", data=payload, headers={"Authorization": f"Bearer {config['key']}", "Content-Type": "application/json"}, method="POST"), timeout=60) as response: result = json.loads(response.read().decode())
        raw = str(result["choices"][0]["message"]["content"]).strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip(); parsed = json.loads(raw)
        return {"description": str(parsed["description"]), "benefits": [str(item) for item in parsed["benefits"]][:4]}
    except Exception as error: raise HTTPException(502, f"AI 分析失败：{error}") from error


app.mount("/files", StaticFiles(directory=DATA), name="files")
