---
title: Send receipts
description: Send a photo or PDF of a receipt for a reimbursement, follow its status, fix a rejected one and turn reminders off.
sidebar:
  order: 6
---

Your company may pay back part of what you spend, such as a gym or lunches. Admin or Finance sets up what it pays back for (a **reimbursement**) and checks your receipts. You send them to Logbook in Slack.

## Send a receipt

1. Open **Messages** with Logbook in Slack and send a photo or a PDF of the receipt, as you would send any file.
2. Logbook answers "🧾 Got your receipt *name*. Add the details so Finance can check it." Choose **Add details**.
3. Fill in the form **Receipt details**:
   - **Reimbursement**: what the receipt is for. With only one reimbursement it is already chosen.
   - **Month**: the month the receipt is for. You can choose this month or one of the two before it. Logbook suggests the month being collected now.
   - **Amount**: the total on the receipt, in your company's currency.
   - **Comment**: optional, for Finance.
4. Choose **Submit**.

The message changes to "🧾 *name* · Gym · October 2026 · $45.50 — sent to Finance." The receipt is now **⏳ Waiting** for Admin or Finance.

You can send several files one after another; each gets its own message and form. A receipt isn't sent to Finance until you add its details.

What Logbook accepts:

- Photos and PDFs: JPG, PNG, HEIC, WebP, GIF and PDF.
- Files up to 10 MB. For a bigger one Logbook says so and keeps nothing.
- Each file once. If you send a file you sent before, Logbook tells you when and what became of it. After a rejection you can send the same file again.

If the workspace has no reimbursements yet, Logbook says so, and tells Admin and Finance where to add one.

Choose **Discard** under "Got your receipt" to delete a file you haven't given details yet. A receipt you already sent is deleted from **My receipts**.

A receipt that has no details after 30 days is deleted, file included.

## Your receipts

**Home** shows **🧾 Receipts** when your company collects some. For each reimbursement it says what you sent for the month being collected, "nothing sent yet" or "2 receipts, $91.00", and the due date. It also says how many of your receipts still need details. Amounts carry the currency sign.

Choose **My receipts** to see the receipts you sent, newest first, grouped by month. The 25 newest show; a line at the end says how many older ones are hidden. Each shows its reimbursement, amount and status. Use its menu to change it:

- **Add details** (for a receipt that needs them) or **Edit**: opens the form again. Saving sends the receipt to Finance again as waiting.
- **Delete**: asks you to confirm, then deletes the receipt and its file.

A receipt Finance accepted has no menu: it is Finance's now, and you can't change or delete it.

If the reimbursement of a receipt was archived, **Edit** lets you choose another one, or you delete the receipt. With no reimbursement left, Logbook says "There are no reimbursements to send receipts for yet." and opens no form.

| Status | Meaning |
| --- | --- |
| 📝 Needs details | You sent the file and gave no details yet. Only you see it. |
| ⏳ Waiting | Sent to Finance, not decided yet. You can still edit or delete it. |
| ✅ Accepted | Finance accepted it. It counts toward what you get back. |
| ❌ Rejected | Finance sent it back with a reason. |

## When a receipt is rejected

You get a direct message: "❌ Your receipt *name* for Gym, October 2026 was rejected: *reason*", with a button **Edit details**. Fix the details there and the receipt goes back to Finance. If the file was the problem, send a new photo or PDF in the same conversation. You also see the reason on the receipt in **My receipts**.

## Limits and who decides

Finance may set a limit per person and month for a reimbursement. If your accepted and waiting receipts add up to more, Finance sees a warning, and only the limit is paid back.

Admin and Finance decide on receipts. Nobody decides on their own, unless the workspace has no other active person with the Admin or Finance role. HR and managers don't see other people's receipts.

## Reminders

Logbook reminds you to send receipts, in a direct message from Logbook:

- When a month opens, on the 1st at 09:00 UTC, if you sent nothing for it.
- The day before the due date, if you sent nothing or have receipts that still need details. A reimbursement due on the 1st or the 2nd has no reminder of this kind.

To stop the reminders for a reimbursement you don't use, choose **I don't use this** under a reminder. Logbook confirms "🔕 You won't be reminded about …".

To change it later, choose **🔔 Reminders** on **Home**. Tick the reimbursements you want reminders about and choose **Save**. Sending a receipt for a reimbursement turns its reminders on again. While all of them are off, **Home** says "You turned receipt reminders off."

See [Finance: receipts](/logbook/docs/finance/receipts/) for how the receipts are checked, and [Receipt limits](/logbook/docs/reference/file-formats/#receipts) for the files.
