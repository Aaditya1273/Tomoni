-- 0009 Fix the rule 2.10 check on care.call. In 0007, `outcome IN (...)` is NULL while a call is
-- in progress, and a CHECK that evaluates to NULL passes, so a conversation step without the
-- disclosure slipped through. Caught by packages/db/test/rls-calls.test.ts.
ALTER TABLE care.call DROP CONSTRAINT call_check;
ALTER TABLE care.call ADD CONSTRAINT call_disclosure_first CHECK (
  step = 'scheduled' OR disclosure_played OR coalesce(outcome IN ('no_answer','voicemail','failed'), false));
