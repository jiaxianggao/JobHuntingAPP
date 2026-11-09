# Job Hunt

Job Hunt is a personal, offline Windows app for tracking job applications and keeping the documents used for each role.

## Start on Windows

1. Have Python 3.11 or newer installed. The launcher checks for Python 3.12 first and also supports Python on PATH or Python 3.11 via the Windows launcher. The app has no packages to install.
2. Double-click **start-job-hunt.cmd**. Keep its window open while using the app.
3. If the browser does not open automatically, enter `http://127.0.0.1:8765` in your desktop browser.

Use **Job Applications → Add role** to create a card. Open the card to attach a CV and cover letter. Each file can be up to 25 MiB. Use **Mark submitted** to select **Today** or pick a past date. After confirmation, the card moves to **Submitted** and appears on **Calendar**.

Press Ctrl+C in the launcher window to stop the app. On your next visit, double-click the launcher again. The database at `%LOCALAPPDATA%\JobHunt\job-hunt.sqlite3` contains the records and saved attachment copies. Keep that file to retain your data.

If port 8765 is busy, close the program using it and retry. If the database cannot be opened, check that your Windows user can access the folder shown in the launcher error.

## Verification

From this folder, run `python -B -m unittest discover -s tests -v`. The suite uses temporary files and local-only sockets.

For the optional developer browser checks, use Node.js 26 and Chrome or Edge. Run `node --test tests/dates.test.mjs` and `node tests/browser-smoke.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"`. The browser check uses a temporary profile and database.

For the Windows acceptance walkthrough, use sample roles and documents and follow [PRD §10](PRD.md#10-acceptance-criteria). Include a browser refresh, moving the sample originals, and a Windows restart with the network disconnected.
