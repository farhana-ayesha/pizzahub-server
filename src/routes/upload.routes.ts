import { Router } from "express";
import { z } from "zod";
import { env, isImgBBConfigured } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { parseBody } from "../utils/validate.js";

const uploadSchema = z.object({
  image: z
    .string()
    .min(32, "Add an image to upload.")
    .max(10_000_000, "That image is too large."),
});

export const uploadRouter = Router();

uploadRouter.use(requireAuth);

/**
 * Proxies a base64 image to ImgBB so the API key never reaches the browser.
 * The client compresses images before sending them here.
 */
uploadRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!isImgBBConfigured) {
      throw ApiError.serviceUnavailable(
        "Image uploads are not configured. Set IMGBB_API_KEY on the server.",
      );
    }

    const body = parseBody(uploadSchema, req);
    const base64 = body.image.startsWith("data:")
      ? body.image.split(",")[1]
      : body.image;
    if (!base64) throw ApiError.badRequest("Could not read the uploaded image.");

    const form = new URLSearchParams();
    form.set("key", env.IMGBB_API_KEY as string);
    form.set("image", base64);

    let response: Response;
    try {
      response = await fetch("https://api.imgbb.com/1/upload", {
        method: "POST",
        body: form,
      });
    } catch {
      throw ApiError.serviceUnavailable(
        "Could not reach ImgBB. Please try again.",
      );
    }

    if (!response.ok) {
      throw ApiError.badRequest(
        `ImgBB rejected the upload (${response.status}). Please try a different image.`,
      );
    }

    const payload = (await response.json()) as {
      data?: { display_url?: string; url?: string };
    };
    const url = payload.data?.display_url ?? payload.data?.url;
    if (!url) throw ApiError.badRequest("ImgBB did not return an image URL.");

    res.status(201).json({
      success: true,
      data: { url, provider: "imgbb" },
    });
  }),
);
