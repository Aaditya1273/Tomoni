-- 0020 Emergency department visits (Voice Lab outcome labels). An outpatient claim with an
-- emergency-room revenue center (045x, or 0981 professional fees) is an ED visit.
ALTER TABLE care.claim ADD COLUMN ed_visit boolean NOT NULL DEFAULT false;
