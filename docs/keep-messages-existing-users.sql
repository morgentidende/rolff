-- NOT part of the migration and NOT run. Option A in docs/keep-messages-default.md: move every existing '1y' to keep-forever.
-- Changes only rows that are exactly '1y'; '5y' and 'unlimited' are untouched. Run once, by hand, after a decision.
update public.user_privacy
   set retention = 'unlimited', retention_warned_at = null, updated_at = now()
 where retention = '1y';
