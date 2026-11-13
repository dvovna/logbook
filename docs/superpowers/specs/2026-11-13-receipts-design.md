# Receipts for reimbursements

## Why

A company that pays back gym or lunch costs collects receipts by hand. The accountant writes "Please provide me with your receipts for sports reimbursement by the 4th of November", people send photos and PDFs to her DM, and she checks each one and adds the reimbursement to the payroll. Her DM fills up with files, she can't see who hasn't sent anything, people who don't use the benefit are pinged anyway, and she repeats the message every month.

Logbook already has the pieces of this flow for time and time off: something a person submits in Slack, someone who decides, a reminder, a "who hasn't" list and a CSV for accounting. Receipts are the same flow with a file attached.

**Success:**
- The accountant no longer writes the monthly message or collects files from her DM. She opens one screen, sees each person's receipts for the month and who sent none, opens a file, accepts or rejects it with a reason, and downloads the month for her records.
- A person sends a photo or PDF to Logbook, fills three fields, and sees what happened to it.
- Someone who doesn't use a reimbursement stops hearing about it after one click.

## Goals

1. **Reimbursements.** Admin or Finance sets up a reimbursement: a name ("Sport"), the day of the next month receipts are due (1–28), and an optional limit per person and month. Monthly only. One currency, the workspace's.
2. **Sending a receipt.** Anyone sends an image or PDF to their conversation with Logbook. The bot answers with a button that opens a form: reimbursement, month, amount, comment. Submitting it puts the receipt in front of Finance.
3. **My receipts.** A person sees their receipts with status, and edits or deletes one that isn't accepted.
4. **Checking.** Admin and Finance see a month of a reimbursement by person, open a file, accept or reject with a reason. The person gets a DM about a rejection.
5. **Who hasn't sent.** The same screen lists active people who sent nothing for the month and didn't opt out.
6. **Reminders.** Logbook reminds people itself, twice a month at most for each reimbursement, and only those who sent nothing and didn't opt out. The reminder has an "I don't use this" button.
7. **Download.** Finance gets the month as an archive: a CSV and the files.
8. **Files are kept in Postgres**, up to 10 MB each, and deleted after a retention period.

## Non-goals

- Reading a receipt automatically (OCR, AI). The person types the amount. A later, optional prefill is possible; nothing here depends on it.
- Paying anyone, payroll export formats, accounting integrations.
- Expenses in general: travel, per diems, company cards, several currencies, taxes, mileage.
- Periods other than a month.
- Reimbursements only some teams or people may use. Everyone may send; opting out is the person's.
- Manager approval. Only Admin and Finance decide.
- Settings for the time reminder (how often, or off). It is the next task and will use the Reminders form this design adds.
- S3 or other storage. The file store is one interface, so it can come later.
- Converting HEIC or shrinking images.

## Anti-goals (would be a failure even if it works)

- **A receipt Finance never sees**: a file the bot took without telling the person it still needs details.
- **A file lost before Finance looked at it.** Hence the bytes are copied from Slack when the file arrives, not when someone opens it.
- **Reminding people who opted out or already sent.**
- **A receipt's content or amount visible to anyone but its owner, Admin and Finance.** HR and managers see none of it.
- **File bytes in logs, Sentry or list queries.**
- **Installing Logbook becoming harder**: no new service, no required variable.
- **The team and leave file imports behaving differently** for Admin and HR.

## Constraints

