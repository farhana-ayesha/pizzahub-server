import Stripe from "stripe";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

export function requireStripe(): Stripe {
  if (!stripe) {
    throw ApiError.serviceUnavailable(
      "Stripe is not configured on this server. Set STRIPE_SECRET_KEY to enable subscriptions.",
    );
  }
  return stripe;
}
