export const MENU_CATEGORIES = [
  "Classic Pizzas",
  "Vegetarian Pizzas",
  "Meat Lovers",
  "Specialty / Gourmet Pizzas",
  "Sides & Appetizers",
  "Beverages & Desserts",
] as const;

export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export const MENU_STATUSES = ["pending", "approved", "rejected", "inactive"] as const;
export const ORDER_STATUSES = ["pending", "accepted", "rejected", "cancelled"] as const;
