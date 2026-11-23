import { ObjectId } from "mongodb";
import { collections } from "../db/mongo.js";
import type { AuthUser, UserDoc } from "../types/models.js";
import { userRole } from "./serializers.js";

export function isObjectId(value: string): boolean {
  return ObjectId.isValid(value) && new ObjectId(value).toHexString() === value;
}

export async function findUserById(id: string): Promise<UserDoc | null> {
  if (!id) return null;
  if (isObjectId(id)) {
    const byId = await collections.users().findOne({ _id: new ObjectId(id) });
    if (byId) return byId;
  }
  return collections.users().findOne({ id } as never);
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  return collections
    .users()
    .findOne({ email: email.trim().toLowerCase() });
}

export function toAuthUser(user: UserDoc): AuthUser {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: userRole(user),
    isBlocked: Boolean(user.isBlocked),
    image: user.image ?? null,
    businessName: user.businessName ?? null,
    subscriptionPlan: user.subscriptionPlan ?? "free",
    subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
    phone: user.phone ?? null,
    location: user.location ?? null,
  };
}
