"use client";

import Image from "next/image";
import Link from "next/link";
import "./app-nav.css";

export type NavSection = "home" | "groups" | "history";

const ITEMS: Array<{ id: NavSection; href: string; label: string; icon: string }> = [
  { id: "home", href: "/dashboard", label: "Home", icon: "home" },
  { id: "groups", href: "/groups", label: "Groups", icon: "group" },
  { id: "history", href: "/history", label: "History", icon: "clock" },
];

type Props = {
  active?: NavSection;
  /** Opens the Add Expense flow. */
  onAdd: () => void;
};

/**
 * Main navigation. Desktop (≥768px): a left sidebar with the brand, links and
 * an Add Expense button. Phones: the floating bottom pill plus the + button.
 * Pages using it add the `mn-app-page` class to their <main>.
 */
export default function AppNav({ active, onAdd }: Props) {
  return (
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

      <button type="button" className="mn-nav-add" onClick={onAdd} aria-label="Add expense">
        <span aria-hidden="true">+</span>
        <span className="mn-nav-add-label">Add Expense</span>
      </button>
    </nav>
  );
}
