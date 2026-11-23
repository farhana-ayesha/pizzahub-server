import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { MENU_CATEGORIES, MENU_STATUSES } from "../constants/categories.js";
import { collections } from "../db/mongo.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { regexContains } from "../utils/query.js";
import {
  toMenuItem,
  toPublicUser,
  toTransaction,
} from "../utils/serializers.js";
import {
  FREE_ACTIVE_ITEM_LIMIT,
  hasActivePremium,
} from "../utils/subscription.js";
import { parseBody, parseQuery } from "../utils/validate.js";

const userQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  role: z.enum(["customer", "vendor", "admin"]).optional(),
});

const menuQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(MENU_STATUSES).optional(),
  category: z.enum(MENU_CATEGORIES).optional(),
  vendorId: z.string().trim().optional(),
});

const menuStatusSchema = z.object({
  status: z.enum(MENU_STATUSES),
});

const transactionQuerySchema = z.object({
  status: z.enum(["succeeded", "failed", "refunded"]).optional(),
  vendorId: z.string().trim().optional(),
});

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("admin"));

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const query = parseQuery(userQuerySchema, req);
    const filter: Record<string, unknown> = {};
    if (query.role) filter.role = query.role;
    if (query.search) {
      const search = regexContains(query.search);
      filter.$or = [
        { name: search },
        { email: search },
        { businessName: search },
      ];
    }

    const users = await collections
      .users()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    res.json({
      success: true,
      data: {
        users: users.map((user) =>
          toPublicUser(user, { includeEmail: true }),
        ),
      },
    });
  }),
);

adminRouter.patch(
  "/users/:id/block",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("User not found.");
    if (id === req.user!.id) {
      throw ApiError.forbidden("You cannot block your own admin account.");
    }

    const user = await collections.users().findOne({ _id: new ObjectId(id) });
    if (!user) throw ApiError.notFound("User not found.");

    const result = await collections.users().findOneAndUpdate(
      { _id: user._id },
      { $set: { isBlocked: !user.isBlocked, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw ApiError.notFound("User not found.");

    res.json({
      success: true,
      data: { user: toPublicUser(result, { includeEmail: true }) },
    });
  }),
);

adminRouter.get(
  "/menu",
  asyncHandler(async (req, res) => {
    const query = parseQuery(menuQuerySchema, req);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.vendorId) filter.vendorId = query.vendorId;
    if (query.search) {
      const search = regexContains(query.search);
      filter.$or = [
        { itemName: search },
        { description: search },
        { category: search },
        { location: search },
      ];
    }

    const items = await collections
      .menuItems()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();

    res.json({ success: true, data: { items: items.map(toMenuItem) } });
  }),
);

adminRouter.patch(
  "/menu/:id/status",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Menu item not found.");

    const body = parseBody(menuStatusSchema, req);
    const item = await collections.menuItems().findOne({ _id: new ObjectId(id) });
    if (!item) throw ApiError.notFound("Menu item not found.");

    if (body.status === "approved") {
      const vendor = ObjectId.isValid(item.vendorId)
        ? await collections.users().findOne({ _id: new ObjectId(item.vendorId) })
        : null;
      if (vendor && !hasActivePremium(vendor)) {
        const otherActive = await collections.menuItems().countDocuments({
          vendorId: item.vendorId,
          status: "approved",
          active: true,
          _id: { $ne: item._id },
        });
        if (otherActive >= FREE_ACTIVE_ITEM_LIMIT) {
          throw ApiError.conflict(
            `This vendor is on the free plan and already has ${FREE_ACTIVE_ITEM_LIMIT} active items. Ask them to upgrade to Premium or deactivate an item first.`,
          );
        }
      }
    }

    const result = await collections.menuItems().findOneAndUpdate(
      { _id: item._id },
      {
        $set: {
          status: body.status,
          active: body.status === "approved",
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!result) throw ApiError.notFound("Menu item not found.");

    res.json({ success: true, data: { item: toMenuItem(result) } });
  }),
);

adminRouter.delete(
  "/menu/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Menu item not found.");

    const result = await collections
      .menuItems()
      .deleteOne({ _id: new ObjectId(id) });
    if (!result.deletedCount) throw ApiError.notFound("Menu item not found.");

    res.json({ success: true, data: { id } });
  }),
);

adminRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const query = parseQuery(transactionQuerySchema, req);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.vendorId) filter.vendorId = query.vendorId;

    const transactions = await collections
      .transactions()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();

    res.json({
      success: true,
      data: { transactions: transactions.map(toTransaction) },
    });
  }),
);

adminRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalMenuItems,
      pendingMenuItems,
      totalTransactions,
    ] = await Promise.all([
      collections.users().countDocuments(),
      collections.users().countDocuments({ role: "vendor" } as never),
      collections.users().countDocuments({ role: "customer" } as never),
      collections.menuItems().countDocuments(),
      collections.menuItems().countDocuments({ status: "pending" }),
      collections.transactions().countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalMenuItems,
        pendingMenuItems,
        totalTransactions,
      },
    });
  }),
);

adminRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("User not found.");
    const user = await collections.users().findOne({ _id: new ObjectId(id) });
    if (!user) throw ApiError.notFound("User not found.");
    res.json({
      success: true,
      data: { user: toPublicUser(user, { includeEmail: true }) },
    });
  }),
);
