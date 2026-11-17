"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { CurrentUser } from "@/lib/manemi/groups";
import { initialOf } from "@/lib/manemi/format";
import AccountSheet from "./AccountSheet";
import "./popups.css";

type Props = {
  user: CurrentUser | null;
  /** Page-specific buttons shown before the bell. */
  children?: React.ReactNode;
  showBell?: boolean;
};

/** Avatar (opens Account) on the left; page actions and the bell on the right. */
export default function PageHeader({ user, children, showBell = true }: Props) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const bellButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!bellOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!bellRef.current?.contains(event.target as Node)) setBellOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBellOpen(false);
        bellButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [bellOpen]);

  return (
    <header className="mn-page-header">
      <button
        type="button"
        className="mn-header-avatar"
        aria-label={user ? `Account: ${user.name}` : "Account"}
        aria-haspopup="dialog"
        onClick={() => setAccountOpen(true)}
        disabled={!user}
      >
        {initialOf(user?.name || "?")}
      </button>

      <div className="mn-header-actions">
        {children}
        {showBell && (
          <div className="mn-header-bell" ref={bellRef}>
            <button
              ref={bellButton}
              type="button"
              className="mn-header-circle"
              aria-label="Notifications"
              title="Notifications"
              aria-expanded={bellOpen}
              onClick={() => setBellOpen((open) => !open)}
            >
              <Image src="/icons/bell.png" alt="" width={20} height={20} />
            </button>
            {bellOpen && (
              <div className="mn-header-popover" role="status">
                No new notifications
              </div>
            )}
          </div>
        )}
      </div>

      {accountOpen && user && (
        <AccountSheet
          name={user.name}
          email={user.email}
          handle={user.handle}
          onClose={() => setAccountOpen(false)}
        />
      )}
    </header>
  );
}

/** Round 48px header button for page-specific actions (join, search, filter…). */
export function HeaderButton({
  label,
  onClick,
  children,
  expanded,
  buttonRef,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  expanded?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  active?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`mn-header-circle ${active ? "is-on" : ""}`}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
