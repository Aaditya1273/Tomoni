-- 0006 Medicines, coverage files and warnings (Phase 2, BUILD_PROMPT §5.1–5.2).
--
-- Two kinds of data:
--   * reference data (public CMS files, drug names, pharmacies, PBM change lists): not PHI,
--     readable by any signed-in request, written by the worker or an admin upload;
--   * patient data (medications, fills, claims, plans, warnings, Blue Button links): PHI,
--     visible through the one patient policy (0003) and written only by the worker or staff.

-- ─── Reference data ────────────────────────────────────────────────────────────
CREATE TABLE care.data_file_version (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  kind            text NOT NULL CHECK (kind IN ('cms_partd','pbm_changes','shortage','pharmacy_closure')),
  label           text NOT NULL,
  source_url      text NOT NULL,
  sha256          bytea NOT NULL UNIQUE,           -- loading the same file twice is a no-op
  effective_date  date NOT NULL,
  row_count       int NOT NULL,
  dropped_count   int NOT NULL DEFAULT 0,          -- rows that failed the strict schema (SECURITY: loaders)
  loaded_by       text NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE care.drug (
  ndc     text PRIMARY KEY CHECK (ndc ~ '^\d{11}$'),
  rxcui   text NOT NULL,
  name    text NOT NULL
);
CREATE INDEX ON care.drug (rxcui);

CREATE TABLE care.pharmacy (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  npi         text NOT NULL UNIQUE CHECK (npi ~ '^\d{10}$'),
  name        text NOT NULL,
  address     text,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One CMS Part D release = plan, formulary and pricing files published together.
CREATE TABLE care.plan (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  version_id        uuid NOT NULL REFERENCES care.data_file_version(id),
  year              int NOT NULL,
  contract_id       text NOT NULL,
  plan_id           text NOT NULL,
  segment_id        text NOT NULL,
  name              text NOT NULL,
  type              text NOT NULL CHECK (type IN ('pdp','mapd')),
  premium_cents     int NOT NULL CHECK (premium_cents >= 0),
  deductible_cents  int NOT NULL CHECK (deductible_cents >= 0),
  formulary_id      text NOT NULL,
  UNIQUE (version_id, contract_id, plan_id, segment_id)
);
CREATE INDEX ON care.plan (contract_id, plan_id, segment_id);

CREATE TABLE care.formulary_entry (
  version_id      uuid NOT NULL REFERENCES care.data_file_version(id),
  formulary_id    text NOT NULL,
  rxcui           text NOT NULL,
  tier            int NOT NULL CHECK (tier BETWEEN 1 AND 7),
  prior_auth      boolean NOT NULL,
  step_therapy    boolean NOT NULL,
  quantity_limit  boolean NOT NULL,
  PRIMARY KEY (version_id, formulary_id, rxcui)
);

CREATE TABLE care.drug_price (
  version_id   uuid NOT NULL REFERENCES care.data_file_version(id),
  contract_id  text NOT NULL,
  plan_id      text NOT NULL,
  segment_id   text NOT NULL,
  rxcui        text NOT NULL,
  days_supply  int NOT NULL CHECK (days_supply IN (30, 60, 90)),
  unit_cost    numeric(12,5) NOT NULL CHECK (unit_cost >= 0),   -- CMS pricing file: dollars per unit
  PRIMARY KEY (version_id, contract_id, plan_id, segment_id, rxcui, days_supply)
);

-- PBM change lists (admin CSV upload): explicit changes rather than a full formulary.
CREATE TABLE care.formulary_change (
  version_id      uuid NOT NULL REFERENCES care.data_file_version(id),
  formulary_id    text NOT NULL,
  rxcui           text NOT NULL,
  change          text NOT NULL CHECK (change IN ('removal','tier_change')),
  new_tier        int CHECK (new_tier BETWEEN 1 AND 7),
  effective_date  date NOT NULL,
  PRIMARY KEY (version_id, formulary_id, rxcui),
  CHECK ((change = 'tier_change') = (new_tier IS NOT NULL))
);

CREATE TABLE care.drug_shortage (
  version_id   uuid NOT NULL REFERENCES care.data_file_version(id),
  rxcui        text NOT NULL,
  reported_on  date NOT NULL,
  resolved_on  date,
  PRIMARY KEY (version_id, rxcui)
);

CREATE TABLE care.pharmacy_closure (
  version_id   uuid NOT NULL REFERENCES care.data_file_version(id),
  pharmacy_id  uuid NOT NULL REFERENCES care.pharmacy(id),
  closes_on    date NOT NULL,
  PRIMARY KEY (version_id, pharmacy_id)
);

-- ─── Patient data ──────────────────────────────────────────────────────────────
CREATE TABLE care.patient_plan (
  patient_id   uuid NOT NULL REFERENCES care.patient(id),
  year         int NOT NULL,
  contract_id  text NOT NULL,
  plan_id      text NOT NULL,
  segment_id   text NOT NULL,
  PRIMARY KEY (patient_id, year)
);

CREATE TABLE care.medication (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id               uuid NOT NULL REFERENCES care.patient(id),
  rxcui                    text,
  display_name             text NOT NULL,
  sig_text                 bytea,     -- enc
  prescriber_clinician_id  uuid REFERENCES care.clinician(id),
  active                   boolean NOT NULL DEFAULT true,
  source                   text NOT NULL CHECK (source IN ('claims','desk','family','call')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX medication_one_per_drug ON care.medication (patient_id, rxcui) WHERE rxcui IS NOT NULL;

CREATE TABLE care.fill (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id          uuid NOT NULL REFERENCES care.patient(id),
  medication_id       uuid REFERENCES care.medication(id),
  ndc                 text NOT NULL,
  rxcui               text,
  fill_date           date NOT NULL,
  days_supply         int NOT NULL CHECK (days_supply BETWEEN 1 AND 365),
  quantity            numeric NOT NULL CHECK (quantity > 0),
  fill_number         int,
  refills_remaining   int CHECK (refills_remaining >= 0),
  pharmacy_id         uuid REFERENCES care.pharmacy(id),
  patient_paid_cents  int CHECK (patient_paid_cents >= 0),
  source              text NOT NULL CHECK (source IN ('bluebutton','mock','manual')),
  source_ref          text NOT NULL,      -- EOB id: ingestion is idempotent
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX ON care.fill (patient_id, rxcui, fill_date DESC);

CREATE TABLE care.claim (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id   uuid NOT NULL REFERENCES care.patient(id),
  kind         text NOT NULL CHECK (kind IN ('inpatient','outpatient','carrier','snf','hha','hospice')),
  start_date   date NOT NULL,
  end_date     date,
  dx_codes     text[] NOT NULL DEFAULT '{}',
  source       text NOT NULL CHECK (source IN ('bluebutton','mock','manual')),
  source_ref   text NOT NULL,
  ingested_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX ON care.claim (patient_id, start_date);

-- OAuth link to the beneficiary's Medicare account. Tokens are encrypted in the app.
CREATE TABLE care.bluebutton_link (
  patient_id       uuid PRIMARY KEY REFERENCES care.patient(id),
  mode             text NOT NULL CHECK (mode IN ('sandbox','mock','production')),
  fhir_patient_id  bytea NOT NULL,   -- enc
  access_token     bytea,            -- enc
  refresh_token    bytea,            -- enc
  expires_at       timestamptz,
  scope            text NOT NULL DEFAULT '',
  connected_by     uuid REFERENCES auth.user_account(id),
  connected_at     timestamptz NOT NULL DEFAULT now(),
  last_synced_at   timestamptz,
  revoked_at       timestamptz
);

CREATE TABLE care.warning (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id          uuid NOT NULL REFERENCES care.patient(id),
  medication_id       uuid REFERENCES care.medication(id),
  rxcui               text,
  type                text NOT NULL CHECK (type IN ('run_out','late_refill','premium_jump','formulary_removal',
                                                    'tier_change','negotiated_price_change','pharmacy_closure',
                                                    'shortage','gene_drug_mismatch')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  days_until_problem  int NOT NULL CHECK (days_until_problem >= 0),
  problem_date        date NOT NULL,
  access_status       text NOT NULL CHECK (access_status IN ('green','amber','red')),
  source_kind         text NOT NULL CHECK (source_kind IN ('fill','data_file','call','pgx')),
  source_ref          text NOT NULL,
  source_date         date NOT NULL,
  evidence            jsonb NOT NULL,          -- ids, dates, tiers and prices only
  dedupe_key          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  outcome             text CHECK (outcome IN ('happened','prevented','false_alarm','unknown')),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX warning_open_dedupe ON care.warning (dedupe_key) WHERE status = 'open';
CREATE INDEX ON care.warning (patient_id) WHERE status = 'open';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care.medication','care.warning'] LOOP
    EXECUTE format('CREATE TRIGGER touch BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', t);
  END LOOP;
END $$;

-- ─── RLS ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['care.data_file_version','care.drug','care.pharmacy','care.plan','care.formulary_entry',
                           'care.drug_price','care.formulary_change','care.drug_shortage','care.pharmacy_closure',
                           'care.patient_plan','care.medication','care.fill','care.claim','care.bluebutton_link',
                           'care.warning'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY worker_all ON %s TO tomoni_worker USING (true) WITH CHECK (true)', t);
  END LOOP;
  -- Reference data: public files, not PHI. Any signed-in request may read; only admins upload.
  FOREACH t IN ARRAY ARRAY['care.data_file_version','care.drug','care.pharmacy','care.plan','care.formulary_entry',
                           'care.drug_price','care.formulary_change','care.drug_shortage','care.pharmacy_closure'] LOOP
    EXECUTE format('CREATE POLICY read ON %s FOR SELECT TO tomoni_app USING (app.user_id() IS NOT NULL)', t);
    EXECUTE format('CREATE POLICY admin_insert ON %s FOR INSERT TO tomoni_app WITH CHECK (app.is_admin())', t);
  END LOOP;
  -- Patient data: the patient policy decides; staff of the patient's practice may write.
  FOREACH t IN ARRAY ARRAY['care.patient_plan','care.medication','care.fill','care.claim','care.warning'] LOOP
    EXECUTE format('CREATE POLICY read ON %s FOR SELECT TO tomoni_app USING (patient_id IN (SELECT id FROM care.patient))', t);
    EXECUTE format('CREATE POLICY staff_insert ON %s FOR INSERT TO tomoni_app WITH CHECK (app.can_write_patient(patient_id))', t);
    EXECUTE format('CREATE POLICY staff_update ON %s FOR UPDATE TO tomoni_app USING (app.can_write_patient(patient_id)) WITH CHECK (app.can_write_patient(patient_id))', t);
  END LOOP;
END $$;

-- Blue Button links: whoever can see the patient may see that a link exists (tokens stay encrypted);
-- connecting is done by the patient or their household (they sign in to Medicare.gov themselves).
CREATE POLICY read ON care.bluebutton_link FOR SELECT TO tomoni_app USING (patient_id IN (SELECT id FROM care.patient));
CREATE FUNCTION app.can_connect_patient(pid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pid = ANY(app.patient_ids()) OR EXISTS (
    SELECT 1 FROM care.patient p WHERE p.id = pid AND p.household_id = ANY(app.household_ids()))
$$;
CREATE POLICY connect ON care.bluebutton_link FOR INSERT TO tomoni_app WITH CHECK (app.can_connect_patient(patient_id));
CREATE POLICY reconnect ON care.bluebutton_link FOR UPDATE TO tomoni_app
  USING (app.can_connect_patient(patient_id)) WITH CHECK (app.can_connect_patient(patient_id));

-- ─── Grants ────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION app.can_connect_patient(uuid) TO tomoni_app, tomoni_worker;
GRANT SELECT ON care.data_file_version, care.drug, care.pharmacy, care.plan, care.formulary_entry, care.drug_price,
  care.formulary_change, care.drug_shortage, care.pharmacy_closure TO tomoni_app;
GRANT INSERT ON care.data_file_version, care.formulary_change TO tomoni_app;      -- admin PBM upload
GRANT SELECT, INSERT, UPDATE ON care.patient_plan, care.medication, care.fill, care.claim, care.warning,
  care.bluebutton_link TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON care.data_file_version, care.drug, care.pharmacy, care.plan,
  care.formulary_entry, care.drug_price, care.formulary_change, care.drug_shortage, care.pharmacy_closure,
  care.patient_plan, care.medication, care.fill, care.claim, care.bluebutton_link, care.warning TO tomoni_worker;
