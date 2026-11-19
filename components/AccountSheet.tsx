"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invalidateGroupsData } from "@/lib/manemi/groups";
import { invalidateCurrentUser } from "@/lib/manemi/friends";
import { notifyDataChanged } from "@/lib/manemi/events";
import { useModalFocus } from "./useModalFocus";
import NotificationSettings from "./NotificationSettings";
import ProfileEditor from "./ProfileEditor";
import Avatar from "./Avatar";
import "./popups.css";

type Props = {
  name: string;
  email: string;
  handle?: string;
  avatarUrl?: string | null;
  onClose: () => void;
};

/** Account popup: bottom sheet on phones, centered dialog on desktop. */
export default function AccountSheet({ name: initialName, email, handle, avatarUrl: initialAvatar = null, onClose }: Props) {
  const router = useRouter();
  const ref = useModalFocus<HTMLElement>(onClose);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"main" | "notifications" | "profile">("main");
  const [userId, setUserId] = useState("");
  // Updated right away after a profile save.
  const [name, setName] = useState(initialName);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatar);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void createClient()
      .auth.getSession()
      .then(({ data }) => setUserId(data.session?.user.id ?? ""));
  }, []);

  async function logOut() {
    setSigningOut(true);
    setError("");
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) {
      setError(`Couldn't log out: ${signOutError.message}. Try again.`);
      setSigningOut(false);
      return;
    }
    invalidateGroupsData();
    invalidateCurrentUser();
    router.replace("/");
    router.refresh();
  }

  const subtitle = [handle ? `@${handle}` : "", email].filter(Boolean).join(" · ");

  return (
    <div className="mn-popup-backdrop mn-popup-sheet-backdrop" onClick={onClose}>
      <section
        ref={ref}
        className="mn-popup-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mn-popup-handle" aria-hidden="true" />
        <header className="mn-popup-sheet-header">
          {view !== "main" ? (
            <button type="button" className="mn-popup-done mn-popup-back" onClick={() => setView("main")}>
              ‹ Back
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          <h2 id="account-title">
            {view === "notifications" ? "Email notifications" : view === "profile" ? "Edit profile" : "Account"}
          </h2>
          <button type="button" className="mn-popup-done" onClick={onClose} data-autofocus>
            Done
          </button>
        </header>

        {view === "notifications" && userId ? (
          <NotificationSettings userId={userId} />
        ) : view === "profile" && userId ? (
          <ProfileEditor
            userId={userId}
            name={name}
            email={email}
            avatarUrl={avatarUrl}
            onCancel={() => setView("main")}
            onSaved={(saved) => {
              setName(saved.name);
              setAvatarUrl(saved.avatarUrl);
              invalidateCurrentUser();
              invalidateGroupsData();
              notifyDataChanged();
              setNotice("Profile updated.");
              setView("main");
            }}
          />
        ) : (
        <>
        <div className="mn-account-identity">
          <div className="mn-account-avatar" aria-hidden="true">
            <Avatar name={name} url={avatarUrl} />
          </div>
          <strong>{name}</strong>
          {subtitle && <span>{subtitle}</span>}
          {notice && (
            <p className="mn-account-notice" role="status">
              {notice}
            </p>
          )}
        </div>

        <div className="mn-account-list">
          <button
            type="button"
            className="mn-account-row-live"
            onClick={() => {
              setNotice("");
              setView("profile");
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
            <span>Edit profile</span>
            <svg className="mn-account-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
          <button type="button" className="mn-account-row-live" onClick={() => setView("notifications")}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6h16v12H4z" />
              <path d="m4 7 8 6 8-6" />
            </svg>
            <span>Email notifications</span>
            <svg className="mn-account-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>

        {error && (
          <p className="mn-popup-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="mn-account-logout" onClick={logOut} disabled={signingOut}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
          </svg>
          {signingOut ? "Logging Out…" : "Log Out"}
        </button>
        </>
        )}
      </section>
    </div>
  );
}
