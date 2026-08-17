import time
import uuid
from typing import Optional

from fastapi import APIRouter, Cookie

from .auth import require_user
from .db import custom_templates
from .db.core import db, transaction
from .schemas import TemplateInput

router = APIRouter()
TEMPLATES = [
    ("hero-image", "商品主图", "商品展示", "1:1", "干净背景、完整展示商品轮廓、视觉焦点明确。"),
    ("lifestyle-scene", "生活场景", "场景展示", "4:5", "将商品置于真实使用环境，体现尺度、氛围和使用价值。"),
    ("detail-macro", "核心细节", "细节展示", "4:5", "特写呈现材质、结构、纹理和标志性细节。"),
    ("poster-banner", "卖点海报", "营销展示", "4:5", "突出商品，留出信息排版空间，适用于促销和传播。"),
]


def template_list(user_id: str) -> list[dict[str, object]]:
    connection = db()
    customs = custom_templates.list_for_user(connection, user_id)
    connection.close()
    return [dict(id=i, name=n, group=g, ratio=r, direction=d, custom=False) for i, n, g, r, d in TEMPLATES] + [dict(id=row["id"], name=row["name"], group="自定义", ratio=row["ratio"], direction=row["direction"], custom=True) for row in customs]


@router.get("/api/templates")
def templates(session: Optional[str] = Cookie(default=None)) -> list[dict[str, object]]:
    return template_list(require_user(session)["id"])


@router.post("/api/templates")
def add_template(body: TemplateInput, session: Optional[str] = Cookie(default=None)) -> dict[str, str]:
    user = require_user(session)
    template_id = uuid.uuid4().hex
    with transaction() as connection:
        custom_templates.create(connection, (template_id, user["id"], body.name, body.ratio, body.direction, int(time.time())))
    return {"id": template_id}


@router.delete("/api/templates/{template_id}")
def delete_template(template_id: str, session: Optional[str] = Cookie(default=None)) -> dict[str, bool]:
    user = require_user(session)
    with transaction() as connection:
        deleted = custom_templates.delete_owned(connection, template_id, user["id"])
    return {"ok": bool(deleted)}
