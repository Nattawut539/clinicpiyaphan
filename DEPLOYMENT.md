# Deployment Notes

## Frontend

- Root directory: `frontend`
- Install command: `npm install`
- Build command: `npm run build`
- Start command: `npm run start`
- Required env: `NEXT_PUBLIC_API_BASE`

Set `NEXT_PUBLIC_API_BASE` to the backend API root, for example:

```env
NEXT_PUBLIC_API_BASE=https://your-backend.example.com/api
```

## Backend

- Root directory: `backend`
- Install command: `npm install`
- Start command: `npm run start`
- Required env: `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`

OAuth callback URLs must point to the backend:

```env
GOOGLE_REDIRECT_URI=https://your-backend.example.com/api/google/callback
LINE_REDIRECT_URI=https://your-backend.example.com/api/line/callback
```

`FRONTEND_URL` is used after OAuth login succeeds. `CORS_ORIGINS` can contain multiple frontend origins separated by commas.

## Production Checklist

- Set a long random `JWT_SECRET`; do not use the example value.
- Set `DATABASE_URL` and `PGSSL=true` if the database provider requires SSL.
- Set SMTP variables before testing forgot-password or appointment email.
- Add the same Google and LINE callback URLs in each provider console.
- Do not deploy `node_modules`, `.env`, `.next`, or local logs.
