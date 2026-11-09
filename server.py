import json
import re
import socket
import sqlite3
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

import storage

HOST = "127.0.0.1"
PORT = 8765
WEB = Path(__file__).resolve().parent / "web"
ASSETS = {
    "/": ("index.html", "text/html"),
    "/styles.css": ("styles.css", "text/css"),
    "/app.js": ("app.js", "text/javascript"),
    "/dates.js": ("dates.js", "text/javascript"),
}
ROLE_PATH = re.compile(r"/api/roles/([1-9][0-9]{0,17})")
SUBMIT_PATH = re.compile(ROLE_PATH.pattern + "/submit")
RESULT_PATH = re.compile(ROLE_PATH.pattern + "/result")
ATTACHMENT_PATH = re.compile(ROLE_PATH.pattern + "/attachments/([^/]+)")
ATTACHMENT_LIMIT = 25 * 1024**2
ROLE_FIELDS = ("company_name", "company_type", "role_title")


class RequestTooLarge(Exception):
    pass


def calendar_date(value, label):
    try:
        if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            return date.fromisoformat(value)
    except ValueError:
        pass
    raise ValueError(f"Choose a valid {label}.")


def submission_date(value):
    if calendar_date(value, "application date") > date.today():
        raise ValueError("Choose today or an earlier application date.")
    return value


class Handler(BaseHTTPRequestHandler):
    def send_data(self, status, data, content_type, **headers):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        for key, value in headers.items():
            self.send_header(key.replace("_", "-"), value)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data):
        self.send_data(status, json.dumps(data).encode(), "application/json")

    def dispatch(self):
        authority = f"{HOST}:{self.server.server_port}"
        if self.headers.get_all("Host") != [authority] or (
            self.command != "GET" and self.headers.get_all("Origin") != [f"http://{authority}"]
        ):
            self.send_json(403, {"error": "This app only accepts requests from its local browser page."})
            return
        try:
            self.route(urlsplit(self.path))
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except LookupError as error:
            self.send_json(404, {"error": str(error.args[0])})
        except storage.SubmissionConflict as error:
            self.send_json(409, {"error": str(error)})
        except RequestTooLarge as error:
            self.send_json(413, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(500, {"error": "Could not access the local database. Please try again."})

    def read_body(self, limit):
        lengths = self.headers.get_all("Content-Length") or []
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
            raise ValueError("A valid request length is required.")
        length = int(lengths[0])
        if length > limit:
            raise RequestTooLarge("The request exceeds the size limit.")
        if length == 0:
            raise ValueError("The request is empty.")
        self.connection.settimeout(10)
        try:
            body = self.rfile.read(length)
        except TimeoutError as error:
            raise ValueError("The request did not arrive in full.") from error
        if len(body) != length:
            raise ValueError("The request did not arrive in full.")
        return body

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Expected a JSON request.")
        try:
            data = json.loads(self.read_body(16384))
        except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
            raise ValueError("Invalid JSON.") from error
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object.")
        return data

    def role_fields(self, data):
        values = [data.get(field) for field in ROLE_FIELDS]
        if any(not isinstance(value, str) or not 0 < len(value.strip()) <= 200 for value in values):
            raise ValueError("Enter a company name, company type, and role title (up to 200 characters each).")
        return tuple(value.strip() for value in values)

    def attachment(self, url, role_id, kind):
        content = self.read_body(ATTACHMENT_LIMIT) if self.command == "PUT" else None
        if kind not in {"cv", "cover_letter"}:
            raise LookupError("Document type not found.")
        if self.command == "GET":
            filename, content = storage.read_attachment(self.server.db_path, role_id, kind)
            disposition = "attachment; filename*=UTF-8''" + quote(filename, safe="")
            self.send_data(200, content, "application/octet-stream", Content_Disposition=disposition)
            return
        names = parse_qs(url.query, max_num_fields=4).get("filename", [])
        if len(names) != 1 or not re.fullmatch(r'[^/\\<>:"|?*\x00-\x1f\x7f]{1,255}', names[0]) or names[0] in {".", ".."}:
            raise ValueError("Choose a file with a valid filename.")
        self.send_json(200, storage.save_attachment(self.server.db_path, role_id, kind, names[0], content))

    def save_result(self, role_id):
        data = self.read_json()
        kind = data.get("kind")
        if kind not in ("rejection", "interview"):
            raise ValueError("Choose Rejection or Interview.")
        received = calendar_date(data.get("received_on"), "response date").isoformat()
        interview = None
        final_result = ""
        if kind == "interview":
            interview = calendar_date(data.get("interview_on"), "interview date").isoformat()
            final_result = data.get("final_result", "")
            if not isinstance(final_result, str) or len(final_result) > 1000:
                raise ValueError("Enter a final result of up to 1,000 characters.")
        self.send_json(200, storage.save_result(
            self.server.db_path, role_id, kind, received, interview, final_result.strip()
        ))

    def route(self, url):
        if self.command == "GET" and url.path in ASSETS:
            filename, mime = ASSETS[url.path]
            self.send_data(200, (WEB / filename).read_bytes(), mime + "; charset=utf-8")
        elif self.command == "GET" and url.path == "/api/health":
            self.send_json(200, {"app": "job-hunt"})
        elif url.path == "/api/roles" and self.command == "GET":
            self.send_json(200, storage.list_roles(self.server.db_path))
        elif url.path == "/api/roles" and self.command == "POST":
            data = self.read_json()
            submitted = submission_date(data["submitted_on"]) if "submitted_on" in data else None
            self.send_json(201, storage.save_role(self.server.db_path, self.role_fields(data), submitted_on=submitted))
        elif self.command == "POST" and (match := SUBMIT_PATH.fullmatch(url.path)):
            value = submission_date(self.read_json().get("submitted_on"))
            self.send_json(200, storage.submit_role(self.server.db_path, int(match[1]), value))
        elif self.command == "PUT" and (match := RESULT_PATH.fullmatch(url.path)):
            self.save_result(int(match[1]))
        elif (match := ATTACHMENT_PATH.fullmatch(url.path)) and self.command in {"GET", "PUT"}:
            self.attachment(url, int(match[1]), match[2])
        elif (match := ROLE_PATH.fullmatch(url.path)) and self.command in {"GET", "PATCH", "DELETE"}:
            role_id = int(match[1])
            if self.command == "DELETE":
                storage.delete_role(self.server.db_path, role_id)
                self.send_json(200, {"deleted": role_id})
                return
            if self.command == "GET":
                role = storage.read_role(self.server.db_path, role_id)
            else:
                role = storage.save_role(self.server.db_path, self.role_fields(self.read_json()), role_id)
            self.send_json(200, role)
        else:
            self.send_json(404, {"error": "Page not found."})

    do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = dispatch

    def log_message(self, format, *args):
        pass


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def create_server(db_path: Path, port: int):
    httpd = LocalServer((HOST, port), Handler)
    try:
        storage.initialize(db_path)
    except Exception:
        httpd.server_close()
        raise
    httpd.db_path = db_path
    return httpd
