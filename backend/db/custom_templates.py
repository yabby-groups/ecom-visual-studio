import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists custom_templates (id text primary key, user_id text not null, name text not null, ratio text not null, direction text not null, created_at integer not null)")
    connection.execute("create index if not exists custom_templates_user_created_idx on custom_templates(user_id, created_at desc)")


def list_for_user(connection: sqlite3.Connection, user_id: str):
    return connection.execute("select * from custom_templates where user_id=? order by created_at desc", (user_id,)).fetchall()


def create(connection: sqlite3.Connection, values: tuple[object, ...]) -> None:
    connection.execute("insert into custom_templates values(?,?,?,?,?,?)", values)


def delete_owned(connection: sqlite3.Connection, template_id: str, user_id: str) -> int:
    return connection.execute("delete from custom_templates where id=? and user_id=?", (template_id, user_id)).rowcount
