import type { ObjectId } from "mongodb";
import type {
  MenuItemDoc,
  OrderDoc,
  PublicUser,
  Role,
  TransactionDoc,
  UserDoc,
} from "../types/models.js";
import { hasActivePremium } from "./subscription.js";

export function objectIdString(value: ObjectId | string): string {
  return typeof value === "string" ? value : value.toHexString();
}

export function userRole(user: Partial<UserDoc>): Role {
  return user.role === "vendor" || user.role === "admin" ? user.role : "customer";
}

export function toPublicUser(
  user: UserDoc,
  options: { includeEmail?: boolean } = {},
): PublicUser {
  const role = userRole(user);
  const premium = hasActivePremium(user);
  return {
    id: objectIdString(user._id),
    name: user.name,
    ...(options.includeEmail ? { email: user.email } : {}),
    image: user.image || "",
    role,
    isBlocked: Boolean(user.isBlocked),
    ...(user.businessName ? { businessName: user.businessName } : {}),
    ...(role === "vendor"
      ? {
          subscriptionPlan: premium ? "premium" : "free",
          subscriptionExpiresAt:
            premium && user.subscriptionExpiresAt
              ? user.subscriptionExpiresAt.toISOString()
              : null,
        }
      : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.location ? { location: user.location } : {}),
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  };
}

export function toMenuItem(item: MenuItemDoc) {
  return {
    id: objectIdString(item._id),
    vendorId: item.vendorId,
    itemName: item.itemName,
    category: item.category,
    description: item.description,
    price: item.price,
    location: item.location,
    images: item.images,
    status: item.status,
    active: item.active,
    rating: item.rating ?? 0,
    reviewsCount: item.reviewsCount ?? 0,
    prepTime: item.prepTime ?? "20–25 min",
    tags: item.tags ?? [],
    createdAt: item.createdAt.toISOString(),
  };
}

export function toOrder(order: OrderDoc) {
  return {
    id: objectIdString(order._id),
    itemId: order.itemId,
    vendorId: order.vendorId,
    customerId: order.customerId,
    deliveryDate: order.deliveryDate,
    deliveryAddress: order.deliveryAddress,
    message: order.message,
    status: order.status,
    quantity: order.quantity,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
  };
}

export function toTransaction(transaction: TransactionDoc) {
  return {
    id: objectIdString(transaction._id),
    vendorId: transaction.vendorId,
    plan: transaction.plan,
    amount: transaction.amount,
    currency: transaction.currency,
    stripeSessionId: transaction.stripeSessionId,
    stripeSubscriptionId: transaction.stripeSubscriptionId,
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
  };
}
