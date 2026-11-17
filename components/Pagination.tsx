"use client";

import "./pagination.css";

type Props = {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  /** e.g. "entries", "expenses" */
  noun?: string;
  busy?: boolean;
};

/** "Showing 11–20 of 57" with Previous / page numbers / Next. Hidden for one page. */
export default function Pagination({ page, total, pageSize, onChange, noun = "entries", busy }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  // First, last, and the pages around the current one; gaps become "…".
  const shown: Array<number | "gap"> = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) shown.push(n);
    else if (shown[shown.length - 1] !== "gap") shown.push("gap");
  }

  return (
    <nav className="mn-pagination" aria-label="Pages">
      <p className="mn-pagination-summary" aria-live="polite">
        Showing {from}–{to} of {total} {noun}
      </p>
      <div className="mn-pagination-controls">
        <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1 || busy}>
          <span aria-hidden="true">‹</span> Previous
        </button>
        <ol>
          {shown.map((item, index) =>
            item === "gap" ? (
              <li key={`gap-${index}`} aria-hidden="true" className="mn-pagination-gap">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? "page" : undefined}
                  className={item === page ? "is-current" : ""}
                  onClick={() => onChange(item)}
                  disabled={busy && item !== page}
                >
                  {item}
                </button>
              </li>
            ),
          )}
        </ol>
        <button type="button" onClick={() => onChange(page + 1)} disabled={page >= pages || busy}>
          Next <span aria-hidden="true">›</span>
        </button>
      </div>
    </nav>
  );
}
