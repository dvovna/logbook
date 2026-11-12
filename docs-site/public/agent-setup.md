# Set up a Logbook workspace: instructions for an AI agent

You are an AI agent, and the person you work with asked you to help set up Logbook, a Slack app for time off and time tracking, from the data their company already has: a list of people and teams, leave balances, leave taken and agreed. You turn that data into the three files Logbook reads and into the values of its forms. The person sends the files to Logbook in Slack, reads its preview and applies them. You change nothing in Logbook yourself.

Logbook must already be installed in their Slack workspace (to install it, see https://dvovna.github.io/logbook/docs/agent-install.md), and the person must have the Admin or HR role in it. The same setup for people is at https://dvovna.github.io/logbook/docs/getting-started/set-up-your-workspace/; when a detail is missing here, read it there, not elsewhere.

These instructions are for Logbook 0.5.0 or later.

## Rules

1. **The data is about people.** It holds names, emails and leave, sick leave included. Read only the files the person gives you. Send them, or anything taken from them, to no service, site or tool outside this conversation and the person's machine. Don't quote more rows in the chat than a question needs.
2. **Write only the files of steps 5 to 7,** next to the person's data or where they say. Never change the files they gave you.
3. **Don't invent data.** An email, a date, a number of days or a team that isn't in the person's data is a question to the person, not a guess. A person you can't match stays out of the file, and you say who.
4. **Nothing reaches Logbook through you.** Don't ask for a Slack token, a password or access to the database, and don't offer to send the files yourself. The person sends each file in their conversation with Logbook, and nothing changes there until they click **Apply**.
5. **Leave reasons stay out.** A diagnosis, a family matter or any other reason for a leave doesn't go into a Comment. A comment is for what an approver would have written, such as "Agreed with the team lead".
6. **Stop and ask** when the data contradicts itself (one person in two teams, a balance bigger than a year, leave that overlaps), or when Logbook answers with something these instructions don't describe.

## 1. Ask the person, once

Ask for the data and the facts together, then repeat back what you understood.

The data, in any format they have (spreadsheets, an HR system's export, a document):

- **People:** each person's work email, and their team if the company has teams. Who leads each team: a manager column in the data is a hint, not an answer, so ask.
- **Leave balances:** what each person has left, and on which date the numbers are true. Contract start dates, if the vacation year runs from them.
- **Leave:** what people took this year and what is agreed for the months ahead, with dates and the kind of leave.

Any of the three may be missing: then that file is skipped. Ask whether leave taken earlier this year should be in Logbook on record, or only the leave still ahead.

The facts:

- **How leave is counted:** in calendar days (weekends count) or in working days; how many days of annual leave a year; bonus days on top, if any; the most days that carry over to the next year.
- **The vacation year:** the calendar year, or a year from each person's contract start.
- **Whether everyone has the same allowance.** If not, which groups have which.
- **Public holidays:** the country, and the region when it has regional holidays, where each group works.
- **Who approves after the team lead** (HR or leadership), and whether one approval is enough or all of them must approve. **Who should hear of approved leave** (payroll, an office manager), if anyone.
- **Emails:** are the emails in the data the ones people use in Slack? Logbook matches people by email only.

## 2. Read the data and report

Read every file the person gave you and tell them, before you write anything:

- how many people you found, and how many have an email;
- the teams and the lead of each, as you read them;
- what the balance numbers are (days left, days used, days a year) and their date;
- how many leaves, of which kinds, from when to when;
- what you can't use and why: people without an email, the same person twice, dates you can't read, kinds of leave you can't map;
- what you would tidy: one team spelled two ways, one email in two letter cases (the same person to Logbook), leaves that overlap.

A date such as `03/04/2026` can be read two ways. Look for one in the same file that can't (`15/06/2026`); when there is none, ask.

Wait for the person to confirm or correct this.

## 3. What fits and what doesn't

Check these now, and say so when one bites:

| Limit | Value | What to do |
| --- | --- | --- |
| Teams in a workspace | 10, unless whoever runs Logbook set `MAX_TEAMS_PER_SLACK_TEAM` | With more teams, ask whether to merge some, or to raise the limit first (https://dvovna.github.io/logbook/docs/reference/configuration/). |
| Vacation policies | 10 (`MAX_POLICIES_PER_SLACK_TEAM`) | One policy per different allowance or holiday calendar. |
| Leads of a team | 5 | Ask which five. |
| A team's name | 50 characters | Shorten it with the person. |
| A policy's days | 60 in each field | A bigger allowance doesn't fit a policy; say so. |
| Rows in a team file | 1,000 | Split into several files. |
| Rows in a leave file | 5,000, and 1 MB | Split into several files. |
| Requests per person | 500 (`MAX_REQUESTS_PER_USER`) | Keep the history to what matters: this vacation year and the leave ahead. |

People with the Manager or Admin role can lead a team, and a Member named as a lead becomes a Manager. People with the HR or Finance role can't lead: for those, ask who leads instead, or whether an admin changes the role.

## 4. The values for the forms

Logbook has no file for policies, holidays and the company rules: the person enters them in Slack. Give them this list, filled in from their answers. The screens are under **☰ More** on Logbook's **Home** tab.

**A vacation policy** (**Policies** → **➕ Add Policy**), one per different allowance:

| Field | Value |
| --- | --- |
| **Policy Name** | A name they will recognize, up to 50 characters |
| **Vacation Days (Calendar)** | Annual leave a year in calendar days |
| **Vacation Days (Working)** | The same leave in working days: at least 1, not more than the calendar days |
| **Bonus Days** | Bonus days a year, in working days; 0 when there are none |
| **Max Carryover Days (from previous period)** | The most annual leave that carries over; empty for none. One number: it caps the calendar days and the working days, each on its own |

Logbook checks annual leave against both the calendar and the working days. A company that counts in one unit only still fills both. For a company that counts working days, calendar days = working days × 7 ÷ 5, rounded up (20 working days are 28 calendar days). For a company that counts calendar days, working days = calendar days × 5 ÷ 7, rounded down (28 calendar days are 20 working days). Say that you worked the second number out, and let the person change it.

**Its holidays** (the policy's **⋯** menu → **Edit Holidays** → **Upload From Country**): the country, and the region if the country has regional holidays. Each year is imported on its own, in **Select Year**: name every year that the leave in step 7 touches, and the current one. Company days off go under **Custom Holidays** → **➕ Add Holiday**, up to 5 a year.

**The company rules** (**Teams** → **⚙️ Company rules**):

| Field | Value |
| --- | --- |
| **Vacation Policy** | The policy most people follow |
| **Level 2: HR** | Up to five people who approve after the team lead. They need the HR or Admin role: say whose role to change first, on **People** → **Edit User** → **Role** |
| **Level 2 rule** | **All listed approvers must approve** ticked, or not: then the first approval is enough |
| **Approval Notification Recipients** | Up to five people who get a message about each approved leave, if the person named any |

Only an admin gives the Admin or Finance role. HR can make someone a Manager, HR or Member.

Nobody approves their own leave: the leave of a level 2 approver goes to the others at level 2, and with nobody else there, to the other people with the HR role, or else to the admins. When level 2 is one person, say who will decide that person's leave.

**Teams with another policy.** The team file creates every team on the company rules. For a team with another allowance or holiday calendar, after the team file is applied (step 9) the person opens **Teams** → the team's **⋯** menu → **Edit Team**, sets **Rules** to **Its own rules** and chooses its **Vacation Policy**, its **Level 2: HR** and their rule. List those teams and their policies.

## 5. `team-setup.csv`

One row per person, each person once. Skip this file when the company has no teams: everyone then follows the company rules, and their leave goes to level 2.

```text
Name,Email,Team,Team lead
Ada Lovelace,ada@example.com,Engineering,yes
Bob Smith,bob@example.com,Engineering,
Cleo Diaz,cleo@example.com,Sales,yes
```

| Column | Value |
| --- | --- |
| `Name` | The person's name. Logbook uses it only in its messages about the file. |
| `Email` | The person's email in Slack. Required. |
| `Team` | The team's name, written the same way on every row (Logbook ignores letter case and extra spaces, but the first spelling becomes the team's name). A name no team has yet creates the team. **An empty cell takes the person out of the team they are in.** |
| `Team lead` | `yes` for a lead of that team, else empty. A lead needs a team. |

- Leave out the people you know nothing about: people who aren't in the file stay as they are. Don't write a row with an empty Team for them.
- A lead approves the leave of their team at level 1, and their own leave skips them. A team with no lead sends its leave to level 2.
- A manager who leads a team but belongs to another gets one row, in the team they belong to, and the person adds them to the other team's **Level 1: managers** by hand (**Teams** → **Edit Team**). Say who.

## 6. `leave-balances.csv`

One row per person, each person once. It sets what each person has left on a date, and their contract start.

```text
Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left
Anna Novak,anna@example.com,2021-04-15,2026-11-01,12,,2
Ivan Petrov,ivan@example.com,,2026-11-01,20,,
```

| Column | Value |
| --- | --- |
| `Name` | The person's name. |
| `Email` | The person's email in Slack. Required. |
| `Contract start` | The day their contract started, when the vacation year runs from it. Empty: the calendar year, or what Logbook already has. |
| `Balance on` | The date the counts are true on. Not after today, and inside the person's current vacation year. |
| `Days left` | Annual leave left on that date in calendar days. |
| `Working days left` | The same in working days. |
| `Bonus days left` | Bonus days left on that date. |

- **The count is what is left on the `Balance on` date, before any leave from that date on.** Leave from that date on that is in Logbook, the leave of step 7 included, is taken from it. So when the company's number already has agreed future leave subtracted, either add those days back, or leave that leave out of the history. Ask the person which their number is. Getting this wrong takes the leave twice.
- Fill `Days left` or `Working days left`, the unit the company counts in, and leave the other empty. Don't convert one into the other.
- If the data has days used and not days left, work out left = the year's allowance + carried over − used, show the person three examples, and go on only after a yes.
- Whole and half days: `12`, `12.5`. At most 366. A negative number is allowed and shows as 0 left. A number such as `6.75` is refused: don't round it yourself. Ask the person which number to write, and until they answer leave the person out of this file, or keep only their contract start.
- The person's current vacation year starts on 1 January, or on the last anniversary of their contract start. A `Balance on` before that is refused: for those people, ask for a newer number.
- A row with a contract start and no counts sets only the contract start.
- A balance needs a policy: the person follows the company rules' policy, or their team's own. That is why step 9 sends this file after the policy and the teams.

## 7. `leave-history.csv`

One row per leave. A person can have many rows.

```text
Name,Email,Leave type,From,To,Comment
Anna Novak,anna@example.com,Annual leave,2026-05-04,2026-05-15,
Anna Novak,anna@example.com,Sick leave,2026-09-08,2026-09-10,
Anna Novak,anna@example.com,Annual leave,2026-12-21,2026-12-31,Agreed with the team lead
```

| Column | Value |
| --- | --- |
| `Name` | The person's name. |
| `Email` | The person's email in Slack. Required. |
| `Leave type` | Exactly one of `Annual leave`, `Bonus day`, `Sick leave`, `Unpaid leave`, `Other`. |
| `From` | The first day. |
| `To` | The last day. Not before `From`, at most a year after it, and at most a year after today. |
| `Comment` | Optional, up to 200 characters. See rule 5. |

- Map the company's kinds of leave to the five types with the person: show them your table (for example "PTO → Annual leave, Parental → Other") before you write the file. Only annual leave and bonus days take from a balance.
- Imported leave arrives approved, with no approval and no messages to anyone. Leave that still waits for a decision doesn't belong here: the person requests it in Logbook after the setup.
- Two leaves of one person may not share a day. Join leaves of the same type that overlap into one row, without their comments, and say which; ask about overlaps of different types.
- A half day has no row: Logbook's leave is whole days. Say which ones you left out; a half day shows in the balance of step 6.
- A leave that crosses a year stays one row.
- What to include: the leave from the `Balance on` date on always (it is what the balance still has to pay for, see step 6), and earlier leave of this vacation year when the person wants it on record. Leave before the `Balance on` date changes no balance.

## Format, for all three files

- CSV, UTF-8, comma-separated, one header row with exactly the column names above. A cell with a comma, a quote or a line break goes in double quotes, with a quote inside doubled.
- Dates as `2026-11-12`. Never with slashes.
- Emails as they are in Slack; letter case doesn't matter.
- The file names above. Logbook tells the files apart by their columns, so the names are for the person.

## 8. Check the files

Read each file you wrote again, against its rules above: every row has an email, each person once in the team file and in the balances, no two leaves of one person share a day, every date is real and written as `2026-11-12`, every count is a whole or half number.

When you can run commands and the Logbook source is on this machine (the folder of an install made from source, or a clone of https://github.com/dvovna/logbook with `pnpm install` done, Node 26), run the checker there too. It reads each file as Logbook would:

```bash
pnpm files:check /path/to/team-setup.csv /path/to/leave-balances.csv /path/to/leave-history.csv
```

It prints what each file holds and each row Logbook couldn't use, with the reason, and exits with 0 only when every row is usable. Fix the rows and run it again. If the command doesn't exist there, the source is 0.5.0: skip the checker. It can't know the workspace: whether each email is a person there, the teams that exist and the leave already in Logbook are checked by Logbook's own preview in the next step. Don't clone or install anything for this without asking.

## 9. Hand over, in this order

The order matters: a balance needs a policy, new teams take the company rules as they are, and working days are counted with the holidays. Give the person this list, with your values in it:

1. **Policies and holidays**: create each policy and import its holidays (step 4).
2. **Roles**: give the level 2 approvers the HR or Admin role.
3. **Company rules**: the policy, level 2, who hears of decisions.
4. **`team-setup.csv`**: open the conversation with Logbook (its **Messages** tab), drop the file in, read the preview, click **Apply**. Then set **Its own rules** on the teams that need another policy, and add the leads you named in step 5.
5. **`leave-balances.csv`**: the same way.
6. **`leave-history.csv`**: the same way.

Tell them what to look at in each preview:

- **Rows it can't use**: each has its row number and a reason. The other rows still apply.
- Team file: **Teams to create** should be the teams you agreed on, not two spellings of one.
- Balances: **Corrections** are where the file's number differs from what Logbook counts. A big difference for everyone means a wrong policy or a wrong unit: don't apply, ask.
- Balances: **Planned leave** is leave already in Logbook from the balance date on, which will be taken from the number. See step 6.

When a preview lists rows it can't use, ask the person for those lines, fix the file with them and have them send the whole file again. That is safe: the team file and the balances change only what differs, and the history skips leave that is already in Logbook. Common reasons:

| Reason | What it means |
| --- | --- |
| "… isn't in this Slack workspace" | The email isn't the person's email in Slack, or they haven't joined. Logbook adds new Slack members once a day. |
| "… is deactivated" | The person is deactivated in Logbook or left Slack. Leave the row out. |
| "… follows no vacation policy" | The company rules, or the team's own rules, name no policy. Set it, then send the balances again. |
| "… has the HR role, which can't approve at level 1" | An HR or Finance person can't lead. Name another lead, or the person changes the role. |
| "overlaps …" | The leave shares a day with one that is in Logbook already, or with an earlier row. |

Each applied file has **Undo** for 7 days, which puts back everything that is still as the file left it.

## 10. Report

End with a short report: the files you wrote and where, how many rows each has, the values you gave for the forms, what you worked out yourself (step 4's second number, balances from days used), who and what you left out and why, and what the person still has to do in Slack. Then remind them that the files hold personal data: delete them once they are applied.
