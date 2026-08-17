import sqlite3
from contextlib import contextmanager
from typing import Iterator

from ..config import DATA, DB, GENERATED, UPLOADS
from . import asset_versions, assets, custom_templates, models, projects, sessions, settings, tokens, users


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma foreign_keys = on")
    connection.execute("pragma busy_timeout = 5000")
    return connection


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    connection = db()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def ensure_storage() -> None:
    DATA.mkdir(exist_ok=True)
    UPLOADS.mkdir(exist_ok=True)
    GENERATED.mkdir(exist_ok=True)


def init_db() -> None:
    ensure_storage()
    with transaction() as connection:
        for table in (users, sessions, settings, tokens, models, projects, assets, asset_versions, custom_templates):
            table.ensure(connection)
        asset_versions.backfill(connection)
        assets.fail_interrupted(connection)
