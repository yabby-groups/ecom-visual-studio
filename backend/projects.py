import shutil
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Cookie, HTTPException

from .auth import require_user
from .config import GENERATED
from .db import asset_versions, assets as db_assets, projects as projects_table
from .db.core import db
from .generation import generate_asset, image_size_for_ratio
from .schemas import AssetPatch, PackInput, ProjectInput
from .templates import template_list

router = APIRouter()


def ensure_supported_ratio(ratio: str) -> None:
    try:
        image_size_for_ratio(ratio)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def project_detail(project_id: str, user_id: str) -> dict[str, Any]:
    connection = db()
    project = projects_table.get_owned(connection, project_id, user_id)
    if not project:
        connection.close()
        raise HTTPException(404, "项目不存在")
    payload = dict(project)
    payload["assets"] = [dict(row) for row in db_assets.list_for_project(connection, project_id)]
    for asset in payload["assets"]:
        asset["versions"] = [dict(row) for row in asset_versions.list_for_asset(connection, asset["id"])]
    connection.close()
    return payload


def built_in_pack(kind: str) -> list[tuple[str, str, str, str, str]]:
    packs = {
        "custom": [("H1", "商品主图", "hero-image", "1:1", "A clear ecommerce hero shot on a clean background, centered and fully visible.")],
        "social": [("S1", "种草主视觉", "lifestyle-scene", "2:3", "A scroll-stopping lifestyle image with the product naturally featured."), ("S2", "产品细节", "detail-macro", "2:3", "A tactile close-up that highlights craftsmanship and product details."), ("S3", "品牌海报", "poster-banner", "2:3", "A premium campaign composition with generous copy space.")],
        "amazon": [("H1", "商品主图", "hero-image", "1:1", "A clean hero shot on #FFFFFF, product occupies 38%, with clear price-overlay whitespace."), ("H2", "核心细节", "detail-macro", "1:1", "A macro close-up of material, texture and construction."), ("H3", "使用场景", "lifestyle-scene", "1:1", "The product naturally used in a believable everyday setting."), ("H4", "多角度展示", "multi-angle-grid", "1:1", "An orderly product grid showing useful angles and silhouette."), ("D1", "核心卖点", "poster-banner", "2:3", "A benefit-led product poster with reserved copy space."), ("D2", "品质特写", "detail-macro", "2:3", "An elevated detail scene emphasizing material and purchase confidence."), ("D3", "购买场景", "lifestyle-scene", "2:3", "A polished lifestyle scene showing daily value.")],
    }
    return packs.get(kind, packs["amazon"])


def make_prompt(project: dict[str, Any], title: str, direction: str) -> str:
    return f"E-commerce commercial image. Purpose: {title}. Art direction: {direction}. Product: {project['product']}. Description: {project['description']}. Benefits: {project['benefits']}. Campaign Style Lock: brand accent {project['color']}, premium commercial lighting, clean composition and conversion focus. Preserve exact product identity from the supplied reference. Leave intentional whitespace. No watermark, unrelated products, fake logo or unreadable extra text."


@router.get("/api/projects")
def projects(session: Optional[str] = Cookie(default=None)) -> list[dict[str, Any]]:
    user = require_user(session)
    connection = db()
    rows = projects_table.list_for_user(connection, user["id"])
    connection.close()
    return [dict(row) for row in rows]


