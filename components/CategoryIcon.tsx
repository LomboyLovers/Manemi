import { CATEGORY_META, type CategoryKey } from "@/lib/manemi/format";

/**
 * Line icons (24px grid, 2px stroke) used instead of emoji for expense
 * categories, payments and audit-log actions. Tinted with the category colour
 * unless `color` is given ("currentColor" to inherit).
 */
const PATHS: Record<CategoryKey | GlyphName, React.ReactNode> = {
  // Fork and knife
  food: (
    <>
      <path d="M5 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 3v18" />
      <path d="M17 21V3c-2 0-3.5 2.2-3.5 6v4a1 1 0 0 0 1 1H17" />
    </>
  ),
  // Car
  transport: (
    <>
      <path d="M5 16V11l2-5h10l2 5v5" />
      <path d="M3 16h18v3H3zM5 11h14" />
      <circle cx="7.5" cy="19" r="1.5" />
      <circle cx="16.5" cy="19" r="1.5" />
    </>
  ),
  // Bed
  lodging: (
    <>
      <path d="M3 6v13M3 13h18v6M21 19v-4a3 3 0 0 0-3-3h-8v1" />
      <circle cx="7" cy="10" r="2" />
    </>
  ),
  // Shopping bag
  shopping: (
    <>
      <path d="M5 8h14l-1 13H6L5 8Z" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" />
    </>
  ),
  // Light bulb
  utilities: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
    </>
  ),
  // Clapperboard
  entertainment: (
    <>
      <path d="M4 10h16v10H4z" />
      <path d="m4 10-.6-3.6 15.4-2.6.6 3.6L4 10ZM8.5 5.7l2 3.5M13.5 4.9l2 3.4" />
    </>
  ),
  // Tag
  other: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  // Payment: two arrows swapping
  payment: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  added: <path d="M12 5v14M5 12h14" />,
  edited: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  deleted: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  cancelled: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
};

export type GlyphName = "payment" | "added" | "edited" | "deleted" | "cancelled";

type Props = {
  name: CategoryKey | GlyphName;
  size?: number;
  color?: string;
};

export default function CategoryIcon({ name, size = 22, color }: Props) {
  const tint = color ?? (name in CATEGORY_META ? CATEGORY_META[name as CategoryKey].color : "currentColor");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
