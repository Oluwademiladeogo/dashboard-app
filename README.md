# Elevate Foods Dashboard

Next.js dashboard for internal customer-service, food-safety, subscription-changes, and cost reporting.
The app reads the managed DigitalOcean MySQL reporting warehouse (`gorgias_appyhourbox_db`).

## Local Development

1. Create a `.env` file in this directory (copy from `.env.example` and paste the shared credentials):

```bash
cp .env.example .env
```

2. Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

3. Open `http://localhost:3000` (default shared password gate is configured in `lib/auth.ts` or via `DASHBOARD_PASSWORD`).

### Environment Variables

Required for all dashboard pages (MySQL):
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL`
- `DB_SSL_REJECT_UNAUTHORIZED`

Optional (used by `/sub-changes` "Trigger Upcoming Charge SMS" test button):
- `RECHARGE_API_TOKEN`
- `KLAVIYO_API_KEY`
- `TEST_SMS_ALLOWLIST`

## Production Build & Server Deployment

```bash
pnpm build
pnpm start
```

On the production Droplet (`104.236.223.214`), the app lives at `/opt/Elevate-Foods/Automations/dashboard-app` and is managed by PM2 (`dashboard`):

```bash
cd /opt/Elevate-Foods/Automations/dashboard-app
pnpm install --frozen-lockfile
pnpm build
pm2 restart dashboard
```
