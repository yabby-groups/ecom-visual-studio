import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists try_on_jobs (id text primary key, user_id text not null, person_path text not null, garment_path text not null, person_paths text, garment_paths text, generation_mode text not null default 'combined', instructions text not null default '', ratio text not null, status text not null, file_path text, generation_started_at integer, created_at integer not null)")
    columns = {row["name"] for row in connection.execute("pragma table_info(try_on_jobs)")}
    if "person_paths" not in columns:
        connection.execute("alter table try_on_jobs add column person_paths text")
    if "garment_paths" not in columns:
        connection.execute("alter table try_on_jobs add column garment_paths text")
    if "generation_mode" not in columns:
        connection.execute("alter table try_on_jobs add column generation_mode text not null default 'combined'")
    connection.execute("create index if not exists try_on_jobs_user_created_idx on try_on_jobs(user_id, created_at desc)")


def create(connection: sqlite3.Connection, values: tuple[object, ...]) -> None:
    connection.execute("insert into try_on_jobs (id,user_id,person_path,garment_path,person_paths,garment_paths,generation_mode,instructions,ratio,status,file_path,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)", values)


def list_for_user(connection: sqlite3.Connection, user_id: str, limit: int, offset: int):
    return connection.execute("select * from try_on_jobs where user_id=? order by created_at desc, id desc limit ? offset ?", (user_id, limit, offset)).fetchall()


def count_for_user(connection: sqlite3.Connection, user_id: str) -> int:
    return int(connection.execute("select count(*) from try_on_jobs where user_id=?", (user_id,)).fetchone()[0])


def get_owned(connection: sqlite3.Connection, job_id: str, user_id: str):
    return connection.execute("select * from try_on_jobs where id=? and user_id=?", (job_id, user_id)).fetchone()


def get_for_generation(connection: sqlite3.Connection, job_id: str):
    return connection.execute("select * from try_on_jobs where id=?", (job_id,)).fetchone()


def delete_owned(connection: sqlite3.Connection, job_id: str, user_id: str) -> int:
    return connection.execute("delete from try_on_jobs where id=? and user_id=?", (job_id, user_id)).rowcount


def queue(connection: sqlite3.Connection, job_id: str, queued_at: int) -> None:
    connection.execute("update try_on_jobs set status='queued', generation_started_at=? where id=?", (queued_at, job_id))


def mark_generating(connection: sqlite3.Connection, job_id: str, started_at: int) -> None:
    connection.execute("update try_on_jobs set status='generating', generation_started_at=coalesce(generation_started_at, ?) where id=?", (started_at, job_id))


def mark_ready(connection: sqlite3.Connection, job_id: str, file_path: str) -> None:
    connection.execute("update try_on_jobs set status='ready', file_path=? where id=?", (file_path, job_id))


def mark_failed(connection: sqlite3.Connection, job_id: str, status: str) -> None:
    connection.execute("update try_on_jobs set status=? where id=?", (status, job_id))


def fail_interrupted(connection: sqlite3.Connection) -> None:
    connection.execute("update try_on_jobs set status='failed: 服务在生成期间重启，请重新发起任务' where status in ('queued', 'generating')")
