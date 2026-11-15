-- 0015 Gene-to-Pill (Phase 6, PRODUCT "Engine 3"). A pharmacogenomic result is clinical data in
-- care (not research), entered by the patient's own practice. Gene-drug warnings go to the doctor
-- only: the family card and its evidence route never show them (0006 warning type, API filters).

CREATE TABLE care.gene_drug_rule (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  gene                 text NOT NULL,
  phenotype            text NOT NULL,          -- CPIC phenotype term
  rxcui                text NOT NULL,
  drug                 text NOT NULL,
  recommendation_code  text NOT NULL,          -- short key; the full text lives in the cited guideline
  cpic_level           text NOT NULL CHECK (cpic_level IN ('A','B')),
  source_url           text NOT NULL,
  version              text NOT NULL,
  UNIQUE (gene, phenotype, rxcui, version)
);

CREATE TABLE care.pgx_result (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  patient_id               uuid NOT NULL REFERENCES care.patient(id),
  gene                     text NOT NULL CHECK (gene ~ '^[A-Z0-9]{2,10}$'),
  diplotype                text NOT NULL CHECK (diplotype ~ '^[*A-Za-z0-9./ -]{1,30}$'),
  phenotype                text NOT NULL,
  lab                      text NOT NULL,
  reported_at              date NOT NULL,
  ordered_by_clinician_id  uuid REFERENCES care.clinician(id),
  source_ref               text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, gene, source_ref)
);

ALTER TABLE care.gene_drug_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE care.pgx_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_all ON care.gene_drug_rule TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_all ON care.pgx_result TO tomoni_worker USING (true) WITH CHECK (true);
CREATE POLICY read ON care.gene_drug_rule FOR SELECT TO tomoni_app USING (app.user_id() IS NOT NULL);
-- Genetic results are for the care team: staff of the patient's practice read and enter them.
-- The family and the patient see that a test exists through their doctor, not here.
CREATE POLICY staff_read ON care.pgx_result FOR SELECT TO tomoni_app
  USING (app.is_admin() OR patient_id IN (SELECT id FROM care.patient WHERE practice_id = ANY(app.staff_practice_ids())));
CREATE POLICY staff_insert ON care.pgx_result FOR INSERT TO tomoni_app
  WITH CHECK (patient_id IN (SELECT id FROM care.patient WHERE practice_id = ANY(app.staff_practice_ids())));

GRANT SELECT ON care.gene_drug_rule TO tomoni_app;
GRANT SELECT, INSERT ON care.pgx_result TO tomoni_app;
GRANT SELECT, INSERT, UPDATE ON care.gene_drug_rule, care.pgx_result TO tomoni_worker;

-- A few well-established CPIC level A pairs (BUILD_PROMPT §5.7). Recommendation text is not
-- copied: the doctor reads the guideline at the source.
INSERT INTO care.gene_drug_rule (gene, phenotype, rxcui, drug, recommendation_code, cpic_level, source_url, version) VALUES
  ('CYP2C19', 'Poor Metabolizer', '309362', 'clopidogrel', 'avoid_consider_alternative', 'A',
   'https://cpicpgx.org/guidelines/guideline-for-clopidogrel-and-cyp2c19/', '2022'),
  ('CYP2C19', 'Intermediate Metabolizer', '309362', 'clopidogrel', 'avoid_consider_alternative', 'A',
   'https://cpicpgx.org/guidelines/guideline-for-clopidogrel-and-cyp2c19/', '2022'),
  ('SLCO1B1', 'Poor Function', '198211', 'simvastatin', 'avoid_or_lower_dose', 'A',
   'https://cpicpgx.org/guidelines/cpic-guideline-for-statins/', '2022'),
  ('SLCO1B1', 'Decreased Function', '198211', 'simvastatin', 'avoid_or_lower_dose', 'A',
   'https://cpicpgx.org/guidelines/cpic-guideline-for-statins/', '2022');
