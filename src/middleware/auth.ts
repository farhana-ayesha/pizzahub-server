import type { NextFunction, Request, RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../auth/auth.js";
import { verifyAccessToken } from "../auth/jwt.js";
import type { Role } from "../types/models.js";
import { ApiError } from "../utils/errors.js";
import { findUserById, toAuthUser } from "../utils/users.js";

async function resolveUser(req: Request): Promise<void> {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) throw ApiError.unauthorized("A valid access token is required.");
    try {
      const payload = verifyAccessToken(token);
      const user = await findUserById(payload.sub);
      if (!user) throw ApiError.unauthorized("The token belongs to an unknown account.");
      if (user.isBlocked) {
        throw ApiError.forbidden("This account has been blocked by an administrator.");
      }
      req.user = toAuthUser(user);
      req.authMethod = "jwt";
      return;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.unauthorized("Your session token is invalid or has expired.");
    }
  }

  const auth = getAuth();
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user?.id) return;

  const user = await findUserById(session.user.id);
  if (!user) throw ApiError.unauthorized("Your session is no longer valid.");
  if (user.isBlocked) {
    throw ApiError.forbidden("This account has been blocked by an administrator.");
  }
  req.user = toAuthUser(user);
  req.authMethod = "session";
}

export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    await resolveUser(req);
    if (!req.user) throw ApiError.unauthorized();
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    await resolveUser(req);
    next();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      next();
      return;
    }
    next(error);
  }
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden("Your role does not allow this action."));
      return;
    }
    next();
  };
}
