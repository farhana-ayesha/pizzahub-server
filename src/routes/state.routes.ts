import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "../db/mongo.js";
import { optionalAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import {
  toMenuItem,
  toOrder,
  toPublicUser,
  toTransaction,
} from "../utils/serializers.js";

/**
 * Returns the scoped snapshot the Next.js client hydrates its store with.
 * Public visitors only receive approved and active menu items, while signed-in
 * users additionally receive the records their role is allowed to manage.
 */
export const stateRouter = Router();

stateRouter.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const user = req.user;
    const isAdmin = user?.role === "admin";
    const isVendor = user?.role === "vendor";
    const selfObjectId =
      user && ObjectId.isValid(user.id) ? new ObjectId(user.id) : null;

    const self = selfObjectId
      ? await collections.users().findOne({ _id: selfObjectId })
      : null;

    const menuFilter = isAdmin
      ? {}
      : isVendor
        ? {
            $or: [
              { status: "approved" as const, active: true },
              { vendorId: user!.id },
            ],
          }
        : { status: "approved" as const, active: true };

    const orderFilter = isAdmin
      ? {}
      : isVendor
        ? { vendorId: user!.id }
        : user
          ? { customerId: user!.id }
          : null;

    const transactionFilter = isAdmin
      ? {}
      : isVendor
        ? { vendorId: user!.id }
        : null;

    const [menuItems, orders, transactions] = await Promise.all([
      collections
        .menuItems()
        .find(menuFilter)
        .sort({ createdAt: -1 })
        .limit(1000)
        .toArray(),
      orderFilter
        ? collections
            .orders()
            .find(orderFilter)
            .sort({ createdAt: -1 })
            .limit(500)
            .toArray()
        : Promise.resolve([]),
      transactionFilter
        ? collections
            .transactions()
            .find(transactionFilter)
            .sort({ createdAt: -1 })
            .limit(500)
            .toArray()
        : Promise.resolve([]),
    ]);

    const relevantUserIds = new Set<string>();
    menuItems.forEach((item) => relevantUserIds.add(item.vendorId));
    orders.forEach((order) => {
      relevantUserIds.add(order.vendorId);
      relevantUserIds.add(order.customerId);
    });
    if (user) relevantUserIds.add(user.id);

    let userDocs;
    if (isAdmin) {
      userDocs = await collections
        .users()
        .find({})
        .sort({ createdAt: -1 })
        .limit(2000)
        .toArray();
    } else {
      const objectIds = Array.from(relevantUserIds)
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
      userDocs = objectIds.length
        ? await collections
            .users()
            .find({ _id: { $in: objectIds } })
            .toArray()
        : [];
    }

    if (self && !userDocs.some((doc) => doc._id.equals(self._id))) {
      userDocs = [self, ...userDocs];
    }

    const emailVisibleIds = new Set<string>();
    if (user) emailVisibleIds.add(user.id);
    if (isVendor) {
      orders.forEach((order) => emailVisibleIds.add(order.customerId));
    }

    res.json({
      success: true,
      data: {
        currentUser: self
          ? toPublicUser(self, { includeEmail: true })
          : null,
        users: userDocs.map((doc) =>
          toPublicUser(doc, {
            includeEmail:
              isAdmin || emailVisibleIds.has(doc._id.toHexString()),
          }),
        ),
        menuItems: menuItems.map(toMenuItem),
        orders: orders.map(toOrder),
        transactions: transactions.map(toTransaction),
      },
    });
  }),
);
