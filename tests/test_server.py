import http.client
import json
import socket
import tempfile
import threading
import unittest
from datetime import date, timedelta
from pathlib import Path

import server
import storage


class ServerTests(unittest.TestCase):
    role_fields = {"company_name": "Northstar", "company_type": "Technology", "role_title": "Analyst"}

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.db = Path(folder.name) / "test.sqlite3"
        self.server = server.create_server(self.db, 0)
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, args=(0.01,))
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        self.port = self.server.server_port
        self.origin = f"http://127.0.0.1:{self.port}"

    def request(self, method, path, payload=None, headers=None):
        headers = dict(headers or {})
        if method != "GET":
            headers.setdefault("Origin", self.origin)
        if isinstance(payload, dict):
            payload = json.dumps(payload)
            headers.setdefault("Content-Type", "application/json")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, payload, headers)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_home_opens_calendar(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b'id="calendar-page"', body)
        self.assertIn(b'id="board-page" hidden', body)
        self.assertEqual(json.loads(self.request("GET", "/api/health")[1]), {"app": "job-hunt"})

    def test_database_reopens(self):
        with storage.connect(self.db) as db:
            db.execute("CREATE TABLE marker (value TEXT)")
            db.execute("INSERT INTO marker VALUES ('saved')")
        storage.initialize(self.db)
        with storage.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT value FROM marker").fetchone()[0], "saved")

    def test_untrusted_host_and_origin_rejected(self):
        self.assertEqual(self.request("GET", "/", headers={"Host": "other.test"})[0], 403)
        for origin in ("https://other.test", "null", ""):
            with self.subTest(origin=origin):
                result = self.request("POST", "/api/roles", headers={"Origin": origin})
                self.assertEqual(result[0], 403)

    def create_role(self):
        status, body = self.request("POST", "/api/roles", self.role_fields)
        self.assertEqual(status, 201)
        return json.loads(body)

    def test_create_and_edit_role(self):
        role = self.create_role()
        self.assertIsNone(role["submitted_on"])
        path = f"/api/roles/{role['id']}"
        self.assertEqual(self.request("PATCH", path, self.role_fields | {"role_title": "New title"})[0], 200)
        storage.initialize(self.db)
        self.assertEqual(json.loads(self.request("GET", path)[1])["role_title"], "New title")
        self.assertEqual(len(json.loads(self.request("GET", "/api/roles")[1])), 1)

    def test_delete_application_removes_documents_and_result(self):
        other = self.create_role()
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        today = date.today().isoformat()
        self.assertEqual(self.request("POST", path + "/submit", {"submitted_on": today})[0], 200)
        self.assertEqual(self.request("PUT", path + "/result", {"kind": "rejection", "received_on": today})[0], 200)
        self.assertEqual(self.request("PUT", path + "/attachments/cv?filename=CV.pdf", b"sample")[0], 200)
        self.assertEqual(self.request("DELETE", path, headers={"Origin": "https://other.test"})[0], 403)
        self.assertEqual(self.request("DELETE", path)[0], 200)
        self.assertEqual(self.request("GET", path)[0], 404)
        self.assertEqual(self.request("GET", path + "/attachments/cv")[0], 404)
        self.assertEqual(json.loads(self.request("GET", "/api/roles")[1]), [other])
        with storage.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM results").fetchone()[0], 0)
        storage.initialize(self.db)
        self.assertGreater(self.create_role()["id"], role["id"])

    def test_blank_fields_leave_record_unchanged(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        self.assertEqual(self.request("PATCH", path, self.role_fields | {"role_title": " "})[0], 400)
        self.assertEqual(json.loads(self.request("GET", path)[1]), role)

    def test_create_role_already_submitted_on_calendar_date(self):
        submitted = (date.today() - timedelta(days=2)).isoformat()
        status, body = self.request("POST", "/api/roles", self.role_fields | {"submitted_on": submitted})
        self.assertEqual(status, 201)
        role = json.loads(body)
        self.assertEqual(role["submitted_on"], submitted)
        self.assertEqual(role["days_since_submission"], 2)
        self.assertEqual(self.request("POST", "/api/roles", self.role_fields | {"submitted_on": "2026-02-30"})[0], 400)
        self.assertEqual(len(json.loads(self.request("GET", "/api/roles")[1])), 1)

    def test_submit_with_valid_date(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        status, body = self.request("POST", path + "/submit", {"submitted_on": "2026-01-04"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["submitted_on"], "2026-01-04")
        self.assertEqual(self.request("GET", path)[1], body)

    def test_results_age_and_late_response(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        submitted = (date.today() - timedelta(days=28)).isoformat()
        self.assertEqual(self.request("POST", path + "/submit", {"submitted_on": submitted})[0], 200)
        saved = json.loads(self.request("GET", path)[1])
        self.assertEqual((saved["days_since_submission"], saved["result_status"]), (28, "no_response"))
        received = date.today().isoformat()
        result = {"kind": "interview", "received_on": received, "interview_on": received, "final_result": "Offer"}
        self.assertEqual(self.request("PUT", path + "/result", result)[0], 200)
        storage.initialize(self.db)
        saved = json.loads(self.request("GET", path)[1])
        self.assertEqual(saved["result_status"], "interview")
        self.assertEqual(saved["result"], result)
        self.assertEqual(saved["days_to_response"], 28)

    def test_response_time_stops_on_received_date(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        submitted = (date.today() - timedelta(days=14)).isoformat()
        received = (date.today() - timedelta(days=7)).isoformat()
        self.assertEqual(self.request("POST", path + "/submit", {"submitted_on": submitted})[0], 200)
        status, body = self.request("PUT", path + "/result", {"kind": "rejection", "received_on": received})
        self.assertEqual(status, 200)
        saved = json.loads(body)
        self.assertEqual(saved["days_to_response"], 7)
        self.assertEqual(saved["days_since_submission"], 14)

    def test_existing_database_keeps_legacy_company_type(self):
        role = self.create_role()
        with storage.connect(self.db) as db:
            db.execute("DROP TABLE results")
        storage.initialize(self.db)
        path = f"/api/roles/{role['id']}"
        self.assertEqual(json.loads(self.request("GET", path)[1])["company_type"], "Technology")
        status, body = self.request("PATCH", path, self.role_fields | {"role_title": "Updated role"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["company_type"], "Technology")

    def test_result_requires_submission_and_valid_dates(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        today = date.today().isoformat()
        result = {"kind": "rejection", "received_on": today}
        self.assertEqual(self.request("PUT", path + "/result", result)[0], 400)
        status, body = self.request("POST", path + "/submit", {"submitted_on": today})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["days_since_submission"], 0)
        self.assertEqual(json.loads(body)["result_status"], "awaiting")
        self.assertEqual(self.request("PUT", path + "/result", result | {"received_on": "2020-01-01"})[0], 400)
        self.assertEqual(self.request("PUT", path + "/result", result)[0], 200)
        self.assertEqual(json.loads(self.request("GET", path)[1])["result_status"], "rejection")

    def test_invalid_or_future_date_preserves_draft(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        for value in ("2026-02-30", "20260101", (date.today() + timedelta(days=1)).isoformat()):
            self.assertEqual(self.request("POST", path + "/submit", {"submitted_on": value})[0], 400)
        self.assertEqual(json.loads(self.request("GET", path)[1]), role)

    def test_repeat_submission_preserves_first_date(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}/submit"
        original = {"submitted_on": "2026-01-04"}
        saved = self.request("POST", path, original)
        self.assertEqual(saved[0], 200)
        self.assertEqual(self.request("POST", path, original), saved)
        self.assertEqual(self.request("POST", path, {"submitted_on": "2026-01-05"})[0], 409)
        self.assertEqual(self.request("GET", path.removesuffix("/submit"))[1], saved[1])

    def test_same_filename_stays_separate_by_role(self):
        for index in (1, 2):
            role = self.create_role()
            path = f"/api/roles/{role['id']}/attachments/cv"
            self.assertEqual(self.request("PUT", path + "?filename=CV.pdf", bytes([index]))[0], 200)
        for index in (1, 2):
            self.assertEqual(self.request("GET", f"/api/roles/{index}/attachments/cv"), (200, bytes([index])))

    def test_attachments_survive_reopen(self):
        role = self.create_role()
        path = f"/api/roles/{role['id']}"
        for kind in ("cv", "cover_letter"):
            self.assertEqual(self.request("PUT", f"{path}/attachments/{kind}?filename=R%C3%A9sum%C3%A9.pdf", kind.encode())[0], 200)
        storage.initialize(self.db)
        saved = json.loads(self.request("GET", path)[1])
        for kind in ("cv", "cover_letter"):
            self.assertEqual(saved["attachments"][kind], "Résumé.pdf")
            self.assertEqual(self.request("GET", f"{path}/attachments/{kind}"), (200, kind.encode()))

    def test_rejected_upload_preserves_existing_copy(self):
        role = self.create_role()
        base = f"/api/roles/{role['id']}/attachments/"
        path = base + "cv?filename=CV.pdf"
        self.assertEqual(self.request("PUT", path, b"saved")[0], 200)
        self.assertEqual(self.request("PUT", path, headers={"Content-Length": str(25 * 1024**2 + 1)})[0], 413)
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as connection:
            connection.sendall(
                f"PUT {path} HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                f"Origin: {self.origin}\r\nContent-Length: 5\r\n\r\nx".encode()
            )
            connection.shutdown(socket.SHUT_WR)
            response = http.client.HTTPResponse(connection)
            response.begin()
            self.assertEqual(response.status, 400)
            response.close()
        self.assertEqual(self.request("PUT", base + "other?filename=CV.pdf", b"x")[0], 404)
        self.assertEqual(self.request("GET", base + "cv"), (200, b"saved"))
