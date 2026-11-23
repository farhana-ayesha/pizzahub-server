import { Router } from "express";
import { env } from "../config/env.js";
import { signAccessToken } from "../auth/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const authTokenRouter = Router();

/**
 * Issues a short-lived JWT for the authenticated Better Auth session. The API
 * also accepts the session cookie directly, so clients can use either method.
 */
authTokenRouter.get(
  "/token",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const token = signAccessToken(user);
    res.json({
      success: true,
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: env.JWT_EXPIRES_IN,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isBlocked: user.isBlocked,
          image: user.image ?? "",
          businessName: user.businessName ?? undefined,
          subscriptionPlan: user.subscriptionPlan ?? "free",
          subscriptionExpiresAt:
            user.subscriptionExpiresAt?.toISOString() ?? null,
          phone: user.phone ?? null,
          location: user.location ?? null,
        },
      },
    });
  }),
);
