---
title: Troubleshooting
description: What a problem with Logbook means and how to fix it, from slow answers to time you can't log.
sidebar:
  order: 1
---

Find what you see, then its cause and what to do. Some fixes are for whoever runs Logbook on your server; they say so.

## "We had some trouble connecting", or slow answers

**What you see:** Slack shows "We had some trouble connecting" or another error after a click, or a screen takes seconds to change.

**Cause:** Slack gives an app 3 seconds to answer a click. Logbook answered too late, usually because:
- the app runs far from its database, so each of the few database queries a click needs takes about 100 ms instead of 1;
- all its database connections were busy, so a query waited and then failed after 2 seconds;
- the app was restarting.

**What to do:**
- Check whether your change was saved before you repeat it: open the screen again. A form may have been saved although Slack showed an error.
- If you run Logbook: run it in the database's region, and check the pool sizes against your Supabase project's Pool Size. See [Run the app next to its database](/logbook/docs/self-hosting/operate/#run-the-app-next-to-its-database) and [Database connections](/logbook/docs/self-hosting/operate/#database-connections). The logs and Sentry show the errors.

## The bot doesn't answer at all

**What you see:** commands fail, **Home** stays empty, buttons do nothing, nobody gets messages.

**Cause and what to do** (for whoever runs Logbook):

| Cause | What to do |
| --- | --- |
| The app is down or can't reach its database. | Call `https://<your-domain>/health`. 200 is fine, 503 means it can't reach the database, no answer means the app or its HTTPS proxy is down. Read the logs. |
| The Supabase free project was paused after a quiet week. | Restore it in the Supabase dashboard, and point a health check at `/health` so it stays awake. See [Health check](/logbook/docs/self-hosting/operate/#health-check). |
| The Slack app's request URLs don't point at the app, or were never verified. | In the Slack app settings, check the domain in the manifest and retry the URL verification under "Event Subscriptions". |
| `SLACK_SIGN_IN_SECRET` isn't the app's Signing Secret, or the server's clock is off by more than 5 minutes. | Logbook refuses every request it can't verify. Fix the secret or the clock and restart. |
| The workspace was installed with "Install to Workspace" or Slack's sharable URL, so Logbook never created it. People see "Logbook doesn't know you yet." | Install through `https://<your-domain>/api/slack/install`. See [Install](/logbook/docs/self-hosting/install/#5-install-in-a-workspace). |

## "Logbook doesn't know you yet" or "Your Logbook account is deactivated"

**Cause:** Logbook adds everyone in the workspace when it is installed, people who join Slack later, and once a day anyone it missed. You aren't in Logbook yet, or HR or an admin deactivated you. Deleting a Slack account also deactivates the person.

**What to do:** ask HR or an admin. They turn a deactivated person back on in More → **People** → ⋯ → **Activate User**. Someone missing appears after the next daily import.

## A CSV doesn't come with its message

**What you see:** you asked for a CSV and got "⚠️ I couldn't attach the file: Logbook doesn't have the permission to upload files in this workspace yet."

**Cause:** Logbook was installed in your workspace before it asked for the permission to upload files (`files:write`).

**What to do:** whoever installed Logbook installs it again, through `https://<your-domain>/api/slack/install`. Nothing is lost. If you run Logbook and your Slack app was created from an older manifest, add the `files:write` scope first. See [An app created from an older manifest](/logbook/docs/self-hosting/install/#an-app-created-from-an-older-manifest).

Other answers instead of a file:

| Message | What to do |
| --- | --- |
| "No time was logged in … : there is nothing to export." | Choose a period that holds time. |
| More than 200,000 entries, "too many for one file" | Show a shorter period or narrow the report, then send the CSV again. |
| "I couldn't send the CSV of …: sending it kept failing for hours." | Slack failed for hours. Send the CSV again. |

## A slash command is missing

**What you see:** Slack says `/log` or another Logbook command doesn't exist, or still offers `/user-team-mapping`.

**Cause:** the Slack app was set up from an older `slack-app-manifest.yml` than the version you run.

**What to do** (for whoever runs Logbook): apply the manifest of the version you run again. See [Apply the Slack app manifest again](/logbook/docs/self-hosting/update/#apply-the-slack-app-manifest-again). The commands are in [Slash commands](/logbook/docs/reference/slash-commands/).

## A time off request that nobody can approve

**What you see:** "⚠️ Nobody can approve your vacation request (…) yet", and the request stays pending.

**Cause:** nobody but you can decide it. You're in no team, or your team lists no approvers under **Level 1: managers** and the company rules name none under **Level 2: HR**, and nobody else has the HR or Admin role.

**What to do:**
1. HR or an admin names approvers: a team's **Level 1: managers**, **Level 2: HR** in Teams → **Company rules**, or the HR or Admin role for someone. See [Teams and company rules](/logbook/docs/admins/teams-and-company-rules/).
2. The request then goes to them on its own, and you get "📨 Your vacation request (…) went to …". Nothing else to do.

Until then, HR or an admin can decide it in Time off → **All requests** → **Edit Request**.

**Approve for Approvers** doesn't help here: it answers "This request is not waiting for anyone to approve it." It is for a request whose approver is away. See [Approve time off](/logbook/docs/approvers/approve-time-off/).

## You can't log time on a project

**What you see:** the project isn't in the **Log Time** form or the week form, the form says "You have no projects to log time on yet. Ask an admin to add you or your team to a project.", or it refuses with "This project is not available."

**Cause:** you log time only on projects assigned to your team or to you, and not archived. HR and admins log on any active project.

**What to do:** ask a manager, HR or an admin to add you or your team to the project on More → **Projects**. See [Projects and clients](/logbook/docs/finance/projects-and-clients/).

## A day in the week form is read-only

**What you see:** a day shows text instead of a box to type in.

| The day says | Why | What to do |
| --- | --- | --- |
| "2 entries" (or more) | The day has more than one entry on that project. | Change them on **My time**. |
| "submitted" | The entry waits for approval. | Wait for the decision: you can change a rejected entry again. HR and admins can change it now. |
| "approved" | The entry is approved. | Ask HR or an admin to change it if it is wrong. |
| "billed" | The entry is in a billing snapshot: nobody can change it. | Ask an admin to unlock the snapshot, if it must change. |
| "closed for logging" | The project is archived, or no longer one you may log on. | See [You can't log time on a project](#you-cant-log-time-on-a-project). |

**"This time changed after the form opened: open the form again."** at a day means someone (you in another window, or HR or an admin) changed that day's time since the form opened. Close the form and open it again; it shows what the day holds now. See [Log time](/logbook/docs/everyone/log-time/).

## The app refuses to start

**What you see** (whoever runs Logbook): the container stops or restarts, and the log says why.

| The log says | Cause | What to do |
| --- | --- | --- |
| "The database lacks N migration(s) this version needs: …" | The new version's database migrations weren't applied. | Apply them: `pnpm supabase db push --remote "<connection string>"` from the release's source, then start again. See [Update](/logbook/docs/self-hosting/update/). |
| "❌ Invalid environment variables", with the variables at fault | A required variable is missing, or a value is wrong (for example `SLACK_TOKEN_ENCRYPTION_KEY` "must be 32 bytes, base64-encoded"). | Fix `.env`. See [Configuration](/logbook/docs/reference/configuration/). |
| "Logbook could not start:" and a database error | The app can't reach the database at `DATABASE_URL`. | Check the connection string (the session pooler, port 5432) and that the project isn't paused. |

## Installing fails

| The browser says | Cause | What to do |
| --- | --- | --- |
| "This installation link has expired or was not started here. Start again from /api/slack/install." | The install wasn't started from `/api/slack/install` in this browser, or took more than 10 minutes. | Open `https://<your-domain>/api/slack/install` and approve again. |
| "This Logbook server does not accept installs from your Slack workspace." | The server lists the workspaces allowed to install in `ALLOWED_SLACK_TEAM_IDS`, and yours isn't one of them. | Ask whoever runs the server to add your workspace ID. |
| "The installation was canceled." | You canceled on Slack's page. | Start again. |
