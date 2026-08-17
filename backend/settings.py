from typing import Any, Optional

from fastapi import APIRouter, Cookie, HTTPException

from .auth import require_user
from .db import models as models_table, settings as settings_table, tokens as tokens_table
from .db.core import db, transaction
from .huabot import huabot_models
from .schemas import SettingsInput

router = APIRouter()


@router.get("/api/huabot/tokens")
def tokens(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    connection = db()
    rows = tokens_table.list_for_user(connection, user["id"])
    setting = settings_table.get(connection, user["id"])
    connection.close()
    return {"tokens": [dict(row) for row in rows], "active_token_id": setting["token_id"] if setting else "", "image_model": setting["image_model"] if setting else "", "text_model": setting["text_model"] if setting else "", "chat_model": setting["chat_model"] if setting else ""}


@router.get("/api/huabot/models")
def models(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(session)
    try:
        refreshed_models = huabot_models()
    except ValueError as error:
        raise HTTPException(502, str(error)) from error
    refreshed_models.sort(key=lambda model: model["name"])
    with transaction() as connection:
        previous_settings = settings_table.get(connection, user["id"])
        models_table.delete_for_user(connection, user["id"])
        for model in refreshed_models:
            models_table.create(connection, user["id"], model)
        if previous_settings:
            def selected_alias(field: str, fallback: str) -> str:
                value = previous_settings[field] or fallback
                match = next((model for model in refreshed_models if value in {model["id"], model["name"], model["alias"]}), None)
                return match["alias"] if match else refreshed_models[0]["alias"]
            settings_table.update_models(connection, user["id"], selected_alias("image_model", "gpt-image-2"), selected_alias("text_model", "gpt-5.6-luna"), selected_alias("chat_model", "gpt-5.6-luna"))
    return {"models": [{"id": model["alias"], "name": model["name"]} for model in refreshed_models]}


@router.post("/api/settings")
def update_settings(body: SettingsInput, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    with transaction() as connection:
        exists = tokens_table.is_available(connection, user["id"], body.token_id)
        if not exists:
            raise HTTPException(400, "请选择可用 Token")
        available_models = models_table.aliases(connection, user["id"])
        if not all(model in available_models for model in (body.image_model, body.text_model, body.chat_model)):
            raise HTTPException(400, "请选择当前账号可用的模型")
        if not body.image_model.startswith("gpt-image-"):
            raise HTTPException(400, "图像生成模型必须是 GPT Image 模型")
        settings_table.save(connection, user["id"], body.token_id, body.image_model, body.text_model, body.chat_model)
    return {"ok": True}
