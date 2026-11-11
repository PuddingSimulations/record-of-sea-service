-- Trial length stays at 90 days. (This file was briefly a 30-day change; it now sets the default back to 90 so it is safe whether or not it was run earlier.)
alter table public.companies alter column trial_ends_at set default (now() + interval '90 days');
