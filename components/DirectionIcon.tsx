/**
 * Balance direction icons. Replaces the ↙ ↗ ✓ characters, which iPhones draw
 * as blue emoji tiles. Inherits the text colour and size (1em by default).
 *   in   ↙ money coming to you (owed to you)
 *   out  ↗ money going out (you owe) — also used for "open"
 *   done ✓ settled
 */
export type Direction = "in" | "out" | "done";

const PATHS: Record<Direction, React.ReactNode> = {
  in: (
    <>
      <path d="M17 7 7 17" />
      <path d="M16 17H7V8" />
    </>
  ),
  out: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </>
  ),
  done: <path d="M20 6 9 17l-5-5" />,
};

export default function DirectionIcon({
  dir,
  size = "1em",
  className = "",
}: {
  dir: Direction;
  size?: number | string;
  className?: string;
}) {
  return (
    <svg
      className={`mn-dir-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[dir]}
    </svg>
  );
}
