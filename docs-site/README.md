# Logbook docs

The user and operator documentation, published at https://dvovna.github.io/logbook/docs/. It is built with [Starlight](https://starlight.astro.build/) (Astro). Developer notes for this repository stay in the root README, CONTRIBUTING.md and CLAUDE.md.

```bash
cd docs-site
pnpm install --ignore-workspace   # its own lockfile, apart from the app's
pnpm dev                          # http://localhost:4321/logbook/docs/
pnpm build                        # into dist/; the Site workflow copies it to site/docs
```

The Site workflow (`.github/workflows/pages.yml`) runs from `main`, so the published docs describe the released version. A change to the app that people would notice comes with its docs page in the same pull request.

## Where a page goes

| Folder | For | Example |
| --- | --- | --- |
| `getting-started/` | someone new to Logbook, and the admin who installs it | What Logbook is; Set up your workspace |
| `everyone/` | anyone in the workspace | Request time off; Log time |
| `approvers/` | managers, HR and admins who decide | Approve time off |
| `admins/` | HR and admins who set Logbook up | Teams and company rules |
| `finance/` | Finance and admins: projects, rates, reports, billing | Billing snapshots |
| `reference/` | facts to look up, no story | Roles and permissions; File formats |
| `self-hosting/` | whoever runs the app | Install; Update; Operate |
| `help/` | when something goes wrong | Troubleshooting |
| `developers/` | people changing the code | Overview |

Pages live in `src/content/docs/<folder>/<slug>.md` (or `.mdx` to use components). The sidebar lists each folder's pages by `sidebar.order` in the frontmatter.

## How to write

- Write for the reader's task, not for the feature. Open with the task or the fact the page is about: who does it, or what it decides. Not with "This page…": the title already names the page, and openers that all share one shape read as a template.
- Use plain, short sentences in US English. Address the reader as "you". No marketing words.
- Name buttons, fields and menus exactly as Slack shows them, in bold: **Fill in the week**, **Approvals**. Check the label in `src/slack` (views and `src/slack/common/views/data/labels.ts`) rather than writing it from memory.
- Give steps as a numbered list, one action a step. Then say what happens next: who gets a message, what the screen shows.
- Say who may do it when not everyone may (for example "HR and admins").
- Use Starlight asides for what matters and is easy to miss, sparingly: `:::note`, `:::tip`, `:::caution`.
- Link to other pages with their full path: `[Log time](/logbook/docs/everyone/log-time/)`.
- Keep reference pages to tables and lists. Explanation goes on its own page or in a short section, not mixed into steps.
- Don't describe internals (services, tables, jobs) outside `self-hosting/` and `developers/`. Readers only need to know what the app does.

Frontmatter:

```md
---
title: Request time off
description: Ask for annual leave, sick leave and other time off, and follow it to a decision.
sidebar:
  order: 2
---
```
