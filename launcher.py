import errno
import http.client
import json
import os
import sqlite3
import sys
import webbrowser
from pathlib import Path

from server import HOST, PORT, create_server


def database_path():
    return Path(os.environ["LOCALAPPDATA"]) / "JobHunt" / "job-hunt.sqlite3"


def existing_instance(port):
    connection = http.client.HTTPConnection(HOST, port, timeout=1)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        return response.status == 200 and json.loads(response.read(256)) == {"app": "job-hunt"}
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def open_browser(url):
    print(f"Job Hunt is available at {url}", flush=True)
    try:
        webbrowser.open(url)
    except webbrowser.Error:
        print("Open the address above in your browser.", file=sys.stderr)


def main():
    url = f"http://{HOST}:{PORT}"
    try:
        path = database_path()
    except KeyError:
        print("Windows did not provide a local app data folder (LOCALAPPDATA).", file=sys.stderr)
        return 1
    try:
        httpd = create_server(path, PORT)
    except OSError as error:
        if error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) in {10013, 10048}:
            if existing_instance(PORT):
                open_browser(url)
                return 0
            print(f"Could not listen on local port {PORT}. Close any program using it and try again.", file=sys.stderr)
        else:
            print(f"Could not start Job Hunt using {path}: {error}", file=sys.stderr)
        return 1
    except sqlite3.Error as error:
        print(f"Could not open the local database at {path}: {error}", file=sys.stderr)
        return 1
    with httpd:
        open_browser(url)
        print("Press Ctrl+C in this window to stop Job Hunt.", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
