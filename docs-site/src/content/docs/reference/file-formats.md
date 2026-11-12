---
title: File formats
description: The columns and rules of the files Logbook reads (vacation history, the team file) and writes (time report and billing snapshot CSVs).
sidebar:
  order: 4
---

The files you send to Logbook, and the ones it sends you. You send a file in your conversation with Logbook: its **Messages** tab in Slack.

| File | Direction | Who | How-to |
| --- | --- | --- | --- |
| `user-vacations.csv` | You send it | Admins | [Imports](/logbook/docs/admins/imports/) |
| The team file | Logbook sends a template, you send it back | HR and admins | [Team file](/logbook/docs/admins/team-file/) |
| Time report CSV | Logbook sends it | Everyone, for the time they see | [Time reports](/logbook/docs/finance/time-reports/) |
| Billing snapshot CSV | Logbook sends it | Admin and Finance | [Billing](/logbook/docs/finance/billing/) |

## `user-vacations.csv`

Sets each person's contract start date and replaces all their time off with the time off in the file.

| Rule | Value |
| --- | --- |
| File name | Exactly `user-vacations.csv` |
| Separator | `;` |
| First line | A header with the column names below |
| Lines | One person per line, up to 1000 lines |
| Size | Up to 1 MB |
| Dates | `YYYY-MM-DD` |

Columns, in this order:

| Column | Required | Value |
| --- | --- | --- |
| `email` | Yes | The person's email, exactly as Logbook has it. |
| `contractStartDate` | Yes | When their contract started. Their vacation year runs from it. |
| `vacation[0].startDate` | No | The first day of the first time off. |
| `vacation[0].endDate` | With a start date | Its last day, not before the first. |
| `vacation[0].type` | With a start date | One of the types below. |
| `vacation[0].status` | With a start date | One of the statuses below. |
| `vacation[1].startDate` … | No | The next time off, with the same four columns and the next number, up to `vacation[99]`. |

| Type | Means |
| --- | --- |
| `annual_leave` | Annual leave |
| `bonus_day` | Bonus day |
| `sick_leave` | Sick leave |
| `unpaid_leave` | Unpaid leave |
| `other` | Other |

| Status | Means |
| --- | --- |
| `pending` | Waits for approval |
| `approved` | Approved |
| `rejected` | Rejected |
| `canceled` | Canceled |

Example, with room for two vacations a person:

```text
email;contractStartDate;vacation[0].startDate;vacation[0].endDate;vacation[0].type;vacation[0].status;vacation[1].startDate;vacation[1].endDate;vacation[1].type;vacation[1].status
anna@example.com;2022-03-01;2026-07-06;2026-07-10;annual_leave;approved;2026-09-14;2026-09-14;bonus_day;pending
bo@example.com;2023-01-09;2026-05-04;2026-05-08;sick_leave;approved;;;;
```

- Every line has as many fields as the header, or the file is refused. Leave the fields of vacations a person doesn't have empty, as on the last line.
- A person's time off ends at the first empty start date.
- A line whose email isn't an active person's in Logbook is skipped; the other lines are imported.
- A line with a missing or wrong field (an email that isn't one, a date, type or status Logbook doesn't know, an end before its start) stops the whole file: nothing is imported, and the answer lists the problems.
- A file with no header (its first line has to start with `email;contractStartDate`) or with no lines below it isn't imported: the answer says why and shows the header.
- A person on several lines gets the last one. The earlier lines are skipped, and the answer lists them.
- The summary counts **Created** (time off requests added), **Updated** (people whose time off was replaced) and **Skipped** (lines left out).

:::caution
The import replaces all of a person's time off, including requests that wait for approval: their approvers' messages close. A line with a contract start and no vacations removes all the person's time off.
:::

Imported time off goes through no approval and sends nobody a message. Its working days follow the holidays of the person's vacation policy.

## The team file

Places people in teams and names the team leads. Logbook sends you a template with everyone's current team when you click **📄 Set up from a file** on **Teams**. You fill it in and send it back.

