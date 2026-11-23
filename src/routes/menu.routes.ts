import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { MENU_CATEGORIES } from "../constants/categories.js";
import { collections } from "../db/mongo.js";
import { optionalAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { regexContains } from "../utils/query.js";
import { toMenuItem, toPublicUser } from "../utils/serializers.js";
import { parseQuery } from "../utils/validate.js";

const menuQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.enum(MENU_CATEGORIES).optional(),
  location: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z
    .enum(["recommended", "price-asc", "price-desc", "newest", "rating", "name"])
    .default("recommended"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export const menuRouter = Router();

menuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = parseQuery(menuQuerySchema, req);
    const filter: Record<string, unknown> = { status: "approved", active: true };

    if (query.category) filter.category = query.category;
    if (query.location) filter.location = query.location;
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    }
    if (query.search) {
      const search = regexContains(query.search);
      filter.$or = [
        { itemName: search },
        { description: search },
        { category: search },
        { location: search },
        { tags: search },
      ];
    }

    const [items, vendorDocs] = await Promise.all([
      collections.menuItems().find(filter).limit(1000).toArray(),
      collections.users().find({ role: "vendor" }).toArray(),
    ]);

    const vendors = new Map(
      vendorDocs.map((vendor) => [
        vendor._id.toHexString(),
        {
          premium: (vendor.subscriptionPlan ?? "free") === "premium",
          publicUser: toPublicUser(vendor),
        },
      ]),
    );

    const sorted = items.sort((a, b) => {
      if (query.sort === "price-asc") return a.price - b.price;
      if (query.sort === "price-desc") return b.price - a.price;
      if (query.sort === "newest") {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      if (query.sort === "rating") {
        return (b.rating ?? 0) - (a.rating ?? 0);
      }
      if (query.sort === "name") {
        return a.itemName.localeCompare(b.itemName);
      }
      const aPremium = vendors.get(a.vendorId)?.premium ? 1 : 0;
      const bPremium = vendors.get(b.vendorId)?.premium ? 1 : 0;
      return (
        bPremium - aPremium ||
        (b.rating ?? 0) - (a.rating ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    });

    const total = sorted.length;
    const start = (query.page - 1) * query.limit;
    const pageItems = sorted.slice(start, start + query.limit);
    const vendorIds = new Set(pageItems.map((item) => item.vendorId));

    res.json({
      success: true,
      data: {
        items: pageItems.map(toMenuItem),
        vendors: Array.from(vendorIds)
          .map((id) => vendors.get(id)?.publicUser)
          .filter(Boolean),
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    });
  }),
);

menuRouter.get(
  "/locations",
  asyncHandler(async (_req, res) => {
    const locations = await collections
      .menuItems()
      .distinct("location", { status: "approved", active: true });
    res.json({ success: true, data: locations.filter(Boolean).sort() });
  }),
);

menuRouter.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const counts = await collections
      .menuItems()
      .aggregate<{ _id: string; count: number }>([
        { $match: { status: "approved", active: true } },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(counts.map((entry) => [entry._id, entry.count]));
    res.json({
      success: true,
      data: MENU_CATEGORIES.map((name) => ({
        name,
        count: countMap.get(name) ?? 0,
      })),
    });
  }),
);

menuRouter.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) {
      throw ApiError.notFound("That menu item does not exist.");
    }
    const item = await collections.menuItems().findOne({ _id: new ObjectId(id) });
    if (!item) throw ApiError.notFound("That menu item does not exist.");

    const isPublic = item.status === "approved" && item.active;
    const isOwner = req.user?.id === item.vendorId;
    const isAdmin = req.user?.role === "admin";
    if (!isPublic && !isOwner && !isAdmin) {
      throw ApiError.notFound("That menu item is not available.");
    }

    const vendor = await collections.users().findOne({
      _id: new ObjectId(item.vendorId),
    });
    res.json({
      success: true,
      data: {
        item: toMenuItem(item),
        vendor: vendor ? toPublicUser(vendor) : null,
      },
    });
  }),
);
