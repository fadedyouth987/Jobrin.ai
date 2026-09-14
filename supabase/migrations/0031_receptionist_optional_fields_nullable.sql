-- Fixes a live, reproducible bug found during a full workflow test: the
-- server's zod schema (server/routes/receptionist.ts) and the frontend's
-- save() function both treat approved_pricing_language, callback_window and
-- after_hours_rule as nullable (the frontend explicitly normalizes an empty
-- string to null before saving, and the call runtime already has fallback
-- defaults for when they're null), but the columns themselves were created
-- NOT NULL. Any save where after_hours_rule is empty -- the default state
-- for every new workspace -- failed with an undiagnosable 400
-- RECEPTIONIST_PROFILE_SAVE_FAILED (a NOT NULL violation swallowed with no
-- detail). Dropping NOT NULL is safe: existing rows keep their current
-- values, and the column defaults still apply to any insert that omits them.

alter table public.receptionist_profiles
  alter column approved_pricing_language drop not null,
  alter column callback_window drop not null,
  alter column after_hours_rule drop not null;