- **Slack.** A modal can't take a file the bot can read conveniently; a file shared in the DM arrives as `file_shared` (already subscribed, scope `files:read` already granted, so receiving needs no reinstall). Open and Download send files and need `files:write`: a workspace installed before that scope gets the existing "install again" DM. `SlackApiClient.uploadFile` takes a file as one buffer with a timeout of a minute at most, and `DmFileService` takes text today and has to take bytes. App Home can't show a PDF, and the original file lives in the sender's DM with the bot, which Finance can't open. So Finance opens a file by having the bot send a copy to their DM (`DmFileService`).
- **`file_shared` today** (`FileUploadService.handleFileUpload`): files matter only in the sharer's DM; anything but `.csv`/`.xlsx` from Admin or HR gets "Unknown file type", and anyone else gets "Only Admin or HR can import files". That routing changes (below).
- **Postgres only.** Every table has `slack_team_id` with `ON DELETE CASCADE`, RLS on, an index per foreign key. Statements time out after 10 s.
- **Jobs.** Work that follows a Slack event or must survive a restart is a job, safe to run twice. At most `JOBS_CONCURRENCY` (4) run at once, so receiving holds at most 4 files of 10 MB in memory. The smallest deployment (`deploy/fly.toml`) has 512 MB, which bounds the download archive too.
- **Roles.** Money about people is Admin's and Finance's (`BILLING_ROLES`). Slack sends action IDs and values from the client, so every handler and service checks the role and the owner.

## Approaches

Where the files live:

1. **Postgres, 10 MB a file (chosen).** No new service or variable; a workspace's deletion cascades to its files; backups hold them. The database grows by about 1–2 GB a year for 400 people. Chosen because self-hosting stays one database.
2. **S3-compatible storage.** Small database, no size limit. Every install needs a bucket and four variables, the workspace deletion and retention need their own cleanup, and `checkup` and the install docs get a step.
3. **Only the Slack file ID.** Nothing to store. The file goes when its message is deleted or Slack's retention removes it, possibly before Finance looked. Rejected: money is paid on these documents.

## Design

### Data

- `reimbursements`: `id`, `slack_team_id`, `name` (unique per workspace among active ones), `due_day` (1–28), `limit_cents` (null: no limit), `archived_at`. Archived, never deleted, as projects are.
- `receipts`: `id`, `slack_team_id`, `user_id`, `reimbursement_id` (null while a draft), `month` (date, first of the month; null while a draft), `amount_cents`, `comment`, `status`, `rejection_reason`, `decided_by`, `decided_at`, `submitted_at`, `file_name`, `mime_type`, `size_bytes`, `sha256`, `slack_file_id`, `file_deleted_at`, `created_at`.
- `receipt_files`: `receipt_id` (primary key, cascade), `slack_team_id`, `content bytea`. Apart from `receipts` so that no list or `select *` reads bytes. Only `ReceiptFileStore` (`put`, `get`, `delete`) touches it; its Postgres implementation is the only one.
- `reimbursement_opt_outs`: `slack_team_id`, `user_id`, `reimbursement_id`.
- `reimbursement_reminders`: `slack_team_id`, `reimbursement_id`, `month`, `kind` (`opened`, `due`, `summary`), unique together: the claim that keeps a reminder to one, as `time_reminder_week` does.

**Status:** `draft` (file received, no details yet) → `submitted` → `accepted` or `rejected`. The owner changes or deletes a draft, a submitted or a rejected receipt; saving a rejected one submits it again. An accepted one is locked for the owner. Finance may change a decision (accept a rejected one, reject an accepted one). Decisions are single conditional updates on the status they expect, as time entry decisions are.

Calls made in this design (not discussed with the owner, open to correction):
- **A file is never replaced.** A receipt rejected for its file (unreadable, the wrong document) stays rejected, as the record of what was sent; the person sends a new file, which is a new receipt. The rejection DM says so. Rejected receipts and drafts count in no total, not as "sent", and not against the limit.
- **Nobody decides their own receipt**, as with time and time off: another Admin or Finance person does. Only when the workspace has no other active Admin or Finance person may the owner decide it, so a receipt can't get stuck.
- **The limit refuses nothing and Finance doesn't change amounts.** A wrong amount is rejected with a reason and the person fixes it. Per person and month the screen and the download show the accepted total and what to reimburse: the accepted total, capped by the limit when there is one.

### Receiving a file

`FileUploadService` routes a file shared in the DM by its name and type:
- `.csv` / `.xlsx`: as today, for every role (the refusal for non-Admin/HR stays).
- An image (`jpg`, `jpeg`, `png`, `heic`, `webp`, `gif`) or a PDF: a receipt, for every role. With no active reimbursement in the workspace, the answer says there are none to send receipts for (Admin and Finance are told where to add one) and nothing is stored.
- Anything else: as today.

