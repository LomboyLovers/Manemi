"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./groups-enhanced.css";
import "./groups-navigation.css";
import "./groups-compact-navigation.css";
import "./groups-actions-sheet.css";
import "./groups-invitations.css";
import "./groups-balance-card.css";
import GroupsSkeleton from "@/components/GroupSkeleton";
import PageHeader, { HeaderButton } from "@/components/PageHeader";
import AppNav from "@/components/AppNav";
import {
  loadGroupsData,
  totalsFor,
  type CurrentUser,
  type GroupSummary,
} from "@/lib/manemi/groups";
import {
  greeting,
  isZero,
  peso,
} from "@/lib/manemi/format";

// ==========================================
// CUSTOM ICON COMPONENT
// Uses PNG files inside public/icons/
// ==========================================

type CustomIconProps = {
  name: string;
  size?: number;
  className?: string;
};

type GroupData = GroupSummary & { emoji: string };

/** Direction of a personal balance, per the design system rules. */
function balanceTone(net: number) {
  if (isZero(net)) return { tone: "zero", arrow: "✓", label: "Settled up" };
  return net > 0
    ? { tone: "positive", arrow: "↙", label: "You're owed" }
    : { tone: "negative", arrow: "↗", label: "You owe" };
}

function CustomIcon({ name, size = 20, className = "" }: CustomIconProps) {
  return (
    <Image
      src={`/icons/${name}.png`}
      alt=""
      width={size}
      height={size}
      className={className}
    />
  );
}

// ==========================================
// GROUPS PAGE
// ==========================================

