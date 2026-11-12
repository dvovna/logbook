---
title: Notifications
description: Every direct message Logbook sends, when it sends it, to whom, and what you can do from it.
sidebar:
  order: 3
---

Logbook writes to people in their conversation with it (its **Messages** tab in Slack). This page lists every such message. Nobody can turn them off.

A message that waits for a decision changes in place once the decision is made, so the buttons go away and the message says who decided.

## Time off

| Message | When | To | What it holds or lets you do |
| --- | --- | --- | --- |
| A request to approve ("You have a new vacation request to approve") | A request reaches the approver's level: level 1 when it is made, level 2 once level 1 approves. Again when HR or an admin changes the dates, type or person of a request that still waits. | Each approver of that level. When nobody listed can decide, everyone with the HR role, or the admins when nobody has it. | Who asks, the dates with calendar and working days, the type, the requester's comment and approvers' comments. A line with the balance after the request, who else on the team is off then, the level ("Level 2 of 2") and who approved the levels before. Buttons **Approve ✅**, **Reject ❌** (asks for an optional reason) and **Comment 💬**. It changes to "Approved by", "Rejected by" (with the reason), "Canceled by" or "Deleted by". |
| Where your request went | Right after you request time off. For a request nobody could approve, again once someone can. | The requester. | "📨 Your vacation request (dates) went to" the approvers of level 1 and the level's name. When nobody on the team can approve it: that it went to HR or to the workspace admins, and why. When nobody at all can: "⚠️ Nobody can approve your vacation request … yet", and what has to change. A line naming teammates who are off on those days (approved or waiting, sick leave left out). |
| A level is done | A level approves the request and another level follows. | The requester. | "✅ Your vacation request (dates): Manager approval done by @… Now waiting for HR approval from @…" |
| A comment | An approver comments while the request waits. | The requester. | The comment, a reminder that the request is still pending, and the buttons **📋 View Details** and **❌ Cancel Request**. The approvers' own messages show the comment too. |
| The decision | The last level approves, or anyone rejects. Also when HR or an admin sets a request to approved or rejected with **Edit Request**. | The requester. | "✅ Your time off request was approved" or "❌ … was rejected": the type, dates, days and working days, the rejection reason, the approvers' comments, and who decided. When time off as time is set up for the leave type, a button **Log … to …** (see below). |
| Time off approved for someone | A request is approved by its approvers, or by HR or an admin with **Edit Request**. | The **Approval Notification Recipients** of the person's team rules, or of the company rules. | "✅ Time off approved for *Name*", the type, dates and days, and the approvers' comments. Nothing is sent for a rejection. |
| An offer to log time off as time | HR or an admin adds a request as approved, or changes the dates, type or person of an approved one, and the leave type has a project. When they change a request to approved, the button comes in the decision message instead. | The requester. | "*Annual leave* · dates. Log it as time on *Project*?" and the button **Log 40h to Project**. After the click, the button gives way to what was logged and which days were skipped. See [Time off as time](/logbook/docs/everyone/time-off-as-time/). |
| Logged time off removed | HR or an admin changes the dates, status, type or person of a request whose time was logged, or deletes the request. | Whoever logged the time, unless they are deactivated. | "Your annual leave 15–19 Jun 2026 was rejected: the 40h logged on Project were removed." Days in a billing snapshot stay, and the message names them. When the request is still theirs and approved, the new offer comes in the same message. |

:::note
A request that HR or an admin sets to approved or rejected with **Edit Request** gets the same decision messages as one the approvers decide, naming them as who decided. A request they add already approved or rejected gets no decision message, since it records time off agreed elsewhere. Added as approved, it still gets the offer to log it as time.
:::

## Time

