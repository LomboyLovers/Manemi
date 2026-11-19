// Group categories. Must match the check constraint on "Group".category
// (migration 20261119170500_group_categories.sql).

import type { IconName } from "@/components/Icon";

export const GROUP_CATEGORIES = [
  { name: "Travel", icon: "plane" },
  { name: "Roommates", icon: "home" },
  { name: "Group Dinners", icon: "utensils" },
  { name: "Events", icon: "party" },
  { name: "Other", icon: "box" },
] as const satisfies ReadonlyArray<{ name: string; icon: IconName }>;

export type GroupCategory = (typeof GROUP_CATEGORIES)[number]["name"];

const ICONS = new Map<string, IconName>(GROUP_CATEGORIES.map((c) => [c.name, c.icon]));

export const isGroupCategory = (value: unknown): value is GroupCategory =>
  typeof value === "string" && ICONS.has(value);

/** Unknown or missing values (older rows, older servers) read as "Other". */
export const toGroupCategory = (value: unknown): GroupCategory =>
  isGroupCategory(value) ? value : "Other";

export const groupCategoryIcon = (category: string): IconName => ICONS.get(category) ?? "box";
