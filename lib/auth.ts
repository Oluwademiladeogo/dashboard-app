// Server-only auth constants for the dashboard password gate.
// The gate is a simple shared-password screen — it keeps the dashboard off
// the open internet, it is not a per-user auth system.

export const DASHBOARD_PASSWORD =
  process.env.DASHBOARD_PASSWORD ?? "AppyHourReporting@ElevateFoods";

export const AUTH_COOKIE = "ef_dash_auth";

// Opaque session token stored in the cookie after a successful login, so the
// password itself never travels in the cookie.
export const AUTH_TOKEN =
  "efd-9f2c47b1a6e34d8c-5b0a91e7c3f2486d-reporting";

export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
