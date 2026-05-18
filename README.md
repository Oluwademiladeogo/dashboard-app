# Elevate Foods dashboard

Next.js dashboard for internal customer-service, food-safety, and cost reporting.
The app reads the managed MySQL reporting warehouse populated by the n8n workflows; it no longer reads CSV snapshots or a local SQLite database.

## Local development

From this submodule directory:

```bash
pnpm install
pnpm dev
```

The scripts load the **repo-root** `.env` file through `scripts/with-root-env.cjs`, so there is one local env source for the monorepo. Start from the root `.env.example` file.

Required app env vars:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL`
- `DB_SSL_REJECT_UNAUTHORIZED`

## Build

```bash
pnpm build
pnpm start
```

## Data flow

1. `Automations/n8n-reporting-sync` syncs Gorgias + Shopify data into MySQL.
2. Dashboard API routes read the MySQL warehouse.
3. Client pages consume `/api/*` endpoints.

The dashboard-side resolution parser is centralized in `lib/resolution.ts`; classification is owned by the reporting-sync workflow rather than by a second dashboard backfill script.

## Deployment

The dashboard is deployed with the parent repo through the root `.github/workflows/deploy.yml` workflow. The dashboard submodule must be committed before the parent repo updates its submodule pointer.

See the parent repo `DEPLOYMENT.md` for Droplet secrets, restart-command configuration, and the n8n release checklist.
