---
title: Slash commands
description: The commands Logbook adds to Slack, who may use each one and what it does.
sidebar:
  order: 2
---

Type these in any Slack conversation. Logbook's answers are only visible to you. Everything else is on Logbook's **Home** tab.

## Commands

| Command | Who | What it does |
| --- | --- | --- |
| `/vacations` | Everyone | Lists the `/vacations` commands. `/vacations help` does the same. |
| `/vacations request` | Everyone | Opens the **Time off request** form, the same form as **🌴 Request time off** on **Home**. See [Request time off](/logbook/docs/everyone/request-time-off/). |
| `/vacations usage` | Everyone | Shows your time off for the current vacation year: annual leave used and remaining (in days and in working days), bonus days used and remaining, and the sick leave, unpaid leave and other time off you used. Without a vacation policy, remaining days show as "not limited". |
| `/vacations cancel` | Everyone | Opens **Cancel Vacation** with your requests that wait for approval. Choose one and click **Cancel Request**. With none waiting, Logbook says "You have no vacation requests waiting for approval." |
| `/log` | Everyone | Opens the **Log Time** form, the same form as **➕ Log Time** on **Home**. See [Log time](/logbook/docs/everyone/log-time/). |
| `/upload-vacations` | Admins | Shows how to import vacation history from `user-vacations.csv`: the file name, the format and an example. You then upload the file in your conversation with Logbook. See [Imports](/logbook/docs/admins/imports/) and [File formats](/logbook/docs/reference/file-formats/#user-vacationscsv). |

A form opened by a command closes when you submit it, and **Home** shows a line saying what happened.

## When a command doesn't work

| What you see | Why |
| --- | --- |
| "Unknown command." and the list of `/vacations` commands | The word after `/vacations` isn't `request`, `usage` or `cancel`. |
| "⛔ Only users with role *admin* can use this command." | `/upload-vacations` is for admins only. |
| "Logbook doesn't know you yet. Ask HR or an admin to add you." | You aren't in Logbook. People are added when the app is installed and when they join Slack; ask HR or an admin. |
| "Your Logbook account is deactivated. Ask HR or an admin to turn it back on." | HR or an admin deactivated you. |
| "An error occurred while processing your command." | Something failed on Logbook's side. Try again; if it keeps failing, tell whoever runs Logbook. |
| Slack says the command doesn't exist | The Slack app was set up from an older manifest. See [Troubleshooting](/logbook/docs/help/troubleshooting/#a-slash-command-is-missing). |

## Removed commands

`/user-team-mapping` and its `user-team-mapping.csv` were removed in 0.3.0. Teams are now set up from the team file: More → **Teams** → **📄 Set up from a file**. See [Team file](/logbook/docs/admins/team-file/). After an update to 0.3.0, apply the Slack app manifest again to drop the old command from Slack (see [Update](/logbook/docs/self-hosting/update/#apply-the-slack-app-manifest-again)).
