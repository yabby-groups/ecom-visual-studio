import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists sessions (id text primary key, user_id text not null, expires_at integer not null)")
    connection.execute("create index if not exists sessions_user_id_idx on sessions(user_id)")


def current_user(connection: sqlite3.Connection, session_id: str, now: int):
    return connection.execute("select u.* from sessions s join users u on u.id=s.user_id where s.id=? and s.expires_at>?", (session_id, now)).fetchone()


def create(connection: sqlite3.Connection, session_id: str, user_id: str, expires_at: int) -> None:
    connection.execute("insert into sessions values(?,?,?)", (session_id, user_id, expires_at))


def delete(connection: sqlite3.Connection, session_id: str) -> None:
    connection.execute("delete from sessions where id=?", (session_id,))
