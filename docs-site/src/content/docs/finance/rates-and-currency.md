---
title: Rates and currency
description: Set hourly rates for projects and for individual people, and the currency of all amounts.
sidebar:
  order: 2
---

Rates turn billable hours into amounts in reports, billing reports and snapshots. Only Admin and Finance work with them.

## Who sees rates

Admin and Finance see and set rates and see amounts. Nobody else does, **HR included**. For everyone else the project form has no rate field, Projects shows no rates or currency, and reports and CSV files have no amount columns.

Only an admin changes the currency.

## A project's hourly rate

A project's hourly rate is what an hour of billable time costs the client.

1. Open **📁 Projects**, open the project's menu and choose **Edit Project**, or choose **➕ Add Project**.
2. Fill in **Hourly rate** (the field names the workspace currency).
3. Submit the form.

Enter a number from 0 to 1,000,000 with at most two decimals, such as `120` or `95.50`. Leave it empty for no rate: the project's billable time then has no amount.

The project list shows the rate as **Rate** and any people's own rates as **Own rates**.

## A person's own rate

A person can have their own rate on a project, which replaces the project's rate for their time on it.

1. Open the project's menu and choose **Person Rates**.
2. The form shows the project's rate and the own rates set so far.
3. Choose the **Person**, and enter their **Hourly rate**.
4. Choose **Save**. Projects shows a notice with the new rate.

To remove a person's own rate, choose the person and leave the rate empty. The project's rate applies again.

A person's own rate stays when they are no longer assigned to the project, so past time keeps its price.

## What a rate does to past time

Reports use today's rates, so changing a rate changes the amounts of reports you show afterward. A [billing snapshot](/logbook/docs/finance/billing/) keeps the rates it was made with and doesn't change.

Billable time with no rate, from the project or the person, has no amount. Reports count it apart, as **No rate**, so it is never lost.

## Currency

The workspace has one currency, shown on Projects as **Rates and amounts are in USD** (or the current code).

1. An admin opens **📁 Projects** and chooses **Change currency**.
2. Enter the three-letter ISO 4217 **Currency code**, such as `USD`, `EUR` or `GBP`.
3. Choose **Save**.

:::caution
Changing the currency doesn't convert anything. The rates keep their numbers, so a rate of 100 USD becomes 100 EUR. Update the rates if they should differ.
:::

## How amounts are worked out

Amounts are whole cents. For each entry, Logbook multiplies the billable time by the rate and rounds the result to the cent. Totals add up the rounded amounts of the entries, so the lines of a report or snapshot always add up to its total.

## Related

- [Projects and clients](/logbook/docs/finance/projects-and-clients/)
- [Billing](/logbook/docs/finance/billing/)
- [Time reports](/logbook/docs/finance/time-reports/)
