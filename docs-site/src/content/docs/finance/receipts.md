---
title: Receipts
description: Set up reimbursements, check and decide receipts, download a month with its files, and see how people are reminded.
sidebar:
  order: 5
---

Receipts are for Admin and Finance. People send a photo or PDF of a receipt to Logbook, and you check what they sent for each reimbursement, month by month. HR and managers don't see receipts. How people send them is on [Send receipts](/logbook/docs/everyone/receipts/).

## Set up reimbursements

A reimbursement is what people send receipts for, such as a gym or lunches.

1. Open **More → 🧾 Receipts**, then choose **⚙️ Reimbursements**.
2. Choose **➕ Add reimbursement**.
3. Fill in the form:
   - **Name**.
   - **Due day**: the day of the following month, 1 to 28. October's receipts with due day 4 are due on 4 November.
   - **Limit per person and month**: optional, in the workspace currency. Leave it empty for no limit.
4. Choose **Submit**.

The list shows each reimbursement with "Due: day 4 of the next month" and its limit. Use its menu to **Edit** it or **Archive** it.

- A workspace has at most 10 active reimbursements. Names are compared ignoring case; two active ones can't share a name.
- Archiving a reimbursement stops people choosing it and stops its reminders. The receipts already sent stay: while it holds any, the **Receipts** screen still offers it, as "Gym (archived)", and you decide on, open and download them as before.
- The currency is the workspace's. See [Rates and currency](/logbook/docs/finance/rates-and-currency/).

## Check a month

**More → 🧾 Receipts** shows one reimbursement and one month at a time: the month being collected when you open it. Use **◀ Previous month** and **Next month ▶**, and the menu **Reimbursement** when there is more than one. The menu lists the active reimbursements, then the archived ones that hold receipts, marked "(archived)".

The line under the title reads "14 of 22 people sent receipts · 3 waiting · due 4 Nov". Someone counts as having sent when they have a receipt that is waiting or accepted. People who haven't turned reminders off and have sent nothing are listed at the end as "Sent nothing: …". Only active people are listed there. An archived reimbursement asks nobody any more: its line reads "3 people sent receipts · 1 waiting", without "Sent nothing".

Below it, each person who sent something has a heading with their name, the total of their waiting and accepted receipts, and the limit: "Anna Lee · $120.00 of $100.00 ⚠️ over the limit". A person who was deactivated since stays on the screen, marked "(deactivated)", and you decide on their receipts like any other.

Each receipt shows its file name, **Amount**, **Status**, the **Comment** and, when rejected, the **Reason**. Two marks help:

- **⏰ Late**: it was sent after the due day.
- **Same file as** a name: another person sent the same file.

Waiting receipts come first. The screen shows as many receipts per person as fit a page. A person with more has a button **Show all N receipts**, which opens their receipts, a page at a time. Choose **◀ All people** to go back. People are listed ten to a page.

## Decide on receipts

A waiting receipt has three buttons:

- **Accept**: the receipt counts toward what the person gets back.
- **Reject**: opens **Reject receipt**. Write a **Reason** (up to 500 characters) and choose **Reject**. The person gets it in a message with a button to fix the details.
- **Open**: sends the file to your Messages with Logbook, with the person, reimbursement, month and amount.

A decided receipt has a menu with **Open** and the opposite decision (**Reject** for an accepted one, **Accept** for a rejected one), so you can change your mind. Changing a decision to a rejection sends the person the same message.

Two of you can click at the same moment: the second finds the receipt changed and the screen shows the new state.

Nobody decides on their own receipt. If there is no other active person with the Admin or Finance role, you can.

## Download the month

Choose **📦 Download the month** (it shows when the month holds a receipt). Logbook sends the archive to your Messages with Logbook, in one or more files: "📦 Receipts for Gym, October 2026 (part 1 of 2)." The screen says "📦 Sending the archive to your Messages."

The first part holds two CSV files, and every part holds the receipts' files:

- `receipts.csv`: one line per receipt, drafts excluded: Person, Email, Team, Reimbursement, Month, Amount, Currency, Status, Reason, Sent on, Decided by, File.
- `totals.csv`: one line per person: Person, Email, Accepted, Limit, To reimburse. **To reimburse** is the accepted amount, but at most the limit.
- The files, named `Person name - 1.jpg`, `Person name - 2.pdf` and so on. The **File** column of `receipts.csv` says which one belongs to a line. A receipt whose file was deleted after the retention period has an empty **File**.

The archive is named like `Receipts Gym 2026-10 part 1 of 2.zip`. A part holds about 20 MB of files, so a big month arrives as several. If sending fails midway, Logbook tries again later and sends every part again, so you may get a part twice.

Open and Download both need the permission `files:write`. A workspace that installed Logbook before it existed has to install Logbook again, through its install link. See [A CSV doesn't come with its message](/logbook/docs/help/troubleshooting/#a-csv-doesnt-come-with-its-message). Nothing is lost.

One file or archive at a time: choosing the same button again while it is on its way says so. If sending keeps failing for hours, you get a message that it couldn't be sent and can ask again.

## How long files are kept

Receipts stay. Their files are deleted `RECEIPT_FILE_RETENTION_DAYS` after the decision (three years, 1095 days, unless whoever runs Logbook set another). A receipt still waiting keeps its file. After deletion **Open** says "This file was deleted after the retention period." and the archive has no file for it.

Files people sent and never gave details for are deleted after 30 days.

## Reminders and the summary

Logbook reminds people itself; there is nothing to schedule. For each active reimbursement and month, from 09:00 UTC:

| When | Who gets it |
| --- | --- |
| The 1st of the next month ("opened") | People who sent nothing |
| The day before the due date | People who sent nothing or have receipts that need details. Not sent for a due day of 1 or 2. |
| The day after the due date | Admin and Finance get a summary |

People who turned reminders off for a reimbursement, and deactivated people, get none, and those who turned them off aren't counted as "Sent nothing". A day the app was down is skipped.

The summary reads "🧾 *Gym*, October 2026: 14 of 22 people sent receipts, 3 waiting for you." with a button **Open receipts**, which opens the screen on that month. It isn't sent when nobody sent anything and nobody is left to.

## Who sees what

| | Admin | Finance | HR | Manager | Member |
| --- | --- | --- | --- | --- | --- |
| Send, edit and delete their own receipts | Yes | Yes | Yes | Yes | Yes |
| The **Receipts** screen, reimbursements, decisions, Open and Download | Yes | Yes | — | — | — |
| The summary message | Yes | Yes | — | — | — |
