import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists tokens (user_id text not null, id text not null, name text not null, secret text not null, masked text, status integer not null default 1, today_cost text, total_cost text, primary key(user_id, id))")
    connection.execute("create index if not exists tokens_user_id_idx on tokens(user_id)")


def delete_for_user(connection: sqlite3.Connection, user_id: str) -> None:
    connection.execute("delete from tokens where user_id=?", (user_id,))


def create(connection: sqlite3.Connection, user_id: str, token: dict[str, object], secret: str) -> None:
    connection.execute("insert into tokens values(?,?,?,?,?,?,?,?)", (user_id, token["id"], token["name"], secret, token["masked"], token["status"], token["today_cost"], token["total_cost"]))


def list_for_user(connection: sqlite3.Connection, user_id: str):
    return connection.execute("select id,name,masked,status,today_cost,total_cost from tokens where user_id=? order by name", (user_id,)).fetchall()


def is_available(connection: sqlite3.Connection, user_id: str, token_id: str):
    return connection.execute("select 1 from tokens where user_id=? and id=? and status=1", (user_id, token_id)).fetchone()
