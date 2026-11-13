---
title: Roles and permissions
description: What Admin, HR, Manager, Finance and Member can see and do in Logbook, and who may give each role.
sidebar:
  order: 1
---

Every person in Logbook has one role. Use this page to check what a role can see and do before you give it to someone.

| Role | In short |
| --- | --- |
| Admin | Everything, including rates, billing, receipts, the currency and deleting time off requests. |
| HR | People, teams, policies and everyone's time off. Sees everyone's time, without rates or amounts. |
| Manager | Approves time off and time for the teams that list them under **Level 1: managers**, and sees those teams' people and time. |
| Finance | Rates, amounts, billing reports and billing snapshots, and checking receipts for reimbursements. Sees everyone's time in reports. Requests time off and logs time like a member, approves nothing and manages no people. |
| Member | Requests time off, logs and submits time, and sees their own time in reports. |

In the tables below:
- **Yes**: can do it.
- **—**: can't.
- **Own**: only for themselves.
- **Their teams**: the teams that list the manager under **Level 1: managers**. A manager of no team sees only their own.

## Screens

| Screen | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| **Home**, **My time**, **Time off** | Yes | Yes | Yes | Yes | Yes |
| **Approvals** | Yes | Yes | Yes | — | — |
| More → **People** | Yes | Yes | Their teams | — | — |
| More → **Reports** | Yes | Yes | Yes | Yes | Yes |
| More → **Teams**, **Policies** (and a policy's **Holidays**) | Yes | Yes | — | — | — |
| More → **Projects**, **Clients** | Yes | Yes | Yes | Yes | — |
| **My receipts** (from **Home**) | Yes | Yes | Yes | Yes | Yes |
| More → **🧾 Receipts**, and its **⚙️ Reimbursements** | Yes | — | — | Yes | — |
| Time off → **All requests** | Yes | Yes | Their teams | — | — |
| Reports → **Time logs** | Yes | Yes | — | — | — |
| Reports → **Billing snapshots** | Yes | — | — | Yes | — |
| The setup checklist on **Home** | Yes | Yes | — | — | — |

## Time off

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| Request time off, see the balance, cancel a pending request | Own | Own | Own | Own | Own |
| See others' requests (**All requests**) | Yes | Yes | Their teams | — | — |
| Add a request for someone else, or one that is already approved or rejected (**➕ Add Vacation Request**) | Yes | Yes | — | — | — |
| Change a request (**Edit Request**) | Yes | Yes | — | — | — |
| Delete a request (**Delete Request**) | Yes | — | — | — | — |
| Bring in leave balances and history (**📥 Import leave**, the leave files) | Yes | Yes | — | — | — |
| Log approved time off as time (the button in the DM) | Own | Own | Own | Own | Own |

## Approvals

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| Approve, reject or comment on a time off request asked of them | Yes | Yes | Yes | — | — |
| Decide or comment on a step asked of another approver | Yes | Yes | — | — | — |
| Approve the waiting level for its approvers (**Approve for Approvers**) | Yes | Yes | — | — | — |
| Approve or reject submitted time | Yes | Yes | Their teams | — | — |
| See and decide anyone's submitted time (**📋 All pending entries**) | Yes | Yes | — | — | — |
| Approve their own time off or time | — | — | — | — | — |

Who is asked:
- **Level 1: managers** of a team lists people with the Manager or Admin role.
- **Level 2: HR**, in the company rules or a team's own rules, lists people with the HR or Admin role.
- When nobody listed can decide (no team, no approvers, or the requester is the only one), a time off request goes to everyone with the HR role, or to the admins when nobody has the HR role. Submitted time works the same way.
- A requester is always left out of their own request's levels.

## Time

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| Log, edit and submit time (**Log Time**, **✏️ Fill in the week**, `/log`) | Own | Own | Own | Own | Own |
| Log on projects assigned to their team or to them | Yes | Yes | Yes | Yes | Yes |
| Log on any active project | Yes | Yes | — | — | — |
| Log, edit and delete time for someone else | Yes | Yes | — | — | — |
| See everyone's entries (**Time logs**) | Yes | Yes | — | — | — |

Nobody changes time that is in a billing snapshot, Admin included, until an admin unlocks the snapshot.

## Receipts

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| Send, edit and delete their own receipts, turn their reminders off | Own | Own | Own | Own | Own |
| Add, edit and archive reimbursements | Yes | — | — | Yes | — |
| See, accept and reject people's receipts, open a file, download a month | Yes | — | — | Yes | — |
| Decide on their own receipt | Only if there is no other active person with the Admin or Finance role | — | — | Only if there is no other active person with the Admin or Finance role | — |

## Reports

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| Time report and its CSV: whose time | Everyone's | Everyone's | Their teams' and own | Everyone's | Own |
| Rates and amounts in time reports and their CSV | Yes | — | — | Yes | — |
| Filter by project | Yes | Yes | Yes | Yes | Own projects |
| Filter by client or person, and **Who hasn't submitted** | Yes | Yes | Yes | Yes | — |
| Billing report, **🧾 Uninvoiced** report | Yes | — | — | Yes | — |

## Billing

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| **🔒 Lock in a snapshot** | Yes | — | — | Yes | — |
| See snapshots, send their CSV, mark them invoiced or not invoiced | Yes | — | — | Yes | — |
| **Unlock** a snapshot | Yes | — | — | — | — |

## People

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| See people | Yes | Yes | Their teams | — | — |
| **View Vacation Usage** | Yes | Yes | Their teams | — | — |
| **Edit User**: role, team, contract start, carryover | Yes | Yes, see the rules below | — | — | — |
| **Deactivate User**, **Activate User** | Yes | Yes, except admins | — | — | — |
| Answer the question about a new person's team | Yes | Yes | — | — | — |

## Teams, policies and holidays

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| Create, edit and delete teams | Yes | Yes | — | — | — |
| **⚙️ Company rules** | Yes | Yes | — | — | — |
| **📄 Set up from a file** (the team file) | Yes | Yes | — | — | — |
| Policies, holidays and the holiday import | Yes | Yes | — | — | — |

## Projects and clients

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| See projects and clients | Yes | Yes | Yes | Yes | — |
| Add, edit, archive and restore clients | Yes | Yes | — | Yes | — |
| Add and edit projects (the form has the rate) | Yes | — | — | Yes | — |
| Assign teams and people to a project | Yes | Yes | Yes | — | — |
| Archive a project | Yes | Yes | Yes | Yes | — |
| See rates, set a project's rate and people's own rates | Yes | — | — | Yes | — |

## Settings

| Action | Admin | HR | Manager | Finance | Member |
| --- | --- | --- | --- | --- | --- |
| **Change currency** | Yes | — | — | — | — |
| **🌴 Time off projects** (time off as time) | Yes | — | — | — | — |

## How people get their roles

- The person who installs Logbook becomes its first admin.
- Everyone else in the Slack workspace is added as a Member, a few seconds after the install and by the daily import of members.
- When Slack tells Logbook that someone joined the workspace, they are added as a Member, whatever their role in Slack. Slack never changes a role in Logbook.
- Installing Logbook again keeps everyone's role. Whoever installs it again doesn't become an admin.
- HR and admins change roles in More → **People** → ⋯ → **Edit User**. See [People and roles](/logbook/docs/admins/people-and-roles/).

## Rules for changing roles

- Only an admin gives or takes away the Admin or Finance role, and only an admin deactivates an admin. HR can change any other role and deactivate anyone else.
- Applying a team file makes a Member marked as **Team lead** a Manager. **Undo** puts the role back. People with the HR or Finance role can't be team leads in the file. See [Team file](/logbook/docs/admins/team-file/).
- When an approver is deactivated or no longer has the Manager, HR or Admin role, the steps waiting for them close and their requests move on.
- A deactivated person can't use Logbook. Deleting someone's Slack account deactivates them in Logbook, but nothing in Slack makes them active again: HR or an admin does, with **Activate User**.
- Logbook checks the role on every action, not only by hiding buttons: a role can't do what this page says it can't, whatever it clicks.
