"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { GroupSummary } from "@/lib/manemi/groups";
import QuickActions from "./QuickActions";
import "./app-nav.css";

export type NavSection = "home" | "groups" | "history";

const ITEMS: Array<{ id: NavSection; href: string; label: string; icon: string }> = [
  { id: "home", href: "/dashboard", label: "Home", icon: "home" },
  { id: "groups", href: "/groups", label: "Groups", icon: "group" },
  { id: "history", href: "/history", label: "History", icon: "clock" },
];

type Props = {
  active?: NavSection;
  /** Groups the page already loaded (used by quick actions). */
  groups?: GroupSummary[];
};

/**
 * Main navigation. Desktop (≥768px): left sidebar with brand, links and an
 * Add Expense button. Phones: floating bottom pill plus the round + button.
 * The + opens the quick actions popup and turns into ✕ while it's open.
 * Pages using it add the `mn-app-page` class to their <main>.
 */
export default function AppNav({ active, groups }: Props) {
  const [quickOpen, setQuickOpen] = useState(false);

  return (
    <>
      <nav className="mn-nav" aria-label="Main navigation">
        <Link href="/dashboard" className="mn-nav-brand" aria-label="Manemi home">
          <Image src="/Logo_manemi.svg" alt="" width={32} height={32} />
          <span>Manemi</span>
        </Link>

        <div className="mn-nav-links">
          {ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={`mn-nav-link ${active === item.id ? "is-active" : ""}`}
              aria-current={active === item.id ? "page" : undefined}
            >
              <Image src={`/icons/${item.icon}.png`} alt="" width={20} height={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        <button
          type="button"
          className={`mn-nav-add ${quickOpen ? "is-open" : ""}`}
          onClick={() => setQuickOpen((open) => !open)}
          aria-label={quickOpen ? "Close quick actions" : "Quick actions"}
          aria-expanded={quickOpen}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">{quickOpen ? "×" : "+"}</span>
          <span className="mn-nav-add-label">{quickOpen ? "Close" : "Add Expense"}</span>
        </button>
      </nav>

      {quickOpen && <QuickActions groups={groups} onClose={() => setQuickOpen(false)} />}
    </>
  );
}
