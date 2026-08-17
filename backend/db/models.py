import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists models (user_id text not null, id text not null, name text not null, alias text, primary key(user_id, id))")
    connection.execute("create index if not exists models_user_id_idx on models(user_id)")
    columns = {row["name"] for row in connection.execute("pragma table_info(models)")}
    if "alias" not in columns:
        connection.execute("alter table models add column alias text")


def delete_for_user(connection: sqlite3.Connection, user_id: str) -> None:
    connection.execute("delete from models where user_id=?", (user_id,))


def create(connection: sqlite3.Connection, user_id: str, model: dict[str, str]) -> None:
    connection.execute("insert into models(user_id,id,name,alias) values(?,?,?,?)", (user_id, model["id"], model["name"], model["alias"]))


def aliases(connection: sqlite3.Connection, user_id: str) -> set[str]:
    return {row["alias"] for row in connection.execute("select alias from models where user_id=? and alias is not null and alias != ''", (user_id,))}