For a receipt, the job:
1. Refuses a file over 10 MB, with the limit in the reply.
2. Downloads the bytes (`fetchFileBytes` with the limit) and hashes them.
3. If the person already has a receipt with this hash that isn't rejected, says so and stores nothing.
4. In one transaction inserts the draft and its file, keyed by `slack_file_id` so a second run of the job adds nothing.
5. Posts a message: "🧾 Got your receipt *gym-october.pdf*. Add the details so Finance can check it." with **Add details** and **Discard**.

The form (also the edit form): Reimbursement (a select of active ones; preset when there is one), Month (this month and the two before; preset to the month being collected: the previous month until its due day, then the current one), Amount, Comment (optional). On submit the message is replaced with what was sent.

A draft never submitted is mentioned in the `due` reminder and deleted with its file after 30 days.

### What a person sees

Home shows a "🧾 Receipts" section when the workspace has an active reimbursement: one line per reimbursement the person didn't opt out of, for the month being collected ("Sport · October: 2 receipts, 45.00 · due 4 Nov"), drafts waiting for details, and buttons **My receipts** and **🔔 Reminders**.

- **My receipts** (a screen under Home, every role): own receipts by month, each with reimbursement, amount, status and, when rejected, the reason; Edit and Delete where allowed. It says how to send one.
- **Reminders** (a modal): a checkbox per active reimbursement, "Remind me about receipts". The time reminder's settings will join it later.

### What Finance sees

A screen **🧾 Receipts** in More → Manage, for `BILLING_ROLES`:

```
🧾 Receipts · Sport · October 2026          [◀] [▶]  [Reimbursement ▾]
14 of 22 people sent receipts · 3 waiting · due 4 Nov

Anna Kim · 45.00 of 50.00
  gym-october.pdf · 30.00 · ⏳ Waiting      [Open] [Accept] [Reject]
  pool.jpg · 15.00 · ✅ Accepted             [Open] [⋯]
Oleg Sidorov · 60.00 of 50.00 ⚠️ over the limit
  …
Sent nothing: Ivan P., Maria K., … (8)
[📦 Download the month]  [⚙️ Reimbursements]
```

- Paginated by person. A receipt sent after the due date is marked late; lateness blocks nothing.
- The same file (hash) sent by two people is marked on both.
- **Open** sends the file to the viewer's DM (a job, through `DmFileService`). A file past retention says so.
- **Reject** opens a form with a required reason. The owner gets a DM with the reason and an Edit button. Accepting sends nothing; the status is on My receipts.
- **Download the month** (a singleton job per person, reimbursement and month, as the CSV exports are): a ZIP of `receipts.csv` (Person, Email, Team, Reimbursement, Month, Amount, Currency, Status, Reason, Sent on, Decided by, File), `totals.csv` (Person, Email, Accepted, Limit, To reimburse) and the files, named by person. The archive is built and sent in parts of about 20 MB, one part in memory at a time, so a big month arrives as several files.
- **Reimbursements** (a child screen): add, edit, archive.

### Reminders

A timer like `TimeEntryRemindersService` (every 10 minutes, from 09:00 UTC, claims in `reimbursement_reminders`, saved with `enqueueMany` at 5 a second):
- `opened`, on the 1st of the month, for the month that ended: to every active person who didn't opt out and has no receipt for it. "🧾 Receipts for Sport for October are due by 4 November. Send a photo or PDF here." with **I don't use this**.
- `due`, the day before the due date: to those who still have none, or have a draft.
- `summary`, the day after the due date: to each Admin and Finance person, one DM with the counts and a button to the screen.

Reminders are per reimbursement, since each has its own due day: a person in three gets up to six DMs a month until they send or opt out. A reimbursement reminds from the first month that ends after it was created, so adding one on the 20th sends nothing about last month. A reminder not sent within a day of its time (the app was down) is skipped, not caught up.

