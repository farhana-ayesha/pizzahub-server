import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api";
import { ObjectId, type Db } from "mongodb";
import { clientOrigins, env, isGoogleConfigured } from "../config/env.js";
import { sendPasswordResetEmail } from "../utils/mail.js";

let authInstance: ReturnType<typeof buildAuth> | null = null;

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z]).{6,}$/;

type SignUpRole = "customer" | "vendor";

function requestedRole(value: unknown): SignUpRole | null {
  return value === "vendor" || value === "customer" ? value : null;
}

/**
 * Reads the role that was signed into the OAuth state cookie by the
 * `/sign-in/social` hook. Better Auth does not copy `additionalData` into the
 * new user automatically, so the user.create hook applies it here.
 */
async function oauthSignUpRole(): Promise<SignUpRole | null> {
  try {
    const state = await getOAuthState();
    return requestedRole(state?.serverContext?.role);
  } catch {
    return null;
  }
}

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
    account: {
      accountLinking: {
        enabled: true,
        // This app does not send verification emails for password accounts, so
        // local users are usually unverified. Google only returns an address
        // after verifying it, and the provider is trusted below. Allowing the
        // link lets an existing email/password user sign in with Google instead
        // of ending up with a duplicate account or an "account not linked" error.
        requireLocalEmailVerified: false,
        trustedProviders: ["google"],
      },
    },
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
            const requested = requestedRole(
              (user as Record<string, unknown>).role,
            );
            const role = requested ?? (await oauthSignUpRole()) ?? "customer";
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
      session: {
        create: {
          before: async (session) => {
            // Better Auth does not know about the business-level isBlocked
            // flag. Reject session creation here so blocked accounts cannot
            // sign in with Google (or email/password) in the first place.
            const userId = String(session.userId);
            const user =
              ObjectId.isValid(userId) &&
              new ObjectId(userId).toHexString() === userId
                ? await db
                    .collection("users")
                    .findOne({ _id: new ObjectId(userId) })
                : await db.collection("users").findOne({ id: userId });
            if (user?.isBlocked) {
              throw new APIError("FORBIDDEN", {
                message:
                  "This account has been blocked by an administrator.",
                code: "account_blocked",
              });
            }
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

        if (ctx.path === "/sign-in/social") {
          const provider =
            typeof body.provider === "string" ? body.provider : "";
          const additionalData = body.additionalData as
            | Record<string, unknown>
            | undefined;
          const role = requestedRole(additionalData?.role);
          if (provider === "google" && role) {
            // Store the requested role in the signed OAuth state so a new
            // Google user keeps the account type selected on the sign-up form.
            await addOAuthServerContext({ role });
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