export default function GroupsPage() {
  const [search, setSearch] = useState("");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupCategory, setGroupCategory] = useState("Travel");
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [groupEmoji, setGroupEmoji] = useState("🇯🇵");
  const [groupCurrency, setGroupCurrency] = useState("PHP");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [initialPageLoading, setInitialPageLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const [refreshGroups, setRefreshGroups] = useState(0);
  const [activeFilter, setActiveFilter] = useState("All");
  const [groupMenu, setGroupMenu] = useState<string | null>(null);
  const [archiveGroupId, setArchiveGroupId] = useState<string | null>(null);
  const [archivingGroup, setArchivingGroup] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [createdGroup, setCreatedGroup] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteResults, setInviteResults] = useState<
    Array<{ email: string; status: string }>
  >([]);
  const [inviteError, setInviteError] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [shareGroup, setShareGroup] = useState<{
    id: string;
    name: string;
    code: string;
  } | null>(null);
  const [shareError, setShareError] = useState("");
  const [loadingShare, setLoadingShare] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const selectedGroup = groups.find((group) => group.id === groupMenu);
  const archiveGroup = groups.find((group) => group.id === archiveGroupId);

  const categories = [
    { name: "Travel", emoji: "✈️" },
    { name: "Roommates", emoji: "🏠" },
    { name: "Group Dinners", emoji: "🍽️" },
    { name: "Events", emoji: "🎉" },
    { name: "Other", emoji: "📦" },
  ];

  const router = useRouter();

  function getInviteCode(input: string): string {
    const value = input.trim();
    if (!value) return "";
    try {
      const url = new URL(value);
      const code =
        url.searchParams.get("code") || url.searchParams.get("inviteCode");
      if (code) return code.trim();
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[0] === "join") return parts[1];
      return "";
    } catch {
      if (/^(https?:\/\/|www\.|\/)/i.test(value) || /[/?#\s]/.test(value))
        return "";
      return value;
    }
  }

  function invitationLink(code: string): string {
    if (typeof window === "undefined")
      return `/join?code=${encodeURIComponent(code)}`;
    return `${window.location.origin}/join?code=${encodeURIComponent(code)}`;
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage("Copied to clipboard");
    } catch {
      setCopyMessage("Copy failed. Please select and copy the link.");
    }
  }

  async function shareInvite(code: string, name: string) {
    const link = invitationLink(code);
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${name} on Manemi`,
          text: `You have been invited to ${name}. Sign in with your invited email.`,
          url: link,
        });
      } catch (error) {
        if ((error as Error)?.name !== "AbortError")
          setCopyMessage("Unable to share. You can copy the link instead.");
      }
    } else {
      await copyText(link);
    }
  }

  async function openShareGroup(id: string, name: string) {
    setGroupMenu(null);
    setShareError("");
    setCopyMessage("");
    setLoadingShare(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("Group")
        .select("groupId, name, inviteCode, inviteCodeExpiresAt, isArchived")
        .eq("groupId", id)
        .single();
      if (error) throw error;
      if (!data?.inviteCode)
        throw new Error("No invitation code is available for this group.");
      if (data.isArchived)
        throw new Error("Archived groups cannot accept invitations.");
      if (
        data.inviteCodeExpiresAt &&
        new Date(data.inviteCodeExpiresAt).getTime() < Date.now()
      ) {
        throw new Error("This group's invitation code has expired.");
      }
      setShareGroup({ id, name, code: data.inviteCode });
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : "Unable to load the invitation link.",
      );
    } finally {
      setLoadingShare(false);
    }
  }

  async function handleJoinGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const inviteCode = getInviteCode(joinInput);
    if (!inviteCode || inviteCode.length > 20 || joining) {
      setJoinError(
        "This link isn't complete or has expired. Ask the group admin to send a new one.",
      );
      return;
    }
    setJoining(true);
    setJoinError("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("join-group", {
        body: { inviteCode },
      });
      if (error || data?.error) {
        let message = data?.error || error?.message || "Unable to join group.";
        if (error && "context" in error && error.context instanceof Response) {
          const response = await error.context.json().catch(() => null);
          if (response?.error) message = response.error;
        }
        throw new Error(message);
      }
      setShowJoinModal(false);
      setJoinInput("");
      setRefreshGroups((previous) => previous + 1);
      const groupId = data?.group?.groupId;
      if (typeof groupId === "string") router.push(`/groups/${groupId}`);
    } catch (error) {
      setJoinError(
        error instanceof Error ? error.message : "Unable to join group.",
      );
    } finally {
      setJoining(false);
    }
  }

  async function handleInviteMembers(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteGroupId || inviteSending) return;
    const emails = [
      ...new Set(
        inviteEmails
          .split(/[\s,;]+/)
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (
      !emails.length ||
      emails.length > 10 ||
      emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      setInviteError(
        "Enter 1 to 10 valid email addresses, separated by commas.",
      );
      return;
    }
    setInviteSending(true);
    setInviteError("");
    setInviteResults([]);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        "invite-members",
        {
          body: { groupId: inviteGroupId, emails },
        },
      );
      if (error || data?.error) {
        let message =
          data?.error || error?.message || "Unable to send invitations.";
        if (error && "context" in error && error.context instanceof Response) {
          const response = await error.context.json().catch(() => null);
          if (response?.error) message = response.error;
          if (Array.isArray(response?.results))
            setInviteResults(response.results);
        }
        throw new Error(message);
      }
      setInviteResults(Array.isArray(data?.results) ? data.results : []);
      setInviteEmails("");
    } catch (error) {
      setInviteError(
        error instanceof Error ? error.message : "Unable to send invitations.",
      );
    } finally {
      setInviteSending(false);
    }
  }

  async function handleArchiveGroup() {
    if (
      !archiveGroup ||
      !archiveGroup.isCreator ||
      archiveGroup.status !== "active" ||
      archivingGroup
    )
      return;

    setArchivingGroup(true);
    setArchiveError("");
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Please log in again.");

      const { data, error } = await supabase
        .from("Group")
        .update({ isArchived: true })
        .eq("groupId", archiveGroup.id)
        .eq("createdBy", user.id)
        .eq("isArchived", false)
        .select("groupId")
        .maybeSingle();

      if (error) throw error;
      if (!data)
        throw new Error(
          "Group was not archived. Check that you are its creator and it is still active.",
        );

      setArchiveGroupId(null);
      setRefreshGroups((previous) => previous + 1);
    } catch (error) {
      setArchiveError(
        error instanceof Error
          ? error.message
          : "Unable to archive group. Please try again.",
      );
    } finally {
      setArchivingGroup(false);
    }
  }

  async function handleCreateGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!groupName.trim() || creatingGroup) return;

    setCreatingGroup(true);
    setCreateGroupError("");

    try {
      const supabase = createClient();

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setCreateGroupError("Please log in again.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-group", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          name: groupName.trim(),
        },
      });

      if (error) {
        setCreateGroupError(error.message);
        console.error("Create group error:", error);
        return;
      }

      console.log("Group created:", data);
      // The Edge Function may return either { group: {...} } or the group directly.
      const resultGroup = data?.group ?? data;
      let newId: string | undefined = resultGroup?.groupId ?? resultGroup?.id;
      let newCode: string | undefined = resultGroup?.inviteCode;
      // Fallback for create-group functions that return only a success message.
      if (!newId || !newCode) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: latest } = await supabase
            .from("Group")
            .select("groupId, inviteCode")
            .eq("createdBy", user.id)
            .eq("name", groupName.trim())
            .order("createdAt", { ascending: false })
            .limit(1)
            .maybeSingle();
          newId = newId ?? latest?.groupId;
          newCode = newCode ?? latest?.inviteCode;
        }
      }
      if (newId)
        setCreatedGroup({
          id: newId,
          name: groupName.trim(),
          code: newCode ?? "",
        });

      setShowCreateModal(false);
      setGroupName("");
      setGroupCategory("Travel");
      setGroupEmoji("🇯🇵");
      setGroupCurrency("PHP");

      setRefreshGroups((previous) => previous + 1);
      if (!newId)
        setShareError(
          "Group created. Open its actions menu to invite members.",
        );
    } catch (error) {
      console.error(error);
      setCreateGroupError("Unable to create group. Please try again.");
    } finally {
      setCreatingGroup(false);
    }
  }

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      setJoinInput(code);
      setJoinError("");
      setShowJoinModal(true);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadGroups() {
      try {
        const result = await loadGroupsData(createClient());
        if (!active) return;
        if (result) {
          setUser(result.user);
          setGroups(result.groups.map((group) => ({ ...group, emoji: "📦" })));
          setGroupsError(
            result.warnings.length
              ? `Some details could not be loaded: ${result.warnings.join("; ")}`
              : "",
          );
        }
      } catch (error) {
        if (!active) return;
        setGroupsError(
          error instanceof Error ? error.message : "Unable to load groups.",
        );
      } finally {
        if (active) {
          setLoadingGroups(false);
          setInitialPageLoading(false);
        }
      }
    }

    void loadGroups();

    return () => {
      active = false;
    };
  }, [refreshGroups]);

  // Search runs in memory: no network calls while typing.
  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? groups.filter((group) => group.name.toLowerCase().includes(query))
      : groups;
  }, [groups, search]);

  const totals = useMemo(() => totalsFor(groups), [groups]);
  const netTone = balanceTone(totals.net);
  if (initialPageLoading) {
    return (
      <main className="manemi-groups-page mn-app-page">
        <div className="groups-page-content">
          <GroupsSkeleton />
        </div>
        <AppNav active="groups" />
      </main>
    );
  }
  return (
    <main className="manemi-groups-page mn-app-page">
      <div className="groups-page-content">
        {/* HEADER */}
        {loadingGroups || groups.length > 0 || Boolean(search) ? (
          <>
            <PageHeader user={user}>
              <HeaderButton label="Join group" onClick={() => setShowJoinModal(true)}>
                <CustomIcon name="group" size={22} />
              </HeaderButton>
              <HeaderButton
                label="Search groups"
                onClick={() => document.getElementById("manemi-rich-search")?.focus()}
              >
                <CustomIcon name="search" size={22} />
              </HeaderButton>
            </PageHeader>
            <div className="manemi-rich-heading">
              <h1>Groups</h1>
              <p>Manage peer-to-peer debts within your circles.</p>
            </div>
            {
              <>
                <section
                  className="manemi-rich-balances"
                  aria-label="Global balances"
                >
                  <h2>GLOBAL BALANCES</h2>
                  <div
                    className={`manemi-net-balance manemi-tone-${netTone.tone}`}
                    aria-live="polite"
                  >
                    <span className="manemi-net-label">
                      Personal net balance
                    </span>
                    <strong>
                      {loadingGroups
                        ? "—"
                        : `${totals.net < 0 && !isZero(totals.net) ? "−" : ""}${peso(Math.abs(totals.net))}`}
                    </strong>
                    <small>
                      <span aria-hidden="true">{netTone.arrow}</span>{" "}
                      {isZero(totals.net)
                        ? "You're all square across your groups"
                        : totals.net > 0
                          ? "Overall, you're owed money"
                          : "Overall, you owe money"}
                      {` · ${groups.length} ${groups.length === 1 ? "group" : "groups"}`}
                    </small>
                  </div>
                  <div className="manemi-rich-balance-grid">
                    <div className="manemi-rich-balance-box">
                      <span>Total collectible</span>
                      <strong className="manemi-rich-green">
                        {peso(totals.owedToYou)}
                      </strong>
                      <small>
                        <span aria-hidden="true">↙</span> Owed to you
                      </small>
                    </div>
                    <div className="manemi-rich-balance-box">
                      <span>Total debt</span>
                      <strong className="manemi-rich-red">
                        {peso(totals.youOwe)}
                      </strong>
                      <small className="manemi-rich-red">
                        <span aria-hidden="true">↗</span> You owe
                      </small>
                    </div>
                  </div>
                </section>
              </>
            }
            <div className="manemi-rich-filter-list" aria-label="Filter groups">
              {["All", ...categories.map((category) => category.name)].map(
                (category) => (
                  <button
                    key={category}
                    type="button"
                    className={`manemi-rich-filter ${activeFilter === category ? "selected" : ""}`}
                    onClick={() => setActiveFilter(category)}
                  >
                    {category}
                  </button>
                ),
              )}
            </div>
            <div className="manemi-rich-search-row">
              <CustomIcon name="search" size={18} />
              <input
                id="manemi-rich-search"
                type="search"
                placeholder="Search your groups"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="manemi-search-clear"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  ×
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <PageHeader user={user} />
            <section className="groups-page-greeting">
              <h1>
                {greeting()},
                <br />
                {user?.name.split(" ")[0] || "there"}
              </h1>
              <p>Here&apos;s what&apos;s happening with your money.</p>
            </section>
            <div className="groups-page-search">
              <CustomIcon name="search" size={18} />
              <input
                type="search"
                placeholder="Search groups or expenses"
                aria-label="Search groups or expenses"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </>
        )}

        {/* EMPTY GROUPS STATE / CREATED GROUPS */}

        {groupsError && (
          <p role="alert" className="manemi-rich-load-error">
            Could not load groups: {groupsError}
          </p>
        )}
        {loadingGroups ? (
          <section className="manemi-rich-group-section">
            <h2>ACTIVE GROUPS</h2>
            <div className="manemi-rich-group-grid" aria-busy="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <article
                  key={index}
                  className="manemi-rich-group-card"
                  aria-hidden="true"
                >
                  <div className="manemi-card-skeleton-icon" />
                  <div className="manemi-card-skeleton-title" />
                  <div className="manemi-card-skeleton-text" />
                  <div className="manemi-card-skeleton-balance" />
                </article>
              ))}
            </div>
          </section>
        ) : groups.length === 0 && !search ? (
          <section className="groups-empty-state">
            <div className="groups-empty-icon-circle">
              <CustomIcon
                name="no-groups"
                size={52}
                className="groups-empty-icon"
              />
            </div>

            <h2>No Groups Yet</h2>

            <p>
              Create a new group or join one to
              <br className="groups-mobile-break" />
              start tracking shared expenses.
            </p>

            <div className="groups-action-buttons">
              <button
                type="button"
                className="groups-create-button"
                onClick={() => setShowCreateModal(true)}
              >
                Create Group
              </button>

              <button
                type="button"
                className="groups-join-button"
                onClick={() => setShowJoinModal(true)}
              >
                Join Group
              </button>
            </div>
          </section>
        ) : (
          <>
            {activeFilter !== "All" && (
              <p className="manemi-rich-filter-note">
                Categories are not saved yet. Choose All to see every group.
              </p>
            )}
            {visibleGroups.length === 0 && search && (
              <p className="manemi-rich-filter-note">
                No groups match your search.
              </p>
            )}
            {(
              [
                { status: "active", label: "ACTIVE" },
                { status: "settled", label: "SETTLED" },
                { status: "unsettled", label: "UNSETTLED" },
              ] as const
            ).map((section) => {
              const sectionGroups = visibleGroups.filter(
                (group) => group.status === section.status,
              );
              // Only Active is always shown; empty Settled/Unsettled are hidden.
              if (section.status !== "active" && sectionGroups.length === 0)
                return null;
              return (
                <section
                  className="manemi-rich-group-section"
                  key={section.status}
                >
                  <h2>
                    {section.label} · {sectionGroups.length}
                  </h2>
                  <div className="manemi-rich-group-grid">
                    {(activeFilter === "All" ? sectionGroups : []).map(
                      (group) => (
                        <article
                          className="manemi-rich-group-card"
                          key={group.id}
                          onClick={() => router.push(`/groups/${group.id}`)}
                          onKeyDown={(event) => {
                            if (
                              event.target === event.currentTarget &&
                              (event.key === "Enter" || event.key === " ")
                            ) {
                              event.preventDefault();
                              router.push(`/groups/${group.id}`);
                            }
                          }}
                          role="link"
                          tabIndex={0}
                          aria-label={`Open ${group.name} details`}
                        >
                          <div className="manemi-rich-card-top">
                            <span
                              className="manemi-rich-group-emoji"
                              aria-hidden="true"
                            >
                              {group.emoji}
                            </span>
                            <div className="manemi-rich-card-menu-wrap">
                              <button
                                type="button"
                                className="manemi-rich-dots"
                                aria-label={`Options for ${group.name}`}
                                aria-expanded={groupMenu === group.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setGroupMenu(
                                    groupMenu === group.id ? null : group.id,
                                  );
                                }}
                              >
                                •••
                              </button>
                            </div>
                          </div>
                          <h3>{group.name}</h3>
                          <p className="manemi-rich-members">
                            {group.members} members ·{" "}
                            {group.isCreator ? "Admin" : "Member"}
                          </p>
                          <div className="manemi-card-body">
                            {(() => {
                              const tone =
                                group.status === "settled"
                                  ? { tone: "zero", arrow: "✓", label: "Settled" }
                                  : balanceTone(group.net);
                              return (
                                <div
                                  className={`manemi-rich-card-balance manemi-tone-${tone.tone}`}
                                >
                                  <span className="manemi-card-overline">
                                    Total Balance
                                  </span>
                                  <strong>{peso(Math.abs(group.net))}</strong>
                                  <span className="manemi-card-direction">
                                    <span aria-hidden="true">{tone.arrow}</span>{" "}
                                    {tone.label}
                                  </span>
                                  <small>
                                    {group.status === "active"
                                      ? "Active group"
                                      : group.status === "settled"
                                        ? "All balances paid"
                                        : "Outstanding group balances"}
                                  </small>
                                </div>
                              );
                            })()}

                            <div
                              className="manemi-card-breakdown"
                              aria-label={`Balance breakdown for ${group.name}`}
                            >
                              <span className="manemi-card-overline">
                                Breakdown
                              </span>
                              {group.counterparties.length === 0 ? (
                                <p className="manemi-breakdown-empty">
                                  {group.expenseCount === 0
                                    ? "No expenses yet"
                                    : "You're square with everyone"}
                                </p>
                              ) : (
                                <ul className="manemi-breakdown-list">
                                  {group.counterparties.slice(0, 3).map((person) => (
                                    <li
                                      key={person.userId}
                                      className={
                                        person.amount > 0
                                          ? "manemi-debt-in"
                                          : "manemi-debt-out"
                                      }
                                    >
                                      <span className="manemi-debt-text">
                                        <span aria-hidden="true">
                                          {person.amount > 0 ? "↙" : "↗"}
                                        </span>{" "}
                                        {person.amount > 0 ? (
                                          <>
                                            <b>{person.name}</b> owes you
                                          </>
                                        ) : (
                                          <>
                                            You owe <b>{person.name}</b>
                                          </>
                                        )}
                                      </span>
                                      <strong>{peso(Math.abs(person.amount))}</strong>
                                    </li>
                                  ))}
                                  {group.counterparties.length > 3 && (
                                    <li className="manemi-breakdown-more">
                                      +{group.counterparties.length - 3} more in
                                      this group
                                    </li>
                                  )}
                                </ul>
                              )}
                              {group.expenseCount > 0 && (
                                <p className="manemi-breakdown-spent">
                                  {peso(group.spent)} spent ·{" "}
                                  {group.expenseCount}{" "}
                                  {group.expenseCount === 1 ? "expense" : "expenses"}
                                </p>
                              )}
                            </div>
                          </div>
                        </article>
                      ),
                    )}
                  </div>
                </section>
              );
            })}
            <button
              type="button"
              className="manemi-rich-create-another"
              onClick={() => setShowCreateModal(true)}
            >
              + Create Another Group
            </button>
          </>
        )}
      </div>

      <AppNav active="groups" groups={groups} />

      {/* GROUP ACTIONS BOTTOM SHEET */}
      {selectedGroup && (
        <div
          className="manemi-actions-overlay"
          onClick={() => setGroupMenu(null)}
        >
          <section
            className="manemi-actions-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manemi-actions-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="manemi-actions-handle" aria-hidden="true" />
            <header className="manemi-actions-heading">
              <span className="manemi-actions-emoji" aria-hidden="true">
                {selectedGroup.emoji}
              </span>
              <div>
                <h2 id="manemi-actions-title">{selectedGroup.name}</h2>
                <p>
                  {selectedGroup.isCreator ? "Group admin" : "Group member"}
                </p>
              </div>
              <span className="manemi-actions-admin">
                {selectedGroup.isCreator ? "Admin" : "Member"}
              </span>
            </header>
            <div className="manemi-actions-list">
              {[
                { label: "Share Invite Link", icon: "link" },
                { label: "Manage Members", icon: "users" },
              ].map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setGroupMenu(null);
                    if (action.label === "Share Invite Link") {
                      void openShareGroup(selectedGroup.id, selectedGroup.name);
                    } else {
                      setInviteGroupId(selectedGroup.id);
                      setInviteResults([]);
                      setInviteError("");
                    }
                  }}
                >
                  <span className="manemi-action-symbol" aria-hidden="true">
                    {action.icon === "link" ? "🔗" : "♧"}
                  </span>
                  {action.label}
                  <span className="manemi-action-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
            <div className="manemi-actions-list manemi-actions-danger">
              {selectedGroup.isCreator ? (
                selectedGroup.status === "active" && (
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveGroupId(selectedGroup.id);
                      setGroupMenu(null);
                    }}
                  >
                    <span className="manemi-action-symbol" aria-hidden="true">
                      ▤
                    </span>
                    Archive Group
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setGroupMenu(null);
                    alert(
                      "Leave Group will be connected after membership permissions are implemented.",
                    );
                  }}
                >
                  <span className="manemi-action-symbol" aria-hidden="true">
                    ⇥
                  </span>
                  Leave Group
                </button>
              )}
            </div>
            <button
              className="manemi-actions-cancel"
              type="button"
              onClick={() => setGroupMenu(null)}
            >
              Cancel
            </button>
          </section>
        </div>
      )}

      {/* ARCHIVE GROUP CONFIRMATION */}
      {archiveGroup &&
        archiveGroup.isCreator &&
        archiveGroup.status === "active" && (
          <div
            className="manemi-actions-overlay"
            onClick={() => {
              if (!archivingGroup) setArchiveGroupId(null);
            }}
          >
            <section
              className="manemi-actions-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manemi-archive-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="manemi-actions-handle" aria-hidden="true" />
              <header className="manemi-actions-heading">
                <span className="manemi-actions-emoji" aria-hidden="true">
                  {archiveGroup.emoji}
                </span>
                <div>
                  <h2 id="manemi-archive-title">Archive Group?</h2>
                  <p>{archiveGroup.name}</p>
                </div>
              </header>
              <p style={{ padding: "12px 4px 20px", lineHeight: 1.5 }}>
                Archiving will move this group out of Active. Its expenses,
                members, and settlements will remain saved.
              </p>
              <div className="manemi-actions-list">
                <button
                  type="button"
                  onClick={handleArchiveGroup}
                  disabled={archivingGroup}
                >
                  <span className="manemi-action-symbol" aria-hidden="true">
                    ▤
                  </span>
                  {archivingGroup
                    ? "Archiving Group..."
                    : "Confirm Archive Group"}
                </button>
              </div>
              {archiveError && (
                <p
                  role="alert"
                  style={{ color: "#ff8585", padding: "8px 4px" }}
                >
                  {archiveError}
                </p>
              )}
              <button
                type="button"
                className="manemi-actions-cancel"
                disabled={archivingGroup}
                onClick={() => setArchiveGroupId(null)}
              >
                Cancel
              </button>
            </section>
          </div>
        )}

      {/* JOIN GROUP BOTTOM SHEET */}
      {showJoinModal && (
        <div
          className="manemi-invite-overlay"
          onClick={() => !joining && setShowJoinModal(false)}
        >
          <section
            className="manemi-invite-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-group-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="manemi-invite-handle" />
            <header className="manemi-invite-top">
              <button
                type="button"
                disabled={joining}
                onClick={() => setShowJoinModal(false)}
              >
                Cancel
              </button>
              <h2 id="join-group-title">Join Group</h2>
              <span />
            </header>
            <div className="manemi-invite-hero">
              <div className="manemi-invite-icon">♧</div>
              <h3>Join a group</h3>
              <p>
                Paste the invite link or code a group admin shared with you. You
                must sign in using the email address they invited.
              </p>
            </div>
            <form onSubmit={handleJoinGroup}>
              <label htmlFor="manemi-join-code">Invite link or code</label>
              <div
                className={`manemi-invite-input-row ${joinError ? "has-error" : ""}`}
              >
                <input
                  id="manemi-join-code"
                  autoComplete="off"
                  placeholder="Paste invite link or code"
                  value={joinInput}
                  onChange={(event) => {
                    setJoinInput(event.target.value);
                    setJoinError("");
                  }}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setJoinInput(await navigator.clipboard.readText());
                      setJoinError("");
                    } catch {
                      setJoinError(
                        "Clipboard access is unavailable. Paste the code manually.",
                      );
                    }
                  }}
                >
                  Paste
                </button>
              </div>
              {joinError && (
                <p className="manemi-invite-error" role="alert">
                  {joinError}
                </p>
              )}
              <button
                className="manemi-invite-primary"
                type="submit"
                disabled={!getInviteCode(joinInput) || joining}
              >
                {joining ? "Joining Group..." : "Join Group"}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* INVITE MEMBERS BY EMAIL */}
      {inviteGroupId && (
        <div
          className="manemi-invite-overlay"
          onClick={() => !inviteSending && setInviteGroupId(null)}
        >
          <section
            className="manemi-invite-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-members-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="manemi-invite-handle" />
            <header className="manemi-invite-top">
              <button
                type="button"
                disabled={inviteSending}
                onClick={() => setInviteGroupId(null)}
              >
                Cancel
              </button>
              <h2 id="invite-members-title">Invite Members</h2>
              <span />
            </header>
            <div className="manemi-invite-hero">
              <div className="manemi-invite-icon">✉</div>
              <h3>Invite by email</h3>
              <p>
                Only invited email addresses can join. Send invitations to up to
                10 people at once.
              </p>
            </div>
            <form onSubmit={handleInviteMembers}>
              <label htmlFor="manemi-invite-emails">Email addresses</label>
              <textarea
                id="manemi-invite-emails"
                rows={3}
                placeholder="friend@example.com, another@example.com"
                value={inviteEmails}
                onChange={(event) => setInviteEmails(event.target.value)}
              />
              {inviteError && (
                <p className="manemi-invite-error" role="alert">
                  {inviteError}
                </p>
              )}
              {inviteResults.length > 0 && (
                <div className="manemi-invite-results" aria-live="polite">
                  {inviteResults.map((result) => (
                    <p key={result.email}>
                      {result.email}:{" "}
                      {result.status === "sent"
                        ? "Invitation sent"
                        : result.status === "already_member"
                          ? "Already a member"
                          : "Sending failed"}
                    </p>
                  ))}
                </div>
              )}
              <button
                className="manemi-invite-primary"
                type="submit"
                disabled={!inviteEmails.trim() || inviteSending}
              >
                {inviteSending ? "Sending Invitations..." : "Send Invitations"}
              </button>
            </form>
          </section>
        </div>
      )}

      {/* GROUP CREATED AND SHARE INVITE LINK */}
      {(createdGroup || shareGroup) &&
        (() => {
          const target = createdGroup || shareGroup!;
          return (
            <div
              className="manemi-invite-overlay"
              onClick={() => {
                setCreatedGroup(null);
                setShareGroup(null);
                setCopyMessage("");
              }}
            >
              <section
                className="manemi-invite-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-invite-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="manemi-invite-handle" />
                <div className="manemi-invite-hero">
                  <div className="manemi-invite-icon">✓</div>
                  <h2 id="share-invite-title">
                    {createdGroup
                      ? `${target.name} is ready`
                      : `Invite to ${target.name}`}
                  </h2>
                  <p>
                    Invite friends by email first. Only invited email addresses
                    can join using this link.
                  </p>
                </div>
                {target.code && (
                  <>
                    <label>Group link</label>
                    <div className="manemi-invite-link">
                      <span>{invitationLink(target.code)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(invitationLink(target.code))
                        }
                      >
                        Copy
                      </button>
                    </div>
                  </>
                )}
                {copyMessage && (
                  <p className="manemi-invite-feedback" role="status">
                    {copyMessage}
                  </p>
                )}
                <button
                  type="button"
                  className="manemi-invite-primary"
                  onClick={() => {
                    setCreatedGroup(null);
                    setShareGroup(null);
                    setInviteGroupId(target.id);
                    setInviteResults([]);
                    setInviteError("");
                  }}
                >
                  Invite Members by Email
                </button>
                {target.code && (
                  <button
                    type="button"
                    className="manemi-invite-secondary"
                    onClick={() => void shareInvite(target.code, target.name)}
                  >
                    Share Invite Link
                  </button>
                )}
                <button
                  type="button"
                  className="manemi-invite-secondary"
                  onClick={() => {
                    setCreatedGroup(null);
                    setShareGroup(null);
                    router.push(`/groups/${target.id}`);
                  }}
                >
                  Go to Group
                </button>
              </section>
            </div>
          );
        })()}
      {(loadingShare || shareError) && !shareGroup && (
        <div
          className="manemi-invite-overlay"
          onClick={() => {
            if (!loadingShare) setShareError("");
          }}
        >
          <section
            className="manemi-invite-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Invitation link"
            onClick={(event) => event.stopPropagation()}
          >
            <p>{loadingShare ? "Loading invitation link..." : shareError}</p>
            <button
              className="manemi-invite-secondary"
              type="button"
              onClick={() => setShareError("")}
            >
              Close
            </button>
          </section>
        </div>
      )}


      {/* CREATE GROUP BOTTOM SHEET */}
      {showCreateModal && (
        <div
          className="new-group-overlay"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="new-group-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-group-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="new-group-handle" />
            <div className="new-group-header">
              <button
                type="button"
                className="new-group-cancel"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <h2 id="new-group-title">New Group</h2>
              <div className="new-group-header-spacer" />
            </div>

            <form onSubmit={handleCreateGroup}>
              <div className="new-group-name-row">
                <div className="new-group-icon-field">
                  <label htmlFor="new-group-icon">Icon</label>
                  <select
                    id="new-group-icon"
                    className="new-group-emoji-select"
                    value={groupEmoji}
                    onChange={(event) => setGroupEmoji(event.target.value)}
                  >
                    <option value="🇯🇵">🇯🇵</option>
                    <option value="🇰🇷">🇰🇷</option>
                    <option value="🏠">🏠</option>
                    <option value="✈️">✈️</option>
                    <option value="🎉">🎉</option>
                    <option value="🍽️">🍽️</option>
                    <option value="📦">📦</option>
                  </select>
                </div>
                <div className="new-group-name-field">
                  <label htmlFor="new-group-name">Group name</label>
                  <input
                    id="new-group-name"
                    type="text"
                    placeholder="Japan 2026"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    maxLength={60}
                    required
                  />
                </div>
              </div>

              <div className="new-group-category-field">
                <label>Category</label>
                <div className="new-group-categories">
                  {categories.map((category) => (
                    <button
                      key={category.name}
                      type="button"
                      className={`new-group-category-chip ${groupCategory === category.name ? "active" : ""}`}
                      onClick={() => setGroupCategory(category.name)}
                      aria-pressed={groupCategory === category.name}
                    >
                      <span>{category.emoji}</span> {category.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="new-group-currency-field">
                <label htmlFor="new-group-currency">Currency</label>
                <select
                  id="new-group-currency"
                  value={groupCurrency}
                  onChange={(event) => setGroupCurrency(event.target.value)}
                >
                  <option value="PHP">Philippine Peso (₱)</option>
                  <option value="USD">US Dollar ($)</option>
                  <option value="EUR">Euro (€)</option>
                  <option value="JPY">Japanese Yen (¥)</option>
                  <option value="KRW">Korean Won (₩)</option>
                </select>
              </div>
              <p className="new-group-info">
                <span aria-hidden="true">ⓘ</span> You'll be the group admin.
                Invite members after creating it.
              </p>
              <button
                type="submit"
                className="new-group-submit"
                disabled={!groupName.trim() || creatingGroup}
              >
                {creatingGroup ? "Creating Group..." : "Create Group"}
              </button>
              {createGroupError && (
                <p role="alert" className="new-group-error">
                  {createGroupError}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
