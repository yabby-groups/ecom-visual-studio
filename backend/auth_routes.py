import secrets
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Cookie, HTTPException, Response

from .auth import crypt, current_user, password_hash, user_payload
from .config import SESSION_TTL
from .db import models as models_table, sessions, settings, tokens as tokens_table, users
from .db.core import db, transaction
from .huabot import huabot_login
from .schemas import Credentials

router = APIRouter()


@router.get("/api/auth/me")
def auth_me(session: Optional[str] = Cookie(default=None)) -> dict[str, Any]:
    user = current_user(session)
    return {"user": user_payload(user) if user else None}


@router.post("/api/auth/login")
def login(body: Credentials, response: Response) -> dict[str, Any]:
    try:
        tokens, models, profile = huabot_login(body.name, body.password, body.totp_code)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    try:
        with transaction() as connection:
            user = users.get_by_username(connection, body.name)
            if not user:
                user_id = uuid.uuid4().hex
                users.create(connection, user_id, body.name, password_hash(secrets.token_urlsafe(32)), int(time.time()), profile["nick_name"], profile["avatar_url"])
            else:
                user_id = user["id"]
                users.update_profile(connection, user_id, profile["nick_name"], profile["avatar_url"])
            previous_settings = settings.get(connection, user_id)
            tokens_table.delete_for_user(connection, user_id)
            models_table.delete_for_user(connection, user_id)
            for token in tokens:
                tokens_table.create(connection, user_id, token, crypt(token["key"]))
            for model in models:
                models_table.create(connection, user_id, model)
            active = tokens[0]
            def selected_alias(field: str, fallback: str) -> str:
                value = previous_settings[field] if previous_settings else fallback
                match = next((model for model in models if value in {model["id"], model["name"], model["alias"]}), None)
                return match["alias"] if match else models[0]["alias"]
            settings.save(connection, user_id, active["id"], selected_alias("image_model", "gpt-image-2"), selected_alias("text_model", "gpt-5.6-luna"), selected_alias("chat_model", "gpt-5.6-luna"))
            session_id = uuid.uuid4().hex
            sessions.create(connection, session_id, user_id, int(time.time()) + SESSION_TTL)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    response.set_cookie("session", session_id, max_age=SESSION_TTL, httponly=True, samesite="lax")
    return {"user": user_payload({"id": user_id, "username": body.name, **profile})}


@router.post("/api/auth/logout")
def logout(response: Response, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    if session:
        with transaction() as connection:
            sessions.delete(connection, session)
    response.delete_cookie("session")
    return {"ok": True}
