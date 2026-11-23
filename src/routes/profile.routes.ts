import { Router } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "../db/mongo.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { toPublicUser } from "../utils/serializers.js";
import { isObjectId } from "../utils/users.js";
import { parseBody } from "../utils/validate.js";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name.").max(120).optional(),
  image: z.string().trim().max(2_500_000).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(160).optional(),
  businessName: z.string().trim().min(2).max(160).optional(),
});

export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.user!.id)) {
      throw ApiError.notFound("Your account could not be found.");
    }
    const user = await collections
      .users()
      .findOne({ _id: new ObjectId(req.user!.id) });
    if (!user) throw ApiError.notFound("Your account could not be found.");
    res.json({
      success: true,
      data: { user: toPublicUser(user, { includeEmail: true }) },
    });
  }),
);

profileRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseBody(profileSchema, req);
    const set: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) set.name = body.name;
    if (body.image !== undefined) set.image = body.image;
    if (body.phone !== undefined) set.phone = body.phone;
    if (body.location !== undefined) set.location = body.location;
    if (body.businessName !== undefined && req.user!.role === "vendor") {
      set.businessName = body.businessName;
    }

    if (Object.keys(set).length === 1) {
      throw ApiError.badRequest("No editable profile fields were provided.");
    }

    if (!isObjectId(req.user!.id)) {
      throw ApiError.notFound("Your account could not be found.");
    }
    const user = await collections.users().findOneAndUpdate(
      { _id: new ObjectId(req.user!.id) },
      { $set: set },
      { returnDocument: "after" },
    );
    if (!user) throw ApiError.notFound("Your account could not be found.");

    res.json({
      success: true,
      data: { user: toPublicUser(user, { includeEmail: true }) },
    });
  }),
);