@router.get("/api/creations/latest")
def latest_creation(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    connection = db()
    row = asset_versions.latest_for_user(connection, user["id"])
    connection.close()
    return {"creation": dict(row) if row else None}


@router.post("/api/projects")
def create_project(body: ProjectInput, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session)
    project_id = uuid.uuid4().hex
    connection = db()
    projects_table.create(connection, (project_id, user["id"], body.name, body.product, body.description, body.benefits, body.color, body.reference, int(time.time())))
    connection.commit()
    connection.close()
    return {"id": project_id}


@router.get("/api/projects/{project_id}")
def get_project(project_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    return project_detail(project_id, require_user(session)["id"])


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    project_detail(project_id, user["id"])
    connection = db()
    asset_versions.delete_for_project(connection, project_id)
    db_assets.delete_for_project(connection, project_id)
    projects_table.delete_owned(connection, project_id, user["id"])
    connection.commit()
    connection.close()
    shutil.rmtree(GENERATED / project_id, ignore_errors=True)
    return {"ok": True}


@router.post("/api/projects/{project_id}/pack")
def create_pack(project_id: str, body: PackInput, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    project = project_detail(project_id, user["id"])
    templates = {item["id"]: item for item in template_list(user["id"])}
    selected_template = templates.get(body.template_id) if body.template_id else None
    assets = [("T1", selected_template["name"], selected_template["id"], selected_template["ratio"], selected_template["direction"])] if selected_template else built_in_pack(body.kind)
    if not selected_template and body.kind == "amazon":
        assets += [(f"C{i}", templates[item]["name"], item, templates[item]["ratio"], templates[item]["direction"]) for i, item in enumerate(dict.fromkeys(body.scene_template_ids), 1) if item in templates and templates[item]["custom"]]
    for _, _, _, ratio, _ in assets:
        ensure_supported_ratio(ratio)
    connection = db()
    asset_versions.delete_for_project(connection, project_id)
    db_assets.delete_for_project(connection, project_id)
    for code, title, template, ratio, direction in assets:
        db_assets.create(connection, (uuid.uuid4().hex, project_id, f"{code} · {title}", template, ratio, make_prompt(project, title, direction), "draft", None, int(time.time())))
    connection.commit()
    connection.close()
    shutil.rmtree(GENERATED / project_id, ignore_errors=True)
    return {"ok": True}


@router.patch("/api/assets/{asset_id}")
def patch_asset(asset_id: str, body: AssetPatch, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    fields = {key: value for key, value in body.model_dump().items() if value is not None}
    if "ratio" in fields:
        ensure_supported_ratio(fields["ratio"])
    connection = db()
    asset = db_assets.get_owned(connection, asset_id, user["id"])
    if not asset:
        connection.close()
        raise HTTPException(404, "画面不存在")
    if fields:
        db_assets.patch(connection, asset_id, fields)
        connection.commit()
    connection.close()
    return {"ok": True}


@router.post("/api/assets/{asset_id}/prompt")
def reset_prompt(asset_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session)
    connection = db()
    asset = db_assets.get_with_project_owned(connection, asset_id, user["id"])
    if not asset:
        connection.close()
        raise HTTPException(404, "画面不存在")
    template = next((item for item in template_list(user["id"]) if item["id"] == asset["template"]), None)
    prompt = make_prompt(dict(asset), asset["title"], template["direction"] if template else "Create a commercially useful composition.")
    db_assets.update_prompt(connection, asset_id, prompt)
    connection.commit()
    connection.close()
    return {"prompt": prompt}


@router.post("/api/assets/{asset_id}/generate")
def generate_one(asset_id: str, tasks: BackgroundTasks, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    connection = db()
    owned = db_assets.get_owned(connection, asset_id, user["id"])
    if not owned:
        connection.close()
        raise HTTPException(404, "画面不存在")
    try:
        ensure_supported_ratio(owned["ratio"])
    except HTTPException:
        connection.close()
        raise
    db_assets.queue(connection, asset_id, int(time.time()))
    connection.commit()
    connection.close()
    tasks.add_task(generate_asset, asset_id)
    return {"ok": True}


@router.post("/api/projects/{project_id}/generate-pack")
def generate_all(project_id: str, tasks: BackgroundTasks, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    project_detail(project_id, user["id"])
    connection = db()
    rows = db_assets.list_not_ready(connection, project_id)
    try:
        for row in rows:
            ensure_supported_ratio(row["ratio"])
    except HTTPException:
        connection.close()
        raise
    queued_at = int(time.time())
    for row in rows:
        db_assets.queue(connection, row["id"], queued_at)
        tasks.add_task(generate_asset, row["id"])
    connection.commit()
    connection.close()
    return {"ok": True}