| Message | When | To | What it holds or lets you do |
| --- | --- | --- | --- |
| Time submitted for your approval | Someone submits time (**📤 Submit for Approval**, **📤 Submit week**, or **Submit the week's time for approval** in the week form), or HR or an admin logs someone's time as submitted. | Each approver of the entries: the managers of the team the time was logged in, else everyone with the HR role, else the admins. Not the person who submitted it. | ":inbox_tray: *Name* submitted *N time entries* (hours) for your approval", the hours by project (the three biggest, then "and N more projects"), and "They wait for you in Logbook → ✅ Approvals." One message per person whose time it is. |
| Your time was rejected | An approver rejects an entry. | The person whose entry it is. | Who rejected it, the project and client, the day and hours, the reason, and "Fix it under Home → ✏️ Edit Entries (week of …) and submit it again." |
| The Monday reminder | Every Monday, within 10 minutes of 09:00 UTC, once a week. | Everyone active with drafts or rejected entries dated before that week. | ":alarm_clock: You have *N time entries* (hours) from … not submitted yet", how many were rejected and in which weeks, and "Your approvers see time only once you submit it: Home → 📤 Submit for Approval." |

## People and setup

| Message | When | To | What it holds or lets you do |
| --- | --- | --- | --- |
| Welcome | Logbook is installed in a workspace. | The person who installed it. | "👋 Logbook is installed, and you're its admin", and the setup steps in order: More → Policies, More → Teams → Company rules, More → Teams → Set up from a file, More → Projects. **Home** shows a checklist until they are done. See [Set up your workspace](/logbook/docs/getting-started/set-up-your-workspace/). |
| A new person | Someone joins Slack after the first import of members, and the workspace has teams. | Everyone with the HR role, or the admins when nobody has it. Never the new person. | "👋 *Name* joined Slack. Which team is Name on?", where their requests go until then, a **Choose a team** list and a **Not yet** button. The first answer places them, and everyone's message changes to say who placed them where. Placing them another way (the team form, **People**, the team file) closes the question too. |

## Files

Files come in your conversation with Logbook: a message, with the file under it.

| Message | When | To | What it holds or lets you do |
| --- | --- | --- | --- |
| Time report CSV | You click **📥 Send CSV to my DMs** under a time report on **Reports**. | You. | "📄 Time report, period (whose time, filters): N entries, hours." and the file `time-report-<from>-to-<to>.csv`. See [File formats](/logbook/docs/reference/file-formats/#time-report-csv). |
| Billing snapshot CSV | You choose **Send CSV to my DMs** in a snapshot's menu on Reports → **Billing snapshots**. | You. | "📄 Billing snapshot, client, period: N entries, hours, amount." and the file `billing-<client>-<from>-to-<to>.csv`. |
| Team file template | You click **📄 Set up from a file** on **Teams**. | You. | "📄 Here are your people. Fill in Team and Team lead (`yes`), then send the file back to me here." and the file `team-setup.csv`. |
| Nothing to export | The time report holds no time. | You. | "📄 No time was logged in … : there is nothing to export." |
| Too many entries | The time report holds more than 200,000 entries. | You. | That it is too many for one file: show a shorter period or narrow the report, then send the CSV again. |
| The file couldn't be sent | Sending the CSV kept failing for hours. | You. | "⚠️ I couldn't send the CSV of …: sending it kept failing for hours", and where to send it again. |
| No permission to upload files | Logbook has no permission to upload files in the workspace: it was installed before it asked for one. | You. | The file's message and "⚠️ I couldn't attach the file: Logbook doesn't have the permission to upload files in this workspace yet. Ask whoever installed Logbook to install it again (nothing is lost), then export again." See [Troubleshooting](/logbook/docs/help/troubleshooting/#a-csv-doesnt-come-with-its-message). |

## Answers to files you send

Logbook answers a file you send it in your conversation with it. Most answers are only visible to you.

| Message | When | To | What it holds or lets you do |
| --- | --- | --- | --- |
| Vacation import result | An admin sends `user-vacations.csv`. | The admin. | "✅ Imported", "⚠️ Imported … with problems" or "❗️ … was not imported", with the counts and up to 10 problems. A file with no header row or no lines is "not imported", with the reason and the header it needs. HR gets "⛔ Only admins can import vacations." Anyone else who isn't an admin or HR gets "⛔ Only Admin or HR can import files into Logbook." when they share a file in their conversation with Logbook. A file shared in a channel gets no answer from Logbook, unless it is `user-vacations.csv` shared by an admin or HR. See [Imports](/logbook/docs/admins/imports/). |
| Team file preview | HR or an admin sends a team file. | The sender. | "Here's what *file* will do": the teams it creates, who moves where, lead changes, and rows it can't use. Buttons **Apply**, **Cancel** and **Company rules**. After **Apply** it shows what changed, with **Undo** and **Open Teams**. See [Team file](/logbook/docs/admins/team-file/). |
| A file Logbook can't use | The file is larger than 1 MB, isn't UTF-8, can't be read, has no Email and Team columns, or isn't a CSV or Excel file. | The sender. | What is wrong, for example "❗️ This doesn't look like a team file: its first row needs Email and Team columns." or "❗️ Unknown file type." |

## When Logbook doesn't know you

| Message | When | To | What it holds |
| --- | --- | --- | --- |
| Not in Logbook | You click a button in Logbook but aren't in it. | You. | "Logbook doesn't know you yet. Ask HR or an admin to add you." |
| Deactivated | You click a button in Logbook after HR or an admin deactivated you. | You. | "Your Logbook account is deactivated. Ask HR or an admin to turn it back on." |

When Slack fails to take a message, Logbook sends it again later, for up to about 8 hours.
