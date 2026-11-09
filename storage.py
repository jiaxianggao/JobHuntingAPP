import sqlite3
from contextlib import closing, contextmanager
from datetime import date
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
            CREATE TABLE IF NOT EXISTS results (
                role_id INTEGER PRIMARY KEY REFERENCES roles(id),
                kind TEXT NOT NULL CHECK (kind IN ('rejection', 'interview')),
                received_on TEXT NOT NULL,
                interview_on TEXT,
                final_result TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS role_ids (last_id INTEGER NOT NULL);
            INSERT INTO role_ids (last_id)
                SELECT COALESCE(MAX(id), 0) FROM roles
                HAVING NOT EXISTS (SELECT 1 FROM role_ids);
        """)


def get_role(db, role_id):
    row = db.execute("SELECT * FROM roles WHERE id = ?", (role_id,)).fetchone()
    if row is None:
        raise LookupError("Application not found.")
    return role_details(db, row)


def role_details(db, row):
    role = dict(row)
    role["attachments"] = attachment_names(db, role["id"])
    result = db.execute(
        "SELECT kind, received_on, interview_on, final_result FROM results WHERE role_id = ?",
        (role["id"],),
    ).fetchone()
    submitted = date.fromisoformat(role["submitted_on"]) if role["submitted_on"] else None
    days = (date.today() - submitted).days if submitted else None
    role["days_since_submission"] = max(0, days) if days is not None else None
    role["days_to_response"] = (date.fromisoformat(result["received_on"]) - submitted).days if result and submitted else None
    role["result"] = dict(result) if result else None
    role["result_status"] = result["kind"] if result else (
        None if days is None else "no_response" if days >= 28 else "awaiting"
    )
    return role


def attachment_names(db, role_id):
    rows = db.execute("SELECT kind, filename FROM attachments WHERE role_id = ?", (role_id,))
    return {row["kind"]: row["filename"] for row in rows}


def list_roles(path):
    with connect(path) as db:
        return [
            role_details(db, row)
            for row in db.execute("SELECT * FROM roles ORDER BY id DESC")
        ]


def read_role(path, role_id):
    with connect(path) as db:
        return get_role(db, role_id)


def save_role(path, fields, role_id=None, *, submitted_on=None):
    with connect(path) as db:
        if role_id is None:
            db.execute("UPDATE role_ids SET last_id = last_id + 1")
            role_id = db.execute("SELECT last_id FROM role_ids").fetchone()[0]
            db.execute(
                "INSERT INTO roles (id, company_name, company_type, role_title, submitted_on) VALUES (?, ?, ?, ?, ?)",
                (role_id, *fields, submitted_on),
            )
        else:
            db.execute(
                "UPDATE roles SET company_name = ?, company_type = ?, role_title = ? WHERE id = ?",
                (*fields, role_id),
            )
        return get_role(db, role_id)


def delete_role(path, role_id):
    with connect(path) as db:
        db.execute("DELETE FROM attachments WHERE role_id = ?", (role_id,))
        db.execute("DELETE FROM results WHERE role_id = ?", (role_id,))
        deleted = db.execute("DELETE FROM roles WHERE id = ?", (role_id,))
        if not deleted.rowcount:
            raise LookupError("Application not found.")


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


def save_result(path, role_id, kind, received_on, interview_on, final_result):
    with connect(path) as db:
        submitted = get_role(db, role_id)["submitted_on"]
        if submitted is None:
            raise ValueError("Submit the application before recording a result.")
        if not submitted <= received_on <= date.today().isoformat():
            raise ValueError("The response date must be between the submission date and today.")
        if interview_on and interview_on < received_on:
            raise ValueError("The interview date must be on or after the invitation date.")
        db.execute("""
            INSERT INTO results (role_id, kind, received_on, interview_on, final_result)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (role_id) DO UPDATE SET kind = excluded.kind,
                received_on = excluded.received_on, interview_on = excluded.interview_on,
                final_result = excluded.final_result
        """, (role_id, kind, received_on, interview_on, final_result))
        return get_role(db, role_id)
