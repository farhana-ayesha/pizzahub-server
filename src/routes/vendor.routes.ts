import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { MENU_CATEGORIES } from "../constants/categories.js";
import { collections } from "../db/mongo.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { MenuItemDoc } from "../types/models.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { toMenuItem } from "../utils/serializers.js";
import {
  FREE_ACTIVE_ITEM_LIMIT,
  hasActivePremium,
} from "../utils/subscription.js";
import { parseBody } from "../utils/validate.js";

const imageSchema = z
  .string()
  .trim()
  .min(1, "Add at least one image.")
  .max(2_500_000, "That image is too large. Please upload a smaller file.")
  .refine(
    (value) =>
      /^https?:\/\//i.test(value) ||
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value),
    "Images must be an http(s) URL or an uploaded image.",
  );

const menuItemInputSchema = z.object({
  itemName: z.string().trim().min(3, "Item name must be at least 3 characters.").max(120),
  category: z.enum(MENU_CATEGORIES),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters.")
    .max(1200),
  price: z.coerce.number().positive("Price must be greater than 0.").max(10000),
  location: z.string().trim().min(3, "Add the vendor area or city.").max(160),
  images: z.array(imageSchema).min(1, "At least one image is required.").max(6),
});

const availabilitySchema = z.object({
  active: z.boolean(),
});

export const vendorMenuRouter = Router();

vendorMenuRouter.use(requireAuth, requireRole("vendor"));

function assertCanUseAnotherActiveSlot(
  req: Express.Request,
  currentActiveApproved: number,
) {
  if (hasActivePremium(req.user!)) return;
  if (currentActiveApproved >= FREE_ACTIVE_ITEM_LIMIT) {
    throw ApiError.forbidden(
      `Your free plan allows ${FREE_ACTIVE_ITEM_LIMIT} active items. Upgrade to Premium to publish more.`,
    );
  }
}

async function countActiveApproved(vendorId: string, excludeId?: ObjectId) {
  return collections.menuItems().countDocuments({
    vendorId,
    status: "approved",
    active: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
}

vendorMenuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await collections
      .menuItems()
      .find({ vendorId: req.user!.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: { items: items.map(toMenuItem) } });
  }),
);

vendorMenuRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const body = parseBody(menuItemInputSchema, req);
    const activeApproved = await countActiveApproved(user.id);
    assertCanUseAnotherActiveSlot(req, activeApproved);

    const now = new Date();
    const item: MenuItemDoc = {
      _id: new ObjectId(),
      vendorId: user.id,
      itemName: body.itemName,
      category: body.category,
      description: body.description,
      price: Number(body.price.toFixed(2)),
      location: body.location,
      images: body.images,
      status: "pending",
      active: true,
      rating: 0,
      reviewsCount: 0,
      prepTime: "20–25 min",
      tags: ["New"],
      createdAt: now,
      updatedAt: now,
    };

    await collections.menuItems().insertOne(item);
    res.status(201).json({ success: true, data: { item: toMenuItem(item) } });
  }),
);

vendorMenuRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Menu item not found.");

    const item = await collections.menuItems().findOne({ _id: new ObjectId(id) });
    if (!item) throw ApiError.notFound("Menu item not found.");
    if (item.vendorId !== user.id) {
      throw ApiError.forbidden("You can only edit your own menu items.");
    }

    const body = parseBody(menuItemInputSchema, req);
    const nextStatus = item.status === "rejected" ? "pending" : item.status;
    const updatedAt = new Date();

    const result = await collections.menuItems().findOneAndUpdate(
      { _id: item._id, vendorId: user.id },
      {
        $set: {
          itemName: body.itemName,
          category: body.category,
          description: body.description,
          price: Number(body.price.toFixed(2)),
          location: body.location,
          images: body.images,
          status: nextStatus,
          updatedAt,
        },
      },
      { returnDocument: "after" },
    );
    if (!result) throw ApiError.notFound("Menu item not found.");

    res.json({ success: true, data: { item: toMenuItem(result) } });
  }),
);

vendorMenuRouter.patch(
  "/:id/availability",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Menu item not found.");

    const body = parseBody(availabilitySchema, req);
    const item = await collections.menuItems().findOne({ _id: new ObjectId(id) });
    if (!item) throw ApiError.notFound("Menu item not found.");
    if (item.vendorId !== user.id) {
      throw ApiError.forbidden("This item belongs to another vendor.");
    }

    if (body.active && item.status === "approved") {
      const otherActive = await countActiveApproved(user.id, item._id);
      assertCanUseAnotherActiveSlot(req, otherActive);
    }

    const result = await collections.menuItems().findOneAndUpdate(
      { _id: item._id, vendorId: user.id },
      { $set: { active: body.active, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw ApiError.notFound("Menu item not found.");

    res.json({ success: true, data: { item: toMenuItem(result) } });
  }),
);

vendorMenuRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Menu item not found.");

    const item = await collections.menuItems().findOne({ _id: new ObjectId(id) });
    if (!item) throw ApiError.notFound("Menu item not found.");
    if (item.vendorId !== user.id) {
      throw ApiError.forbidden("You can only delete your own menu items.");
    }

    await collections.menuItems().deleteOne({ _id: item._id });
    res.json({ success: true, data: { id } });
  }),
);
