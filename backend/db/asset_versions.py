import sqlite3
import time
import uuid

from ..config import DATA, GENERATED


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists asset_versions (id text primary key, asset_id text not null, file_path text not null, created_at integer not null, unique(asset_id, file_path))")
    connection.execute("create index if not exists asset_versions_asset_created_idx on asset_versions(asset_id, created_at desc)")


def list_for_asset(connection: sqlite3.Connection, asset_id: str):
    return connection.execute("select * from asset_versions where asset_id=? order by created_at desc", (asset_id,)).fetchall()


def delete_for_project(connection: sqlite3.Connection, project_id: str) -> None:
    connection.execute("delete from asset_versions where asset_id in (select id from assets where project_id=?)", (project_id,))


def create(connection: sqlite3.Connection, asset_id: str, file_path: str, created_at: int) -> None:
    connection.execute("insert into asset_versions values(?,?,?,?)", (uuid.uuid4().hex, asset_id, file_path, created_at))


def latest_for_user(connection: sqlite3.Connection, user_id: str):
    return connection.execute("select av.file_path, av.created_at, a.title, p.id as project_id from asset_versions av join assets a on a.id=av.asset_id join projects p on p.id=a.project_id where p.user_id=? order by av.created_at desc, av.id desc limit 1", (user_id,)).fetchone()


def backfill(connection: sqlite3.Connection) -> None:
    for asset in connection.execute("select id, project_id, file_path, created_at from assets"):
        if asset["file_path"]:
            connection.execute("insert or ignore into asset_versions values(?,?,?,?)", (uuid.uuid4().hex, asset["id"], asset["file_path"], asset["created_at"]))
        directory = GENERATED / asset["project_id"]
        if directory.exists():
            for image in directory.glob(f"{asset['id']}-*.png"):
                connection.execute("insert or ignore into asset_versions values(?,?,?,?)", (uuid.uuid4().hex, asset["id"], str(image.relative_to(DATA)), int(image.stat().st_mtime)))
