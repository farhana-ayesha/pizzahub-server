import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Db } from "mongodb";
import { clientOrigins, env, isGoogleConfigured } from "../config/env.js";
import { sendPasswordResetEmail } from "../utils/mail.js";

let authInstance: ReturnType<typeof buildAuth> | null = null;

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z]).{6,}$/;

function validatePassword(password: unknown) {
  if (typeof password !== "string" || !strongPassword.test(password)) {
    throw new APIError("BAD_REQUEST", {
      message:
        "Password must be at least 6 characters and include one uppercase and one lowercase letter.",
    });
  }
}

export function buildAuth(db: Db) {
  const auth = betterAuth({
    appName: "PizzaHub",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: clientOrigins,
    database: mongodbAdapter(db, {
      usePlural: true,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, user.name, url);
      },
    },
    socialProviders: isGoogleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : {},
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "customer",
          input: true,
        },
        isBlocked: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
        businessName: {
          type: "string",
          required: false,
          input: false,
        },
        subscriptionPlan: {
          type: "string",
          required: false,
          defaultValue: "free",
          input: false,
        },
        subscriptionExpiresAt: {
          type: "date",
          required: false,
          input: false,
        },
        phone: {
          type: "string",
          required: false,
          input: false,
        },
        location: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const requestedRole = (user as Record<string, unknown>).role;
            const role =
              requestedRole === "vendor" || requestedRole === "customer"
                ? requestedRole
                : "customer";
            return {
              data: {
                ...user,
                role,
                isBlocked: false,
                ...(role === "vendor"
                  ? {
                      businessName:
                        (user as Record<string, unknown>).businessName ||
                        `${user.name}'s Pizzeria`,
                      subscriptionPlan: "free",
                    }
                  : {}),
              },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;

        if (ctx.path === "/sign-up/email") {
          validatePassword(body.password);
          if (body.role === "admin") {
            throw new APIError("FORBIDDEN", {
              message: "Admin accounts cannot be created through public registration.",
            });
          }
          if (body.role !== "vendor" && body.role !== "customer") {
            body.role = "customer";
          }
        }

        if (ctx.path === "/reset-password" || ctx.path === "/change-password") {
          validatePassword(body.newPassword);
        }

        if (ctx.path === "/set-password") {
          validatePassword(body.newPassword ?? body.password);
        }
      }),
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: env.NODE_ENV === "production" ? "none" : "lax",
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  });

  authInstance = auth;
  return auth;
}

export type PizzaHubAuth = ReturnType<typeof buildAuth>;

export function getAuth(): PizzaHubAuth {
  if (!authInstance) {
    throw new Error("Authentication has not been initialised.");
  }
  return authInstance;
}
