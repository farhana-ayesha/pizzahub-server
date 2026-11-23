import { ObjectId } from "mongodb";
import { buildAuth, type PizzaHubAuth } from "../auth/auth.js";
import { env } from "../config/env.js";
import {
  closeDatabase,
  collections,
  connectDatabase,
} from "../db/mongo.js";
import type {
  MenuItemDoc,
  OrderDoc,
  TransactionDoc,
  UserDoc,
} from "../types/models.js";

const photo = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;

const photos = {
  margherita: photo("photo-1574071318508-1cdbab80d002"),
  pepperoni: photo("photo-1628840042765-356cda07504e"),
  garden: photo("photo-1511689660979-10d2b1aada49"),
  bbq: photo("photo-1565299624946-b28f40a0ae38"),
  salami: photo("photo-1593560708920-61dd98c46a4e"),
  cheese: photo("photo-1579751626657-72bc17010498"),
  veggie: photo("photo-1594007654729-407eedc4be65"),
  mushroom: photo("photo-1604382354936-07c5d9983bd3"),
  garlic: photo("photo-1541592106381-b31e9677c0e5"),
  fries: photo("photo-1573080496219-bb080dd4f877"),
  drink: photo("photo-1555072956-7758afb20e8f"),
  tiramisu: photo("photo-1571877227200-a0d98ea607e9"),
  tikka: photo("photo-1566843972142-a7fcb70de55a"),
  prosciutto: photo("photo-1585238342024-78d387f4a707"),
  lava: photo("photo-1606313564200-e75d5e30476c"),
};

interface SeedUserInput {
  name: string;
  email: string;
  image: string;
  role: "customer" | "vendor" | "admin";
  businessName?: string;
  subscriptionPlan?: "free" | "premium";
  subscriptionExpiresAt?: Date | null;
  phone?: string;
  location?: string;
  isBlocked?: boolean;
  createdAt?: Date;
}

async function ensureUser(
  auth: PizzaHubAuth,
  input: SeedUserInput,
): Promise<UserDoc> {
  const email = input.email.toLowerCase();
  let existing = await collections.users().findOne({ email });

  if (!existing) {
    // Admin accounts are deliberately created through the normal customer
    // sign-up path and then promoted, because public registration forbids
    // requesting the admin role.
    const result = await auth.api.signUpEmail({
      body: {
        name: input.name,
        email,
        password: env.ADMIN_PASSWORD,
        image: input.image,
      },
    });
    if (!result?.user?.id) {
      throw new Error(`Could not create seed user ${email}.`);
    }
    existing = await collections.users().findOne({
      _id: new ObjectId(result.user.id),
    });
    if (!existing) {
      throw new Error(`Seed user ${email} disappeared after sign-up.`);
    }
  }

  const set: Partial<UserDoc> = {
    name: input.name,
    image: input.image,
    role: input.role,
    isBlocked: Boolean(input.isBlocked),
    phone: input.phone ?? null,
    location: input.location ?? null,
    updatedAt: new Date(),
  };
  if (input.role === "vendor") {
    set.businessName = input.businessName ?? `${input.name}'s Pizzeria`;
    set.subscriptionPlan = input.subscriptionPlan ?? "free";
    set.subscriptionExpiresAt = input.subscriptionExpiresAt ?? null;
  } else {
    set.businessName = null;
    set.subscriptionPlan = "free";
    set.subscriptionExpiresAt = null;
  }
  if (input.createdAt) set.createdAt = input.createdAt;

  const updated = await collections
    .users()
    .findOneAndUpdate(
      { _id: existing._id },
      { $set: set },
      { returnDocument: "after" },
    );
  if (!updated) throw new Error(`Could not update seed user ${email}.`);
  return updated;
}

