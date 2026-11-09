import io
import os
import tempfile
import threading
import unittest
from contextlib import chdir, redirect_stderr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import launcher


class ForeignHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"app":"other"}')

    def log_message(self, format, *args):
        pass


class LauncherTests(unittest.TestCase):
    def test_data_path_independent_of_working_directory(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"LOCALAPPDATA": folder}):
            expected = Path(folder) / "JobHunt" / "job-hunt.sqlite3"
            self.assertEqual(launcher.database_path(), expected)
            with chdir(folder):
                self.assertEqual(launcher.database_path(), expected)

    def test_foreign_service_on_port_reports_conflict(self):
        with tempfile.TemporaryDirectory() as folder, ThreadingHTTPServer(("127.0.0.1", 0), ForeignHandler) as foreign:
            worker = threading.Thread(target=foreign.serve_forever)
            worker.start()
            try:
                error = io.StringIO()
                with patch.object(launcher, "PORT", foreign.server_port), patch.dict(os.environ, {"LOCALAPPDATA": folder}), patch.object(launcher.webbrowser, "open") as open_browser, redirect_stderr(error):
                    self.assertEqual(launcher.main(), 1)
                    open_browser.assert_not_called()
                self.assertIn(str(foreign.server_port), error.getvalue())
            finally:
                foreign.shutdown()
                worker.join()
