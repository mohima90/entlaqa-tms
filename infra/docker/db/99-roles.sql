-- First start only (run by the image's migrate.sh as postgres): the Auth server's database password,
-- taken from the container environment (.secrets/.env), never written into this file.
\set pw `echo "$AUTH_DB_PASSWORD"`
alter role supabase_auth_admin with login password :'pw';
