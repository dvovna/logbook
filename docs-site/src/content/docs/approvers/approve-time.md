---
title: Approve time
description: Approve or reject the time entries people submit, one at a time or all at once.
sidebar:
  order: 2
---

Managers, HR and admins approve or reject the time entries people submit. Nobody approves their own entries.

## What waits for whom

A submitted entry waits for the approvers of the team it was logged in (the owner's team at the time):

1. The people the team lists under **Team approvers**, if at least one of them is active, has the Manager, HR or Admin role, and isn't the owner.
2. Otherwise everyone with the HR role. This covers the entries of people in no team, of a team with no managers, and of the team's only manager.
3. Otherwise, when nobody has the HR role, every admin.

The owner is always left out.

While every approver of an entry's team is on time off, the entry also waits for HR (else the admins) who are at work. The away managers keep it in their list, and submitting tells only the people at work. It goes back to the managers when one of them returns. When nobody who could decide is at work, nothing changes. HR and admins may still decide anyone's entries; see [All pending entries](#all-pending-entries) below.

Team approvers are set up in [Teams and company rules](/logbook/docs/admins/teams-and-company-rules/). Submitting is described in [Submit time](/logbook/docs/everyone/submit-time/).

## The message you get

When someone submits entries that wait for you, Logbook sends you a DM: who submitted how many entries, the hours, and the projects with the most time, and that they wait for you under **Approvals**. You get one message per person each time they submit.

When the entries of a team start to wait for you because its managers are on time off, you get one DM on the day the last of them goes on time off, from 06:00 UTC (not again when the time off runs on in a new request): who is on time off until when, and how many entries of which team now wait for you. See [Notifications](/logbook/docs/reference/notifications/).

## The Approvals screen

**Approvals** in the navigation row counts what waits for you, time off and time entries together: **Approvals (5)**. Home also says **Needs your attention** with an **Open Approvals** button.

![The Approvals inbox: time off and time entries that wait for you, with Approve, Reject and Approve all](../../../assets/screens/approvals.png)

Under **Time entries** you see the entries waiting for you, ten to a page, newest work first. Each shows the person, the project and client, the date, the time and the description, with **Approve** and **Reject**.

### Approve or reject one entry

- **Approve** approves the entry at once, and it leaves the list. If someone else decided it first, it just leaves the list.
- **Reject** opens **Reject Time Entry** with an optional **Reason**. Click **Reject**. The screen says the owner gets a message.

The owner's DM names the entry, who rejected it and why, and the week to fix it in. They fix it and submit it again.

### Approve all

1. Click **Approve all (N)** next to **Time entries**.
2. **Approve Time Entries** says how many entries will be approved.
3. Click **Approve Time Entries**.

This approves every entry that waits for you, not only the page you see. The screen then says how many were approved.

:::note
**Approve all** covers what waits for you only. HR and admins don't approve everyone's time with it.
:::

## All pending entries

HR and admins can decide an entry when its approver is away.

1. Open **Approvals**.
2. Click **All pending entries**. The list shows every submitted entry in the workspace except your own.
3. Click **Approve** or **Reject** on an entry.
4. Click **Waiting for you** to go back.

**All pending entries** has no **Approve all**: you decide each entry yourself.

## After a decision

- An approved entry is locked for its owner. It counts as approved in reports.
- A rejected entry can be changed again by its owner, and becomes a draft once they change it. They submit it again for approval.

## Reminders of what waits for you

When something has waited for your decision for two days or more, Logbook reminds you in one direct message: how many time off requests and how many time entries (of how many people) still wait, and since when the oldest. It comes as often as you chose in **Home → 🔔 Reminders** ("Remind me about time I haven't submitted and what waits for my approval"): every working day, every Monday (the default), the first Monday of the month, or never, in the morning (UTC). With nothing that old waiting, no reminder comes. A manager on time off isn't reminded of time entries while someone else who could decide them is at work (another of the team's managers, else HR, else the admins): those are reminded instead.

Everyone with the HR role (the admins, when nobody has it) is also told what has waited for someone else for more than five days, in the same reminder, under "Waiting for someone else for more than 5 days": each request with its requester, dates and approvers, and each person's time entries with their count and hours, oldest first, ten at most and then "and N more". What waits for you, and your own requests and time, are left out; the rest you can decide for the approvers in **Approvals → All pending requests** and **All pending entries**.

See [Notifications](/logbook/docs/reference/notifications/) for every message Logbook sends about time.
