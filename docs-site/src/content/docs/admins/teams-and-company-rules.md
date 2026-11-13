---
title: Teams and company rules
description: Set up teams, their approvers and vacation policy, and the company rules that most teams share.
sidebar:
  order: 2
---

Teams and the company rules decide who approves whose time off, who hears of decisions, and which vacation policy applies. HR and admins set them up.

A team holds its people and its level 1 approvers. Everything else (level 2, who hears of decisions, the vacation policy) comes either from the **company rules**, shared by most teams, or from the team's own rules.

## Teams

Open **More** → **Teams**. Each team shows its rules (company or own), its vacation policy, its approvers and its members. When a team has no approvers at all, it says that its requests go to HR or the admins.

### Create or edit a team

1. Click **➕ Add Team**, or choose **Edit Team** in a team's **⋯** menu.
2. Fill in the form (see the fields below).
3. Click **Submit**. The screen says the team was created or updated.

The fields:

- **Team Name**.
- **Rules**: **Company rules** or **Its own rules**. Choosing **Its own rules** adds the fields of its own rules to the form.
- **Members**: type a name to add someone. Someone in another team moves to this one, and their time off goes to this team's approvers from then on. Removing someone here takes them out of the team. Saving the form changes only the people it lists: inactive members, who aren't listed, stay in the team. A team of more than 100 people is changed person by person on **People**.
- **Level 1: managers**: up to five people with the Manager or Admin role. To choose someone else, give them one of these roles on [People](/logbook/docs/admins/people-and-roles/) first.
- **Level 1 rule**: tick **All listed approvers must approve** to need every one of them. Otherwise the first approval is enough.
- **Description**, optional.

With **Its own rules**, the team also has:

- **Vacation Policy**: a policy, or **No Policy** to only track time off.
- **Level 2: HR**: up to five people with the HR or Admin role.
- **Level 2 rule**: the same choice as for level 1.
- **Approval Notification Recipients**: up to five people who get a DM when a request is approved. Anyone in the workspace can be one.

Level 1 always comes from the team, also when it follows the company rules. Nobody approves their own request: a manager's own request skips them.

### Delete a team

Choose **Delete Team** in the team's **⋯** menu and confirm. A team that still has active members can't be deleted: move them to another team first.

## Company rules

The company rules hold what most teams share:

- **Vacation Policy**;
- **Level 2: HR** and the **Level 2 rule**;
- **Approval Notification Recipients**.

They apply to every team whose **Rules** are **Company rules**, and to everyone in no team. A team set to **Its own rules** uses its own values for all four instead. A team made by the [team file](/logbook/docs/admins/team-file/) follows the company rules.

To change them:

1. On **Teams**, click **⚙️ Company rules**.
2. Choose the policy, the level 2 approvers and their rule, and the recipients.
3. Click **Submit**. The screen says the company rules were saved.

Changes count from then on: a request already waiting keeps the approvers it was sent to. A request that went to nobody, because nobody could approve it, goes to the new approvers then. The notification recipients are read when a request is approved.

### People in no team

Someone in no team has no level 1. Their requests go to the company rules' level 2, and they have the company rules' vacation policy. When the company rules name no level 2, their requests go to HR, or to the admins when nobody has the HR role. See [Approve time off](/logbook/docs/approvers/approve-time-off/#when-nobody-on-the-team-can-approve).

Their submitted time waits for HR, or for the admins when nobody has the HR role. See [Approve time](/logbook/docs/approvers/approve-time/).

## The setup checklist

Until the workspace is set up, Home shows HR and admins **🚀 Set up Logbook** with how many of four steps are done. The next step is shown in full and the others in a line each, with a button to the screen that does it:

1. **Create a vacation policy**: done when the workspace has a policy. See [Policies and holidays](/logbook/docs/admins/policies-and-holidays/).
2. **Set the company rules**: done when the company rules name level 2 approvers, or when every team keeps its own rules.
3. **Create teams and pick their approvers**: done when a team has approvers. **📄 Set up from a file** sets up everyone at once.
4. **Put people in teams**: done when every active person has a team. Until then it counts the people without one.

**Bring in leave balances** (done once a leave file was applied; see [Bring in leave balances and history](/logbook/docs/admins/imports/)) and **Add projects** (for workspaces that track time) are listed too, as optional. The checklist goes away once the four steps are done.

The welcome message the installing admin gets lists these steps too.
