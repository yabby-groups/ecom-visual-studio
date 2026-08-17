import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists assets (id text primary key, project_id text not null, title text not null, template text not null, ratio text not null, prompt text not null, status text not null, file_path text, generation_started_at integer, created_at integer not null)")
    connection.execute("create index if not exists assets_project_created_idx on assets(project_id, created_at)")
    columns = {row["name"] for row in connection.execute("pragma table_info(assets)")}
    if "generation_started_at" not in columns:
        connection.execute("alter table assets add column generation_started_at integer")


def fail_interrupted(connection: sqlite3.Connection) -> None:
    connection.execute("update assets set status='failed: 服务在生成期间重启，请重新发起任务' where status in ('queued', 'prompting', 'generating')")


def list_for_project(connection: sqlite3.Connection, project_id: str):
    return connection.execute("select * from assets where project_id=? order by created_at", (project_id,)).fetchall()


def delete_for_project(connection: sqlite3.Connection, project_id: str) -> None:
    connection.execute("delete from assets where project_id=?", (project_id,))


def create(connection: sqlite3.Connection, values: tuple[object, ...]) -> None:
    connection.execute("insert into assets (id,project_id,title,template,ratio,prompt,status,file_path,created_at) values(?,?,?,?,?,?,?,?,?)", values)


def get_owned(connection: sqlite3.Connection, asset_id: str, user_id: str):
    return connection.execute("select a.* from assets a join projects p on p.id=a.project_id where a.id=? and p.user_id=?", (asset_id, user_id)).fetchone()


def get_with_project_owned(connection: sqlite3.Connection, asset_id: str, user_id: str):
    return connection.execute("select a.*,p.* from assets a join projects p on p.id=a.project_id where a.id=? and p.user_id=?", (asset_id, user_id)).fetchone()


def get_for_generation(connection: sqlite3.Connection, asset_id: str):
    return connection.execute("select a.*, p.user_id, p.product, p.description, p.benefits, p.color, p.reference from assets a join projects p on p.id=a.project_id where a.id=?", (asset_id,)).fetchone()


def patch(connection: sqlite3.Connection, asset_id: str, fields: dict[str, object]) -> None:
    connection.execute("update assets set " + ",".join(f"{key}=?" for key in fields) + " where id=?", (*fields.values(), asset_id))


def update_prompt(connection: sqlite3.Connection, asset_id: str, prompt: str) -> None:
    connection.execute("update assets set prompt=? where id=?", (prompt, asset_id))


def queue(connection: sqlite3.Connection, asset_id: str, queued_at: int) -> None:
    connection.execute("update assets set status='queued', generation_started_at=? where id=?", (queued_at, asset_id))


def list_not_ready(connection: sqlite3.Connection, project_id: str):
    return connection.execute("select id,ratio from assets where project_id=? and status!='ready'", (project_id,)).fetchall()


def mark_generating(connection: sqlite3.Connection, asset_id: str, started_at: int) -> None:
    connection.execute("update assets set status='generating', generation_started_at=coalesce(generation_started_at, ?) where id=?", (started_at, asset_id))


def mark_ready(connection: sqlite3.Connection, asset_id: str, file_path: str) -> None:
    connection.execute("update assets set status='ready', file_path=? where id=?", (file_path, asset_id))


def mark_failed(connection: sqlite3.Connection, asset_id: str, status: str) -> None:
    connection.execute("update assets set status=? where id=?", (status, asset_id))
