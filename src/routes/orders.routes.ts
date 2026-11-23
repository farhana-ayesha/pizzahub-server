import { Router } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import { z } from "zod";
import { ORDER_STATUSES } from "../constants/categories.js";
import { collections } from "../db/mongo.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import type { OrderDoc } from "../types/models.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { roundMoney } from "../utils/query.js";
import { toOrder } from "../utils/serializers.js";
import { parseBody, parseQuery } from "../utils/validate.js";

const createOrderSchema = z.object({
  itemId: z.string().trim().min(1, "Choose a menu item."),
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid delivery date."),
  deliveryAddress: z
    .string()
    .trim()
    .min(8, "Please enter a complete delivery address.")
    .max(300),
  message: z.string().trim().max(500).default(""),
  quantity: z.coerce.number().int().min(1).max(50).default(1),
});

const orderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

const orderStatusSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (user.role === "admin") {
      throw ApiError.forbidden("Admins cannot place customer orders.");
    }

    const body = parseBody(createOrderSchema, req);
    if (!ObjectId.isValid(body.itemId)) {
      throw ApiError.notFound("That menu item does not exist.");
    }

    const item = await collections
      .menuItems()
      .findOne({ _id: new ObjectId(body.itemId) });
    if (!item || item.status !== "approved" || !item.active) {
      throw ApiError.notFound("This item is not available to order.");
    }
    if (item.vendorId === user.id) {
      throw ApiError.forbidden("You cannot order your own menu items.");
    }

    const delivery = new Date(`${body.deliveryDate}T00:00:00.000Z`);
    if (Number.isNaN(delivery.getTime())) {
      throw ApiError.unprocessable("Choose a valid delivery date.");
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (delivery.getTime() < today.getTime()) {
      throw ApiError.unprocessable("Delivery date cannot be in the past.");
    }

    const orderGuard = `${user.id}:${body.itemId}:${body.deliveryDate}`;
    const duplicate = await collections.orders().findOne({ orderGuard });
    if (duplicate) {
      throw ApiError.conflict(
        "You already have an active order for this item on that date.",
      );
    }

    const now = new Date();
    const order: OrderDoc = {
      _id: new ObjectId(),
      itemId: body.itemId,
      vendorId: item.vendorId,
      customerId: user.id,
      deliveryDate: body.deliveryDate,
      deliveryAddress: body.deliveryAddress,
      message: body.message,
      status: "pending",
      quantity: body.quantity,
      total: roundMoney(item.price * body.quantity),
      orderGuard,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await collections.orders().insertOne(order);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw ApiError.conflict(
          "You already have an active order for this item on that date.",
        );
      }
      throw error;
    }

    res.status(201).json({ success: true, data: { order: toOrder(order) } });
  }),
);

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const query = parseQuery(orderListQuerySchema, req);
    const filter: Record<string, unknown> = {};

    if (user.role === "customer") filter.customerId = user.id;
    if (user.role === "vendor") filter.vendorId = user.id;
    if (query.status) filter.status = query.status;

    const [orders, total] = await Promise.all([
      collections
        .orders()
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .toArray(),
      collections.orders().countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        orders: orders.map(toOrder),
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    });
  }),
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Order not found.");

    const order = await collections.orders().findOne({ _id: new ObjectId(id) });
    if (!order) throw ApiError.notFound("Order not found.");

    const isOwner =
      order.customerId === user.id || order.vendorId === user.id;
    if (!isOwner && user.role !== "admin") {
      throw ApiError.forbidden("This order does not belong to your account.");
    }

    res.json({ success: true, data: { order: toOrder(order) } });
  }),
);

ordersRouter.patch(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Order not found.");

    const order = await collections.orders().findOne({ _id: new ObjectId(id) });
    if (!order) throw ApiError.notFound("Order not found.");
    if (order.customerId !== user.id) {
      throw ApiError.forbidden("You can only cancel your own orders.");
    }
    if (order.status !== "pending") {
      throw ApiError.conflict("Only pending orders can be cancelled.");
    }

    const result = await collections.orders().findOneAndUpdate(
      { _id: order._id, status: "pending" },
      {
        $set: { status: "cancelled", updatedAt: new Date() },
        $unset: { orderGuard: "" },
      },
      { returnDocument: "after" },
    );
    if (!result) {
      throw ApiError.conflict("This order has already been processed.");
    }

    res.json({ success: true, data: { order: toOrder(result) } });
  }),
);

ordersRouter.patch(
  "/:id/status",
  requireRole("vendor"),
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) throw ApiError.notFound("Order not found.");

    const body = parseBody(orderStatusSchema, req);
    const order = await collections.orders().findOne({ _id: new ObjectId(id) });
    if (!order) throw ApiError.notFound("Order not found.");
    if (order.vendorId !== user.id) {
      throw ApiError.forbidden("This order belongs to another vendor.");
    }
    if (order.status !== "pending") {
      throw ApiError.conflict("This order has already been processed.");
    }

    const update: Record<string, unknown> = {
      $set: { status: body.status, updatedAt: new Date() },
    };
    if (body.status === "rejected") {
      update.$unset = { orderGuard: "" };
    }

    const result = await collections
      .orders()
      .findOneAndUpdate({ _id: order._id, status: "pending" }, update, {
        returnDocument: "after",
      });
    if (!result) {
      throw ApiError.conflict("This order has already been processed.");
    }

    res.json({ success: true, data: { order: toOrder(result) } });
  }),
);
