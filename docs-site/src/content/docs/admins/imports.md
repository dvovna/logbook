---
title: Bring in leave balances and history
description: Load each person's leave balance and past and agreed leave from your spreadsheet, so balances are right on day one.
sidebar:
  order: 5
---

When you move to Logbook in the middle of a year, people have already taken leave, carried days over and agreed leave for the months ahead. Two files bring that in, so everyone's balance on **Home** is right from the first day. Admins and HR can do it.

- **`leave-balances.csv`**: each person's contract start and what they have left on a date.
- **`leave-history.csv`**: one row per leave, taken or agreed, with its dates.

Send either or both, in any order. Nothing changes until you check the preview and click **Apply**.

:::note
Set up a [vacation policy](/logbook/docs/admins/policies-and-holidays/) and [teams](/logbook/docs/admins/team-file/) first. A balance needs a policy, and working days are counted with the holidays of the policy a person's team follows.
:::

## Get the templates

Open **More** → **People** and click **📥 Import leave**, or click it in the **Bring in leave balances** step of the setup checklist on **Home**. Logbook sends you both templates in your conversation with it:

- `leave-balances.csv` lists everyone active with their contract start as Logbook has it, and **Balance on** set to the day it was sent. The three count columns are empty.
- `leave-history.csv` has only its header row.

Fill them in, in Excel, Google Sheets or a text editor, and drag them back into your conversation with Logbook. You can save as CSV or as Excel (`.xlsx`).

## Balances

A balance is what the person has left on the **Balance on** date, before any leave from that date on. Fill **Days left** or **Working days left**, whichever your company counts in, and **Bonus days left** if your policy has bonus days.

- Leave in Logbook from the **Balance on** date on is taken from the balance as usual, including leave you import with the history file. Leave before that date doesn't change it.
- When your number differs from what Logbook counts from the policy, the carried-over days and the leave it knows, the difference shows as a correction next to the balance on **Home** and on **People**. The person sees why their number is what it is.
- Whole and half days are fine (`12`, `12.5`, `12,5`). A negative balance shows as 0 left.
- An empty cell keeps what is there: the contract start, or a count set by an earlier file. With a new **Balance on** date in the same vacation year, an earlier count you leave empty moves to the new date. In another vacation year it goes, and the preview says so.
- **Balance on** must fall in the person's current vacation year and not after today. Left empty, it is the day you send the file.
- A changed **Contract start** moves the person's vacation year. It applies even when the rest of the row can't, for example for someone who follows no vacation policy.
- The carryover on a person's profile doesn't change a year whose balance came from a file: the balance already includes it.

## History

Each row is one leave: **Email**, **Leave type**, **From**, **To**, and an optional **Comment**.

- Imported leave arrives approved. It goes through no approval, nobody gets a message, and it offers no [time off as time](/logbook/docs/everyone/time-off-as-time/).
- The file only adds. Leave already in Logbook with the same type and dates is skipped, so sending the same file twice adds nothing. A leave that overlaps another request of the person, or an earlier row, can't be used. Nothing in Logbook is changed or deleted.
- Leave types are Logbook's: **Annual leave**, **Bonus day**, **Sick leave**, **Unpaid leave** and **Other**, in any letter case.
- Agreed future leave shows in "Who's off next" and in approvers' messages like any approved leave.
- To fix an imported leave, change or delete it in **All requests** like any request, or undo the whole file and send a corrected one.

## The preview

For a balances file, the preview shows the balance date and how many people it sets, then:

- **Corrections**: each balance that differs from Logbook's count, with both numbers.
- How many match.
- **Vacation year changes**: contract starts the file sets.
- **Planned leave**: leave already in Logbook from the balance date on, with what is left after it. Check this list: if your number already subtracted that leave, it would be taken twice.
- **Earlier balances that go**: counts from an earlier file in another vacation year that the new date replaces.
- **Rows it can't use**, each with its reason.

For a history file, it shows how many leaves it adds by type and how many are from today on, the balances that change, the planned leave taken from a balance from a file, how many it skips as already in Logbook, and the rows it can't use.

Click **Apply** within 7 days. If Logbook changed in between, you get a new preview instead. After **Apply**, **Undo** takes the file back for 7 days, everything still as the file left it; what someone changed since stays, and Logbook lists it.

## The format, in short

- CSV with `,` or `;`, saved as UTF-8, or an Excel file (its first sheet). Up to 5,000 rows and 1 MB.
- Logbook tells the files apart by their columns, whatever their names. Columns can come in any order, and header names ignore case and spaces.
- Dates as `2026-11-12`, `12.11.2026`, Excel date cells, or with slashes. Slash dates are read the same way for the whole file: if any has a first number over 12 it is day/month, if any has a second number over 12 it is month/day. When the file can't tell, write the dates as `2026-11-12` or save it as Excel.

The full format is in [File formats](/logbook/docs/reference/file-formats/).
