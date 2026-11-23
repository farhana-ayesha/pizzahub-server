# PizzaHub — Server

Express + TypeScript REST API for **PizzaHub**, a role-based pizza ordering and delivery
platform. The API owns authentication, role authorization, MongoDB business data, Stripe
subscription checkout/webhooks, ImgBB uploads and email password resets.

- Client repository: <https://github.com/farhana-ayesha/pizzahub-client>
- Server repository: <https://github.com/farhana-ayesha/pizzahub-server>
- Live API: add the deployed API URL here after deploying (for example
  `https://pizzahub-api.onrender.com`). No live URL is committed because it depends on the
  operator's hosting account and secrets.

## Features

- **Better Auth** email/password sessions, optional Google OAuth, password reset and
  change-password flows.
- **JWT** access tokens (`GET /api/auth/token`) accepted as `Authorization: Bearer …` next to
  the Better Auth session cookie.
- Server-side role verification (`customer`, `vendor`, `admin`) and blocked-account checks on
  every protected route.
- Scoped state snapshot (`GET /api/state`) so the Next.js client hydrates only the records the
  current role may see.
- Menu CRUD with ownership checks, admin approval/rejection and the free-plan limit of three
  active approved items.
- Order creation with duplicate-active-order protection, customer cancellation and one-time
  vendor accept/reject rules.
- Admin user management (search, details, block/unblock), menu review and read-only
  transaction monitoring.
- **Stripe Checkout** subscriptions and webhook-driven Premium activation. Premium is never
  activated by the success redirect.
- ImgBB upload proxy so the API key never reaches the browser.
- Advanced menu search/filter/sort support (`search`, `category`, `location`, `minPrice`,
  `maxPrice`, `sort`, `page`, `limit`) and partial MongoDB indexes.
- Zod request validation, Helmet, CORS allow-list, rate limiting and consistent JSON errors.
- Integration test suite with `mongodb-memory-server`, plus unit tests for JWT, serializers,
  subscription rules and query helpers.

## Technology stack

| Area | Packages |
| --- | --- |
| Runtime | Node.js, TypeScript, Express 5 |
| Database | `mongodb` driver (Better Auth collections + `menuItems`, `orders`, `transactions`) |
| Auth | `better-auth` with the MongoDB adapter, `jsonwebtoken` |
| Payments | `stripe` |
| Validation | `zod` |
| Security | `helmet`, `cors`, `express-rate-limit` |
| Images | ImgBB REST API (server-side proxy) |
| Email | Resend REST API (password reset) |
| Tooling | `tsx`, `mongodb-memory-server`, Node's built-in `node:test` |

## Requirements

- Node.js 20+
- A MongoDB database (local or MongoDB Atlas)
- Stripe account/test keys for subscription testing
- Optional: Google OAuth app, ImgBB key, Resend key

## Local setup

```bash
npm install
cp .env.example .env
# fill in MongoDB, auth secrets and the optional integrations
npm run seed
npm run dev
```

The API starts on `http://localhost:4000`. Health check: `GET /api/health`.

Useful scripts:

```bash
npm run dev      # tsx watch
npm run build    # tsc
npm start        # run dist/index.js
npm run seed     # create the admin + demo records
npm test         # unit tests; integration test runs when MongoDB binaries can start
```

## Environment variables

See `.env.example` for the full list. Never commit `.env` or real secrets.

