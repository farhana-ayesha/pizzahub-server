import type { UserDoc } from "../types/models.js";

export const FREE_ACTIVE_ITEM_LIMIT = 3;
export const PREMIUM_MONTHLY_PRICE = 29;

export function hasActivePremium(
  user: Pick<UserDoc, "role" | "subscriptionPlan" | "subscriptionExpiresAt">,
): boolean {
  if (user.role !== "vendor") return false;
  if (user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return user.subscriptionExpiresAt.getTime() > Date.now();
}

export function premiumExpiryFromNow(months = 12): Date {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + months);
  return expires;
}
