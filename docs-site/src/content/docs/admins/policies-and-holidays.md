---
title: Policies and holidays
description: Set how many days off people get, what carries over to the next year, and which holidays are not working days.
sidebar:
  order: 4
---

This page helps you set up vacation policies and their holidays, so that balances are counted and checked. HR and admins manage policies and holidays.

A policy applies to a team through its rules: the company rules' policy, or the team's own. See [Teams and company rules](/logbook/docs/admins/teams-and-company-rules/).

## Create a policy

1. Open **More** → **Policies** and click **➕ Add Policy**.
2. Fill in the fields below.
3. Click **Submit**.

| Field | What it means |
| --- | --- |
| **Policy Name** | Up to 50 characters |
| **Vacation Days (Calendar)** | Annual leave a year, in calendar days: every day of a request counts, weekends too |
| **Vacation Days (Working)** | The same leave in working days: weekends and the policy's enabled holidays don't count. At least 1, and no more than the calendar days |
| **Bonus Days** | Days off on top of annual leave, in working days |
| **Max Carryover Days (from previous period)** | The most days of annual leave that carry over to the next vacation year. Optional |

Each field takes up to 60 days.

The list shows each policy's days, its carryover and the teams that use it. Its **⋯** menu has **Edit Policy**, **Edit Holidays** and **Delete Policy**. You can't delete a policy the company rules or a team's own rules use: choose another one there first. Its holidays are deleted with it.

## What a policy checks

When someone requests time off, Logbook checks it against their balance:

- **Annual leave** has to fit both limits: the calendar days and the working days left, carryover included.
- **Bonus days** count in working days: a Friday to Monday request takes two.
- Sick leave, unpaid leave and other time off are counted but have no limit.

Pending requests count as used. When a request doesn't fit, the form says how many days are available. See [Request time off](/logbook/docs/everyone/request-time-off/).

### Without a policy

When neither the team's own rules nor the company rules name a policy (**No Policy**), Logbook only tracks time off. People see what they used, but nothing is checked and approvers see no balance. People in no team have the company rules' policy.

## The vacation year

Balances count per vacation year:

- With a contract start date, the year runs from its anniversary. A contract start of 15 May gives a vacation year from 15 May to 14 May.
- Without one, it is the calendar year.

A request is checked against the year it falls in, not the current one. A request across the anniversary counts its days in each year. You set the contract start on [People](/logbook/docs/admins/people-and-roles/#team-contract-start-and-carryover).

## Carryover

Only annual leave carries over. It carries over on its own, in calendar and working days apart:

- **The year someone joined**: they get the **Carryover Days** HR entered on their profile, for the time before Logbook. It can't be more than the policy's limit.
- **Each later year**: what was left of the year before (its annual leave and its carryover, minus what was used) carries over, up to **Max Carryover Days**.
- **A year still to come** gets nothing yet, since what will be left of this one isn't known.

Bonus days don't carry over. Logbook works carryover out from the requests each time, so a change to last year's requests changes this year's carryover.

## Holidays

Each policy has its own holidays. An enabled holiday is not a working day for the teams on that policy.

To open them, choose **Edit Holidays** in the policy's **⋯** menu. The screen shows one year at a time: pick another in **Select Year**.

### Import public holidays

1. Click **Upload From Country**.
2. In **Select Country**, choose the country.
3. If the country has regional holidays, a **Region** field appears. Keep **Only the whole country**, or choose the region where the policy's people work.
4. Click **Submit**.

Logbook takes the public holidays of that year from [Nager.Date](https://date.nager.at): those of the whole country, and those of the region if you chose one. Bank and school holidays and observances are left out. An import replaces the country holidays of that year for this policy. Your own holidays stay, and holidays you switched off stay off.

Each year is imported on its own: import again for the next year.

### Company holidays

Under **Custom Holidays**, click **➕ Add Holiday**, then enter the **Holiday Name** and **Date**. Use it for company days off that aren't public holidays.

### Switch a holiday off

In a holiday's **⋯** menu, choose **Deactivate Holiday**. It shows as **Off** and becomes a working day again. **Activate Holiday** switches it back on. Your own holidays also have **Edit Holiday** and **Delete Holiday**.

## Working days

Working days are Monday to Friday, without the enabled holidays of the policy of the team the request was made in. Logbook counts them again each time it works out a balance: when you import, add or switch off a holiday, balances follow, also for requests made before.
