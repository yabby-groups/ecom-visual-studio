import base64
import json
import mimetypes
from typing import Any, Optional

from fastapi import APIRouter, Cookie, HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI

from .auth import require_user
from .config import DATA
from .huabot import user_config
from .schemas import AnalyzeInput, ChatInput

router = APIRouter()


@router.post("/api/chat")
def chat(body: ChatInput, session: Optional[str] = Cookie(default=None)) -> StreamingResponse:
    user = require_user(session)
    try:
        config = user_config(user["id"])
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    messages = [{"role": item.get("role"), "content": str(item.get("content", ""))[:6000]} for item in body.messages if item.get("role") in {"user", "assistant"} and item.get("content")]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(400, "请输入消息")
    def stream_reply():
        try:
            client = OpenAI(base_url=config["base"], api_key=config["key"], timeout=90)
            result = client.responses.create(
                model=config["chat_model"],
                instructions="You are a helpful Chinese e-commerce creative assistant. Return copy-ready, accurate answers.",
                input=messages,
                stream=True,
            )
            for event in result:
                if event.type == "response.output_text.delta" and event.delta:
                    yield f"data: {json.dumps({'delta': event.delta}, ensure_ascii=False)}\n\n"
        except Exception as error:
            yield f"data: {json.dumps({'error': f'AI 对话失败：{error}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(stream_reply(), media_type="text/event-stream")


@router.post("/api/analyze-product")
def analyze(body: AnalyzeInput, session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    if body.mode not in {"name", "image"} or (body.mode == "name" and not body.product.strip()):
        raise HTTPException(400, "请提供商品名称或已上传图片")
    try:
        config = user_config(user["id"])
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    content: list[dict[str, str]] = [{"type": "input_text", "text": f"Product: {body.product}. Return JSON only: {{\"description\": Chinese 45-80 character description, \"benefits\": exactly four concise Chinese selling points}}. Do not invent unprovided specifications, certifications or claims."}]
    if body.mode == "image":
        image = (DATA / body.reference).resolve()
        if not image.is_file() or DATA not in image.parents:
            raise HTTPException(400, "请先上传图片")
        content.append({"type": "input_image", "image_url": f"data:{mimetypes.guess_type(image)[0] or 'image/jpeg'};base64,{base64.b64encode(image.read_bytes()).decode()}"})
    try:
        client = OpenAI(base_url=config["base"], api_key=config["key"], timeout=60)
        result = client.responses.create(model=config["text_model"], temperature=0.35, input=[{"role": "user", "content": content}])
        raw = result.output_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)
        return {"description": str(parsed["description"]), "benefits": [str(item) for item in parsed["benefits"]][:4]}
    except Exception as error:
        raise HTTPException(502, f"AI 分析失败：{error}") from error
