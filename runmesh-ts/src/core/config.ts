import { z } from "zod";

// Local development convenience: a .env file, when present, supplies the variables below.
// Deployment (container) sets real environment variables and this is a no-op.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine
}

const schema = z.object({
  DB_PATH: z.string().default("runmesh.db"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.string().default("info"),
  MIGRATIONS_DIR: z.string().optional(),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().nonnegative().default(5),
  QUEUE_POLL_INTERVAL_SECONDS: z.coerce.number().nonnegative().default(1),
  JWT_SECRET: z.string().min(8).default("dev-only-secret-change-me"),
  PUBLIC_URL: z.string().default("http://localhost:8787"),
  FRONTEND_URL: z.string().default("http://localhost:5173"),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  GOOGLE_CONNECT_CLIENT_ID: z.string().default(""),
  GOOGLE_CONNECT_CLIENT_SECRET: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  CONNECT_EMAIL_FROM: z.string().default("Runmesh Connect <onboarding@resend.dev>"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration — ${details}`);
}

const env = parsed.data;

export const config = Object.freeze({
  dbPath: env.DB_PATH,
  host: env.HOST,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  migrationsDir: env.MIGRATIONS_DIR,
  sweepIntervalSeconds: env.SWEEP_INTERVAL_SECONDS,
  queuePollIntervalSeconds: env.QUEUE_POLL_INTERVAL_SECONDS,
  jwtSecret: env.JWT_SECRET,
  publicUrl: env.PUBLIC_URL,
  frontendUrl: env.FRONTEND_URL,
  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  },
  google: {
    clientId: env.GOOGLE_CONNECT_CLIENT_ID,
    clientSecret: env.GOOGLE_CONNECT_CLIENT_SECRET,
  },
  resendApiKey: env.RESEND_API_KEY,
  connectEmailFrom: env.CONNECT_EMAIL_FROM,
});

export type Config = typeof config;
