import base64
import json
import mimetypes
from typing import Any, Optional
from urllib.request import Request, urlopen

from fastapi import APIRouter, Cookie, HTTPException

from .auth import require_user
from .config import DATA
from .huabot import user_config
from .schemas import AnalyzeInput, ChatInput

router = APIRouter()


@router.post("/api/chat")
def chat(body: ChatInput, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session)
    try:
        config = user_config(user["id"])
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    messages = [{"role": item.get("role"), "content": str(item.get("content", ""))[:6000]} for item in body.messages if item.get("role") in {"user", "assistant"} and item.get("content")]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(400, "请输入消息")
    payload = json.dumps({"model": config["chat_model"], "messages": [{"role": "system", "content": "You are a helpful Chinese e-commerce creative assistant. Return copy-ready, accurate answers."}, *messages]}).encode()
    try:
        with urlopen(Request(f"{config['base']}/chat/completions", data=payload, headers={"Authorization": f"Bearer {config['key']}", "Content-Type": "application/json"}, method="POST"), timeout=90) as response:
            result = json.loads(response.read().decode())
        return {"reply": str(result["choices"][0]["message"]["content"]).strip()}
    except Exception as error:
        raise HTTPException(502, f"AI 对话失败：{error}") from error


@router.post("/api/analyze-product")
def analyze(body: AnalyzeInput, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    if body.mode not in {"name", "image"} or (body.mode == "name" and not body.product.strip()):
        raise HTTPException(400, "请提供商品名称或已上传图片")
    try:
        config = user_config(user["id"])
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    content: Any = f"Product: {body.product}. Return JSON only: {{\"description\": Chinese 45-80 character description, \"benefits\": exactly four concise Chinese selling points}}. Do not invent unprovided specifications, certifications or claims."
    if body.mode == "image":
        image = (DATA / body.reference).resolve()
        if not image.is_file() or DATA not in image.parents:
            raise HTTPException(400, "请先上传图片")
        content = [{"type": "text", "text": content}, {"type": "image_url", "image_url": {"url": f"data:{mimetypes.guess_type(image)[0] or 'image/jpeg'};base64,{base64.b64encode(image.read_bytes()).decode()}"}}]
    payload = json.dumps({"model": config["text_model"], "temperature": 0.35, "messages": [{"role": "user", "content": content}]}).encode()
    try:
        with urlopen(Request(f"{config['base']}/chat/completions", data=payload, headers={"Authorization": f"Bearer {config['key']}", "Content-Type": "application/json"}, method="POST"), timeout=60) as response:
            result = json.loads(response.read().decode())
        raw = str(result["choices"][0]["message"]["content"]).strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)
        return {"description": str(parsed["description"]), "benefits": [str(item) for item in parsed["benefits"]][:4]}
    except Exception as error:
        raise HTTPException(502, f"AI 分析失败：{error}") from error
