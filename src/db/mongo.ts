import { MongoClient, type Db } from "mongodb";
import { env } from "../config/env.js";
import type {
  MenuItemDoc,
  OrderDoc,
  TransactionDoc,
  UserDoc,
} from "../types/models.js";

const client = new MongoClient(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10_000,
});

let database: Db | null = null;

export async function connectDatabase(): Promise<Db> {
  if (database) return database;
  await client.connect();
  database = client.db(env.MONGODB_DB_NAME);
  await ensureIndexes(database);
  return database;
}

export function getDb(): Db {
  if (!database) {
    throw new Error("Database has not been connected yet.");
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  await client.close();
  database = null;
}

export const collections = {
  users: () => getDb().collection<UserDoc>("users"),
  menuItems: () => getDb().collection<MenuItemDoc>("menuItems"),
  orders: () => getDb().collection<OrderDoc>("orders"),
  transactions: () => getDb().collection<TransactionDoc>("transactions"),
};

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection<UserDoc>("users").createIndex({ email: 1 }, { unique: true }),
    db.collection<UserDoc>("users").createIndex({ role: 1 }),
    db.collection<MenuItemDoc>("menuItems").createIndex({ vendorId: 1 }),
    db.collection<MenuItemDoc>("menuItems").createIndex({
      status: 1,
      active: 1,
      category: 1,
      location: 1,
      price: 1,
    }),
    db.collection<OrderDoc>("orders").createIndex({ customerId: 1, createdAt: -1 }),
    db.collection<OrderDoc>("orders").createIndex({ vendorId: 1, createdAt: -1 }),
    db.collection<OrderDoc>("orders").createIndex(
      { orderGuard: 1 },
      {
        unique: true,
        partialFilterExpression: { orderGuard: { $type: "string" } },
        name: "one_active_order_per_item_and_date",
      },
    ),
    db
      .collection<TransactionDoc>("transactions")
      .createIndex({ vendorId: 1, createdAt: -1 }),
    db
      .collection<TransactionDoc>("transactions")
      .createIndex({ stripeSessionId: 1 }, { unique: true }),
    db
      .collection<TransactionDoc>("transactions")
      .createIndex({ stripeSubscriptionId: 1 }),
  ]);
}