| Rule | Value |
| --- | --- |
| Format | CSV (`.csv`) or Excel (`.xlsx`). Excel: the first sheet. |
| File name | Any name ending in `.csv` or `.xlsx`, other than `user-vacations.csv` |
| Where | Your conversation with Logbook. A team file shared in a channel is ignored. |
| CSV separator | `,` or `;`, whichever the header line uses |
| CSV encoding | UTF-8. In Excel, save as "CSV UTF-8", or send the `.xlsx`. |
| First row | A header naming the columns |
| Rows | Up to 1000 |
| Size | Up to 1 MB |

Columns, in any order. Header names ignore case and spaces, and other columns are ignored.

| Column | Required | Value |
| --- | --- | --- |
| `Name` | No | The person's name, to help you read the file. |
| `Email` | Yes | The email of a person in Logbook who is active. Each person once. |
| `Team` | Yes | The team's name. A name that matches no team creates one (up to 50 characters, within the workspace's team limit). Letter case and extra spaces don't matter unless two teams differ only in them. Empty: the person leaves their team. |
| `Team lead` | No | `yes`, `y`, `x`, `true` or `1` for a lead; empty, `no`, `n`, `false` or `0` for anyone else. |

Example:

```text
Name,Email,Team,Team lead
Ada Lovelace,ada@example.com,Engineering,yes
Bob Smith,bob@example.com,Engineering,
Cleo Diaz,cleo@example.com,Sales,yes
Dan Wu,dan@example.com,,
```

- People who aren't in the file stay as they are.
- A team lead becomes one of the team's **Level 1: managers**. A Member marked as a lead becomes a Manager. A lead of the team who is in the file without the mark stops being one.
- A lead needs a team. People with the HR or Finance role can't be leads, and a team can have up to 5 leads.
- A row Logbook can't use is listed in the preview with the reason; the other rows still apply.
- Nothing changes until you click **Apply**. The preview stays open for 7 days, and **Undo** works for 7 days after **Apply**.

## Time report CSV

The entries of the time report on show on **Reports**, one line each, sorted by date, person and project. The name is `time-report-<from>-to-<to>.csv`. It holds up to 200,000 entries.

| Column | Value |
| --- | --- |
| Date | `YYYY-MM-DD` |
| Person | The person's name |
| Email | The person's email |
| Team | The team the time was logged in |
| Client | The project's client |
| Project | The project |
| Description | What the person wrote |
| Hours | Decimal hours with two decimals: `1.50` is 1h 30m |
| Billable | `yes` or `no` |
| Status | `draft`, `submitted`, `approved`, `rejected` or `cancelled` |
| Rate | Admin and Finance only. The person's own rate on the project, else the project's, as it is today. Empty when there is none. |
| Amount | Admin and Finance only. Billable hours × rate, rounded to the cent. Empty for time that isn't billable or has no rate. |
| Currency | Admin and Finance only. The workspace's currency, such as `USD`. |

## Billing snapshot CSV

The entries locked in one billing snapshot, one line each, sorted by date, person and project. All lines are one client's approved time, so there is no Client or Status column. The name is `billing-<client>-<from>-to-<to>.csv`.

| Column | Value |
| --- | --- |
| Date | `YYYY-MM-DD` |
| Person | The person's name |
| Email | The person's email |
| Team | The team the time was logged in |
| Project | The project |
| Description | What the person wrote |
| Hours | Decimal hours with two decimals |
| Billable | `yes` or `no` |
| Rate | The rate the snapshot locked. Empty when there was none. |
| Amount | The amount the snapshot locked, rounded per entry so the lines add up to the snapshot's total. Empty without a rate. |
| Currency | The snapshot's currency |

## How Logbook writes CSV files

The time report CSV, the billing snapshot CSV and the team file template are written so that a spreadsheet opens them as they are:

| Rule | Value |
| --- | --- |
| Encoding | UTF-8, starting with a byte order mark, so Excel reads names in any alphabet |
| Separator | `,` |
| Line ends | CRLF |
| Quotes | A field with a comma, a quote or a line break is put in double quotes; a quote inside is doubled. |
| Formula guard | Text people typed that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front, so a spreadsheet doesn't run it as a formula. Logbook drops that `'` again when it reads a team file. |
