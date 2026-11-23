import type { ErrorRequestHandler, RequestHandler } from "express";
import { MongoServerError } from "mongodb";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} was not found.`));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof ApiError) {
    res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: "Please check the submitted fields.",
      details: error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof MongoServerError && error.code === 11000) {
    res.status(409).json({
      success: false,
      message: "That record already exists.",
    });
    return;
  }

  console.error("Unhandled API error:", error);
  res.status(500).json({
    success: false,
    message:
      env.NODE_ENV === "production"
        ? "Something went wrong. Please try again."
        : error instanceof Error
          ? error.message
          : "Something went wrong.",
  });
};
