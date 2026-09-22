# Deployment Notes

Google Drive image storage setup, migration and cleanup:
[คู่มือภาษาไทย](GOOGLE_DRIVE_STORAGE_TH.md).

Email, Google OAuth and LINE Login production setup:
[คู่มือเตรียม Integrations](INTEGRATIONS_SETUP_TH.md).

## Frontend

- Root directory: `frontend`
- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm run start`
- Required env: `NEXT_PUBLIC_API_BASE`, `BACKEND_ORIGIN`

Set `NEXT_PUBLIC_API_BASE` to the backend API root, for example:

```env
NEXT_PUBLIC_API_BASE=/api
BACKEND_ORIGIN=https://your-backend.example.com
```

`BACKEND_ORIGIN` is used by Next.js to proxy `/api` and `/uploads`. Set
`BACKEND_INTERNAL_URL` too when the hosting provider gives the frontend a
private URL for reaching the backend. Build the frontend again whenever
`BACKEND_ORIGIN` changes.

## Backend

- Root directory: `backend`
- Install command: `npm install`
- Migration/release command: `npm run migrate`
- Preflight command: `npm run check:deploy`
- Build command: `npm ci --omit=dev --ignore-scripts`
- Start command: `npm run start:render`
- Health check: `/readyz`
- Required env: either `DATABASE_URL` or all `DB_USER`, `DB_HOST`, `DB_NAME`,
  `DB_PASSWORD`; plus `JWT_SECRET`, `FRONTEND_URL`, and `CORS_ORIGINS`
- Image storage: `STORAGE_PROVIDER=local` requires persistent `UPLOAD_DIR`;
  `STORAGE_PROVIDER=google_drive` requires the four `GOOGLE_DRIVE_*` variables below.

For the hardware scale, set `MQTT_ENABLED=true` and configure `MQTT_URL`,
`MQTT_CLIENT_ID`, `MQTT_USERNAME`, `MQTT_PASSWORD`, and (for a private CA)
`MQTT_CA_FILE`. Production accepts only `mqtts://` broker URLs. Run the
database migration before enabling the MQTT bridge.

OAuth callback URLs must use the frontend domain. Next.js proxies them to the
backend so OAuth state and login cookies remain first-party:

```env
GOOGLE_REDIRECT_URI=https://your-frontend.example.com/api/google/callback
LINE_REDIRECT_URI=https://your-frontend.example.com/api/line/callback
```

`FRONTEND_URL` is used after OAuth login succeeds. `CORS_ORIGINS` can contain
multiple frontend origins separated by commas. Keep `COOKIE_SAME_SITE=lax` and
`COOKIE_SECURE=true` with the recommended same-origin proxy.

Production does not alter the database during normal startup. Run
`npm run migrate` once before rolling out the new backend version. If the
runtime role does not own the schema, provide a schema-owner connection only
to the release job as `MIGRATION_DATABASE_URL`; never expose it to the running
web service.

Run `npm run check:deploy` in the production service after migration and before
shifting traffic. It validates secrets/URLs, the least-privilege database role,
required tables and functions, and writable persistent upload storage without
changing application data.

### Database runtime role

Do not run the API with the PostgreSQL `postgres` superuser. Create a dedicated
login role for this database and put that role in `DATABASE_URL` or `DB_USER`.
The API refuses to start in production when the configured role is a superuser.
For a Supabase shared pooler, copy the exact host from the project's Connect
dialog and use `cliniccare_runtime.<project-ref>` as the username. Do not infer
the pooler cluster number or reuse values from another Supabase project.

Example (run once as the database owner and replace the password securely):

```sql
CREATE ROLE cliniccare_runtime LOGIN PASSWORD '<long-random-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO cliniccare_runtime;
GRANT USAGE ON SCHEMA clinic TO cliniccare_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clinic TO cliniccare_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA clinic TO cliniccare_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA clinic TO cliniccare_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE <schema-owner> IN SCHEMA clinic
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cliniccare_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE <schema-owner> IN SCHEMA clinic
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO cliniccare_runtime;
```

For every table with RLS enabled, add an explicit policy for the runtime role.
The deployment preflight currently requires the policy
`cliniccare_runtime_backend_full_access` on these seven tables: `appointments`,
`clinic_holidays`, `help_requests`, `medical_records`, `queue_tickets`,
`user_details`, and `users`. The role must remain `NOBYPASSRLS`; API
authorization is still mandatory on every private route.

After creating the role and setting its password privately, run
[`database/migrations.sql`](database/migrations.sql)
in pgAdmin or the Supabase SQL Editor as the schema/migration owner, after the
initial schema exists. This replaces the six former standalone migration/grant
files. Execute the entire file; its transaction preserves existing application
rows. The final query must include policies for all seven tables listed above
(additional clinic tables are also covered).

If `cliniccare_runtime` does not exist, production grants are skipped for local
development. For production, create the role first and rerun this file. Grants
target the connected database and default privileges target the executing owner,
so use the same owner for future migrations. The backend's ACK initializer reads
only the marked `measurement_ack_outbox` section; normal startup does not apply
the entire consolidated file.

### Render Blueprint

The repository-root `render.yaml` contains the backend service settings for
Singapore and the `deployment/production-preparation` branch. Create a Render Blueprint
from that file, or copy the same values into an existing Web Service. Render
will generate `JWT_SECRET` and prompt for `DB_PASSWORD`; never commit either
value. Automatic deploys are disabled to match the manual deployment workflow.

For an existing service, add or update `DB_PASSWORD` directly in the Render
Dashboard because Blueprint variables marked `sync: false` are prompted only
during initial Blueprint creation.

## Production Checklist

- Set a long random `JWT_SECRET`; do not use the example value.
- Set either `DATABASE_URL` or the separate `DB_*` values, and set `PGSSL=true`
  for Supabase. Do not set `DATABASE_URL` when using `DB_*`.
- Run `npm run migrate` with a backed-up database before starting the new release.
- Set SMTP variables before testing forgot-password or appointment email.
- On Render Free, use an email provider endpoint on port 2525; Gmail SMTP port 587 is blocked.
- Run `npm run check:integrations:live` after all Email, OAuth, Drive and MQTT values are set.
- Use a dedicated non-superuser database role; production startup rejects a superuser.
- For local image storage, mount a persistent disk and set its absolute path in `UPLOAD_DIR`.
- For Google Drive storage, run `npm run check:storage` and test image upload/read/delete.
- Confirm `clinic.audit_logs` is created and Super Admin can read `/api/audit-logs`.
- Run `AUDIT_TEST_ALLOW_MUTATION=true npm run test:audit` against a staging database.
- Add the same Google and LINE callback URLs in each provider console.
- Configure the platform health check to call `/readyz` on the backend.
- Do not deploy `node_modules`, `.env`, `.next`, or local logs.

## Docker

Both applications include production Dockerfiles. Build the frontend with the
real backend destination because Next.js rewrites are generated during build:

```powershell
docker build -t clinic-backend ./backend
docker build --build-arg BACKEND_ORIGIN=https://your-backend.example.com -t clinic-frontend ./frontend
```

Run the migration as a one-off job before starting or replacing backend
containers. The backend container runs as the unprivileged `node` user; make
sure the mounted upload directory is writable by that user.
