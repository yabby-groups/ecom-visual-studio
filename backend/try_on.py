import base64
import json
import time
import uuid
from contextlib import ExitStack
from itertools import product
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Cookie, HTTPException, Query
from openai import OpenAI

from .auth import require_user
from .config import DATA, GENERATED, UPLOADS
from .db import try_on_jobs, try_on_versions
from .db.core import db
from .generation import image_size_for_ratio, png_dimensions
from .huabot import user_config
from .schemas import TryOnInput

router = APIRouter()

TRY_ON_PROMPT = """Create a realistic full-body fashion try-on image. The first group of reference images shows the person and the second group shows one garment. The first image of each group is the primary reference; any later images only provide additional angles and visual details. Preserve the person's identity, pose, body proportions, hair, and background. Replace only their clothing with the supplied garment, accurately preserving its color, fabric, silhouette, and visible details. Compose a complete full-body fashion image. Do not add text, watermarks, logos, extra garments, or unrelated objects."""


def _uploaded_path(path: str) -> Path:
    if not path.startswith("uploads/"):
        raise ValueError("换装图片必须先通过上传功能添加")
    target = (DATA / path).resolve()
    if UPLOADS.resolve() not in target.parents or not target.is_file():
        raise ValueError("换装参考图片不存在")
    return target


def _reference_paths(job: Any, key: str) -> list[str]:
    raw = job[f"{key}_paths"]
    if raw:
        try:
            paths = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError("换装参考图片记录无效") from error
        if isinstance(paths, list) and all(isinstance(path, str) for path in paths):
            return paths
        raise ValueError("换装参考图片记录无效")
    return [job[f"{key}_path"]]


