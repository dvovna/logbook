---
title: Import vacation history
description: Load people's contract start dates and past time off from a CSV file, so balances start right.
sidebar:
  order: 5
---

This page helps you bring time off from before Logbook into it, so that everyone's balance is right from the start. Only admins can import.

The import reads `user-vacations.csv`. For each person in it, it sets the contract start date and replaces all their time off requests with the ones in the file.

## Import a file

1. Type `/upload-vacations` in any channel, or open **More** → **People** and click **📥 Import vacations (CSV)**. Logbook shows you how to import, with the format.
2. Save your file as `user-vacations.csv`. The name has to be exactly this: Logbook recognizes the import by its name.
3. Upload it in your conversation with Logbook: open Logbook's **Messages** tab and drag the file in.
4. Logbook imports it and answers with a summary.

The summary counts the lines, for example "Imported `user-vacations.csv`: Created 0 · Updated 12 · Skipped 1". **Updated** counts the people whose time off was replaced, **Skipped** the lines left out. When there were problems, it lists the first ten.

## What it replaces

For each person in the file, the import:

- sets their **Contract Start Date**, which starts their vacation year (see [Policies and holidays](/logbook/docs/admins/policies-and-holidays/#the-vacation-year));
- deletes every time off request they have, whatever its status or year;
- adds the requests of the file, with the statuses it gives.

:::caution
The import replaces a person's whole history. Put all of their time off in the file, not only what is missing.
:::

What else to know:

- Approvers of a pending request that the import replaces see their message closed.
- The imported requests send no messages: pending ones are not sent to approvers, and approved ones offer no [time off as time](/logbook/docs/everyone/time-off-as-time/).
- Hours already logged for a replaced request stay as time entries.
- The import doesn't check balances or overlapping dates.
- People who aren't in the file keep their time off.

## When a line is refused

- A line whose email Logbook doesn't know, or of someone deactivated, is skipped. The other lines are imported.
- When any line is malformed (an invalid email or date, a request that ends before it starts, an unknown type or status), nothing is imported. Fix the file and upload it again.
- When a person is on several lines, the last one counts.

## The format, in short

A CSV with fields separated by `;`. The first line names the columns. Each line after it is one person: their email, their contract start, then four fields for each request.

```
email;contractStartDate;vacation[0].startDate;vacation[0].endDate;vacation[0].type;vacation[0].status;vacation[1].startDate;vacation[1].endDate;vacation[1].type;vacation[1].status
anna@example.com;2022-03-01;2026-07-06;2026-07-10;annual_leave;approved;2026-09-14;2026-09-14;bonus_day;pending
bo@example.com;2023-01-09;2026-05-04;2026-05-08;sick_leave;approved;;;;
```

- Add four columns to the first line for each further request: `vacation[2].startDate` and so on.
- Every line has as many fields as the first line. Leave the fields of requests a person doesn't have empty, as on the last line above.
- Dates are `YYYY-MM-DD`.
- Types: `annual_leave`, `bonus_day`, `sick_leave`, `unpaid_leave`, `other`.
- Statuses: `pending`, `approved`, `rejected`, `canceled`.
- Up to 1,000 lines, 100 requests a person and 1 MB.

The full format is in [File formats](/logbook/docs/reference/file-formats/).
