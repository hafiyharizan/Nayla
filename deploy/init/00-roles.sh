#!/bin/bash
# Runs once, when the database volume is first created.
#
# PostgREST logs in as `authenticator`, a role with almost no rights of its
# own, and switches to `anon` per request. So even a total compromise of the
# API process lands on a role that can reach nothing but the two functions.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	create role anon nologin noinherit;
	create role authenticated nologin noinherit;

	create role authenticator login noinherit password '${AUTHENTICATOR_PASSWORD}';
	grant anon, authenticated to authenticator;

	-- Nothing new should land in public by default.
	revoke create on schema public from public;
EOSQL