def generate_try_on(job_id: str) -> None:
    connection = db()
    job = try_on_jobs.get_for_generation(connection, job_id)
    if not job:
        connection.close()
        return
    try_on_jobs.mark_generating(connection, job_id, int(time.time()))
    connection.commit()
    try:
        config = user_config(job["user_id"])
        if not config["base"]:
            raise ValueError("请设置 HUABOT_BASE_URL 或 IMG_BASE_URL")
        if not config["image_model"].startswith("gpt-image-"):
            raise ValueError("图像生成模型必须是 GPT Image 模型")
        person_paths = _reference_paths(job, "person")
        garment_paths = _reference_paths(job, "garment")
        reference_paths = person_paths + garment_paths
        if not reference_paths:
            raise ValueError("换装参考图片不能为空")
        width, height = image_size_for_ratio(job["ratio"])
        client = OpenAI(base_url=config["base"], api_key=config["key"], timeout=300)
        with ExitStack() as stack:
            image_files = [
                stack.enter_context(_uploaded_path(path).open("rb"))
                for path in reference_paths
            ]
            result = client.images.edit(
                model=config["image_model"],
                image=image_files,
                prompt=f"{TRY_ON_PROMPT}\nAdditional direction: {job['instructions'].strip() or 'None.'}",
                size=f"{width}x{height}",
                n=1,
            )
        image = result.data[0] if result.data else None
        if not image or not image.b64_json:
            raise ValueError("当前图像服务不支持换装编辑或没有返回图片")
        image_bytes = base64.b64decode(image.b64_json, validate=True)
        actual_width, actual_height = png_dimensions(image_bytes)
        if actual_width * height != actual_height * width:
            raise ValueError(f"图像服务返回比例 {actual_width}:{actual_height}，但请求的是 {job['ratio']}")
        target_dir = GENERATED / "try-on" / job["user_id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{job_id}-{uuid.uuid4().hex[:8]}.png"
        target.write_bytes(image_bytes)
        file_path = str(target.relative_to(DATA))
        try_on_jobs.mark_ready(connection, job_id, file_path)
        try_on_versions.create(connection, job_id, file_path, int(time.time()))
    except Exception as error:
        message = str(error)[:180]
        if "edit" in message.lower() or "unsupported" in message.lower():
            message = "当前图像服务不支持换装编辑：" + message
        try_on_jobs.mark_failed(connection, job_id, f"failed: {message}")
    finally:
        connection.commit()
        connection.close()


def _job_payload(connection: Any, row: Any) -> dict[str, Any]:
    payload = dict(row)
    payload["person_paths"] = _reference_paths(payload, "person")
    payload["garment_paths"] = _reference_paths(payload, "garment")
    payload["versions"] = [
        dict(version) for version in try_on_versions.list_for_job(connection, payload["id"])
    ]
    return payload


@router.get("/api/try-on")
def list_try_on(limit: int = Query(default=12, ge=1, le=48), offset: int = Query(default=0, ge=0), session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    connection = db()
    rows = try_on_jobs.list_for_user(connection, user["id"], limit, offset)
    total = try_on_jobs.count_for_user(connection, user["id"])
    items = [_job_payload(connection, row) for row in rows]
    connection.close()
    return {"items": items, "total": total, "has_more": offset + len(rows) < total}


@router.get("/api/try-on/{job_id}")
def get_try_on(job_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    connection = db()
    row = try_on_jobs.get_owned(connection, job_id, user["id"])
    if not row:
        connection.close()
        raise HTTPException(404, "换装任务不存在")
    payload = _job_payload(connection, row)
    connection.close()
    return payload


@router.post("/api/try-on")
def create_try_on(body: TryOnInput, tasks: BackgroundTasks, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    person_paths = body.person_paths or ([body.person_path] if body.person_path else [])
    garment_paths = body.garment_paths or ([body.garment_path] if body.garment_path else [])
    try:
        if not person_paths or not garment_paths:
            raise ValueError("请至少添加一张人物照片和一张服装图片")
        if len(person_paths) > 4 or len(garment_paths) > 4:
            raise ValueError("人物照片和服装图片最多各添加 4 张")
        for path in [*person_paths, *garment_paths]:
            _uploaded_path(path)
        image_size_for_ratio(body.ratio)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    with_connection = db()
    references = (
        [(person_paths, garment_paths)]
        if body.generation_mode == "combined"
        else [([person_path], [garment_path]) for person_path, garment_path in product(person_paths, garment_paths)]
    )
    job_ids = []
    for people, garments in references:
        job_id = uuid.uuid4().hex
        try_on_jobs.create(with_connection, (
            job_id, user["id"], people[0], garments[0], json.dumps(people),
            json.dumps(garments), body.generation_mode, body.instructions, body.ratio, "queued", None,
            int(time.time()),
        ))
        job_ids.append(job_id)
    with_connection.commit()
    with_connection.close()
    for job_id in job_ids:
        tasks.add_task(generate_try_on, job_id)
    return {"id": job_ids[0], "ids": job_ids}


@router.post("/api/try-on/{job_id}/generate")
def regenerate_try_on(job_id: str, tasks: BackgroundTasks, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    connection = db()
    job = try_on_jobs.get_owned(connection, job_id, user["id"])
    if not job:
        connection.close()
        raise HTTPException(404, "换装任务不存在")
    try_on_jobs.queue(connection, job_id, int(time.time()))
    connection.commit()
    connection.close()
    tasks.add_task(generate_try_on, job_id)
    return {"ok": True}


@router.delete("/api/try-on/{job_id}")
def delete_try_on(job_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    connection = db()
    job = try_on_jobs.get_owned(connection, job_id, user["id"])
    if not job:
        connection.close()
        raise HTTPException(404, "换装任务不存在")
    if job["status"] in {"queued", "generating"}:
        connection.close()
        raise HTTPException(409, "正在生成的换装任务不能删除")
    paths = {version["file_path"] for version in try_on_versions.list_for_job(connection, job_id)}
    if job["file_path"]:
        paths.add(job["file_path"])
    deleted = try_on_jobs.delete_owned(connection, job_id, user["id"])
    try_on_versions.delete_for_job(connection, job_id)
    connection.commit()
    connection.close()
    for path in paths:
        target = (DATA / path).resolve()
        allowed = (GENERATED / "try-on" / user["id"]).resolve()
        if allowed in target.parents and target.is_file():
            target.unlink()
    return {"ok": bool(deleted)}
