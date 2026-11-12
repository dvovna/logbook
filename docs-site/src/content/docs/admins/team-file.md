---
title: Set up teams from a file
description: Put everyone in a team and name the team leads in one spreadsheet, check what it will change, then apply it.
sidebar:
  order: 3
---

This page helps you set up every team and team lead at once, from a spreadsheet, instead of one team at a time. HR and admins can use the team file.

## Get the template

1. Open **More** → **Teams** and click **Set up from a file**. The same button is on Home's setup checklist.
2. Logbook sends you a DM with `team-setup.csv`.

The file lists every active person, with the team they are in now and whether they lead it. Nothing changes until you send it back, check the preview and click **Apply**.

## Fill it in

Open the file in a spreadsheet app. It has four columns:

| Column | What to write |
| --- | --- |
| Name | The person's name. Logbook uses it only to name the person in its messages |
| Email | Who the row is about. Leave it as it is |
| Team | The team's name. A name no team has yet creates that team. An empty cell takes the person out of their team |
| Team lead | `yes` if the person leads the team (`y`, `x`, `true` and `1` work too), else empty (or `no`) |

How Logbook reads it:

- A team name matches an existing team whatever its case and extra spaces. When two teams differ only in case, write the exact name.
- A lead is a level 1 approver of their team. Someone with the Member role who leads a team becomes a Manager. People with the HR or Finance role can't lead a team. A team has at most five leads.
- Someone in the file who led their team and isn't marked as lead any more stops leading it. Approvers who aren't in the file stay.
- People you delete from the file stay as they are.
- A new team follows the company rules, and any one of its leads approves at level 1. See [Teams and company rules](/logbook/docs/admins/teams-and-company-rules/).

:::caution
An empty Team cell takes the person out of their team, and an empty Team lead cell takes away their lead. Delete the rows of people you don't want to change.
:::

The full format is in [File formats](/logbook/docs/reference/file-formats/).

## Send it back

Save the file as CSV or as an Excel workbook (`.xlsx`) and send it to Logbook in the same DM. A file shared in a channel is ignored.

- A CSV may use commas or semicolons. Save it as UTF-8 ("CSV UTF-8" in Excel): Logbook refuses a CSV in another encoding when it has letters such as é or ö.
- In a workbook, Logbook reads the first sheet.
- The first row needs at least the Email and Team columns. A file can have up to 1,000 rows and 1 MB.

## Check the preview

Logbook answers with what the file will do, in this order:

- **Teams to create**, with their leads and how many people. A new team with no lead sends its requests to the company rules' level 2, or to HR or an admin when there is none.
- **Moves between teams**, **Lead changes**, and who is **Becoming Managers because they lead a team**.
- **Placed in a team** and **Left without a team**.
- **Teams with no lead**: their requests skip level 1.
- **Team names matched**: how a name you wrote was read.
- **Rows it can't use**, each with its row number and the reason, for example an email that isn't in the workspace, a deactivated person, or someone listed twice. Logbook skips these rows and applies the rest.

A last line says what new teams get from the company rules. Under it are **Apply**, **Cancel** and **Company rules**, which opens the company rules to change them first.

If you find a mistake, fix the file and send it again. A newer file replaces the open preview.

## Apply

Click **Apply** within 7 days of sending the file. The message then says what changed, for example "Created 3 teams and placed 14 people", and names anyone left without a team. It has **Open Teams** and **Undo**.

- If something changed in Logbook since the preview, Apply changes nothing and shows the new preview instead. Check it and click **Apply** again.
- After 7 days the preview expires. Send the file again.
- **Cancel** closes the preview without changing anything.

Moving people closes any open [question about a new person](/logbook/docs/admins/people-and-roles/#the-question-about-a-new-person).

## Undo

**Undo** works for 7 days after **Apply**, as long as no newer file was applied.

Undo puts back each team, lead and role the file changed, where nothing changed it since. It deletes the teams the file created when they are empty and have no requests, time or projects. A Manager the file made goes back to Member unless they still lead a team.

The message then says how many changes it restored, and lists what it kept as it is and why.
