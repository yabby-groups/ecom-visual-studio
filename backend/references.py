import mimetypes
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Cookie, File, HTTPException, UploadFile

from .auth import require_user
from .config import MAX_UPLOAD, UPLOADS

router = APIRouter()


@router.post("/api/reference-upload")
async def upload_reference(file: UploadFile = File(...), session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    require_user(session)
    extension = Path(file.filename or "image.jpg").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(400, "仅支持 JPG、PNG 或 WebP")
    contents = await file.read()
    if len(contents) > MAX_UPLOAD:
        raise HTTPException(400, "图片不能超过 15MB")
    target = UPLOADS / f"{uuid.uuid4().hex}{extension}"
    target.write_bytes(contents)
    return {"path": f"uploads/{target.name}"}


@router.post("/api/reference-url")
def import_reference(payload: dict[str, str], session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    require_user(session)
    url = payload.get("url", "")
    if not url.startswith(("https://", "http://")):
        raise HTTPException(400, "请输入公开可访问的图片 URL")
    try:
        with httpx.stream("GET", url, headers={"User-Agent": "EcomVisualStudio/1.0"}, timeout=20) as response:
            response.raise_for_status()
            mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            content = b""
            for chunk in response.iter_bytes():
                content += chunk
                if len(content) > MAX_UPLOAD:
                    break
    except httpx.HTTPError as error:
        raise HTTPException(400, f"无法导入图片：{error}") from error
    if len(content) > MAX_UPLOAD or not mime.startswith("image/"):
        raise HTTPException(400, "图片格式无效或超过 15MB")
    extension = mimetypes.guess_extension(mime) or ".jpg"
    target = UPLOADS / f"{uuid.uuid4().hex}{extension}"
    target.write_bytes(content)
    return {"path": f"uploads/{target.name}"}
