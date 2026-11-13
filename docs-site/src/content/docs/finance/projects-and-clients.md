---
title: Projects and clients
description: Set up the clients and projects people log time on, and choose who can log on each one.
sidebar:
  order: 1
---

Time in Logbook is logged on projects. A project can belong to a client, which lets reports and billing group time by customer. This page is for the people who set them up.

Open **☰ More** and choose **💼 Clients** or **📁 Projects** under Settings.

## Who can do what

| Action | Admin | HR | Manager | Finance |
| --- | --- | --- | --- | --- |
| See Clients and Projects | yes | yes | yes | yes |
| Add, edit, archive or restore a client | yes | yes | no | yes |
| Add or edit a project | yes | no | no | yes |
| **Manage Assignments** | yes | yes | yes | no |
| Archive or restore a project | yes | yes | yes | yes |
| **Person Rates**, hourly rate | yes | no | no | yes |

Members don't see these screens. They log time on the projects they are assigned to. See [Roles and permissions](/logbook/docs/reference/roles-and-permissions/) for the full list.

## Clients

A client is a customer whose projects you track time on. It has a **Client Name** and an optional **Description**.

1. Open **💼 Clients** and choose **➕ Add Client**.
2. Fill in **Client Name**, and a **Description** if you want one.
3. Submit the form. The list shows a notice that the client was created.

Use the menu next to a client to **Edit Client** or **Archive Client**. An archived client stays in reports and billing, and its projects keep their time. Choose **Include Archived Clients** to see archived ones, and **Restore Client** to bring one back.

## Projects

A project has:

- **Project Name**.
- **Client**: pick one, or **No Client**.
- **Billable**: **Yes** or **No**. Time logged on the project takes its client and its billable setting from the project.
- **Hourly rate**: optional. See [Rates and currency](/logbook/docs/finance/rates-and-currency/).
- **Project Status**: **🟢 Active**, **⏸️ On hold** or **🏁 Completed**.
- **Description**: optional.

To add a project, open **📁 Projects**, choose **➕ Add Project** and fill in the form. To change one, open its menu and choose **Edit Project**.

The list shows each project's client, status, billable setting, teams and people. Once there are projects, use **Find Project**, **Status** and **Billable** to filter it, and **Include Archived Projects** to include archived ones. Before the first project, the screen has none of these.

### Archive a project

Projects are never deleted, so their time stays in reports and billing.

1. Open the project's menu and choose **Archive Project**.
2. Confirm.

An archived project shows its archive date and can only be restored, with **Restore Project**. Nobody can log new time on an archived project.

## Choose who can log on a project

People log time only on projects assigned to them. A person can log on a project when they belong to an assigned team or are assigned directly.

1. Open the project's menu and choose **Manage Assignments**.
2. Under **Project Teams**, pick up to 30 teams. Everyone on those teams can log on the project.
3. Under **Project Users**, search for and pick up to 30 people.
4. Submit the form. The list shows **✅ Assignments saved.**

Saving replaces the earlier assignments. Admin and HR can log time on any active project, whatever its assignments. A manager can find every person when assigning, because projects belong to the whole workspace.

:::note
Removing a person or team from a project doesn't delete the time they already logged there.
:::

## Related

- [Rates and currency](/logbook/docs/finance/rates-and-currency/)
- [Log time](/logbook/docs/everyone/log-time/)
- [Time reports](/logbook/docs/finance/time-reports/)
