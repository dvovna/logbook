---
title: What Logbook is
description: Logbook handles time off requests and time tracking inside Slack. Learn where it lives and who can do what.
sidebar:
  order: 1
---

Logbook is a Slack app for two jobs: asking for time off and getting it approved, and logging the hours you work. Everything happens in Slack, so you don't need another login.

## What it does

- **Time off.** You request annual leave, sick leave or other time off. The request goes to your approvers, and you hear back in a direct message. If your company sets limits, Logbook checks your balance.
- **Time tracking.** You log hours on projects, review the week, and submit it. Approvers accept or reject it. Finance can turn approved time into reports and billing snapshots.
- **Setup for the company.** Admins and HR set policies, teams, approvers and projects, and manage people.

## Where it lives in Slack

- **The Home tab of the Logbook app.** Open Logbook under **Apps** in the Slack sidebar and choose its **Home** tab. A row of buttons at the top moves between screens: **Home**, **My time**, **Time off**, **Approvals** and **☰ More**. **Approvals** shows only for managers, HR and admins. The **More** menu holds the rest of what your role may open.
- **Direct messages from the bot.** Logbook writes to you when a request goes to approvers, moves up a level, gets a comment or is decided, and when time you submitted is rejected. Approvers get their requests there with **Approve** and **Reject** buttons.
- **Slash commands.** `/vacations` handles time off: `/vacations request`, `/vacations usage` and `/vacations cancel`. `/log` opens the **Log Time** form.

## Roles

Each person has one role. An admin sets it under **People**.

| Role | What they do |
| --- | --- |
| Admin | Full access: sets Logbook up, manages people and roles, sees everything. |
| HR | Manages people, teams, policies and requests, and sees everyone's time without rates or amounts. |
| Manager | Approves time off and time for the teams that list them as approvers, and sees those teams' people and time. |
| Finance | Handles rates, amounts, billing reports and snapshots, and sees everyone's time. Requests and logs like a member and approves nothing. |
| Member | Requests time off, logs and submits their own time, and sees their own reports. |

## Where to go next

- Installing Logbook for your company: [Set up your workspace](/logbook/docs/getting-started/set-up-your-workspace/).
- Your Home tab: [Home](/logbook/docs/everyone/home/).
- Asking for time off: [Request time off](/logbook/docs/everyone/request-time-off/).
- Logging hours: [Log time](/logbook/docs/everyone/log-time/), then [Submit time for approval](/logbook/docs/everyone/submit-time/).
- Logging approved time off as hours: [Time off as time](/logbook/docs/everyone/time-off-as-time/).
