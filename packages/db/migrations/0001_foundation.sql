-- 0001 Foundation: extensions, schemas, scope helpers, auth, care people + consents, outbox.
-- Ids use Postgres 18 uuidv7(). Enumerations are text + CHECK so they can grow without enum DDL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA app;      -- request-scope helpers read by RLS policies
CREATE SCHEMA auth;
CREATE SCHEMA care;
CREATE SCHEMA research; -- filled in Phase 5
CREATE SCHEMA audit;
CREATE SCHEMA sponsor;  -- aggregate functions only (Phase 5)

-- ─── Request scope ─────────────────────────────────────────────────────────────
-- The API sets these with set_config(name, value, is_local => true) at the start of
-- every request transaction. Unset = empty = sees nothing.
CREATE FUNCTION app.setting(name text) RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting(name, true), '') $$;

CREATE FUNCTION app.uuids(name text) RETURNS uuid[]
  LANGUAGE sql STABLE AS $$ SELECT coalesce(string_to_array(app.setting(name), ',')::uuid[], '{}') $$;

CREATE FUNCTION app.user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT app.setting('app.user_id')::uuid $$;
CREATE FUNCTION app.is_admin() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(app.setting('app.is_admin') = 'true', false) $$;
-- One list per role family so a user who is both a nurse somewhere and a family member
-- elsewhere never gets nurse rights over their own household (or vice versa).
CREATE FUNCTION app.staff_practice_ids() RETURNS uuid[]
  LANGUAGE sql STABLE AS $$ SELECT app.uuids('app.staff_practice_ids') $$;
CREATE FUNCTION app.ops_practice_ids() RETURNS uuid[]
  LANGUAGE sql STABLE AS $$ SELECT app.uuids('app.ops_practice_ids') $$;
CREATE FUNCTION app.household_ids() RETURNS uuid[]
  LANGUAGE sql STABLE AS $$ SELECT app.uuids('app.household_ids') $$;
CREATE FUNCTION app.patient_ids() RETURNS uuid[]
  LANGUAGE sql STABLE AS $$ SELECT app.uuids('app.patient_ids') $$;
CREATE FUNCTION app.staff_roles() RETURNS text[]
  LANGUAGE sql STABLE AS $$ SELECT coalesce(string_to_array(app.setting('app.staff_roles'), ','), '{}') $$;

CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ─── auth ──────────────────────────────────────────────────────────────────────
CREATE TABLE auth.user_account (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  email           citext NOT NULL UNIQUE,
  display_name    text NOT NULL,
  password_hash   text,
  mfa_secret      bytea,                 -- enc
  mfa_enabled_at  timestamptz,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked','disabled')),
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.identity (
  user_id   uuid NOT NULL REFERENCES auth.user_account(id),
  provider  text NOT NULL,               -- 'password' | 'oidc:<issuer>'
  subject   text NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE TABLE auth.role_grant (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id       uuid NOT NULL REFERENCES auth.user_account(id),
  role          text NOT NULL CHECK (role IN ('patient','family_member','representative','physician',
                                              'nurse','front_desk','ops_agent','sponsor_user','admin')),
  practice_id   uuid,
  household_id  uuid,
  patient_id    uuid,
  sponsor_id    uuid,
  granted_by    uuid,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  -- Each role carries exactly the scope it needs (DATA_MODEL "Scope rules").
  CONSTRAINT role_scope CHECK (
    CASE role
      WHEN 'physician'      THEN practice_id IS NOT NULL
      WHEN 'nurse'          THEN practice_id IS NOT NULL
      WHEN 'front_desk'     THEN practice_id IS NOT NULL
      WHEN 'ops_agent'      THEN practice_id IS NOT NULL
      WHEN 'family_member'  THEN household_id IS NOT NULL
      WHEN 'patient'        THEN patient_id IS NOT NULL
      WHEN 'representative' THEN patient_id IS NOT NULL
      WHEN 'sponsor_user'   THEN sponsor_id IS NOT NULL
      WHEN 'admin'          THEN true
    END
  )
);
CREATE INDEX ON auth.role_grant (user_id) WHERE revoked_at IS NULL;

CREATE TABLE auth.session (
  id_hash              bytea PRIMARY KEY,   -- sha256(token); raw token lives only in the cookie
  user_id              uuid NOT NULL REFERENCES auth.user_account(id),
  csrf_token_hash      bytea NOT NULL,
  mfa_verified_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  idle_timeout_s       int NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  revoked_at           timestamptz,
  user_agent           text
);
CREATE INDEX ON auth.session (user_id);

-- ─── care: people and organizations ────────────────────────────────────────────
CREATE TABLE care.practice (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  name                 text NOT NULL,
  npi                  text,
  tz                   text NOT NULL,
  phone                text,
  address              text,
  apcm_enrolled_at     date,
  offshore_ops_access  boolean NOT NULL DEFAULT false,   -- D-008
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE care.clinician (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  practice_id   uuid NOT NULL REFERENCES care.practice(id),
  user_id       uuid REFERENCES auth.user_account(id),
  npi           text,
  kind          text NOT NULL CHECK (kind IN ('physician','nurse','front_desk')),
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
  -- No money / payout columns, by design (BUILD_PROMPT rule 2.7).
);

CREATE TABLE care.household (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name    text NOT NULL,
  primary_locale  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE care.patient (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  practice_id        uuid NOT NULL REFERENCES care.practice(id),
  household_id       uuid NOT NULL REFERENCES care.household(id),
  mbi                bytea,          -- enc
  mbi_hash           bytea UNIQUE,
  name               bytea NOT NULL, -- enc
  preferred_name     bytea,          -- enc (what the call says: "Raj-bhai")
  dob                bytea NOT NULL, -- enc
  birth_year         int NOT NULL,
  phone              bytea,          -- enc
  phone_hash         bytea,
  address            bytea,          -- enc
  state              text NOT NULL,
  locale             text NOT NULL,
  tz                 text NOT NULL,
  call_window_start  time NOT NULL DEFAULT '10:00',
  call_window_end    time NOT NULL DEFAULT '12:00',
  medicare_type      text NOT NULL CHECK (medicare_type IN ('original','advantage')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','deceased','left')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON care.patient (practice_id);
CREATE INDEX ON care.patient (household_id);
CREATE INDEX ON care.patient (phone_hash);

CREATE TABLE care.family_member (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  household_id         uuid NOT NULL REFERENCES care.household(id),
  user_id              uuid REFERENCES auth.user_account(id),
  display_name         text NOT NULL,
  relationship         text NOT NULL,
  phone                bytea,        -- enc
  phone_hash           bytea,
  notify_on_emergency  boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON care.family_member (household_id);

CREATE TABLE care.representative (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id        uuid NOT NULL REFERENCES care.patient(id),
  family_member_id  uuid REFERENCES care.family_member(id),
  external_name     bytea,            -- enc
  legal_basis       text NOT NULL CHECK (legal_basis IN ('healthcare_poa','guardian','state_surrogate')),
  document_ref      text,
  verified_by       uuid REFERENCES auth.user_account(id),
  valid_from        date NOT NULL,
  valid_to          date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (family_member_id IS NOT NULL OR external_name IS NOT NULL)
);

-- ─── care: consents ────────────────────────────────────────────────────────────
CREATE TABLE care.care_consent (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id              uuid NOT NULL REFERENCES care.patient(id),
  practice_id             uuid NOT NULL REFERENCES care.practice(id),
  program                 text NOT NULL DEFAULT 'apcm' CHECK (program IN ('apcm')),
  given_by_kind           text NOT NULL CHECK (given_by_kind IN ('patient','representative')),
  given_by_id             uuid,       -- representative.id when given_by_kind = 'representative'
  method                  text NOT NULL CHECK (method IN ('verbal_recorded','written','e_sign')),
  copay_disclosed         boolean NOT NULL CHECK (copay_disclosed),  -- APCM cost-sharing disclosure is mandatory
  given_at                timestamptz NOT NULL,
  withdrawn_at            timestamptz,
  withdrawal_recorded_by  uuid,
  evidence_ref            text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK ((given_by_kind = 'representative') = (given_by_id IS NOT NULL))
);
CREATE UNIQUE INDEX care_consent_one_active ON care.care_consent (patient_id, program) WHERE withdrawn_at IS NULL;

CREATE TABLE care.contact_consent (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id         uuid NOT NULL REFERENCES care.patient(id),
  channel            text NOT NULL CHECK (channel IN ('voice','sms','whatsapp')),
  phone_hash         bytea NOT NULL,
  recording_allowed  boolean NOT NULL DEFAULT false,
  quiet_start        time NOT NULL DEFAULT '20:00',
  quiet_end          time NOT NULL DEFAULT '09:00',
  given_by_kind      text NOT NULL CHECK (given_by_kind IN ('patient','representative')),
  given_by_id        uuid,
  given_at           timestamptz NOT NULL,
  withdrawn_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_consent_one_active ON care.contact_consent (patient_id, channel) WHERE withdrawn_at IS NULL;

-- ─── Transactional outbox ──────────────────────────────────────────────────────
CREATE TABLE care.outbox (
  id              bigserial PRIMARY KEY,
  topic           text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  practice_id     uuid,
  household_id    uuid,
  payload         jsonb NOT NULL DEFAULT '{}',   -- ids/types only, never PHI
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);
CREATE INDEX outbox_unpublished ON care.outbox (id) WHERE published_at IS NULL;

CREATE FUNCTION care.outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('tomoni_outbox', NEW.id::text); RETURN NEW; END $$;
CREATE TRIGGER outbox_notify AFTER INSERT ON care.outbox FOR EACH ROW EXECUTE FUNCTION care.outbox_notify();

-- updated_at triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auth.user_account','care.practice','care.clinician','care.household',
                           'care.patient','care.family_member','care.representative'] LOOP
    EXECUTE format('CREATE TRIGGER touch BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t);
  END LOOP;
END $$;
