---
title: Billing
description: Show a client's billable time, lock it in a snapshot for an invoice, and track what is not yet invoiced.
sidebar:
  order: 4
---

Billing is for Admin and Finance. Logbook shows what to bill and locks that time in place. **It doesn't make invoices**: you create those in your own tool.

## Billing report

The billing report shows a client's approved time for a period, with rates and amounts.

1. Open **Reports** and choose **📊 Billing report**.
2. Choose the **Client**, which can be an archived one.
3. Pick a **Quick period** or set **From** and **To**.
4. Choose **Show report**.

The report counts approved entries of the client's projects. It shows:

- a table of each person's time on each project, with **Hours**, **Billable**, **Rate** and **Amount**, and a total row;
- the totals **By project** and **By person**, each only when there is more than one project or person and the table spreads their time over several rows;
- **No rate**: billable time with no rate, counted apart and not in the amount;
- **Not approved yet**: time that waits for approval and isn't in the report;
- **In billing snapshots already**: how much of the approved time a snapshot already holds.

The report uses today's rates. A snapshot freezes them.

## Lock in a snapshot

A snapshot locks a client's approved time of a period, with its rates, so the invoice you make from it stays right.

1. Show the client's billing report.
2. Choose **🔒 Lock in a snapshot**. The button appears while some of the report's approved time isn't in a snapshot.
3. Logbook shows what it would lock: the number of entries, the time, the billable time, and the amount at today's rates. It also shows any time with no rate.
4. Choose **Lock** to confirm.

A snapshot takes the approved time of the client's projects, archived ones too, that is in no snapshot yet. Making a second snapshot of the same period only takes time approved since the first. Each line keeps the person's or project's rate and the amount, rounded per entry.

:::caution
Nobody can change a snapshot's entries until an admin unlocks it: not edit, delete or change their status. This is true for admins too.
:::

The snapshot is made after Slack gets its answer, because a big client's year can take a while. When it is ready, **Billing snapshots** opens with a notice, such as **🔒 Acme · 1–31 Oct 2026 locked**, with the entries, time and amount. If it fails, Reports says **Nothing was locked** and why, and the time stays available to lock again. A failure leaves nothing half-made.

## Billing snapshots

Open **Reports → 🔒 Billing snapshots**. It lists snapshots, newest first. Use the client filter (**All clients** by default) to narrow the list.

Each snapshot shows its time, billable time, amount, entries, status and who created it. The status is **🔒 Locked, not invoiced yet** or **✅ Invoiced** with a date. Use the menu next to a snapshot:

| Menu item | What it does | Who |
| --- | --- | --- |
| **Send CSV to my DMs** | Sends the snapshot's entries as a file | Admin, Finance |
| **Mark as invoiced** | Records that you invoiced it. It stays locked. | Admin, Finance |
| **Mark as not invoiced** | Removes the invoiced mark. It stays locked. | Admin, Finance |
| **Unlock** | Deletes the snapshot, so its entries can change again | Admin only |

The snapshot's CSV has one line per entry: Date, Person, Email, Team, Project, Description, Hours, Billable, Rate, Amount and Currency, with the rate and amount frozen in the snapshot. It follows the same rules as the [time report CSV](/logbook/docs/finance/time-reports/): one at a time, retried if Slack fails, and a DM if it can't be sent.

### Unlock a snapshot

1. An admin opens the snapshot's menu and chooses **Unlock**.
2. Read the confirmation, then choose **Unlock**.

The snapshot is deleted. Its entries can change again, and count as uninvoiced until another snapshot takes them. For a snapshot marked invoiced, the form warns that the invoice was sent and that changed time won't match it.

## Uninvoiced report

The uninvoiced report shows what you haven't invoiced yet.

1. On Reports, choose **🧾 Uninvoiced**.
2. Pick a **Quick period**, including **All time**, or set dates. A date left empty means no limit on that side.
3. Choose **Show report**.

For each client it shows:

- **Not in a snapshot**: approved billable time that isn't locked yet, with its **Amount** at today's rates and the earliest day (**Since**);
- **In snapshots**: time of snapshots not marked invoiced, with the **Snapshot amount** at their frozen rates.

Time on projects with no client isn't in it. Mark snapshots as invoiced in Billing snapshots and they leave the report.

## Related

- [Rates and currency](/logbook/docs/finance/rates-and-currency/)
- [Time reports](/logbook/docs/finance/time-reports/)
- [Projects and clients](/logbook/docs/finance/projects-and-clients/)
