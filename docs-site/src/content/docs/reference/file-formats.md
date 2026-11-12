---
title: File formats
description: The columns and rules of the files Logbook reads (leave balances and history, the team file) and writes (time report and billing snapshot CSVs).
sidebar:
  order: 4
---

The files you send to Logbook, and the ones it sends you. You send a file in your conversation with Logbook: its **Messages** tab in Slack.

| File | Direction | Who | How-to |
| --- | --- | --- | --- |
| `leave-balances.csv` | Logbook sends a template, you send it back | HR and admins | [Leave balances and history](/logbook/docs/admins/imports/) |
| `leave-history.csv` | Logbook sends a template, you send it back | HR and admins | [Leave balances and history](/logbook/docs/admins/imports/) |
| The team file | Logbook sends a template, you send it back | HR and admins | [Team file](/logbook/docs/admins/team-file/) |
| Time report CSV | Logbook sends it | Everyone, for the time they see | [Time reports](/logbook/docs/finance/time-reports/) |
| Billing snapshot CSV | Logbook sends it | Admin and Finance | [Billing](/logbook/docs/finance/billing/) |

Logbook tells the files you send apart by their columns, not their names: a team file has **Email** and **Team**; a leave balances file has **Email** and at least one of **Contract start**, **Days left**, **Working days left** and **Bonus days left**, and no **Team**; a leave history has **Email**, **Leave type**, **From** and **To**. A file that is none of them gets an answer that names the three.

Whoever runs Logbook from its source can check a file before sending it: `pnpm files:check <file>` lists the rows Logbook couldn't use, as far as the file alone tells. See [Set up with an AI agent](/logbook/docs/getting-started/set-up-with-an-agent/#check-the-files-yourself).

## Leave files

What the two leave files have in common:

| Rule | Value |
| --- | --- |
| Format | CSV (`.csv`) or Excel (`.xlsx`). Excel: the first sheet. |
| Where | Your conversation with Logbook. A file shared in a channel is ignored. |
| CSV separator | `,` or `;`, whichever the header line uses |
| CSV encoding | UTF-8. In Excel, save as "CSV UTF-8", or send the `.xlsx`. |
| First row | A header naming the columns, in any order. Header names ignore case and spaces; other columns are ignored. |
| Rows | Up to 5000 |
| Size | Up to 1 MB |
| Dates | `2026-11-12`, `12.11.2026`, an Excel date cell, or with slashes (`11/12/2026`, `12/11/26`). Slash dates are read the same way for the whole file: a first number over 12 anywhere makes them day/month, a second number over 12 month/day. A file that mixes both, or where no number tells, has those rows refused: write the dates as `2026-11-12` or save the file as Excel. |
| Emails | Matched ignoring case and spaces. A person who isn't in Logbook, or is deactivated, can't be used. |

Nothing changes until you click **Apply**. The preview stays open for 7 days, and **Undo** works for 7 days after **Apply**, wherever the file's changes are still as it left them. A row Logbook can't use is listed in the preview with the reason; the other rows still apply.

## `leave-balances.csv`

Sets each person's balance as it is on a date, and their contract start. The template lists everyone active, with **Balance on** set to the day Logbook sent it.

| Column | Required | Value |
| --- | --- | --- |
| `Name` | No | The person's name, to help you read the file. |
| `Email` | Yes | The person's email. Each person once. |
| `Contract start` | No | When their contract started; their vacation year runs from it. Empty: stays as it is. |
| `Balance on` | No | The date the counts are for, in the person's current vacation year and not after today. Empty: the day you send the file. |
| `Days left` | No | Calendar days of annual leave left on that date, before any leave from that date on. |
| `Working days left` | No | The same in working days, for companies that count in working days. |
| `Bonus days left` | No | Bonus days left on that date. |

Example:

```text
Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left
Anna Novak,anna@example.com,2021-04-15,2026-11-12,12,,2
Ivan Petrov,ivan@example.com,,2026-11-12,20,,
```

- Counts are whole or half days (`12`, `12.5`, `12,5`), up to 366. A negative count is accepted and shows as 0 left.
- An empty count keeps what an earlier file set. With another **Balance on** in the same vacation year, the earlier count moves to the new date (the leave in between is taken from it, or given back); in another vacation year it goes, and the preview lists it.
- A person who follows no vacation policy has no balance to set; their row's contract start still applies.
- A row the same as the balance already set changes nothing.

## `leave-history.csv`

Adds leave as approved, with no approval and no messages. The template has only its header.

| Column | Required | Value |
| --- | --- | --- |
| `Name` | No | The person's name, to help you read the file. |
| `Email` | Yes | The person's email. A person can have many rows. |
| `Leave type` | Yes | `Annual leave`, `Bonus day`, `Sick leave`, `Unpaid leave` or `Other`, in any letter case (or `annual_leave`, `bonus_day`, `sick_leave`, `unpaid_leave`, `other`). |
| `From` | Yes | The first day. |
| `To` | Yes | The last day, not before **From**, at most a year ahead. A leave is at most a year long. |
| `Comment` | No | Up to 200 characters, kept on the request. |

Example:

```text
Name,Email,Leave type,From,To,Comment
Anna Novak,anna@example.com,Annual leave,2026-05-04,2026-05-15,
Anna Novak,anna@example.com,Sick leave,2026-09-08,2026-09-10,
Anna Novak,anna@example.com,Annual leave,2026-12-21,2026-12-31,Agreed with the team lead
```

- Leave already in Logbook with the same person, type and dates is skipped.
- A leave that overlaps another of the person's requests that is pending or approved, or an earlier row of the file, can't be used.
- A row that would take a person past Logbook's limit of requests can't be used.
- The file never changes or deletes what is in Logbook. Imported leave isn't checked against the balance, and offers no time off as time.
- Its working days follow the holidays of the policy the person's team follows.

## The team file

Places people in teams and names the team leads. Logbook sends you a template with everyone's current team when you click **📄 Set up from a file** on **Teams**. You fill it in and send it back.

| Rule | Value |
| --- | --- |
| Format | CSV (`.csv`) or Excel (`.xlsx`). Excel: the first sheet. |
| File name | Any name ending in `.csv` or `.xlsx` |
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

The time report CSV, the billing snapshot CSV and the team and leave file templates are written so that a spreadsheet opens them as they are:

| Rule | Value |
| --- | --- |
| Encoding | UTF-8, starting with a byte order mark, so Excel reads names in any alphabet |
| Separator | `,` |
| Line ends | CRLF |
| Quotes | A field with a comma, a quote or a line break is put in double quotes; a quote inside is doubled. |
| Formula guard | Text people typed that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front, so a spreadsheet doesn't run it as a formula. Logbook drops that `'` again when it reads a team or leave file. |
