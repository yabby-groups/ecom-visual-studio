import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists users (id text primary key, username text unique not null, password_hash text not null, created_at integer not null, nick_name text, avatar_url text)")
    columns = {row["name"] for row in connection.execute("pragma table_info(users)")}
    if "nick_name" not in columns:
        connection.execute("alter table users add column nick_name text")
    if "avatar_url" not in columns:
        connection.execute("alter table users add column avatar_url text")
        if "avatar" in columns:
            connection.execute("update users set avatar_url=avatar where avatar_url is null")


def get_by_username(connection: sqlite3.Connection, username: str):
    return connection.execute("select * from users where username=?", (username,)).fetchone()


def create(connection: sqlite3.Connection, user_id: str, username: str, password_hash: str, created_at: int, nick_name: str, avatar_url: str) -> None:
    connection.execute("insert into users(id,username,password_hash,created_at,nick_name,avatar_url) values(?,?,?,?,?,?)", (user_id, username, password_hash, created_at, nick_name, avatar_url))


def update_profile(connection: sqlite3.Connection, user_id: str, nick_name: str, avatar_url: str) -> None:
    connection.execute("update users set nick_name=?, avatar_url=? where id=?", (nick_name, avatar_url, user_id))
