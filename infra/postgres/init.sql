-- Runs once on a fresh volume. Creates the login roles; migrations own everything else.
-- Dev passwords only; real environments set these from a secret store.
CREATE ROLE tomoni_app     LOGIN PASSWORD 'dev_app_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE tomoni_worker  LOGIN PASSWORD 'dev_worker_pw'  NOSUPERUSER NOBYPASSRLS;
CREATE ROLE tomoni_sponsor LOGIN PASSWORD 'dev_sponsor_pw' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE tomoni_test OWNER tomoni_owner;
