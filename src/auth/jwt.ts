import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthUser } from "../types/models.js";

export interface PizzaHubTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: AuthUser["role"];
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { email: user.email, role: user.role },
    env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
      issuer: "pizzahub-api",
      audience: "pizzahub-client",
    },
  );
}

export function verifyAccessToken(token: string): PizzaHubTokenPayload {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    issuer: "pizzahub-api",
    audience: "pizzahub-client",
  });
  if (typeof payload === "string" || !payload.sub) {
    throw new Error("Invalid token payload.");
  }
  return payload as PizzaHubTokenPayload;
}
