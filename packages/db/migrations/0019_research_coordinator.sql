-- 0019 The research coordinator (Trial Bridge funnel). Until now admin stood in, which gave every
-- admin the names of patients in trial matches. The role reads nothing through tomoni_app RLS:
-- the API reads matched names under the worker role, for matches only, and audits each read.
ALTER TABLE auth.role_grant DROP CONSTRAINT role_grant_role_check;
ALTER TABLE auth.role_grant ADD CONSTRAINT role_grant_role_check CHECK (role IN ('patient','family_member',
  'representative','physician','nurse','front_desk','ops_agent','sponsor_user','research_coordinator','admin'));
-- No practice, household, patient or sponsor scope: the role is not a care, family or sponsor role.
ALTER TABLE auth.role_grant DROP CONSTRAINT role_scope;
ALTER TABLE auth.role_grant ADD CONSTRAINT role_scope CHECK (
  CASE role
    WHEN 'physician'      THEN practice_id IS NOT NULL
    WHEN 'nurse'          THEN practice_id IS NOT NULL
    WHEN 'front_desk'     THEN practice_id IS NOT NULL
    WHEN 'ops_agent'      THEN practice_id IS NOT NULL
    WHEN 'family_member'  THEN household_id IS NOT NULL
    WHEN 'patient'        THEN patient_id IS NOT NULL
    WHEN 'representative' THEN patient_id IS NOT NULL
    WHEN 'sponsor_user'   THEN sponsor_id IS NOT NULL
    WHEN 'research_coordinator' THEN coalesce(practice_id, household_id, patient_id, sponsor_id) IS NULL
    WHEN 'admin'          THEN true
  END
);
