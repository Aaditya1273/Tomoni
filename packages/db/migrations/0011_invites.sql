-- 0011 Household invites (BUILD_PROMPT §5.5): a family member invites a sibling, who joins the
-- household with their own login; or names the patient's doctor for Tomoni to contact. The
-- link carries a 256-bit token; only its hash is stored. Single use, 7 days.
CREATE TABLE care.invite (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  household_id  uuid NOT NULL REFERENCES care.household(id),
  kind          text NOT NULL CHECK (kind IN ('sibling','doctor')),
  target        bytea NOT NULL,               -- enc: the invitee's e-mail
  token_hash    bytea UNIQUE,                 -- null for doctor invites (no link)
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_by    uuid NOT NULL REFERENCES auth.user_account(id),
  accepted_by   uuid REFERENCES auth.user_account(id),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'sibling') = (token_hash IS NOT NULL))
);
ALTER TABLE care.invite ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_all ON care.invite TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY household ON care.invite FOR SELECT TO tomoni_app USING (household_id = ANY(app.household_ids()));
CREATE POLICY invite ON care.invite FOR INSERT TO tomoni_app
  WITH CHECK (household_id = ANY(app.household_ids()) AND created_by = app.user_id());
CREATE POLICY revoke ON care.invite FOR UPDATE TO tomoni_app
  USING (household_id = ANY(app.household_ids())) WITH CHECK (status = 'revoked');
GRANT SELECT, INSERT, UPDATE ON care.invite TO tomoni_app, tomoni_worker;
