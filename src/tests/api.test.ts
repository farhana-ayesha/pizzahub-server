import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * PizzaHub API test suite.
 *
 * The unit tests cover the security primitives (JWT, role helpers), money and
 * search utilities and serializers without needing a database. The integration
 * test boots the real Express app against an in-memory MongoDB instance and is
 * skipped automatically on machines where the MongoDB test binary cannot run
 * (for example a missing Windows VC++ runtime).
 */

process.env.NODE_ENV = "test";
process.env.MONGODB_DB_NAME = "pizzahub_test";
process.env.BETTER_AUTH_SECRET =
  "pizzahub-test-better-auth-secret-not-for-production";
process.env.JWT_SECRET = "pizzahub-test-jwt-secret-not-for-production";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:4100";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.SEED_DEMO_DATA = "false";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.IMGBB_API_KEY;

test("JWT access tokens are signed, verified and tamper-proof", async () => {
  const { signAccessToken, verifyAccessToken } = await import("../auth/jwt.js");
  const token = signAccessToken({
    id: "507f1f77bcf86cd799439011",
    name: "Test Vendor",
    email: "vendor@example.com",
    role: "vendor",
    isBlocked: false,
  });

  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "507f1f77bcf86cd799439011");
  assert.equal(payload.role, "vendor");
  assert.equal(payload.email, "vendor@example.com");

  const tampered = `${token.slice(0, -2)}xx`;
  assert.throws(() => verifyAccessToken(tampered));
  assert.throws(() => verifyAccessToken("not-a-token"));
});

test("premium access requires an active vendor subscription", async () => {
  const { hasActivePremium, premiumExpiryFromNow, FREE_ACTIVE_ITEM_LIMIT } =
    await import("../utils/subscription.js");

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

  assert.equal(FREE_ACTIVE_ITEM_LIMIT, 3);
  assert.equal(
    hasActivePremium({
      role: "vendor",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: future,
    }),
    true,
  );
  assert.equal(
    hasActivePremium({
      role: "vendor",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: past,
    }),
    false,
  );
  assert.equal(
    hasActivePremium({
      role: "vendor",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: null,
    }),
    true,
  );
  assert.equal(
    hasActivePremium({
      role: "vendor",
      subscriptionPlan: "free",
      subscriptionExpiresAt: future,
    }),
    false,
  );
  assert.equal(
    hasActivePremium({
      role: "customer",
      subscriptionPlan: "premium",
      subscriptionExpiresAt: future,
    }),
    false,
  );
  assert.ok(premiumExpiryFromNow(1).getTime() > Date.now());
});

test("search and money helpers behave predictably", async () => {
  const { escapeRegex, regexContains, roundMoney } = await import(
    "../utils/query.js"
  );

  assert.equal(escapeRegex("pizza.*(hot)"), "pizza\\.\\*\\(hot\\)");
  const regex = regexContains("BBQ.Chicken");
  assert.equal(regex.test("Smoky bbq.chicken pizza"), true);
  assert.equal(regex.test("Smoky BBQXChicken pizza"), false);
  assert.equal(roundMoney(12.345), 12.35);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
});

