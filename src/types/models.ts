import type { ObjectId } from "mongodb";

export type Role = "customer" | "vendor" | "admin";
export type MenuStatus = "pending" | "approved" | "rejected" | "inactive";
export type OrderStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type TransactionStatus = "succeeded" | "failed" | "refunded";

export interface UserDoc {
  _id: ObjectId;
  id?: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  role?: Role;
  isBlocked?: boolean;
  businessName?: string | null;
  subscriptionPlan?: "free" | "premium";
  subscriptionExpiresAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  phone?: string | null;
  location?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MenuItemDoc {
  _id: ObjectId;
  vendorId: string;
  itemName: string;
  category: string;
  description: string;
  price: number;
  location: string;
  images: string[];
  status: MenuStatus;
  active: boolean;
  rating: number;
  reviewsCount: number;
  prepTime: string;
  tags: string[];
  createdAt: Date;
  updatedAt?: Date;
}

export interface OrderDoc {
  _id: ObjectId;
  itemId: string;
  vendorId: string;
  customerId: string;
  deliveryDate: string;
  deliveryAddress: string;
  message: string;
  status: OrderStatus;
  quantity: number;
  total: number;
  orderGuard?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

export interface TransactionDoc {
  _id: ObjectId;
  vendorId: string;
  plan: "premium";
  amount: number;
  currency: string;
  stripeSessionId: string;
  stripeSubscriptionId: string;
  status: TransactionStatus;
  createdAt: Date;
  updatedAt?: Date;
}

export interface PublicUser {
  id: string;
  name: string;
  email?: string;
  image: string;
  role: Role;
  isBlocked: boolean;
  businessName?: string;
  subscriptionPlan?: "free" | "premium";
  subscriptionExpiresAt?: string | null;
  phone?: string | null;
  location?: string | null;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isBlocked: boolean;
  image?: string | null;
  businessName?: string | null;
  subscriptionPlan?: "free" | "premium";
  subscriptionExpiresAt?: Date | null;
  phone?: string | null;
  location?: string | null;
}
