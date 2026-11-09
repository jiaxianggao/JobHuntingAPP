# Job Hunt Product Requirements

## 1. Product goal and use cases

Track personal job applications in a desktop browser on a Windows PC. Save roles before applying, then record the submission date and keep the exact CV and cover letter used for each role. Use the calendar to see which applications were submitted each day. The app works offline and requires no login.

## 2. Pages and navigation

The top navigation contains **Calendar** and **Job Applications**. The app opens on **Calendar**. A calendar entry and its matching board card open the same application details.

## 3. Calendar home page

The home page shows a monthly calendar with controls to move to the previous or next month. Submitted applications appear on their submission dates. If several applications share a date, each can be opened separately. Roles awaiting submission appear on the board only.

## 4. What each module does

- **Calendar** lets you review submitted applications by date.
- **Job Applications** lets you save roles and manage their submission status. The board has two columns, **Not submitted** and **Submitted**, with one card per role.
- **Application details** lets you view and edit role information and open the saved CV and cover letter.

## 5. First-version data and actions

| Data | Use |
| --- | --- |
| Company name, company type, and role title | Identify the role. All three can be edited in the application details. |
| Submission status | Determines which board column contains the card. |
| Application date | Records when the application was submitted and determines where it appears on the calendar. |
| CV and cover letter | The app keeps one copy of each file per role. Both can be opened from the application details. |

Select **Add role** to create a card. You can save a role first and attach the documents later. After applying, select **Mark submitted**, choose **Today** or pick a date on the calendar, then confirm. Cancelling keeps the existing status. **Today** uses the PC's local date.

## 6. How the calendar and board work together

The board and calendar use the same application record. After you confirm a submission, the card moves to **Submitted** and appears on the chosen date. A separate **Today Plan** page is outside the first-version scope. **Today** is a shortcut for selecting the submission date.

## 7. Local data, backup, and recovery

The app stores application records and copies of attachments in a local folder on the PC. Records and attachments remain available after closing the browser or restarting the PC. Moving or deleting an original file after attaching it does not affect the app's saved copy.

Backup and recovery procedures, including whether they belong in the first version, are pending confirmation. The agreed requirement is that saved data remains available after normal shutdown and restart.

## 8. First-version requirements

- Open the app in a desktop browser while offline, with no login.
- Review submitted applications in the monthly calendar and open their details from calendar entries.
- Create and edit roles, view them on a two-column board, and record submissions.
- Select **Today** or pick a date on the calendar. On confirmation, update both the board and calendar.
- Save and open local copies of each role's CV and cover letter, including after a restart.

## 9. First-version exclusions

Account login, cloud storage or sync, online deployment, a mobile version, a separate Today Plan, and additional stages such as interviews and offers. Backup and recovery scope is pending confirmation.

## 10. Acceptance criteria

1. Disconnect from the internet and open the app. Verify that it opens on the monthly calendar and that the top navigation opens the board.
2. Add a role with a company name, company type, and role title. Verify that its card appears under **Not submitted** and is absent from the calendar. Edit its details and verify that the changes are present after reopening the card.
3. Attach different CVs and cover letters to two roles. Move the original files, then open the saved attachments from each role and verify that they match that role.
4. Submit one role using **Today** and another by picking a past date on the calendar. Verify that both cards move to **Submitted** and appear on their respective dates. Start and cancel submission for a third role and verify that it stays under **Not submitted**.
5. Record two applications on the same date and verify that each opens separately from the calendar. Switch to another month and back, then verify that both entries still appear on the correct date.
6. Close the browser, restart the PC, and reopen the app while offline. Verify that the roles, statuses, dates, CVs, and cover letters are still available.
