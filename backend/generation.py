import base64
import struct
import time
import uuid

from openai import OpenAI
from .config import DATA, GENERATED, PNG_SIGNATURE
from .db import asset_versions, assets
from .db.core import db
from .huabot import user_config


IMAGE_SIZE_BY_RATIO = {
    "1:1": (1024, 1024),
    "3:2": (1536, 1024),
    "2:3": (1024, 1536),
    "16:9": (1536, 864),
}


def image_size_for_ratio(ratio: str) -> tuple[int, int]:
    try:
        return IMAGE_SIZE_BY_RATIO[ratio]
    except KeyError as error:
        supported = "、".join(IMAGE_SIZE_BY_RATIO)
        raise ValueError(f"图像服务仅支持画面比例: {supported}") from error


def png_dimensions(image_bytes: bytes) -> tuple[int, int]:
    if image_bytes[:8] != PNG_SIGNATURE or image_bytes[12:16] != b"IHDR":
        raise ValueError("图像服务没有返回 PNG 图片")
    width, height = struct.unpack(">II", image_bytes[16:24])
    if width < 1 or height < 1:
        raise ValueError("图像服务返回的 PNG 尺寸无效")
    return width, height


def generate_asset(asset_id: str) -> None:
    connection = db()
    asset = assets.get_for_generation(connection, asset_id)
    if not asset:
        connection.close()
        return
    assets.mark_generating(connection, asset_id, int(time.time()))
    connection.commit()
    try:
        config = user_config(asset["user_id"])
        if not config["base"]:
            raise ValueError("请设置 HUABOT_BASE_URL 或 IMG_BASE_URL")
        if not config["image_model"].startswith("gpt-image-"):
            raise ValueError("图像生成模型必须是 GPT Image 模型")
        expected_width, expected_height = image_size_for_ratio(asset["ratio"])
        client = OpenAI(base_url=config["base"], api_key=config["key"], timeout=300)
        result = client.images.generate(
            model=config["image_model"],
            prompt=asset["prompt"],
            size=f"{expected_width}x{expected_height}",
            n=1,
        )
        image = result.data[0] if result.data else None
        if not image or not image.b64_json:
            raise ValueError("图像服务没有返回图片")
        image_bytes = base64.b64decode(image.b64_json, validate=True)
        actual_width, actual_height = png_dimensions(image_bytes)
        if actual_width * expected_height != actual_height * expected_width:
            raise ValueError(f"图像服务返回比例 {actual_width}:{actual_height}，但请求的是 {asset['ratio']}")
        target_dir = GENERATED / asset["project_id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{asset_id}-{uuid.uuid4().hex[:8]}.png"
        target.write_bytes(image_bytes)
        file_path = str(target.relative_to(DATA))
        asset_versions.create(connection, asset_id, file_path, int(time.time()))
        assets.mark_ready(connection, asset_id, file_path)
    except Exception as error:
        assets.mark_failed(connection, asset_id, f"failed: {str(error)[:180]}")
    finally:
        connection.commit()
        connection.close()
