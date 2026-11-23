import { Router } from "express";
import { ObjectId } from "mongodb";
import type Stripe from "stripe";
import { env } from "../config/env.js";
import { collections } from "../db/mongo.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireStripe } from "../services/stripe.js";
import type { TransactionStatus } from "../types/models.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/errors.js";
import { toTransaction } from "../utils/serializers.js";
import {
  hasActivePremium,
  premiumExpiryFromNow,
} from "../utils/subscription.js";
import { isObjectId } from "../utils/users.js";

function subscriptionExpiry(subscription: Stripe.Subscription): Date {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return periodEnd ? new Date(periodEnd * 1000) : premiumExpiryFromNow();
}

async function resolveVendorId(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  if (subscription.metadata?.vendorId) {
    return subscription.metadata.vendorId;
  }
  const vendor = await collections
    .users()
    .findOne({ stripeSubscriptionId: subscription.id });
  return vendor ? vendor._id.toHexString() : null;
}

async function activatePremium(
  vendorId: string,
  subscription: Stripe.Subscription,
  now: Date,
): Promise<void> {
  if (!isObjectId(vendorId)) return;
  await collections.users().updateOne(
    { _id: new ObjectId(vendorId) },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: subscriptionExpiry(subscription),
        stripeSubscriptionId: subscription.id,
        updatedAt: now,
      },
    },
  );
}

async function deactivatePremium(vendorId: string, now: Date): Promise<void> {
  if (!isObjectId(vendorId)) return;
  await collections.users().updateOne(
    { _id: new ObjectId(vendorId) },
    {
      $set: {
        subscriptionPlan: "free",
        subscriptionExpiresAt: null,
        updatedAt: now,
      },
    },
  );
}

async function upsertTransaction(input: {
  vendorId: string;
  sessionId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  createdAt?: Date;
}): Promise<void> {
  const now = new Date();
  await collections.transactions().updateOne(
    { stripeSessionId: input.sessionId },
    {
      $set: {
        vendorId: input.vendorId,
        plan: "premium",
        amount: Number(input.amount.toFixed(2)),
        currency: input.currency.toLowerCase(),
        stripeSubscriptionId: input.subscriptionId,
        status: input.status,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: new ObjectId(),
        stripeSessionId: input.sessionId,
        createdAt: input.createdAt ?? now,
      },
    },
    { upsert: true },
  );
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const reference = invoice.parent?.subscription_details?.subscription;
  if (!reference) return null;
  return typeof reference === "string" ? reference : reference.id;
}

export const vendorSubscriptionRouter = Router();

vendorSubscriptionRouter.use(requireAuth, requireRole("vendor"));

vendorSubscriptionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.user!.id)) {
      throw ApiError.notFound("Your vendor account could not be found.");
    }
    const vendor = await collections
      .users()
      .findOne({ _id: new ObjectId(req.user!.id) });
    if (!vendor) throw ApiError.notFound("Your vendor account could not be found.");

    const transactions = await collections
      .transactions()
      .find({ vendorId: req.user!.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      data: {
        plan: hasActivePremium(vendor) ? "premium" : "free",
        subscriptionExpiresAt:
          hasActivePremium(vendor) && vendor.subscriptionExpiresAt
            ? vendor.subscriptionExpiresAt.toISOString()
            : null,
        transactions: transactions.map(toTransaction),
      },
    });
  }),
);

