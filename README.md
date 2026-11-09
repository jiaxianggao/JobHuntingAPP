# Job Hunt

Job Hunt is a personal, offline Windows app for tracking job applications and keeping the documents used for each role.

## Features

- Browse submitted applications by date, or click a calendar date to add a submission.
- Search the application board by company name or role title.
- Keep a local copy of the CV and cover letter for each application.
- Track rejections, interviews, final outcomes, and time to response. Filter results by status.

## Start on Windows

1. Clone this repository, or download and extract it using GitHub's **Code → Download ZIP** option.
2. Have Python 3.11 or newer installed. The app has no packages to install.
3. Double-click **start-job-hunt.cmd**. Keep its window open while using the app.
4. If the browser does not open automatically, open [Job Hunt](http://127.0.0.1:8765). You can bookmark that address and reuse it while the launcher is running.

Use **Job Applications → Add role** to create a card. Open the card to attach a CV and cover letter. Each file can be up to 25 MiB. Use **Mark submitted** to select **Today** or pick a past date. After confirmation, the card moves to **Submitted** and appears on **Calendar**.

Choose **University** or **Corporate** when adding a role. Existing company types remain available on their original records. Search by company or role title on the board. Submitted cards show how many calendar days have passed since you applied.

On **Results**, record a rejection or interview and the date you heard back. For interviews, add the interview date and return later to record the final outcome. Applications without a recorded response show **No response after 4 weeks** starting on day 28.

Valid edits to existing application details save automatically, including when you close the editor. Use **Add role** to create a new application and **Save result** to record a response. The main header's **Save data** button confirms that your changes are saved.

Press Ctrl+C in the launcher window to stop the app. On your next visit, double-click the launcher again. The database at `%LOCALAPPDATA%\JobHunt\job-hunt.sqlite3` contains the records and saved attachment copies. Keep that file to retain your data.

If port 8765 is busy, close the program using it and retry. If the database cannot be opened, check that your Windows user can access the folder shown in the launcher error.

## Verification

From this folder, run `python -B -m unittest discover -s tests -v`. The suite uses temporary files and local-only sockets.

For the optional developer browser checks, use Node.js 26 and Chrome or Edge. Run `node --test tests/dates.test.mjs` and `node tests/browser-smoke.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"`. The browser check uses a temporary profile and database.

For the Windows acceptance walkthrough, use sample roles and documents and follow [PRD §10](PRD.md#10-acceptance-criteria). Include a browser refresh, moving the sample originals, and a Windows restart with the network disconnected.

## License

Job Hunt is released under the [MIT License](LICENSE).
