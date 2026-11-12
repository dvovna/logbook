---
title: Set up with an AI agent
description: Give an AI agent your people list and leave data, and it writes the files Logbook reads and the values for its forms. You apply them in Slack.
sidebar:
  order: 3
---

An AI agent, such as Claude or ChatGPT, can do the paperwork of [Set up your workspace](/logbook/docs/getting-started/set-up-your-workspace/): it reads what your company already has (an HR export, a spreadsheet of teams, leave balances) and turns it into Logbook's files. Admins and HR can use it. Give the agent your files and paste this:

```text
Help me set up Logbook from my company's data. Follow the instructions at
https://dvovna.github.io/logbook/docs/agent-setup.md exactly, in order.
Change nothing in Logbook yourself, and send my data nowhere else.
```

The address in the prompt is a page written for the agent: what to ask you, the format of each file, and the rules it has to keep. You can read it at [agent-setup.md](/logbook/docs/agent-setup.md).

## What the agent does

1. Asks for your data and for how your company counts leave: days a year, calendar or working days, carryover, public holidays, who approves after the team lead.
2. Tells you what it found in your data and what it can't use, and waits for your yes.
3. Gives you the values for the forms Logbook has no file for: each vacation policy, its holidays and the company rules.
4. Writes up to three files: `team-setup.csv` (teams and team leads), `leave-balances.csv` (what each person has left) and `leave-history.csv` (leave taken and agreed).
5. Checks the files against Logbook's rules.
6. Tells you the order to do things in Slack, and what to look at in each preview.

## What stays with you

- **Everything in Slack.** You fill in the forms, send each file in your conversation with Logbook, read its preview and click **Apply**. The agent gets no access to Logbook or to Slack.
- **The preview.** Logbook checks what the agent can't: that each email is a person in your workspace, the teams that exist, the leave already there. Rows it can't use are listed with the reason; give those lines to the agent and send the corrected file again.
- **Undo.** Each applied file can be taken back for 7 days.

## Your data

The files hold names, emails and leave, sick leave included. Use an agent your company allows for such data. The agent is told to send the data nowhere else, to keep reasons for leave out of the files and to leave out anyone it can't match rather than guess. An agent can still make mistakes: read what it reports before you send a file, and delete the files once they are applied.

## Check the files yourself

Whoever runs Logbook from its source can check the files without Slack:

```bash
pnpm files:check team-setup.csv leave-balances.csv leave-history.csv
```

It reads each file as Logbook would and lists the rows it couldn't use, with the reason. It knows no workspace, so the preview in Slack still has the last word. An agent that can run commands on that machine does this itself.

The files' full format is in [File formats](/logbook/docs/reference/file-formats/); what each does is in [Set up teams from a file](/logbook/docs/admins/team-file/) and [Bring in leave balances and history](/logbook/docs/admins/imports/).
