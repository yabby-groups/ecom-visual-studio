import json
from typing import Any, Optional

import httpx
from .auth import decrypt
from .config import env
from .db import settings
from .db.core import db


def parse_huabot_models(raw_models: dict[str, Any]) -> list[dict[str, str]]:
    items = raw_models.get("models") or raw_models.get("data") or []
    return [{"id": str(item.get("id") or item.get("uuid") or item["alias"]), "name": str(item.get("title") or item["alias"]), "alias": str(item["alias"])} for item in items if isinstance(item, dict) and item.get("alias")]


def huabot_models() -> list[dict[str, str]]:
    web_base = env().get("HUABOT_WEB_BASE_URL", "https://www.huabot.com").rstrip("/")
    try:
        response = httpx.get(f"{web_base}/api/token_base/model/list/?size=500&offset=0&enabled=1", timeout=30)
        response.raise_for_status()
        models = parse_huabot_models(response.json())
    except (httpx.HTTPError, json.JSONDecodeError) as error:
        raise ValueError(f"无法读取 huabot 模型列表：{error}") from error
    if not models:
        raise ValueError("huabot 没有返回可用模型")
    return models


def huabot_login(name: str, password: str, totp_code: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, str]]:
    values = env()
    base = (values.get("HUABOT_BASE_URL") or values.get("IMG_BASE_URL") or "https://huabot.com").removesuffix("/v1").rstrip("/")

    def call(path: str, data: Optional[dict[str, str]] = None, bearer: str = "", form: bool = False) -> dict[str, Any]:
        headers = {}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        try:
            kwargs: dict[str, Any] = {"headers": headers, "timeout": 30}
            if data:
                kwargs["data" if form else "json"] = data
            response = httpx.request("POST" if data else "GET", base + path, **kwargs)
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as error:
            try:
                error_result = error.response.json()
            except (UnicodeDecodeError, json.JSONDecodeError):
                error_result = None
            if isinstance(error_result, dict):
                message = error_result.get("err") or error_result.get("detail") or error_result.get("error")
                if message:
                    raise ValueError(str(message)) from error
            raise ValueError(f"huabot 登录失败：HTTP {error.response.status_code}") from error
        except (httpx.RequestError, json.JSONDecodeError) as error:
            raise ValueError(f"无法连接 huabot：{error}") from error
        if not isinstance(result, dict) or result.get("err"):
            raise ValueError(str(result.get("err", "huabot 返回异常")))
        return result

    signin = {"name": name, "passwd": password}
    if totp_code:
        signin["totp_code"] = totp_code
    signin_result = call("/api/signin/", signin, form=True)
    bearer = signin_result.get("token")
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
    models = huabot_models()
    if not tokens or not models:
        raise ValueError("huabot 没有返回可用 Token 或模型")
    account = signin_result.get("user") if isinstance(signin_result.get("user"), dict) else signin_result
    profile = account.get("profile") if isinstance(account.get("profile"), dict) else {}
    return tokens, models, {"nick_name": str(profile.get("nick_name") or ""), "avatar_url": str(profile.get("avatar_url") or "")}


def user_config(user_id: str) -> dict[str, str]:
    connection = db()
    row = settings.get_with_secret(connection, user_id)
    connection.close()
    if not row or not row["secret"]:
        raise ValueError("请先在设置中选择 huabot Token")
    values = env()
    return {"base": (values.get("HUABOT_BASE_URL") or values.get("IMG_BASE_URL") or "").rstrip("/"), "key": decrypt(row["secret"]), "image_model": row["image_model"] or "gpt-image-2", "text_model": row["text_model"] or "gpt-5.6-luna", "chat_model": row["chat_model"] or "gpt-5.6-luna"}