vendorSubscriptionRouter.post(
  "/checkout",
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.user!.id)) {
      throw ApiError.notFound("Your vendor account could not be found.");
    }
    const vendor = await collections
      .users()
      .findOne({ _id: new ObjectId(req.user!.id) });
    if (!vendor) throw ApiError.notFound("Your vendor account could not be found.");
    if (hasActivePremium(vendor)) {
      throw ApiError.conflict("Your Premium subscription is already active.");
    }

    const stripe = requireStripe();

    let customerId = vendor.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: vendor.email,
        name: vendor.businessName || vendor.name,
        metadata: { vendorId: req.user!.id },
      });
      customerId = customer.id;
      await collections.users().updateOne(
        { _id: vendor._id },
        { $set: { stripeCustomerId: customerId, updatedAt: new Date() } },
      );
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
      env.STRIPE_PREMIUM_PRICE_ID
        ? [{ price: env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }]
        : [
            {
              quantity: 1,
              price_data: {
                currency: env.STRIPE_CURRENCY,
                unit_amount: env.STRIPE_PREMIUM_AMOUNT,
                recurring: { interval: "month" },
                product_data: {
                  name: "PizzaHub Premium",
                  description:
                    "Unlimited active menu items, Premium badge and featured placement.",
                },
              },
            },
          ];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
      success_url: `${env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.CLIENT_URL}/payment/cancel`,
      client_reference_id: req.user!.id,
      metadata: { vendorId: req.user!.id, plan: "premium" },
      subscription_data: {
        metadata: { vendorId: req.user!.id, plan: "premium" },
      },
      allow_promotion_codes: true,
    });

    res.status(201).json({
      success: true,
      data: { url: session.url, sessionId: session.id },
    });
  }),
);

vendorSubscriptionRouter.post(
  "/portal",
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.user!.id)) {
      throw ApiError.notFound("Your vendor account could not be found.");
    }
    const vendor = await collections
      .users()
      .findOne({ _id: new ObjectId(req.user!.id) });
    if (!vendor?.stripeCustomerId) {
      throw ApiError.badRequest("No Stripe billing profile exists for this account yet.");
    }

    const stripe = requireStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: vendor.stripeCustomerId,
      return_url: `${env.CLIENT_URL}/dashboard/vendor/subscription`,
    });

    res.status(201).json({ success: true, data: { url: session.url } });
  }),
);

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw ApiError.serviceUnavailable(
        "Stripe webhooks are not configured. Set STRIPE_WEBHOOK_SECRET.",
      );
    }

    const signatureHeader = req.headers["stripe-signature"];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    if (!signature) {
      throw ApiError.badRequest("Missing Stripe signature header.");
    }

    const stripe = requireStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch (error) {
      throw ApiError.badRequest(
        `Stripe webhook signature verification failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription") break;
        if (
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required"
        ) {
          break;
        }
        const vendorId =
          session.metadata?.vendorId ?? session.client_reference_id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!vendorId || !subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const now = new Date();
        await upsertTransaction({
          vendorId,
          sessionId: session.id,
          subscriptionId,
          amount: (session.amount_total ?? env.STRIPE_PREMIUM_AMOUNT) / 100,
          currency: session.currency ?? env.STRIPE_CURRENCY,
          status: "succeeded",
          createdAt: now,
        });
        await activatePremium(vendorId, subscription, now);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const subscriptionId = invoiceSubscriptionId(invoice);
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const vendorId = await resolveVendorId(subscription);
        if (!vendorId) break;

        const now = new Date();
        if (invoice.billing_reason !== "subscription_create") {
          await upsertTransaction({
            vendorId,
            sessionId: invoice.id,
            subscriptionId,
            amount: invoice.amount_paid / 100,
            currency: invoice.currency ?? env.STRIPE_CURRENCY,
            status: "succeeded",
            createdAt: now,
          });
        }
        await activatePremium(vendorId, subscription, now);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subscriptionId = invoiceSubscriptionId(invoice);
        if (!subscriptionId) break;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const vendorId = await resolveVendorId(subscription);
        if (!vendorId) break;

        await upsertTransaction({
          vendorId,
          sessionId: invoice.id,
          subscriptionId,
          amount: invoice.amount_due / 100,
          currency: invoice.currency ?? env.STRIPE_CURRENCY,
          status: "failed",
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const vendorId = await resolveVendorId(subscription);
        if (!vendorId) break;

        const now = new Date();
        if (
          event.type === "customer.subscription.updated" &&
          (subscription.status === "active" ||
            subscription.status === "trialing")
        ) {
          await activatePremium(vendorId, subscription, now);
        } else {
          await deactivatePremium(vendorId, now);
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  }),
);
