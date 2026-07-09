import mysql from "mysql2/promise";

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

const sslEnabled = envBool("DB_SSL", true);
// DigitalOcean's managed MySQL supports TLS. Validate certificates by default;
// local setups that intentionally use self-signed certs can opt out explicitly.
const rejectUnauthorized = envBool("DB_SSL_REJECT_UNAUTHORIZED", true);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 25060,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: sslEnabled ? { rejectUnauthorized } : undefined,
  waitForConnections: true,
  connectionLimit: 5,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
});

export default pool;
