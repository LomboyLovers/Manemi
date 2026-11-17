// Split math for Add Expense. Everything is integer-based:
//   money   -> cents        (₱250.00 = 25000)
//   percent -> basis points (50%     = 5000, 100% = 10000)
// so switching between Equally / Exact / Percent never drifts by a centavo.

export type SplitMode = "equally" | "exact" | "percent";

export const FULL_PERCENT_BPS = 10_000;

export type SplitState = {
  /** Members included in the split. */
  selected: string[];
  /** Raw text of the per-member inputs for the current mode. */
  entries: Record<string, string>;
};

/** "250.50" -> 25050. Invalid or negative input counts as 0. */
export function toCents(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

/** "33.33" -> 3333. Invalid or negative input counts as 0. */
export function toBps(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

/** Integer hundredths -> short input text: 25000 -> "250", 3333 -> "33.33", 1250 -> "12.5". */
export function hundredthsToInput(value: number): string {
  if (!value) return "";
  return (value / 100).toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Splits `total` into integer parts proportional to `weights`, so the parts
 * always add up to exactly `total` (largest-remainder method). The earliest
 * members win ties, matching how Equally hands out the leftover centavo.
 */
export function apportion(
  total: number,
  ids: string[],
  weights: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  const weightSum = ids.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  if (!ids.length || total <= 0 || weightSum <= 0) {
    ids.forEach((id) => (result[id] = 0));
    return result;
  }
  const remainders = ids.map((id, index) => {
    const exact = (total * (weights[id] ?? 0)) / weightSum;
    result[id] = Math.floor(exact);
    return { id, index, remainder: exact - result[id] };
  });
  let left = total - ids.reduce((sum, id) => sum + result[id], 0);
  remainders
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(({ id }) => {
      if (left > 0) {
        result[id] += 1;
        left -= 1;
      }
    });
  return result;
}

/** Equal shares in cents; the first members absorb the leftover centavos. */
export function equalShares(totalCents: number, ids: string[]) {
  return apportion(
    totalCents,
    ids,
    Object.fromEntries(ids.map((id) => [id, 1])),
  );
}

/**
 * Cents owed by each member for the current mode and inputs.
 * Percent shares are apportioned so 100% always equals the exact total.
 */
export function computeShares(
  mode: SplitMode,
  totalCents: number,
  state: SplitState,
): Record<string, number> {
  const { selected, entries } = state;
  if (mode === "equally") return equalShares(totalCents, selected);
  if (mode === "exact") {
    return Object.fromEntries(
      selected.map((id) => [id, toCents(entries[id] ?? "")]),
    );
  }
  const bps = Object.fromEntries(
    selected.map((id) => [id, toBps(entries[id] ?? "")]),
  );
  const bpsSum = selected.reduce((sum, id) => sum + bps[id], 0);
  if (bpsSum === FULL_PERCENT_BPS) return apportion(totalCents, selected, bps);
  // Not 100% yet: show each person's literal share of the total.
  return Object.fromEntries(
    selected.map((id) => [id, Math.round((totalCents * bps[id]) / FULL_PERCENT_BPS)]),
  );
}

/** Basis points per member for the given cents. Adds to exactly 100% when the cents cover the total. */
export function sharesToBps(
  totalCents: number,
  ids: string[],
  cents: Record<string, number>,
): Record<string, number> {
  const centsSum = ids.reduce((sum, id) => sum + (cents[id] ?? 0), 0);
  if (totalCents <= 0) return Object.fromEntries(ids.map((id) => [id, 0]));
  if (centsSum === totalCents) return apportion(FULL_PERCENT_BPS, ids, cents);
  return Object.fromEntries(
    ids.map((id) => [
      id,
      Math.round(((cents[id] ?? 0) * FULL_PERCENT_BPS) / totalCents),
    ]),
  );
}

/**
 * Re-expresses the current split in another mode, e.g. ₱250 of ₱500 in Exact
 * becomes 50% in Percent, and 50% becomes ₱250 again in Exact.
 */
export function convertSplit(
  from: SplitMode,
  to: SplitMode,
  totalCents: number,
  state: SplitState,
): SplitState {
  if (from === to) return state;
  const shares = computeShares(from, totalCents, state);
  const contributing = state.selected.filter((id) =>
    from === "equally"
      ? true
      : from === "exact"
        ? toCents(state.entries[id] ?? "") > 0
        : toBps(state.entries[id] ?? "") > 0,
  );

  if (to === "equally") {
    // Keep everyone who had a share; fall back to the previous selection.
    return {
      selected: contributing.length ? contributing : state.selected,
      entries: {},
    };
  }

  // Without an amount, Percent can still be expressed: split 100% evenly.
  if (to === "percent" && totalCents <= 0) {
    const people = from === "equally" || !contributing.length ? state.selected : contributing;
    const bps = apportion(
      FULL_PERCENT_BPS,
      people,
      Object.fromEntries(people.map((id) => [id, 1])),
    );
    return {
      selected: state.selected,
      entries: Object.fromEntries(
        people.map((id) => [id, hundredthsToInput(bps[id])]),
      ),
    };
  }

  const values =
    to === "exact" ? shares : sharesToBps(totalCents, state.selected, shares);
  return {
    selected: state.selected,
    entries: Object.fromEntries(
      state.selected.map((id) => [id, hundredthsToInput(values[id] ?? 0)]),
    ),
  };
}
