# Deployment Notes

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
- Start command: `npm run start`
- Required env: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`, `UPLOAD_DIR`

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

Example (run once as the database owner and replace the password securely):

```sql
CREATE ROLE clinic_app LOGIN PASSWORD '<long-random-password>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT CONNECT ON DATABASE projectfinal TO clinic_app;
GRANT USAGE ON SCHEMA clinic TO clinic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA clinic TO clinic_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA clinic TO clinic_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA clinic TO clinic_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <schema-owner> IN SCHEMA clinic
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clinic_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <schema-owner> IN SCHEMA clinic
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO clinic_app;
```

`BYPASSRLS` is required by the current login and migration architecture; API
authorization remains mandatory on every private route. The role is deliberately
not a PostgreSQL superuser and has no cluster/database creation privileges.

## Production Checklist

- Set a long random `JWT_SECRET`; do not use the example value.
- Set `DATABASE_URL` and `PGSSL=true` if the database provider requires SSL.
- Run `npm run migrate` with a backed-up database before starting the new release.
- Set SMTP variables before testing forgot-password or appointment email.
- Use a dedicated non-superuser database role; production startup rejects a superuser.
- Mount a persistent disk and set its absolute path in `UPLOAD_DIR`.
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
