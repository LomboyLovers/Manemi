"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadGroupsData, type GroupSummary } from "@/lib/manemi/groups";
import { peso } from "@/lib/manemi/format";
import { useModalFocus } from "./useModalFocus";
import "./popups.css";

export type QuickStep = "menu" | "add-type" | "add-group" | "settle" | "request";

type Props = {
  onClose: () => void;
  /** Groups already loaded by the page; loaded on demand when omitted. */
  groups?: GroupSummary[];
  initialStep?: QuickStep;
};

type Debt = { key: string; name: string; amount: number; groupId: string; groupName: string };

const Icon = {
  plus: <path d="M12 5v14M5 12h14" />,
  swap: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  send: <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />,
  group: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c2 .7 3.5 2.4 3.5 5.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  back: <path d="m15 6-6 6 6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
};

const Svg = ({ children, size = 22 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/**
 * Quick actions opened by the + button. Steps:
 * menu → Add Expense → (Personal | Group → active groups), Settle Debts,
 * Request Payment.
 */
export default function QuickActions({ onClose, groups: given, initialStep = "menu" }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<QuickStep>(initialStep);
  const [loaded, setLoaded] = useState<GroupSummary[] | null>(given ?? null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const ref = useModalFocus<HTMLElement>(onClose);
  const groups = given ?? loaded;

  // Pages without group data (e.g. a group's page) load it when needed.
  useEffect(() => {
    if (given || loaded || step === "menu" || step === "add-type") return;
    let active = true;
    loadGroupsData(createClient())
      .then((result) => active && setLoaded(result?.groups ?? []))
      .catch(() => active && setLoadError("Couldn't load your groups. Try again."));
    return () => {
      active = false;
    };
  }, [given, loaded, step]);

  // Move focus to the new step's first control.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button:not([disabled]):not([aria-disabled='true']), a[href]")?.focus();
  }, [step, groups, ref]);

  const activeGroups = (groups ?? []).filter((group) => !group.isArchived);
  const debts = (sign: 1 | -1): Debt[] =>
    (groups ?? [])
      .flatMap((group) =>
        group.counterparties
          .filter((person) => Math.sign(person.amount) === sign)
          .map((person) => ({
            key: `${group.id}-${person.userId}`,
            name: person.name,
            amount: Math.abs(person.amount),
            groupId: group.id,
            groupName: group.name,
          })),
      )
      .sort((a, b) => b.amount - a.amount);

  async function remind(debt: Debt) {
    const text = `Hi ${debt.name}! Friendly reminder from Manemi: you owe me ${peso(debt.amount)} for "${debt.groupName}".`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        setNotice(`Reminder ready for ${debt.name}.`);
      } else {
        await navigator.clipboard.writeText(text);
        setNotice(`Reminder copied. Paste it to ${debt.name}.`);
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setNotice("Couldn't share the reminder. Try again.");
    }
  }

  const title: Record<QuickStep, string> = {
    menu: "Quick actions",
    "add-type": "Add Expense",
    "add-group": "Choose a group",
    settle: "Settle Debts",
    request: "Request Payment",
  };
  const back: Partial<Record<QuickStep, QuickStep>> = {
    "add-type": "menu",
    "add-group": "add-type",
    settle: "menu",
    request: "menu",
  };

  const loading = !groups && !loadError;

  return (
    <>
      {/* Sibling, not parent: the popup must stack above the nav. */}
      <div className="mn-popup-backdrop" onClick={onClose} aria-hidden="true" />
      <section
        ref={ref}
        className="mn-quick"
        role="dialog"
        aria-modal="true"
        aria-label={title[step]}
      >
        {step !== "menu" && (
          <header className="mn-quick-header">
            {back[step] && step !== initialStep ? (
              <button type="button" className="mn-quick-back" aria-label="Back" onClick={() => setStep(back[step]!)}>
                <Svg>{Icon.back}</Svg>
              </button>
            ) : (
              <span className="mn-quick-back-spacer" />
            )}
            <h2>{title[step]}</h2>
            <button type="button" className="mn-quick-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </header>
        )}

        {step === "menu" && (
          <div className="mn-quick-list">
            <QuickRow icon={Icon.plus} title="Add Expense" detail="Split a new cost" onClick={() => setStep("add-type")} />
            <QuickRow icon={Icon.swap} title="Settle Debts" detail="Record a payment you made" onClick={() => setStep("settle")} />
            <QuickRow icon={Icon.send} title="Request Payment" detail="Remind someone who owes you" onClick={() => setStep("request")} />
          </div>
        )}

        {step === "add-type" && (
          <div className="mn-quick-list">
            <QuickRow
              icon={Icon.group}
              title="Group expense"
              detail="Split it with a group"
              onClick={() => setStep("add-group")}
              chevron
            />
            <QuickRow
              icon={Icon.user}
              title="Personal expense"
              detail="Just for you · coming soon"
              disabled
            />
          </div>
        )}

        {step === "add-group" &&
          (loading ? (
            <p className="mn-quick-state" aria-busy="true">Loading your groups…</p>
          ) : loadError ? (
            <p className="mn-quick-state" role="alert">{loadError}</p>
          ) : activeGroups.length ? (
            <div className="mn-quick-list mn-quick-scroll">
              {activeGroups.map((group) => (
                <QuickRow
                  key={group.id}
                  emoji="📦"
                  title={group.name}
                  detail={`${group.members} ${group.members === 1 ? "member" : "members"}`}
                  onClick={() => router.push(`/groups/${group.id}/add-expense`)}
                  chevron
                />
              ))}
            </div>
          ) : (
            <div className="mn-quick-state">
              <strong>No active groups</strong>
              <p>Group expenses need an active group. Create or join one on the Groups page.</p>
              <button type="button" className="mn-quick-cta" onClick={() => router.push("/groups")}>
                Go to Groups
              </button>
            </div>
          ))}

        {(step === "settle" || step === "request") &&
          (loading ? (
            <p className="mn-quick-state" aria-busy="true">Loading balances…</p>
          ) : loadError ? (
            <p className="mn-quick-state" role="alert">{loadError}</p>
          ) : (
            (() => {
              const list = debts(step === "settle" ? -1 : 1);
              if (!list.length)
                return (
                  <div className="mn-quick-state">
                    <strong>{step === "settle" ? "You don't owe anyone" : "Nobody owes you"}</strong>
                    <p>{step === "settle" ? "You're all square. Nice." : "When someone owes you, you can remind them here."}</p>
                  </div>
                );
              return (
                <>
                  {step === "settle" && (
                    <p className="mn-quick-note">
                      Recording payments isn&apos;t available yet. Here&apos;s who you owe — open a group to see details.
                    </p>
                  )}
                  <div className="mn-quick-list mn-quick-scroll">
                    {list.map((debt) =>
                      step === "settle" ? (
                        <QuickRow
                          key={debt.key}
                          initial={debt.name}
                          title={`You owe ${debt.name}`}
                          detail={debt.groupName}
                          amount={peso(debt.amount)}
                          tone="negative"
                          onClick={() => router.push(`/groups/${debt.groupId}`)}
                        />
                      ) : (
                        <QuickRow
                          key={debt.key}
                          initial={debt.name}
                          title={`${debt.name} owes you`}
                          detail={`${peso(debt.amount)} · ${debt.groupName}`}
                          tone="positive"
                          action="Remind"
                          onClick={() => void remind(debt)}
                        />
                      ),
                    )}
                  </div>
                  {notice && (
                    <p className="mn-quick-notice" role="status">
                      {notice}
                    </p>
                  )}
                </>
              );
            })()
          ))}
      </section>
    </>
  );
}

type RowProps = {
  title: string;
  detail?: string;
  icon?: React.ReactNode;
  emoji?: string;
  initial?: string;
  amount?: string;
  action?: string;
  tone?: "positive" | "negative";
  chevron?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

function QuickRow({ title, detail, icon, emoji, initial, amount, action, tone, chevron, disabled, onClick }: RowProps) {
  return (
    <button
      type="button"
      className={`mn-quick-row ${tone ? `is-${tone}` : ""}`}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
    >
      <span className={`mn-quick-icon ${initial ? "is-initial" : ""}`} aria-hidden="true">
        {icon ? <Svg>{icon}</Svg> : emoji ?? initial?.charAt(0).toUpperCase()}
      </span>
      <span className="mn-quick-text">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      {amount && <span className="mn-quick-amount">{amount}</span>}
      {action && <span className="mn-quick-action">{action}</span>}
      {chevron && (
        <span className="mn-quick-chevron">
          <Svg size={18}>{Icon.chevron}</Svg>
        </span>
      )}
    </button>
  );
}