test("serializers expose safe public records", async () => {
  const { toMenuItem, toOrder, toPublicUser, toTransaction } = await import(
    "../utils/serializers.js"
  );

  const id = new ObjectId();
  const user = {
    _id: id,
    name: "Mario Rossi",
    email: "mario@example.com",
    image: "",
    role: "vendor" as const,
    isBlocked: false,
    businessName: "Mario's Woodfire",
    subscriptionPlan: "premium" as const,
    subscriptionExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const publicUser = toPublicUser(user);
  assert.equal(publicUser.id, id.toHexString());
  assert.equal(publicUser.email, undefined);
  assert.equal(publicUser.role, "vendor");
  assert.equal(publicUser.subscriptionPlan, "premium");
  assert.equal("password" in publicUser, false);

  const withEmail = toPublicUser(user, { includeEmail: true });
  assert.equal(withEmail.email, "mario@example.com");

  const menuItem = toMenuItem({
    _id: id,
    vendorId: id.toHexString(),
    itemName: "Margherita",
    category: "Classic Pizzas",
    description: "Tomato, mozzarella and basil.",
    price: 12.5,
    location: "Test City",
    images: ["https://example.com/pizza.jpg"],
    status: "approved",
    active: true,
    rating: 4.5,
    reviewsCount: 10,
    prepTime: "20 min",
    tags: ["Classic"],
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(menuItem.id, id.toHexString());
  assert.equal(menuItem.createdAt, "2026-02-01T00:00:00.000Z");

  const order = toOrder({
    _id: id,
    itemId: id.toHexString(),
    vendorId: id.toHexString(),
    customerId: id.toHexString(),
    deliveryDate: "2030-01-01",
    deliveryAddress: "1 Test Street",
    message: "",
    status: "pending",
    quantity: 1,
    total: 12.5,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
  });
  assert.equal(order.status, "pending");
  assert.equal(order.total, 12.5);

  const transaction = toTransaction({
    _id: id,
    vendorId: id.toHexString(),
    plan: "premium",
    amount: 29,
    currency: "usd",
    stripeSessionId: "cs_test_123",
    stripeSubscriptionId: "sub_test_123",
    status: "succeeded",
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
  });
  assert.equal(transaction.stripeSessionId, "cs_test_123");
  assert.equal(transaction.status, "succeeded");
});

test("ApiError helpers return the expected HTTP statuses", async () => {
  const { ApiError } = await import("../utils/errors.js");
  assert.equal(ApiError.unauthorized().status, 401);
  assert.equal(ApiError.forbidden().status, 403);
  assert.equal(ApiError.notFound().status, 404);
  assert.equal(ApiError.conflict().status, 409);
  assert.equal(ApiError.unprocessable().status, 422);
  assert.equal(ApiError.serviceUnavailable().status, 503);
});

test("PizzaHub API role, menu, order and auth flows", async (t) => {
  let mongod: MongoMemoryServer;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = () => {
    // The memory server prints a long Windows runtime error when the test
    // binary cannot start. The test is reported as skipped instead.
  };
  console.warn = () => {
    // Suppress the matching MongoMemoryServer warning in the same situation.
  };
  try {
    mongod = await MongoMemoryServer.create();
  } catch (error) {
    t.skip(
      `Skipping database integration test: ${
        error instanceof Error ? error.message : "MongoDB binary unavailable"
      }`,
    );
    return;
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }

  process.env.MONGODB_URI = mongod.getUri();

  const { connectDatabase, closeDatabase, collections } = await import(
    "../db/mongo.js"
  );

  let server: import("node:http").Server | undefined;
  try {
    const { buildAuth } = await import("../auth/auth.js");
    const { createApp } = await import("../app.js");
    const { signAccessToken } = await import("../auth/jwt.js");

    const db = await connectDatabase();
    buildAuth(db);
    const app = createApp();
    server = await new Promise<import("node:http").Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    type RequestOptions = {
      method?: string;
      body?: unknown;
      token?: string;
      cookie?: string;
    };

    async function api(path: string, options: RequestOptions = {}) {
      const headers: Record<string, string> = {};
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      if (options.cookie) headers.Cookie = options.cookie;

      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
      return { response, payload: payload as Record<string, any> | null };
    }

    async function signUp(input: {
      name: string;
      email: string;
      password: string;
      role: "customer" | "vendor" | "admin";
    }) {
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as Record<string, any>;
      const cookie = response.headers
        .getSetCookie()
        .map((entry) => entry.split(";")[0])
        .join("; ");
      return { response, payload, cookie };
    }

    async function tokenFromCookie(cookie: string) {
      const { response, payload } = await api("/api/auth/token", { cookie });
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload?.data?.token as string;
    }

    await t.test("health check responds", async () => {
      const { response, payload } = await api("/api/health");
      assert.equal(response.status, 200);
      assert.equal(payload?.success, true);
    });

    await t.test("menu is public while mutations require auth", async () => {
      const menu = await api("/api/menu");
      assert.equal(menu.response.status, 200);
      assert.equal(menu.payload?.data?.total, 0);

      const guest = await api("/api/vendor/menu", {
        method: "POST",
        body: {
          itemName: "Guest Pizza",
          category: "Classic Pizzas",
          description: "This request must never be accepted without a session.",
          price: 10,
          location: "Test City",
          images: ["https://example.com/pizza.jpg"],
        },
      });
      assert.equal(guest.response.status, 401);
    });

    await t.test("admin accounts cannot be created publicly", async () => {
      const result = await signUp({
        name: "Sneaky Admin",
        email: "sneaky@example.com",
        password: "Password123",
        role: "admin",
      });
      assert.equal(result.response.status, 403);
    });

    const vendorSignup = await signUp({
      name: "Test Vendor",
      email: "vendor@test.com",
      password: "Password123",
      role: "vendor",
    });
    assert.ok(vendorSignup.response.ok);
    const vendorToken = await tokenFromCookie(vendorSignup.cookie);
    const vendorDoc = await collections.users().findOne({ email: "vendor@test.com" });
    assert.ok(vendorDoc);

    const customerSignup = await signUp({
      name: "Test Customer",
      email: "customer@test.com",
      password: "Password123",
      role: "customer",
    });
    assert.ok(customerSignup.response.ok);
    const customerToken = await tokenFromCookie(customerSignup.cookie);
    const customerDoc = await collections
      .users()
      .findOne({ email: "customer@test.com" });
    assert.ok(customerDoc);
    const customerId = customerDoc._id.toHexString();

    const adminId = new ObjectId();
    await collections.users().insertOne({
      _id: adminId,
      name: "Test Admin",
      email: "admin@test.com",
      role: "admin",
      isBlocked: false,
      createdAt: new Date(),
    });
    const adminToken = signAccessToken({
      id: adminId.toHexString(),
      name: "Test Admin",
      email: "admin@test.com",
      role: "admin",
      isBlocked: false,
    });

    let itemId = "";

    await t.test("vendor can create a pending menu item", async () => {
      const invalid = await api("/api/vendor/menu", {
        method: "POST",
        token: vendorToken,
        body: {
          itemName: "A",
          category: "Classic Pizzas",
          description: "too short",
          price: 0,
          location: "X",
          images: [],
        },
      });
      assert.equal(invalid.response.status, 400);

      const created = await api("/api/vendor/menu", {
        method: "POST",
        token: vendorToken,
        body: {
          itemName: "Test Margherita",
          category: "Classic Pizzas",
          description:
            "A test pizza with tomato, mozzarella and fresh basil for the API suite.",
          price: 12.5,
          location: "Test City",
          images: ["https://example.com/pizza.jpg"],
        },
      });
      assert.equal(created.response.status, 201, JSON.stringify(created.payload));
      assert.equal(created.payload?.data?.item?.status, "pending");
      itemId = created.payload?.data?.item?.id;
      assert.ok(itemId);
    });

    await t.test("customers and vendors cannot review menu items", async () => {
      for (const token of [customerToken, vendorToken]) {
        const result = await api(`/api/admin/menu/${itemId}/status`, {
          method: "PATCH",
          token,
          body: { status: "approved" },
        });
        assert.equal(result.response.status, 403);
      }
    });

    await t.test("admin approval publishes the item", async () => {
      const approved = await api(`/api/admin/menu/${itemId}/status`, {
        method: "PATCH",
        token: adminToken,
        body: { status: "approved" },
      });
      assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
      assert.equal(approved.payload?.data?.item?.status, "approved");

      const publicMenu = await api("/api/menu");
      assert.equal(publicMenu.response.status, 200);
      assert.equal(publicMenu.payload?.data?.total, 1);
      assert.equal(publicMenu.payload?.data?.items?.[0]?.id, itemId);
    });

    let orderId = "";

    await t.test("customer can order and duplicates are rejected", async () => {
      const orderBody = {
        itemId,
        deliveryDate: "2030-01-05",
        deliveryAddress: "12 Test Street, Test City",
        message: "Ring twice.",
        quantity: 2,
      };

      const created = await api("/api/orders", {
        method: "POST",
        token: customerToken,
        body: orderBody,
      });
      assert.equal(created.response.status, 201, JSON.stringify(created.payload));
      assert.equal(created.payload?.data?.order?.status, "pending");
      orderId = created.payload?.data?.order?.id;

      const duplicate = await api("/api/orders", {
        method: "POST",
        token: customerToken,
        body: orderBody,
      });
      assert.equal(duplicate.response.status, 409);
    });

    await t.test("customers cannot change order status", async () => {
      const result = await api(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        token: customerToken,
        body: { status: "accepted" },
      });
      assert.equal(result.response.status, 403);
    });

    await t.test("customer can cancel and order again", async () => {
      const cancelled = await api(`/api/orders/${orderId}/cancel`, {
        method: "PATCH",
        token: customerToken,
      });
      assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.payload));
      assert.equal(cancelled.payload?.data?.order?.status, "cancelled");

      const reordered = await api("/api/orders", {
        method: "POST",
        token: customerToken,
        body: {
          itemId,
          deliveryDate: "2030-01-05",
          deliveryAddress: "12 Test Street, Test City",
          message: "Second attempt.",
          quantity: 1,
        },
      });
      assert.equal(reordered.response.status, 201);
      orderId = reordered.payload?.data?.order?.id;
    });

    await t.test("vendor can accept only their own orders", async () => {
      const accepted = await api(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        token: vendorToken,
        body: { status: "accepted" },
      });
      assert.equal(accepted.response.status, 200, JSON.stringify(accepted.payload));
      assert.equal(accepted.payload?.data?.order?.status, "accepted");

      const otherVendorSignup = await signUp({
        name: "Other Vendor",
        email: "other-vendor@test.com",
        password: "Password123",
        role: "vendor",
      });
      assert.ok(otherVendorSignup.response.ok);
      const otherToken = await tokenFromCookie(otherVendorSignup.cookie);

      const forbidden = await api(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        token: otherToken,
        body: { status: "rejected" },
      });
      assert.equal(forbidden.response.status, 403);
    });

    await t.test("state snapshot is scoped by role", async () => {
      const customerState = await api("/api/state", { token: customerToken });
      assert.equal(customerState.response.status, 200);
      assert.equal(customerState.payload?.data?.currentUser?.id, customerId);
      assert.equal(customerState.payload?.data?.users?.length, 1);
      assert.equal(customerState.payload?.data?.orders?.length, 1);

      const adminState = await api("/api/state", { token: adminToken });
      assert.equal(adminState.response.status, 200);
      assert.ok(adminState.payload?.data?.users?.length >= 4);
    });

    await t.test("profile updates cannot escalate role or subscription", async () => {
      const updated = await api("/api/profile", {
        method: "PATCH",
        token: customerToken,
        body: {
          name: "Updated Customer",
          role: "admin",
          subscriptionPlan: "premium",
        },
      });
      assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
      assert.equal(updated.payload?.data?.user?.role, "customer");

      const stored = await collections
        .users()
        .findOne({ email: "customer@test.com" });
      assert.equal(stored?.role, "customer");
      assert.equal(stored?.subscriptionPlan, "free");
    });

    await t.test("invalid JWT and blocked users are rejected", async () => {
      const invalid = await api("/api/auth/token", { token: "not-a-real-token" });
      assert.equal(invalid.response.status, 401);

      const block = await api(`/api/admin/users/${customerId}/block`, {
        method: "PATCH",
        token: adminToken,
      });
      assert.equal(block.response.status, 200);
      assert.equal(block.payload?.data?.user?.isBlocked, true);

      const blocked = await api("/api/orders", { token: customerToken });
      assert.equal(blocked.response.status, 403);

      const unblock = await api(`/api/admin/users/${customerId}/block`, {
        method: "PATCH",
        token: adminToken,
      });
      assert.equal(unblock.response.status, 200);
      assert.equal(unblock.payload?.data?.user?.isBlocked, false);
    });

    await t.test("free plan item limit and premium bypass are enforced", async () => {
      const makeItem = async (index: number) =>
        api("/api/vendor/menu", {
          method: "POST",
          token: vendorToken,
          body: {
            itemName: `Limit Pizza ${index}`,
            category: "Classic Pizzas",
            description:
              "A menu item used to verify the free plan publishing limit.",
            price: 9.5 + index,
            location: "Test City",
            images: ["https://example.com/limit.jpg"],
          },
        });

      // One item is already approved. Create and approve one more, bringing the
      // vendor to the free-plan limit of 3 active items.
      const first = await makeItem(1);
      assert.equal(first.response.status, 201);
      const approveFirst = await api(
        `/api/admin/menu/${first.payload?.data?.item?.id}/status`,
        {
          method: "PATCH",
          token: adminToken,
          body: { status: "approved" },
        },
      );
      assert.equal(approveFirst.response.status, 200);

      const second = await makeItem(2);
      assert.equal(second.response.status, 201);
      const approveSecond = await api(
        `/api/admin/menu/${second.payload?.data?.item?.id}/status`,
        {
          method: "PATCH",
          token: adminToken,
          body: { status: "approved" },
        },
      );
      assert.equal(approveSecond.response.status, 200);

      const overLimit = await makeItem(3);
      assert.equal(overLimit.response.status, 403);

      await collections
        .users()
        .updateOne({ _id: vendorDoc._id }, { $set: { subscriptionPlan: "premium" } });
      const premiumItem = await makeItem(3);
      assert.equal(premiumItem.response.status, 201);
    });
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await closeDatabase().catch(() => undefined);
    await mongod.stop();
  }
});
