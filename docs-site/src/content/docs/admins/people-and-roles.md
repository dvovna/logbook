---
title: People and roles
description: Manage who is in Logbook, what role each person has, their team and contract start, and who can no longer use it.
sidebar:
  order: 1
---

This page helps you keep Logbook's people right: their roles, teams and contract start dates, and who is deactivated. HR and admins change people; managers can look.

## The People screen

Open **More** → **People**. It lists everyone in the workspace with their email, role and team, their contract start date when set, and, during the vacation year they joined in, the carryover HR entered for it.

- Filter by person, role or team with the selects at the top.
- Tick **Include inactive users** to see deactivated people too.
- Each person's **⋯** menu has **Edit User**, **View Vacation Usage** and **Deactivate User**. A deactivated person has only **Activate User**.

HR and admins see everyone and can use every menu item. A manager sees only the people of the teams that list them as level 1 approvers, and can open **View Vacation Usage** only.

## Roles

Each person has one role:

| Role | What it is for |
| --- | --- |
| Admin | Everything, including the roles below, vacation imports, the currency and the time off projects |
| HR | People, teams, policies and holidays; everyone's time off and time, without rates or amounts |
| Manager | Approves time off and time for the teams that list them |
| Finance | Rates, amounts, billing reports and snapshots; everyone's time in reports. Approves nothing |
| Member | Their own time off and time |

The full list is in [Roles and permissions](/logbook/docs/reference/roles-and-permissions/).

To change a role:

1. In the person's **⋯** menu, choose **Edit User**.
2. Pick the **Role**.
3. Click **Submit**.

Only an admin grants or removes the Admin or Finance role. HR can make someone a Manager, HR or Member, but not an admin or Finance, and can't change the role of someone who is already one. The workspace always keeps at least one active admin.

A role also decides who can approve. Level 1 of a team takes people with the Manager or Admin role, level 2 people with the HR or Admin role. When someone gets the Finance or Member role, which can't approve, the requests waiting for them move on to other approvers; see [Approve time off](/logbook/docs/approvers/approve-time-off/#when-a-request-or-an-approver-changes). When someone gets the Manager, HR or Admin role, or is activated again with one, a request that went to nobody, because nobody could approve it, goes to its approvers then, as a new request would; see [Approve time off](/logbook/docs/approvers/approve-time-off/#when-nobody-on-the-team-can-approve).

## Team, contract start and carryover

**Edit User** also sets:

- **Team**: the person's team, or **No Team**. Their time off goes to that team's approvers.
- **Contract Start Date**: the day their vacation year starts each year. Without one, their vacation year is the calendar year. Changing it moves their vacation year, and with it their balance and carryover.
- **Carryover Days**: days left from before they joined Logbook, for the vacation year they joined in. It can't be more than their policy's carryover limit. Later years carry over what is left on their own.

See [Policies and holidays](/logbook/docs/admins/policies-and-holidays/) for how the vacation year and carryover work. A [vacation import](/logbook/docs/admins/imports/) also sets contract start dates.

## Deactivate someone

1. In the person's **⋯** menu, choose **Deactivate User**.
2. Confirm with **Deactivate User**.

A deactivated person can't use Logbook: their Home says their access is turned off. Time off requests that waited for their approval move on to other approvers, and time entries that waited for them wait for the next approvers in line. They are left out of the team file.

To bring someone back, tick **Include inactive users**, then choose **Activate User** in their **⋯** menu.

Only an admin deactivates or activates an admin.

### When a Slack account is deactivated

When someone's Slack account is deactivated, Logbook deactivates them too, with the same effects. Reactivating the account in Slack doesn't reactivate them in Logbook: HR or an admin does that with **Activate User**.

## Where people come from

You don't add people by hand. Logbook takes them from Slack:

- **On install**, it imports every member of the workspace who is a person with an email, leaving out bots and deactivated accounts. They come in as Members, in no team, with no contract start date. Whoever installs Logbook is its first admin.
- **When someone joins Slack** later, they are added right away, with the day they join as their contract start date. They come in as Members, whatever their role in Slack. Logbook's roles are set in Logbook: an admin or HR gives them in **Edit User**.
- **Once a day**, Logbook imports any member it is missing, for example someone who joined while Logbook was restarting. It only adds people: everyone it already has keeps their role, team and status.

Name and email changes in Slack come over to Logbook.

## The question about a new person

When someone new joins after the first import, HR gets a DM asking which team they are on. Without anyone with the HR role, the admins get it. It is only sent when the workspace has at least one team.

The message names the person and says where their requests go until they have a team. To answer:

- Choose the team in **Choose a team**. The person moves to it.
- Or click **Not yet** to leave them without a team for now.

The first answer counts. Everyone's message then says who placed the person where, or that they were left without a team. Placing the person any other way (the team form, **Edit User** or the [team file](/logbook/docs/admins/team-file/)) closes the questions too.
