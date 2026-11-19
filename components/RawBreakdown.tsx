"use client";

import { useState } from "react";
import { peso } from "@/lib/manemi/format";
import type { RawPerson } from "@/lib/manemi/ledger";
import "./raw-breakdown.css";

type Props = {
  people: RawPerson[];
  nameOf: (userId: string) => string;
  /** Smaller type for cards. */
  compact?: boolean;
};

const PER_PERSON = 5;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

/**
 * "See raw breakdown": every expense and payment between you and each person
 * (in pesos), before Manemi nets them and simplifies who pays whom.
 */
export default function RawBreakdown({ people, nameOf, compact }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!people.length) return null;
  const lines = people.reduce((sum, person) => sum + person.items.length, 0);
  const owedToYou = people.flatMap((p) => p.items).filter((i) => i.cents > 0).reduce((s, i) => s + i.cents, 0);
  const youOwe = people.flatMap((p) => p.items).filter((i) => i.cents < 0).reduce((s, i) => s - i.cents, 0);
  const net = owedToYou - youOwe;

  return (
    // Inside clickable cards: opening the dropdown mustn't open the group.
    <details
      className={`mn-raw ${compact ? "is-compact" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary>
        <span>See raw breakdown</span>
        <small>
          {lines} {lines === 1 ? "line" : "lines"}, before simplifying
        </small>
        <svg className="mn-raw-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      <p className="mn-raw-intro">Every peso expense and payment between you and each person, before they are added up and simplified.</p>

      {people.map((person) => {
        const name = nameOf(person.otherId);
        const open = expanded.has(person.otherId);
        const shown = open ? person.items : person.items.slice(0, PER_PERSON);
        return (
          <section key={person.otherId} className="mn-raw-person" aria-label={`Raw lines with ${name}`}>
            <header>
              <strong>{name}</strong>
              <span className={person.cents > 0 ? "is-positive" : person.cents < 0 ? "is-negative" : ""}>
                {person.cents === 0 ? "Even" : person.cents > 0 ? `owes you ${peso(person.cents / 100)}` : `you owe ${peso(-person.cents / 100)}`}
              </span>
            </header>
            <ul>
              {shown.map((item) => (
                <li key={`${item.id}-${item.otherId}`}>
                  <span className="mn-raw-text">
                    <span>
                      {item.kind === "payment"
                        ? item.cents > 0
                          ? `You paid ${name} back`
                          : `${name} paid you back`
                        : item.title}
                    </span>
                    <small>
                      {day(item.date)} ·{" "}
                      {item.kind === "payment"
                        ? "payment"
                        : item.cents > 0
                          ? `you paid, ${name}'s share`
                          : `${name} paid, your share`}
                    </small>
                  </span>
                  <strong className={item.cents > 0 ? "is-positive" : "is-negative"}>
                    {item.cents > 0 ? "+" : "−"}
                    {peso(Math.abs(item.cents) / 100)}
                  </strong>
                </li>
              ))}
            </ul>
            {person.items.length > PER_PERSON && (
              <button
                type="button"
                className="mn-raw-more"
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(person.otherId)) next.delete(person.otherId);
                    else next.add(person.otherId);
                    return next;
                  })
                }
              >
                {open ? "Show fewer" : `Show all ${person.items.length}`}
              </button>
            )}
          </section>
        );
      })}

      <dl className="mn-raw-totals">
        <div>
          <dt>Owed to you</dt>
          <dd className="is-positive">{peso(owedToYou / 100)}</dd>
        </div>
        <div>
          <dt>You owe</dt>
          <dd className="is-negative">{peso(youOwe / 100)}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd className={net > 0 ? "is-positive" : net < 0 ? "is-negative" : ""}>
            {net === 0 ? "Settled" : `${net > 0 ? "+" : "−"}${peso(Math.abs(net) / 100)}`}
          </dd>
        </div>
      </dl>
      <p className="mn-raw-note">
        The amounts above are simplified to the fewest payments across the group, so who pays whom can differ from these
        lines. Your overall balance is the same.
      </p>
    </details>
  );
}
