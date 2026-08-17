import sqlite3
import uuid

from ..config import DATA, GENERATED


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute(
        "create table if not exists try_on_versions (id text primary key, job_id text not null, file_path text not null, created_at integer not null, unique(job_id, file_path))"
    )
    connection.execute(
        "create index if not exists try_on_versions_job_created_idx on try_on_versions(job_id, created_at desc)"
    )


def list_for_job(connection: sqlite3.Connection, job_id: str):
    return connection.execute(
        "select * from try_on_versions where job_id=? order by created_at desc, id desc",
        (job_id,),
    ).fetchall()


def create(connection: sqlite3.Connection, job_id: str, file_path: str, created_at: int) -> None:
    connection.execute(
        "insert or ignore into try_on_versions values(?,?,?,?)",
        (uuid.uuid4().hex, job_id, file_path, created_at),
    )


def delete_for_job(connection: sqlite3.Connection, job_id: str) -> None:
    connection.execute("delete from try_on_versions where job_id=?", (job_id,))


def backfill(connection: sqlite3.Connection) -> None:
    for job in connection.execute("select id, user_id, file_path, created_at from try_on_jobs"):
        if job["file_path"]:
            create(connection, job["id"], job["file_path"], job["created_at"])
        directory = GENERATED / "try-on" / job["user_id"]
        if directory.exists():
            for image in directory.glob(f"{job['id']}-*.png"):
                create(
                    connection,
                    job["id"],
                    str(image.relative_to(DATA)),
                    int(image.stat().st_mtime),
                )