**I don't use this** adds the opt-out and replaces the message with a line saying so and how to turn it back on. Sending a receipt for a reimbursement removes the person's opt-out for it.

### Retention

- `RECEIPT_FILE_RETENTION_DAYS` (optional, default 1095): a daily timer deletes the files of receipts older than that and sets `file_deleted_at`; the receipt's row stays.
- Deleting a receipt deletes its file. An uninstalled workspace's files go with the workspace's cascade.

### Access

- A receipt's owner, Admin and Finance are the only readers, checked in the service for every ID that comes from the client. HR and managers get no screen and no count.
- People's text (comment, reason, file name) goes through `escapeMrkdwn`.
- `ReceiptFileStore` logs sizes and IDs, never content.

## Left to the builder

- Module layout (`src/receipts`, `src/slack/tabs/receipts`), names of jobs, events and lock keys, and where a lock is needed.
- The ZIP writer: a small dependency or a few lines of stored (uncompressed) ZIP; images and PDFs don't compress.
- Exact wording, taken into `labels.ts`.
- Integration tests in the existing style (the fake Slack needs to serve a file's bytes), the round-trip budgets for the new screens, and the docs pages (everyone: sending a receipt; finance: checking receipts; reference: limits and the variable).
- The order of building. A sensible one: reimbursements and receiving; My receipts; the Finance screen with decisions, Open and Download; reminders and opt-outs; retention and docs.

## Changed while building

- Files are deleted only for decided receipts (accepted or rejected), `RECEIPT_FILE_RETENTION_DAYS` (1095) after the decision; the file of a receipt still waiting is never deleted. The check runs hourly. Drafts nobody finished are deleted after 30 days.
- The bot message's "Discard" deletes only a draft; a receipt already sent is deleted from Home → My receipts.
- A deactivated person's receipts stay on Finance's screen, marked "(deactivated)", and are decided like any other; "Sent nothing" lists active people only.
- Finance's screen shows as many receipts per person as fit a page; a person with more gets "Show all N receipts", which opens that person's receipts, paginated, with "◀ All people" to go back.
- At most 10 active reimbursements per workspace.
- The 🔔 Reminders form changes only the reimbursements it showed.
- Reminder days come from the real due date: "opened" on the 1st of the next month, "due" the day before the due date (only when the due day is 3 or later), the summary for Admin and Finance the day after it; all from 09:00 UTC, a missed day is skipped.
- An archive part is about 20 MB; a big month arrives as several files. Each part is its own job (the click's job only plans them, saving one job per part, started 2 s apart), so a retry sends only the part that failed, no run lasts long enough to be run twice by the job worker, and a second click is refused while any part is still on its way. Without `files:write` only part 1 says how to fix it.
- Home shows amounts with the currency sign; My receipts shows the 25 newest receipts.
- A person can't decide their own receipt unless nobody else in the workspace is an active Admin or Finance person.
- A decision is made on the receipt as Finance's screen showed it: Accept and Reject carry when it was sent, and a receipt its owner saved again since is refused ("This receipt was changed meanwhile.") and shown as it is now.
- An archived reimbursement stays on Finance's screen while it holds a receipt that isn't a draft: offered after the active ones as "<name> (archived)", with every action of the screen (decisions, Open, Download, Show all), no "Sent nothing", and the header "N people sent receipts · K waiting". People can't choose it: editing a receipt of one opens the form with the active reimbursements and none chosen, and with none active the person is told "There are no reimbursements to send receipts for yet." instead.
- One file or archive part is read, zipped and sent at a time in a process, and a month of more than 50 parts (about 1 GB) is sent as its two CSVs alone: four parts at once did not fit 512 MB.
- The storage estimate above was too low: a phone photo is 1 to 4 MB, so 400 people are about 10 GB a year with a receipt a month and about 190 GB a year with lunch receipts every working day. The second is past what Postgres should hold; another `ReceiptFileStore` comes before collecting receipts that often.
