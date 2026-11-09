import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path


class SubmissionConflict(Exception):
    pass


@contextmanager
def connect(path):
    with closing(sqlite3.connect(path)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        yield db


def initialize(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY,
                company_name TEXT NOT NULL,
                company_type TEXT NOT NULL,
                role_title TEXT NOT NULL,
                submitted_on TEXT
            );
            CREATE TABLE IF NOT EXISTS attachments (
                role_id INTEGER NOT NULL REFERENCES roles(id),
                kind TEXT NOT NULL CHECK (kind IN ('cv', 'cover_letter')),
                filename TEXT NOT NULL,
                content BLOB NOT NULL,
                PRIMARY KEY (role_id, kind)
            );
        """)


def get_role(db, role_id):
    row = db.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
    if row is None:
        raise LookupError("Application not found.")
    role = dict(row)
    role["attachments"] = attachment_names(db, role_id)
    return role


def attachment_names(db, role_id):
    rows = db.execute("SELECT kind, filename FROM attachments WHERE role_id = ?", (role_id,))
    return {row["kind"]: row["filename"] for row in rows}


def list_roles(path):
    with connect(path) as db:
        return [
            dict(row, attachments=attachment_names(db, row["id"]))
            for row in db.execute("SELECT * FROM roles ORDER BY id DESC")
        ]


def read_role(path, role_id):
    with connect(path) as db:
        return get_role(db, role_id)


def save_role(path, fields, role_id=None):
    with connect(path) as db:
        if role_id is None:
            role_id = db.execute(
                "INSERT INTO roles (company_name, company_type, role_title) VALUES (?, ?, ?)", fields
            ).lastrowid
        else:
            db.execute(
                "UPDATE roles SET company_name = ?, company_type = ?, role_title = ? WHERE id = ?",
                (*fields, role_id),
            )
        return get_role(db, role_id)


def submit_role(path, role_id, submitted_on):
    with connect(path) as db:
        db.execute(
            "UPDATE roles SET submitted_on = ? WHERE id = ? AND submitted_on IS NULL",
            (submitted_on, role_id),
        )
        role = get_role(db, role_id)
        if role["submitted_on"] != submitted_on:
            raise SubmissionConflict("This application was already submitted on " + role["submitted_on"] + ".")
        return role


def save_attachment(path, role_id, kind, filename, content):
    with connect(path) as db:
        get_role(db, role_id)
        db.execute("""
            INSERT INTO attachments (role_id, kind, filename, content) VALUES (?, ?, ?, ?)
            ON CONFLICT (role_id, kind) DO UPDATE
            SET filename = excluded.filename, content = excluded.content
        """, (role_id, kind, filename, content))
        return get_role(db, role_id)


def read_attachment(path, role_id, kind):
    with connect(path) as db:
        row = db.execute(
            "SELECT filename, content FROM attachments WHERE role_id = ? AND kind = ?",
            (role_id, kind),
        ).fetchone()
        if row is None:
            raise LookupError("Saved file not found.")
        return row["filename"], row["content"]
