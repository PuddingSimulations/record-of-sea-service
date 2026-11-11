-- New companies get a 30-day trial instead of 90. Existing companies keep their current dates (change them on the admin page if needed).
alter table public.companies alter column trial_ends_at set default (now() + interval '30 days');
