#!/bin/sh
set -eu

# Runs only on a new PostgreSQL volume. Keep the application role non-superuser.
if [ "$CONSORT_DB_PASSWORD" = "$POSTGRES_PASSWORD" ]; then
  echo 'Use different application and bootstrap database passwords.' >&2
  exit 1
fi
psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$CONSORT_DB_PASSWORD" <<'SQL'
CREATE ROLE consort LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE consort OWNER consort;
REVOKE ALL ON DATABASE consort FROM PUBLIC;
\connect consort
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO consort;
SQL
