import base64
import json
import struct
import time
import uuid
from urllib.request import Request, urlopen

from .config import DATA, GENERATED, MAX_LONG_EDGE, PNG_SIGNATURE, TARGET_SHORT_EDGE
from .db import asset_versions, assets
from .db.core import db
from .huabot import user_config


def image_size_for_ratio(ratio: str) -> tuple[int, int]:
    try:
        width_text, height_text = ratio.split(":", 1)
        ratio_width, ratio_height = int(width_text), int(height_text)
    except ValueError as error:
        raise ValueError(f"不支持的画面比例: {ratio}") from error
    if ratio_width < 1 or ratio_height < 1:
        raise ValueError(f"不支持的画面比例: {ratio}")
    scale = min(TARGET_SHORT_EDGE // min(ratio_width, ratio_height), MAX_LONG_EDGE // max(ratio_width, ratio_height))
    if scale < 1:
        raise ValueError(f"不支持的画面比例: {ratio}")
    return ratio_width * scale, ratio_height * scale


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
        payload = json.dumps({"model": config["image_model"], "prompt": asset["prompt"], "size": f"{expected_width}x{expected_height}", "n": 1}).encode()
        request = Request(f"{config['base']}/images/generations", data=payload, headers={"Authorization": f"Bearer {config['key']}", "Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=300) as response:
            result = json.loads(response.read().decode())
        image = (result.get("data") or [{}])[0]
        if image.get("b64_json"):
            image_bytes = base64.b64decode(image["b64_json"], validate=True)
        elif image.get("url"):
            with urlopen(Request(image["url"], headers={"User-Agent": "EcomVisualStudio/1.0"}), timeout=300) as response:
                image_bytes = response.read()
        else:
            raise ValueError("图像服务没有返回图片")
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
