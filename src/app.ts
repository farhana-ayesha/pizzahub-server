import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { getAuth } from "./auth/auth.js";
import { clientOrigins, env } from "./config/env.js";
import { getDb } from "./db/mongo.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authTokenRouter } from "./routes/auth.routes.js";
import { menuRouter } from "./routes/menu.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { stateRouter } from "./routes/state.routes.js";
import {
  stripeWebhookRouter,
  vendorSubscriptionRouter,
} from "./routes/subscription.routes.js";
import { uploadRouter } from "./routes/upload.routes.js";
import { vendorMenuRouter } from "./routes/vendor.routes.js";
import { asyncHandler } from "./utils/async-handler.js";
import { ApiError } from "./utils/errors.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || clientOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(
          ApiError.forbidden(`Origin ${origin} is not allowed by CORS.`),
        );
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many requests. Please slow down and try again shortly.",
    },
  });
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many authentication attempts. Please try again in a minute.",
    },
  });

  app.use("/api", apiLimiter);

  // Custom JWT endpoint must be registered before the Better Auth catch-all.
  app.use("/api/auth", authLimiter, authTokenRouter);
  app.all("/api/auth/*splat", toNodeHandler(getAuth()));

  // Stripe requires the untouched raw request body for signature verification.
  app.use(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    stripeWebhookRouter,
  );

  app.use(express.json({ limit: "12mb" }));
  app.use(express.urlencoded({ extended: true, limit: "12mb" }));

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      name: "PizzaHub API",
      version: "1.0.0",
      health: "/api/health",
    });
  });

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      await getDb().command({ ping: 1 });
      res.json({
        success: true,
        message: "PizzaHub API is running",
        timestamp: new Date().toISOString(),
      });
    }),
  );

  app.get(
    "/api/health",
    asyncHandler(async (_req, res) => {
      await getDb().command({ ping: 1 });
      res.json({
        success: true,
        message: "PizzaHub API is running",
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
      });
    }),
  );

  app.use("/api/menu", menuRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/vendor/menu", vendorMenuRouter);
  app.use("/api/vendor/subscription", vendorSubscriptionRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/state", stateRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/upload", uploadRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
