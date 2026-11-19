"use client";

import { useState } from "react";
import type { CurrentUser } from "@/lib/manemi/groups";
import { initialOf } from "@/lib/manemi/format";
import AccountSheet from "./AccountSheet";
import NotificationsBell from "./NotificationsBell";
import "./popups.css";

type Props = {
  user: CurrentUser | null;
  /** Page-specific buttons shown before the bell. */
  children?: React.ReactNode;
  showBell?: boolean;
  /** Called after a notification is acted on (e.g. invitation accepted). */
  onNotificationsChange?: () => void;
};

/** Avatar (opens Account) on the left; page actions and the bell on the right. */
export default function PageHeader({
  user,
  children,
  showBell = true,
  onNotificationsChange,
}: Props) {
  const [accountOpen, setAccountOpen] = useState(false);

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
        {showBell && <NotificationsBell onChange={onNotificationsChange} />}
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