async function main() {
  const db = await connectDatabase();
  const auth = buildAuth(db);

  const admin = await ensureUser(auth, {
    name: env.ADMIN_NAME,
    email: env.ADMIN_EMAIL,
    image: "https://i.pravatar.cc/150?img=25",
    role: "admin",
    phone: "+1 415 555 0100",
    location: "San Francisco, CA",
    createdAt: new Date("2026-01-08T09:00:00.000Z"),
  });
  console.log(`Admin ready: ${admin.email}`);

  if (!env.SEED_DEMO_DATA) {
    console.log("SEED_DEMO_DATA=false, skipping demo records.");
    await closeDatabase();
    return;
  }

  const premiumExpiry = new Date();
  premiumExpiry.setFullYear(premiumExpiry.getFullYear() + 1);

  const mario = await ensureUser(auth, {
    name: "Mario Rossi",
    email: "mario@woodfire.com",
    image: "https://i.pravatar.cc/150?img=12",
    role: "vendor",
    businessName: "Mario's Woodfire",
    subscriptionPlan: "premium",
    subscriptionExpiresAt: premiumExpiry,
    phone: "+1 415 555 0142",
    location: "Gulshan, Dhaka",
    createdAt: new Date("2026-02-14T09:00:00.000Z"),
  });

  const fire = await ensureUser(auth, {
    name: "Nadia Rahman",
    email: "vendor@pizzahub.com",
    image: "https://i.pravatar.cc/150?img=47",
    role: "vendor",
    businessName: "Fire & Crust",
    subscriptionPlan: "free",
    phone: "+1 415 555 0188",
    location: "Dhanmondi, Dhaka",
    createdAt: new Date("2026-03-03T09:00:00.000Z"),
  });

  const basil = await ensureUser(auth, {
    name: "Tanvir Ahmed",
    email: "tanvir@basilandbrick.com",
    image: "https://i.pravatar.cc/150?img=33",
    role: "vendor",
    businessName: "Basil & Brick",
    subscriptionPlan: "premium",
    subscriptionExpiresAt: premiumExpiry,
    phone: "+1 415 555 0166",
    location: "Banani, Dhaka",
    createdAt: new Date("2026-03-22T09:00:00.000Z"),
  });

  const emma = await ensureUser(auth, {
    name: "Emma Carter",
    email: "customer@pizzahub.com",
    image: "https://i.pravatar.cc/150?img=5",
    role: "customer",
    phone: "+1 415 555 0117",
    location: "Gulshan 1, Dhaka",
    createdAt: new Date("2026-04-11T09:00:00.000Z"),
  });

  const james = await ensureUser(auth, {
    name: "James Lee",
    email: "james@example.com",
    image: "https://i.pravatar.cc/150?img=15",
    role: "customer",
    phone: "+1 415 555 0134",
    location: "Uttara, Dhaka",
    createdAt: new Date("2026-05-02T09:00:00.000Z"),
  });

  const sofia = await ensureUser(auth, {
    name: "Sofia Alvarez",
    email: "sofia@example.com",
    image: "https://i.pravatar.cc/150?img=44",
    role: "customer",
    phone: "+1 415 555 0159",
    location: "Mirpur, Dhaka",
    createdAt: new Date("2026-06-19T09:00:00.000Z"),
  });

  await ensureUser(auth, {
    name: "Noah Bennett",
    email: "blocked@example.com",
    image: "https://i.pravatar.cc/150?img=60",
    role: "customer",
    phone: "+1 415 555 0172",
    location: "Banani, Dhaka",
    isBlocked: true,
    createdAt: new Date("2026-07-04T09:00:00.000Z"),
  });

  const vendorIds = {
    mario: mario._id.toHexString(),
    fire: fire._id.toHexString(),
    basil: basil._id.toHexString(),
  };
  const customerIds = {
    emma: emma._id.toHexString(),
    james: james._id.toHexString(),
    sofia: sofia._id.toHexString(),
  };

  const menuSeed: Array<
    Omit<MenuItemDoc, "_id" | "createdAt"> & { createdAt: Date }
  > = [
    {
      vendorId: vendorIds.mario,
      itemName: "Truffle Margherita",
      category: "Classic Pizzas",
      description:
        "San Marzano tomato, fior di latte, black truffle shavings and fresh basil on a 48-hour sourdough base.",
      price: 14.9,
      location: "Gulshan, Dhaka",
      images: [photos.margherita, photos.cheese, photos.prosciutto],
      status: "approved",
      active: true,
      rating: 4.9,
      reviewsCount: 128,
      prepTime: "18–22 min",
      tags: ["Vegetarian", "Signature", "Sourdough"],
      createdAt: new Date("2026-09-12T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.mario,
      itemName: "Pepperoni Overload",
      category: "Meat Lovers",
      description:
        "Double cured pepperoni, aged mozzarella, oregano and a swirl of hot honey. Built for sharing.",
      price: 16.5,
      location: "Gulshan, Dhaka",
      images: [photos.pepperoni, photos.salami, photos.margherita],
      status: "approved",
      active: true,
      rating: 4.8,
      reviewsCount: 214,
      prepTime: "20–24 min",
      tags: ["Spicy", "Best seller"],
      createdAt: new Date("2026-09-13T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.mario,
      itemName: "Garden Glow",
      category: "Vegetarian Pizzas",
      description:
        "Roasted peppers, courgette ribbons, cherry tomatoes, basil pesto and whipped ricotta.",
      price: 13.75,
      location: "Gulshan, Dhaka",
      images: [photos.garden, photos.veggie, photos.margherita],
      status: "approved",
      active: true,
      rating: 4.7,
      reviewsCount: 89,
      prepTime: "18–22 min",
      tags: ["Vegetarian", "Fresh"],
      createdAt: new Date("2026-09-14T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.mario,
      itemName: "Smoky BBQ Chicken",
      category: "Specialty / Gourmet Pizzas",
      description:
        "Wood-smoked chicken, caramelised onion, smoked scamorza and a tangy house BBQ drizzle.",
      price: 17.9,
      location: "Gulshan, Dhaka",
      images: [photos.bbq, photos.tikka, photos.pepperoni],
      status: "approved",
      active: true,
      rating: 4.8,
      reviewsCount: 176,
      prepTime: "22–26 min",
      tags: ["Smoky", "Chef's pick"],
      createdAt: new Date("2026-09-15T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.mario,
      itemName: "Chicken Tikka Pizza",
      category: "Specialty / Gourmet Pizzas",
      description:
        "Tandoori chicken, red onion, coriander and a cooling yogurt drizzle on a spiced base.",
      price: 17.2,
      location: "Gulshan, Dhaka",
      images: [photos.tikka, photos.bbq, photos.pepperoni],
      status: "approved",
      active: false,
      rating: 4.7,
      reviewsCount: 91,
      prepTime: "22–26 min",
      tags: ["Spicy", "Fusion"],
      createdAt: new Date("2026-09-16T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.mario,
      itemName: "Pesto Prosciutto",
      category: "Specialty / Gourmet Pizzas",
      description:
        "Prosciutto di Parma, basil pesto, burrata and rocket. Finished with lemon oil.",
      price: 18.75,
      location: "Gulshan, Dhaka",
      images: [photos.prosciutto, photos.margherita, photos.cheese],
      status: "pending",
      active: true,
      rating: 0,
      reviewsCount: 0,
      prepTime: "20–24 min",
      tags: ["New", "Gourmet"],
      createdAt: new Date("2026-11-19T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.fire,
      itemName: "Garlic Knots",
      category: "Sides & Appetizers",
      description:
        "Six pillowy knot rolls brushed with garlic butter, parsley and a dusting of parmesan.",
      price: 6.9,
      location: "Dhanmondi, Dhaka",
      images: [photos.garlic, photos.margherita, photos.fries],
      status: "approved",
      active: true,
      rating: 4.8,
      reviewsCount: 156,
      prepTime: "10–14 min",
      tags: ["Vegetarian", "Shareable"],
      createdAt: new Date("2026-09-17T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.fire,
      itemName: "Loaded Fries",
      category: "Sides & Appetizers",
      description:
        "Crispy skin-on fries, melty mozzarella, jalapeños, spring onion and chipotle mayo.",
      price: 7.5,
      location: "Dhanmondi, Dhaka",
      images: [photos.fries, photos.garlic, photos.bbq],
      status: "approved",
      active: true,
      rating: 4.6,
      reviewsCount: 73,
      prepTime: "12–16 min",
      tags: ["Spicy", "Shareable"],
      createdAt: new Date("2026-09-18T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.fire,
      itemName: "Blood Orange Fizz",
      category: "Beverages & Desserts",
      description:
        "Sparkling blood orange, rosemary syrup and plenty of ice. A bright, bubbly palate cleanser.",
      price: 4.5,
      location: "Dhanmondi, Dhaka",
      images: [photos.drink, photos.tiramisu, photos.garlic],
      status: "approved",
      active: true,
      rating: 4.7,
      reviewsCount: 58,
      prepTime: "5 min",
      tags: ["Vegan", "Chilled"],
      createdAt: new Date("2026-09-19T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.fire,
      itemName: "Tiramisu Jar",
      category: "Beverages & Desserts",
      description:
        "Espresso-soaked sponge, mascarpone cream and cocoa in a ready-to-spoon jar for one.",
      price: 6.25,
      location: "Dhanmondi, Dhaka",
      images: [photos.tiramisu, photos.lava, photos.drink],
      status: "approved",
      active: false,
      rating: 4.9,
      reviewsCount: 112,
      prepTime: "5 min",
      tags: ["Vegetarian", "Dessert"],
      createdAt: new Date("2026-09-20T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.fire,
      itemName: "Margherita Classica",
      category: "Classic Pizzas",
      description:
        "A simple, honest margherita with tomato, mozzarella and basil. Nothing else needed.",
      price: 12.9,
      location: "Dhanmondi, Dhaka",
      images: [photos.margherita, photos.cheese, photos.garden],
      status: "pending",
      active: true,
      rating: 0,
      reviewsCount: 0,
      prepTime: "16–20 min",
      tags: ["Vegetarian", "Classic"],
      createdAt: new Date("2026-11-18T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.basil,
      itemName: "Hot Honey Salami",
      category: "Meat Lovers",
      description:
        "Fiery salami, chilli flakes, mozzarella and a generous finish of chilli-infused honey.",
      price: 18.25,
      location: "Banani, Dhaka",
      images: [photos.salami, photos.pepperoni, photos.bbq],
      status: "approved",
      active: true,
      rating: 4.9,
      reviewsCount: 201,
      prepTime: "20–24 min",
      tags: ["Spicy", "Signature"],
      createdAt: new Date("2026-09-21T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.basil,
      itemName: "Quattro Formaggi",
      category: "Classic Pizzas",
      description:
        "Mozzarella, gorgonzola, fontina and parmesan with a touch of thyme and cracked black pepper.",
      price: 15.6,
      location: "Banani, Dhaka",
      images: [photos.cheese, photos.margherita, photos.mushroom],
      status: "approved",
      active: true,
      rating: 4.7,
      reviewsCount: 97,
      prepTime: "18–22 min",
      tags: ["Vegetarian", "Four cheese"],
      createdAt: new Date("2026-09-22T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.basil,
      itemName: "Roasted Veggie Pesto",
      category: "Vegetarian Pizzas",
      description:
        "Slow-roasted pumpkin, broccoli, red onion and almond pesto over a light tomato base.",
      price: 14.4,
      location: "Banani, Dhaka",
      images: [photos.veggie, photos.garden, photos.margherita],
      status: "approved",
      active: true,
      rating: 4.6,
      reviewsCount: 64,
      prepTime: "18–22 min",
      tags: ["Vegan option", "Fresh"],
      createdAt: new Date("2026-09-23T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.basil,
      itemName: "Truffle Mushroom",
      category: "Specialty / Gourmet Pizzas",
      description:
        "Wild mushrooms, taleggio, truffle cream and crispy thyme on a golden stone-baked crust.",
      price: 19.5,
      location: "Banani, Dhaka",
      images: [photos.mushroom, photos.cheese, photos.prosciutto],
      status: "approved",
      active: true,
      rating: 4.9,
      reviewsCount: 143,
      prepTime: "22–26 min",
      tags: ["Vegetarian", "Gourmet"],
      createdAt: new Date("2026-09-24T10:00:00.000Z"),
    },
    {
      vendorId: vendorIds.basil,
      itemName: "Chocolate Lava Cake",
      category: "Beverages & Desserts",
      description:
        "Warm dark chocolate cake with a molten centre, served with a little sea salt.",
      price: 6.9,
      location: "Banani, Dhaka",
      images: [photos.lava, photos.tiramisu, photos.drink],
      status: "rejected",
      active: false,
      rating: 0,
      reviewsCount: 0,
      prepTime: "8–10 min",
      tags: ["Dessert"],
      createdAt: new Date("2026-09-25T10:00:00.000Z"),
    },
  ];

  for (const entry of menuSeed) {
    await collections.menuItems().updateOne(
      { vendorId: entry.vendorId, itemName: entry.itemName },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          ...entry,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  const items = await collections
    .menuItems()
    .find({ vendorId: { $in: Object.values(vendorIds) } })
    .toArray();
  const itemId = (name: string) => {
    const found = items.find((entry) => entry.itemName === name);
    if (!found) throw new Error(`Seed menu item ${name} was not created.`);
    return found._id.toHexString();
  };
  const itemPrice = (name: string) => {
    const found = items.find((entry) => entry.itemName === name);
    if (!found) throw new Error(`Seed menu item ${name} was not created.`);
    return found.price;
  };

  const orderSeed: Array<{
    itemName: string;
    vendorId: string;
    customerId: string;
    deliveryDate: string;
    deliveryAddress: string;
    message: string;
    status: OrderDoc["status"];
    quantity: number;
    createdAt: string;
  }> = [
    {
      itemName: "Pepperoni Overload",
      vendorId: vendorIds.mario,
      customerId: customerIds.emma,
      deliveryDate: "2026-11-25",
      deliveryAddress: "House 12, Road 7, Gulshan 1, Dhaka",
      message: "Please add extra napkins and chilli flakes.",
      status: "pending",
      quantity: 1,
      createdAt: "2026-11-19T13:20:00.000Z",
    },
    {
      itemName: "Quattro Formaggi",
      vendorId: vendorIds.basil,
      customerId: customerIds.emma,
      deliveryDate: "2026-11-24",
      deliveryAddress: "House 12, Road 7, Gulshan 1, Dhaka",
      message: "Leave at the reception desk, please.",
      status: "accepted",
      quantity: 2,
      createdAt: "2026-11-18T18:05:00.000Z",
    },
    {
      itemName: "Blood Orange Fizz",
      vendorId: vendorIds.fire,
      customerId: customerIds.emma,
      deliveryDate: "2026-11-18",
      deliveryAddress: "House 12, Road 7, Gulshan 1, Dhaka",
      message: "No straws needed.",
      status: "rejected",
      quantity: 3,
      createdAt: "2026-11-17T11:42:00.000Z",
    },
    {
      itemName: "Truffle Margherita",
      vendorId: vendorIds.mario,
      customerId: customerIds.james,
      deliveryDate: "2026-11-26",
      deliveryAddress: "Flat 4B, Road 11, Uttara, Dhaka",
      message: "Cut into 8 slices if possible.",
      status: "pending",
      quantity: 1,
      createdAt: "2026-11-19T16:10:00.000Z",
    },
    {
      itemName: "Garlic Knots",
      vendorId: vendorIds.fire,
      customerId: customerIds.sofia,
      deliveryDate: "2026-11-23",
      deliveryAddress: "House 8, Avenue 3, Mirpur, Dhaka",
      message: "Extra garlic butter on the side.",
      status: "accepted",
      quantity: 2,
      createdAt: "2026-11-19T09:30:00.000Z",
    },
    {
      itemName: "Hot Honey Salami",
      vendorId: vendorIds.basil,
      customerId: customerIds.james,
      deliveryDate: "2026-11-16",
      deliveryAddress: "Flat 4B, Road 11, Uttara, Dhaka",
      message: "",
      status: "cancelled",
      quantity: 1,
      createdAt: "2026-11-15T20:00:00.000Z",
    },
    {
      itemName: "Garlic Knots",
      vendorId: vendorIds.fire,
      customerId: customerIds.emma,
      deliveryDate: "2026-11-12",
      deliveryAddress: "House 12, Road 7, Gulshan 1, Dhaka",
      message: "Thanks!",
      status: "accepted",
      quantity: 1,
      createdAt: "2026-11-11T17:45:00.000Z",
    },
    {
      itemName: "Smoky BBQ Chicken",
      vendorId: vendorIds.mario,
      customerId: customerIds.sofia,
      deliveryDate: "2026-11-27",
      deliveryAddress: "House 8, Avenue 3, Mirpur, Dhaka",
      message: "Ring the bell twice.",
      status: "pending",
      quantity: 1,
      createdAt: "2026-11-20T08:15:00.000Z",
    },
  ];

  for (const entry of orderSeed) {
    const id = itemId(entry.itemName);
    const active = entry.status === "pending" || entry.status === "accepted";
    await collections.orders().updateOne(
      {
        customerId: entry.customerId,
        itemId: id,
        deliveryDate: entry.deliveryDate,
      },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          itemId: id,
          vendorId: entry.vendorId,
          customerId: entry.customerId,
          deliveryDate: entry.deliveryDate,
          deliveryAddress: entry.deliveryAddress,
          message: entry.message,
          status: entry.status,
          quantity: entry.quantity,
          total: Number((itemPrice(entry.itemName) * entry.quantity).toFixed(2)),
          orderGuard: active
            ? `${entry.customerId}:${id}:${entry.deliveryDate}`
            : null,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.createdAt),
        },
      },
      { upsert: true },
    );
  }

  const transactionSeed: Array<
    Omit<TransactionDoc, "_id" | "createdAt"> & { createdAt: string }
  > = [
    {
      vendorId: vendorIds.mario,
      plan: "premium",
      amount: 29,
      currency: "usd",
      stripeSessionId: "cs_test_seed_mario",
      stripeSubscriptionId: "sub_seed_mario",
      status: "succeeded",
      createdAt: "2026-10-12T14:32:00.000Z",
    },
    {
      vendorId: vendorIds.basil,
      plan: "premium",
      amount: 29,
      currency: "usd",
      stripeSessionId: "cs_test_seed_basil",
      stripeSubscriptionId: "sub_seed_basil",
      status: "succeeded",
      createdAt: "2026-09-28T10:11:00.000Z",
    },
    {
      vendorId: vendorIds.fire,
      plan: "premium",
      amount: 29,
      currency: "usd",
      stripeSessionId: "cs_test_seed_fire",
      stripeSubscriptionId: "sub_seed_fire",
      status: "failed",
      createdAt: "2026-11-02T19:04:00.000Z",
    },
    {
      vendorId: vendorIds.mario,
      plan: "premium",
      amount: 29,
      currency: "usd",
      stripeSessionId: "cs_test_seed_mario_renewal",
      stripeSubscriptionId: "sub_seed_mario",
      status: "succeeded",
      createdAt: "2026-11-12T14:32:00.000Z",
    },
  ];

  for (const entry of transactionSeed) {
    await collections.transactions().updateOne(
      { stripeSessionId: entry.stripeSessionId },
      {
        $setOnInsert: {
          _id: new ObjectId(),
          ...entry,
          createdAt: new Date(entry.createdAt),
          updatedAt: new Date(entry.createdAt),
        },
      },
      { upsert: true },
    );
  }

  console.log("Seed complete.");
  console.log("Demo accounts (password for all: Password123):");
  console.log(`  Admin:    ${env.ADMIN_EMAIL}`);
  console.log("  Vendor:   vendor@pizzahub.com (free) / mario@woodfire.com (premium)");
  console.log("  Customer: customer@pizzahub.com");
  console.log("  Blocked:  blocked@example.com");
  await closeDatabase();
}

main().catch(async (error) => {
  console.error("Seed failed:", error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
