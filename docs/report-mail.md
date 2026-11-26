# Report e-mails

In-app **Rapportér** / **Report** still stores only metadata in `report_log` (reporter, conversation, category, attached count, time). The chosen text and attached messages are not stored; they go in one e-mail to the developer inbox.

## Recipient (one-line change)

The inbox is the Edge secret **`REPORT_EMAIL_TO`**. While Rolff is tested, set it to `nicolaipetersen108@gmail.com`. To move reports later (for example to `info@rolffapp.com`) change only that secret and redeploy the `report` function:

```
supabase secrets set REPORT_EMAIL_TO=info@rolffapp.com --project-ref dubwlbqazbllnwpsqrjv
supabase functions deploy report --project-ref dubwlbqazbllnwpsqrjv
```

If `REPORT_EMAIL_TO` is unset, `FEEDBACK_TO` is used. If neither is a valid address, the report is still saved; the mail failure is logged without content (`report_mail_failed`). The user gets a success response either way.

## Mail path

The mail uses the same path as invitation mail: authenticated SMTP as `Rolff` `<rolff-no-reply@…>` when `SMTP_USER` / `SMTP_PASS` are set, otherwise the Hostinger relay `api/mail.php`. No extra domain or mailbox needs to be bought for this.

The mail includes: report id, category, reporter (e-mail and user id), reported user (e-mail and user id), conversation id, the reporter’s description, and each attached message’s text and time. HTML is escaped. Rate limit: 3 reports per 24 hours (unchanged).