| Name | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT` | Runtime mode and HTTP port |
| `MONGODB_URI`, `MONGODB_DB_NAME` | MongoDB connection and database |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Better Auth signing secret and public auth origin (the client origin that proxies `/api/auth`) |
| `CLIENT_URL`, `CLIENT_URLS` | Allowed CORS/client origins; `CLIENT_URL` must match the `BETTER_AUTH_URL` origin |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | JWT signing secret and lifetime |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe API and webhook verification |
| `STRIPE_PREMIUM_PRICE_ID`, `STRIPE_PREMIUM_AMOUNT`, `STRIPE_CURRENCY` | Premium price configuration |
| `IMGBB_API_KEY` | Menu image uploads |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed admin account |
| `RESEND_API_KEY`, `EMAIL_FROM`, `RESET_PASSWORD_URL` | Password reset email delivery |
| `SEED_DEMO_DATA` | Include demo vendors/menu/orders when seeding |

Production refuses to start with the built-in development auth/JWT secrets.

## Demo accounts after `npm run seed`

All demo accounts use the password `Password123` unless you changed `ADMIN_PASSWORD`.

| Role | Email |
| --- | --- |
| Admin | `admin@pizzahub.com` (`ADMIN_EMAIL`) |
| Vendor (free) | `vendor@pizzahub.com` |
| Vendor (Premium) | `mario@woodfire.com` |
| Customer | `customer@pizzahub.com` |
| Blocked customer | `blocked@example.com` |

## API overview

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/health` | Public |
| `GET/POST` | `/api/auth/*` | Better Auth |
| `GET` | `/api/auth/token` | Authenticated session |
| `GET` | `/api/menu`, `/api/menu/:id`, `/api/menu/locations`, `/api/menu/categories` | Public |
| `GET` | `/api/state` | Optional auth (role-scoped) |
| `PATCH` | `/api/profile` | Authenticated |
| `GET/POST` | `/api/orders` | Authenticated (role-scoped) |
| `PATCH` | `/api/orders/:id/cancel` | Order owner (customer) |
| `PATCH` | `/api/orders/:id/status` | Vendor owner |
| `GET/POST/PATCH/DELETE` | `/api/vendor/menu…` | Vendor |
| `GET` | `/api/vendor/subscription` | Vendor |
| `POST` | `/api/vendor/subscription/checkout`, `/api/vendor/subscription/portal` | Vendor |
| `GET/PATCH/DELETE` | `/api/admin/users…`, `/api/admin/menu…`, `/api/admin/transactions`, `/api/admin/overview` | Admin |
| `POST` | `/api/upload` | Authenticated |
| `POST` | `/api/stripe/webhook` | Stripe signature only |

## Stripe setup

1. Set `STRIPE_SECRET_KEY` (test mode is fine).
2. Optionally set `STRIPE_PREMIUM_PRICE_ID`; otherwise the API creates an inline $29/month
   recurring price from `STRIPE_PREMIUM_AMOUNT` and `STRIPE_CURRENCY`.
3. Add a webhook endpoint pointing to `{PUBLIC_API_URL}/api/stripe/webhook` and subscribe to:
   `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
4. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
5. For local testing, run `stripe listen --forward-to localhost:4000/api/stripe/webhook` and
   use test card `4242 4242 4242 4242`, any future expiry and any CVC.

Premium is written to MongoDB only after signature verification and a paid subscription event.

## Google OAuth and ImgBB

- Google: set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. In Google Cloud Console add:
  - Authorized JavaScript origin: `{BETTER_AUTH_URL}`
  - Authorized redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google`

  `BETTER_AUTH_URL` is the public **client** origin, because the Next.js client proxies
  `/api/auth/*` to this API. For local development that is `http://localhost:3000`; in
  production it is the deployed client URL. `CLIENT_URL` must use the same origin.
- Existing email/password users are linked to Google by their verified Google email on first
  Google sign-in, so they keep the same MongoDB user and role. Google sign-ups honour the
  customer/vendor role selected on the registration form.
- ImgBB: set `IMGBB_API_KEY`. Vendors upload through `POST /api/upload`, which proxies the
  base64 image to ImgBB. Without the key the API returns `503` and the client keeps a
  compressed local preview with a visible warning.

## Challenge implementation notes

- **Advanced search and sorting:** `GET /api/menu` validates query parameters with Zod and
  builds a MongoDB filter for search, category, location and price range, then sorts by
  recommended/premium, price ascending/descending, newest, rating or name.
- **JWT verification:** `middleware/auth.ts` first verifies a `Bearer` token with
  `jsonwebtoken` (issuer + audience + expiry), loads the current user from MongoDB, rejects
  blocked accounts, and only then applies `requireRole(...)`. Ownership checks run again inside
  menu/order handlers so a client-supplied ID or role is never trusted.

## Deployment

1. Provision MongoDB Atlas and set `MONGODB_URI`, `MONGODB_DB_NAME`.
2. Generate production `BETTER_AUTH_SECRET` and `JWT_SECRET`.
3. Set `BETTER_AUTH_URL` and `CLIENT_URL` to the public client origin (the client proxies
   `/api/auth/*` to this API). Do not point `BETTER_AUTH_URL` at the API host.
4. Configure Stripe, Google and ImgBB credentials. Register
   `{BETTER_AUTH_URL}/api/auth/callback/google` in Google Cloud Console.
5. Run `npm run build`, then `npm start`. Run `npm run seed` once to create the admin account.
6. Register the Stripe webhook against the deployed `/api/stripe/webhook`.
