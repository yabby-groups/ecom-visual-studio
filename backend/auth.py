import base64
import hashlib
import hmac
import os
import time
from typing import Any, Optional

from fastapi import HTTPException

from .config import SESSION_TTL, env
from .db import sessions
from .db.core import db


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
    row = sessions.current_user(connection, session_id, int(time.time()))
    connection.close()
    return dict(row) if row else None


def require_user(session_id: Optional[str]) -> dict[str, Any]:
    user = current_user(session_id)
    if not user:
        raise HTTPException(401, "登录状态已失效")
    return user


def user_payload(user: dict[str, Any]) -> dict[str, Any]:
    nick_name = str(user.get("nick_name") or user["username"])
    return {"id": user["id"], "username": user["username"], "profile": {"nick_name": nick_name, "avatar_url": str(user.get("avatar_url") or "")}}
