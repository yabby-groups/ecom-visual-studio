from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "storage"
UPLOADS = DATA / "uploads"
GENERATED = DATA / "generated"
DB = DATA / "workspace.db"
SESSION_TTL = 60 * 60 * 24 * 14
MAX_UPLOAD = 15 * 1024 * 1024
TARGET_SHORT_EDGE = 1024
MAX_LONG_EDGE = 1536
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def env() -> dict[str, str]:
    values = dict(os.environ)
    env_file = ROOT / ".env"
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in raw and not raw.lstrip().startswith("#"):
                key, value = raw.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip("\"'"))
    return values
