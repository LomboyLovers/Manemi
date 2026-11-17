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
import InviteFriendsSheet from "@/components/InviteFriendsSheet";
import LeaveGroupDialog, { type LeaveBalance } from "@/components/LeaveGroupDialog";
import Select from "@/components/Select";
import Icon, { type IconName } from "@/components/Icon";
import AppNav from "@/components/AppNav";
import { notifyDataChanged, useDataVersion } from "@/lib/manemi/events";
import { searchGroupIds } from "@/lib/manemi/search";
import { useDebounced } from "@/lib/manemi/useDebounced";
import {
  loadGroupsDataCached,
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

type GroupData = GroupSummary & { icon: IconName };

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
  const [groupName, setGroupName] = useState("");
  const [groupCategory, setGroupCategory] = useState("Travel");
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [groupEmoji, setGroupEmoji] = useState<string>("plane");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [initialPageLoading, setInitialPageLoading] = useState(true);
  const [groupsError, setGroupsError] = useState("");
  const dataVersion = useDataVersion();
  const [activeFilter, setActiveFilter] = useState("All");
  const [groupMenu, setGroupMenu] = useState<string | null>(null);
  const [archiveGroupId, setArchiveGroupId] = useState<string | null>(null);
  const [archivingGroup, setArchivingGroup] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [leaveGroup, setLeaveGroup] = useState<{ id: string; name: string; balances: LeaveBalance[] } | null>(null);
  const [notice, setNotice] = useState("");
  const [createdGroup, setCreatedGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // Group whose Invite Friends sheet is open (owner/admin only).
  const [inviteGroup, setInviteGroup] = useState<{
    id: string;
    name: string;
    memberIds: string[];
  } | null>(null);

  const selectedGroup = groups.find((group) => group.id === groupMenu);
  const archiveGroup = groups.find((group) => group.id === archiveGroupId);

  const categories = [
    { name: "Travel", icon: "plane" as IconName },
    { name: "Roommates", icon: "home" as IconName },
    { name: "Group Dinners", icon: "utensils" as IconName },
    { name: "Events", icon: "party" as IconName },
    { name: "Other", icon: "box" as IconName },
  ];

  const router = useRouter();


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
      notifyDataChanged();
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

      // The Edge Function may return either { group: {...} } or the group directly.
      const resultGroup = data?.group ?? data;
      let newId: string | undefined = resultGroup?.groupId ?? resultGroup?.id;
      // Fallback for create-group functions that return only a success message.
      if (!newId) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: latest } = await supabase
            .from("Group")
            .select("groupId")
            .eq("createdBy", user.id)
            .eq("name", groupName.trim())
            .order("createdAt", { ascending: false })
            .limit(1)
            .maybeSingle();
          newId = newId ?? latest?.groupId;
        }
      }
      if (newId)
        setCreatedGroup({
          id: newId,
          name: groupName.trim(),
        });

      setShowCreateModal(false);
      setGroupName("");
      setGroupCategory("Travel");
      setGroupEmoji("plane");

      notifyDataChanged();
      if (!newId)
        setGroupsError(
          "Group created. Open its ••• menu and choose Invite Friends.",
        );
    } catch (error) {
      console.error(error);
      setCreateGroupError("Unable to create group. Please try again.");
    } finally {
      setCreatingGroup(false);
    }
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("new") === "group") {
      // From Home's "Create Group".
      setShowCreateModal(true);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadGroups() {
      try {
        const result = await loadGroupsDataCached(createClient());
        if (!active) return;
        if (result) {
          setUser(result.user);
          setGroups(result.groups.map((group) => ({ ...group, icon: "users" as IconName })));
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
  }, [dataVersion]);

  // Search runs in the database (group names and expense titles), 300ms
  // after typing stops; the cards keep their already-computed balances.
  const query = useDebounced(search.trim(), 300);
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    if (!query) {
      setMatchIds(null);
      setSearchError("");
      return;
    }
    let active = true;
    searchGroupIds(createClient(), query)
      .then((ids) => {
        if (!active) return;
        setMatchIds(ids);
        setSearchError("");
      })
      .catch((reason: unknown) => {
        if (active) setSearchError(reason instanceof Error ? reason.message : "Search failed. Try again.");
      });
    return () => {
      active = false;
    };
  }, [query, dataVersion]);
  const visibleGroups = useMemo(
    () => (matchIds ? groups.filter((group) => matchIds.has(group.id)) : groups),
    [groups, matchIds],
  );

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
            <PageHeader
              user={user}
              onNotificationsChange={notifyDataChanged}
            >
              <HeaderButton label="Create group" onClick={() => setShowCreateModal(true)}>
                <PeoplePlusIcon />
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
                placeholder="Search groups or expenses"
                aria-label="Search groups or expenses"
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
              Create a group, then invite friends to it.
              <br className="groups-mobile-break" />
              Invited by a friend? Accept it from the bell.
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
                onClick={() => router.push("/friends")}
              >
                Add Friends
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
            {searchError && (
              <p className="manemi-rich-filter-note" role="alert">
                {searchError}
              </p>
            )}
            {visibleGroups.length === 0 && matchIds && (
              <p className="manemi-rich-filter-note" role="status">
                No groups or expenses match “{query}”.
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
                              <Icon name={group.icon} size={22} />
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
                <Icon name={selectedGroup.icon} size={24} />
              </span>
              <div>
                <h2 id="manemi-actions-title">{selectedGroup.name}</h2>
                <p>
                  {selectedGroup.role === "owner"
                    ? "Group owner"
                    : selectedGroup.role === "admin"
                      ? "Group admin"
                      : "Group member"}
                </p>
              </div>
              <span className="manemi-actions-admin">
                {selectedGroup.role === "owner"
                  ? "Owner"
                  : selectedGroup.role === "admin"
                    ? "Admin"
                    : "Member"}
              </span>
            </header>
            <div className="manemi-actions-list">
              {!selectedGroup.isArchived && (
                <button
                  type="button"
                  aria-disabled={!selectedGroup.canInvite || undefined}
                  className={selectedGroup.canInvite ? "" : "manemi-action-disabled"}
                  onClick={() => {
                    if (!selectedGroup.canInvite) return;
                    setGroupMenu(null);
                    setInviteGroup({
                      id: selectedGroup.id,
                      name: selectedGroup.name,
                      memberIds: selectedGroup.memberIds,
                    });
                  }}
                >
                  <span className="manemi-action-symbol" aria-hidden="true">
                    ＋
                  </span>
                  <span>
                    Invite Friends
                    {!selectedGroup.canInvite && (
                      <small className="manemi-action-hint">Only the owner or an admin can invite</small>
                    )}
                  </span>
                  <span className="manemi-action-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setGroupMenu(null);
                  router.push(`/groups/${selectedGroup.id}`);
                }}
              >
                <span className="manemi-action-symbol" aria-hidden="true">
                  ↗
                </span>
                Open Group
                <span className="manemi-action-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
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
                    setLeaveGroup({
                      id: selectedGroup.id,
                      name: selectedGroup.name,
                      balances: selectedGroup.counterparties,
                    });
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

      {leaveGroup && (
        <LeaveGroupDialog
          groupId={leaveGroup.id}
          groupName={leaveGroup.name}
          balances={leaveGroup.balances}
          onSettle={() => router.push(`/groups/${leaveGroup.id}?settle=1`)}
          onClose={() => setLeaveGroup(null)}
          onLeft={() => {
            setNotice(`You left ${leaveGroup.name}.`);
            setLeaveGroup(null);
            notifyDataChanged();
          }}
        />
      )}

      {notice && (
        <div className="mn-toast" role="status" onAnimationEnd={() => setNotice("")}>
          {notice}
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
                  <Icon name={archiveGroup.icon} size={24} />
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

      {/* INVITE FRIENDS (owner/admin) */}
      {inviteGroup && (
        <InviteFriendsSheet
          groupId={inviteGroup.id}
          groupName={inviteGroup.name}
          memberIds={inviteGroup.memberIds}
          onClose={() => setInviteGroup(null)}
        />
      )}

      {/* GROUP CREATED: invite friends next */}
      {createdGroup && (
        <div className="manemi-invite-overlay" onClick={() => setCreatedGroup(null)}>
          <section
            className="manemi-invite-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-ready-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="manemi-invite-handle" />
            <div className="manemi-invite-hero">
              <div className="manemi-invite-icon"><Icon name="check" size={30} strokeWidth={2.4} /></div>
              <h2 id="group-ready-title">{createdGroup.name} is ready</h2>
              <p>
                Invite friends to start splitting expenses. Only people on your
                friends list can be invited.
              </p>
            </div>
            <button
              type="button"
              className="manemi-invite-primary"
              onClick={() => {
                const target = createdGroup;
                setCreatedGroup(null);
                setInviteGroup({
                  id: target.id,
                  name: target.name,
                  memberIds: user ? [user.id] : [],
                });
              }}
            >
              Invite Friends
            </button>
            <button
              type="button"
              className="manemi-invite-secondary"
              onClick={() => {
                const target = createdGroup;
                setCreatedGroup(null);
                router.push(`/groups/${target.id}`);
              }}
            >
              Go to Group
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
                  <div className="new-group-emoji-select-wrap">
                    <Select
                      id="new-group-icon"
                      variant="field"
                      align="start"
                      label="Group icon"
                      value={groupEmoji}
                      onChange={setGroupEmoji}
                      options={[
                        { value: "plane", label: "Travel", icon: <Icon name="plane" size={22} /> },
                        { value: "home", label: "Home", icon: <Icon name="home" size={22} /> },
                        { value: "utensils", label: "Food", icon: <Icon name="utensils" size={22} /> },
                        { value: "party", label: "Party", icon: <Icon name="party" size={22} /> },
                        { value: "flag", label: "Trip", icon: <Icon name="flag" size={22} /> },
                        { value: "users", label: "Friends", icon: <Icon name="users" size={22} /> },
                        { value: "box", label: "Other", icon: <Icon name="box" size={22} /> },
                      ]}
                    />
                  </div>
                </div>
                <div className="new-group-name-field">
                  <label htmlFor="new-group-name">Group name</label>
                  <input
                    id="new-group-name"
                    type="text"
                    placeholder="Japan 2026"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    maxLength={50}
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
                      <Icon name={category.icon} size={18} /> {category.name}
                    </button>
                  ))}
                </div>
              </div>

              <p className="new-group-info">
                <span aria-hidden="true">ⓘ</span> You'll be the group owner.
                Invite friends after creating it. Each expense picks its own currency.
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

/** People with a plus badge: the Create group action. */
function PeoplePlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="16" cy="6.5" r="2.5" />
      <path d="M17.5 12.4c1.1.4 2 1 2.6 1.8" />
      <path d="M19.5 16.5v5M17 19h5" />
    </svg>
  );
}
