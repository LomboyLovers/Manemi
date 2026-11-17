// Shared money formatting and expense category metadata (Manemi design system).

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

/** Always ₱ with 2 decimals, via Intl en-PH. */
export const peso = (amount: number) => pesoFormatter.format(amount);

// Matches the database's expense_category list.
export type CategoryKey =
  | "food"
  | "transport"
  | "lodging"
  | "shopping"
  | "utilities"
  | "entertainment"
  | "other";

export const CATEGORY_META: Record<
  CategoryKey,
  { label: string; icon: string; color: string }
> = {
  food: { label: "Food", icon: "🍔", color: "#FFB547" },
  transport: { label: "Transport", icon: "🚕", color: "#5AA9FF" },
  lodging: { label: "Lodging", icon: "🏠", color: "#C4A1FF" },
  shopping: { label: "Shopping", icon: "🛍️", color: "#FF8FA3" },
  utilities: { label: "Utilities", icon: "💡", color: "#4FD1C5" },
  entertainment: { label: "Entertainment", icon: "🎬", color: "#A3E635" },
  other: { label: "Other", icon: "💳", color: "#8A8A95" },
};

export function categoryKey(raw: string | null | undefined): CategoryKey {
  const key = (raw ?? "").trim().toLowerCase();
  return key in CATEGORY_META ? (key as CategoryKey) : "other";
}

/** Balances under half a centavo are treated as zero. */
export const isZero = (amount: number) => Math.abs(amount) < 0.005;

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export const initialOf = (name: string) =>
  name.trim().charAt(0).toUpperCase() || "?";
