import sqlite3


def ensure(connection: sqlite3.Connection) -> None:
    connection.execute("create table if not exists settings (user_id text primary key, token_id text, image_model text, text_model text, chat_model text)")


def get(connection: sqlite3.Connection, user_id: str):
    return connection.execute("select * from settings where user_id=?", (user_id,)).fetchone()


def get_with_secret(connection: sqlite3.Connection, user_id: str):
    return connection.execute("select s.*, t.secret from settings s left join tokens t on t.user_id=s.user_id and t.id=s.token_id where s.user_id=?", (user_id,)).fetchone()


def save(connection: sqlite3.Connection, user_id: str, token_id: str, image_model: str, text_model: str, chat_model: str) -> None:
    connection.execute("insert into settings values(?,?,?,?,?) on conflict(user_id) do update set token_id=excluded.token_id,image_model=excluded.image_model,text_model=excluded.text_model,chat_model=excluded.chat_model", (user_id, token_id, image_model, text_model, chat_model))


def update_models(connection: sqlite3.Connection, user_id: str, image_model: str, text_model: str, chat_model: str) -> None:
    connection.execute("update settings set image_model=?,text_model=?,chat_model=? where user_id=?", (image_model, text_model, chat_model, user_id))
