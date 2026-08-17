import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists projects (id text primary key, user_id text not null, name text not null, product text not null, description text, benefits text, color text, reference text, created_at integer not null)")
    connection.execute("create index if not exists projects_user_created_idx on projects(user_id, created_at desc)")


def list_for_user(connection: sqlite3.Connection, user_id: str):
    return connection.execute("select p.*, count(a.id) as asset_count from projects p left join assets a on a.project_id=p.id where p.user_id=? group by p.id order by p.created_at desc", (user_id,)).fetchall()


def get_owned(connection: sqlite3.Connection, project_id: str, user_id: str):
    return connection.execute("select * from projects where id=? and user_id=?", (project_id, user_id)).fetchone()


def create(connection: sqlite3.Connection, values: tuple[object, ...]) -> None:
    connection.execute("insert into projects values(?,?,?,?,?,?,?,?,?)", values)


def delete_owned(connection: sqlite3.Connection, project_id: str, user_id: str) -> None:
    connection.execute("delete from projects where id=? and user_id=?", (project_id, user_id))
