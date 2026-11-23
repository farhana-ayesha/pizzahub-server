import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string()
    .min(1)
    .default("mongodb://127.0.0.1:27017/pizzahub"),
  MONGODB_DB_NAME: z.string().min(1).default("pizzahub"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .default("pizzahub-development-better-auth-secret-change-me"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
  CLIENT_URL: z.string().url().default("http://localhost:3000"),
  CLIENT_URLS: z.string().optional(),
  JWT_SECRET: z
    .string()
    .min(32)
    .default("pizzahub-development-jwt-secret-change-me-now"),
  JWT_EXPIRES_IN: z.string().min(1).default("7d"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PREMIUM_PRICE_ID: z.string().optional(),
  STRIPE_PREMIUM_AMOUNT: z.coerce.number().int().positive().default(2900),
  STRIPE_CURRENCY: z.string().min(3).default("usd"),
  IMGBB_API_KEY: z.string().optional(),
  ADMIN_NAME: z.string().min(2).default("PizzaHub Admin"),
  ADMIN_EMAIL: z.string().email().default("admin@pizzahub.com"),
  ADMIN_PASSWORD: z
    .string()
    .min(6)
    .default("Password123"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("PizzaHub <noreply@pizzahub.com>"),
  RESET_PASSWORD_URL: optionalUrl,
  SEED_DEMO_DATA: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;

if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
  throw new Error(
    "Google OAuth is partially configured. Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or leave both empty.",
  );
}

if (isProduction) {
  const unsafeDefaults = [
    ["BETTER_AUTH_SECRET", "pizzahub-development-better-auth-secret-change-me"],
    ["JWT_SECRET", "pizzahub-development-jwt-secret-change-me-now"],
  ].filter(([key, value]) => env[key as keyof typeof env] === value);

  if (unsafeDefaults.length) {
    throw new Error(
      `Refusing to start in production with development secrets: ${unsafeDefaults
        .map(([key]) => key)
        .join(", ")}`,
    );
  }
}

export const clientOrigins = Array.from(
  new Set(
    [
      env.CLIENT_URL,
      ...(env.CLIENT_URLS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ].filter(Boolean),
  ),
);

export const isStripeConfigured = Boolean(env.STRIPE_SECRET_KEY);
export const isGoogleConfigured = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);
export const isImgBBConfigured = Boolean(env.IMGBB_API_KEY);
