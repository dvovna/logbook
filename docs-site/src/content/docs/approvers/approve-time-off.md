---
title: Approve time off
description: Decide the time off requests that wait for you, from Slack messages or the Approvals screen, and approve for approvers who are away.
sidebar:
  order: 1
---

This page helps you decide time off requests: approve them, reject them with a reason, or ask the requester something first. Managers, HR and admins approve. Nobody approves their own request.

## The message you get

When a request waits for you, Logbook sends you a direct message. It shows who asks, the dates (calendar and working days), the leave type, the requester's comment and any approver comments. A line under it helps you decide:

- **Balance after**: what the requester has left once this request counts, for annual leave and bonus days under a vacation policy.
- **Also off**: up to five teammates who have approved or pending time off on some of those days. You see sick leave there too; the requester doesn't.
- **Level 1 of 2**, when the request has two levels, and who approved the level before yours.

The balance and the teammates are taken when the request is sent for approval and don't change afterwards.

The message has three buttons:

- **Approve ✅** approves at once. Logbook updates the message to show who approved.
- **Reject ❌** opens **Reject Request** with an optional **Reason**. The requester gets the reason with the decision, and every approver's message shows it.
- **Comment 💬** opens **Add Comment**. The comment shows on the messages of everyone at your level, and the requester gets it in a DM right away, with **View Details** and **Cancel Request** buttons.

## Levels

A request goes through up to two levels:

1. **Manager approval**: the managers the requester's team lists under **Level 1: managers**.
2. **HR approval**: the people under **Level 2: HR**, from the team's own rules or from the company rules. The level is called **Admin approval** when everyone on it is an admin.

Each level has a rule, shown on **Teams** as "any one" or "all":

- "Any one", the default: the first approval completes the level. The other approvers' messages show who approved.
- "All", when **All listed approvers must approve** is ticked: every listed approver has to approve, and the level waits until they have.

One rejection at any level rejects the request, also under "all". When a level is done, the next one gets its messages, and the requester gets a DM: who approved and who decides next.

Logbook leaves out the requester, and anyone deactivated or without the Manager, HR or Admin role. A level with nobody left is skipped. Someone in no team has no level 1: their request starts at the company rules' level 2.

If you approved level 1 and you are also on level 2, you aren't asked again: your level 2 step is approved as you. With "any one" that completes level 2; with "all" the others still decide.

See [Teams and company rules](/logbook/docs/admins/teams-and-company-rules/) for how levels are set up.

## When nobody on the team can approve

When neither level has anyone who can decide (no team, no approvers, or the requester is the only one), the request goes to everyone with the HR role as one level, any one of them. With nobody on HR it goes to every admin. The requester is told where it went and why.

If there is nobody at all, the request stays pending and the requester is told that nobody can approve it yet. It goes for approval once someone can: when someone gets the Manager, HR or Admin role or is activated again, or a team's approvers or the company rules name someone new. It then goes where a new request would, and the requester is told where. Until then, HR or an admin can set its status with **Edit Request** on **All requests**.

## The Approvals screen

**Approvals** in the navigation row shows how much waits for you: **Approvals (3)**. Home also says **Needs your attention** with an **Open Approvals** button.

Under **Time off** you see up to ten requests that wait for you, oldest first. **All requests** opens the rest. Each request has:

- **Approve**, which asks you to confirm in **Approve Request**;
- **Reject**, which opens the same **Reject Request** form as the message;
- a **⋯** menu with **Comment** and **View details**.

After a decision the screen says what happened. If someone else decided first, or the request changed or was canceled meanwhile, it says the request was not decided and why.

## Approve for approvers who are away

HR and admins can move a request on when its approvers are away.

1. Open **Approvals** and click **All pending requests**. **All requests** opens with only pending requests.
2. In the request's **⋯** menu, choose **Approve for Approvers**.
3. The form names who the request waits for. Click **Approve for Approvers** to confirm.

Logbook approves every open step of the level the request waits on, under either rule. The request moves on to the next level, or is approved when there is none. You can't do this for your own request.

## When a request or an approver changes

- **An edit.** When HR or an admin changes the dates, type or person of a pending request with **Edit Request**, the open approval closes and starts again: everyone is asked again about the request as it is now. A change to the comment only leaves the approval as it was.
- **A status set by hand.** When HR or an admin sets a request to approved or rejected with **Edit Request**, from pending or from the other decision, that is a decision by them. The approvers' messages close, and the decision messages below go out as if the approvers had decided, naming HR or the admin as who decided. Setting the status of a request its requester canceled only records it: nobody is told.
- **Canceled or deleted.** The approvers' messages lose their buttons and say who canceled or deleted it.
- **An approver can no longer decide.** When an approver is deactivated, or gets the Finance or Member role, which can't approve, their open steps close. If nobody else is left on that level, the request moves on as a new one would: to the next level, or, with none left, to HR or the admins. If someone on that level had already approved under "all", the level counts as done.

## Who hears of the decision

When the approvers decide, or HR or an admin sets the status with **Edit Request**:

- The requester gets a DM: approved or rejected, by whom, the reason and the approver comments. An approved request may carry a button to log it as time; see [Time off as time](/logbook/docs/everyone/time-off-as-time/).
- When it is approved, the team's **Approval Notification Recipients** get a DM too. They come from the team's own rules or the company rules, as they are at the time of the decision. They hear nothing of a rejection.
- Every approver's message shows the decision and who made it, HR or the admin after **Edit Request**.

All messages are listed in [Notifications](/logbook/docs/reference/notifications/).
