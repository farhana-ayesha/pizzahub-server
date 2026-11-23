import type { Request } from "express";
import type { z } from "zod";
import { ApiError } from "./errors.js";

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw ApiError.unprocessable(
      "Please check the submitted fields.",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw ApiError.badRequest(
      "Invalid query parameters.",
      result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
): z.infer<T> {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    throw ApiError.badRequest("Invalid route parameters.");
  }
  return result.data;
}
