"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./groups-enhanced.css";
import "./groups-navigation.css";
import "./groups-compact-navigation.css";
import "./groups-actions-sheet.css";
import "./groups-invitations.css";
import GroupsSkeleton from "@/components/GroupSkeleton";
import "./groups-invitations.css";

// ==========================================
// CUSTOM ICON COMPONENT
// Uses PNG files inside public/icons/
// ==========================================

type CustomIconProps = {
  name: string;
  size?: number;
  className?: string;
};

type GroupData = {
  id: string;
  name: string;
  category: string;
  status: "active" | "settled" | "unsettled";
  members: number;
  emoji: string;
  owedByYou: number;
  youOwe: number;
  createdAt: string;
  isCreator: boolean;
};

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
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
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

  async function handleLogout() {
    const supabase = createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      return;
    }

    router.replace("/");
    router.refresh();
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
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;

    setLoadingGroups(true);

    async function loadGroups() {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!active) return;

      if (userError || !user) {
        setLoadingGroups(false);
        setInitialPageLoading(false);
        return;
      }

      // Membership determines visibility. The database RLS policies must also
      // allow members to read their groups.
      const { data: memberships, error: membershipError } = await supabase
        .from("Group_Member")
        .select("groupId")
        .eq("userId", user.id);

      if (!active) return;
      if (membershipError) {
        setGroupsError(
          `Unable to load group memberships: ${membershipError.message}`,
        );
        setLoadingGroups(false);
        setInitialPageLoading(false);
        return;
      }

      const memberGroupIds = [
        ...new Set((memberships ?? []).map((m) => m.groupId)),
      ];
      // Also include groups created by the user, in case their membership
      // record has not been inserted yet.
      const { data: ownedGroups, error: ownedError } = await supabase
        .from("Group")
        .select("groupId")
        .eq("createdBy", user.id);

      if (!active) return;
      if (ownedError) {
        setGroupsError(ownedError.message);
        setLoadingGroups(false);
        setInitialPageLoading(false);
        return;
      }

      const groupIds = [
        ...new Set([
          ...memberGroupIds,
          ...(ownedGroups ?? []).map((g) => g.groupId),
        ]),
      ];

      if (groupIds.length === 0) {
        setGroups([]);
        setGroupsError("");
        setLoadingGroups(false);
        setInitialPageLoading(false);
        return;
      }

      let query = supabase
        .from("Group")
        .select("groupId, name, createdAt, createdBy, isArchived")
        .in("groupId", groupIds);

      if (debouncedSearch) {
        query = query.ilike("name", `%${debouncedSearch}%`);
      }

      const { data, error } = await query.order("createdAt", {
        ascending: false,
      });

      if (!active) return;
      if (error) {
        console.error("Error loading groups:", error.message);
        setGroupsError(error.message);
        setLoadingGroups(false);
        setInitialPageLoading(false);
        return;
      }

      // An archived group is Settled only when every member's net is zero.
      // get-balances checks group membership and returns the members array.
      const results = await Promise.all(
        (data ?? []).map(async (group) => {
          let status: GroupData["status"] = "active";
          let members = 1;
          let owedByYou = 0;
          let youOwe = 0;
          let balanceError: string | null = null;

          const { data: balances, error: functionError } =
            await supabase.functions.invoke("get-balances", {
              body: { groupId: group.groupId },
            });

          if (
            functionError ||
            balances?.error ||
            !Array.isArray(balances?.members)
          ) {
            balanceError = `${group.name}: ${functionError?.message ?? balances?.error ?? "invalid balance response"}`;
          } else {
            members = balances.members.length;
            const nets = balances.members.map(
              (member: { net: number | string }) => Number(member.net),
            );
            if (nets.some((net: number) => !Number.isFinite(net))) {
              balanceError = `${group.name}: invalid member balance`;
            } else {
              if (group.isArchived) {
                status = nets.every((net: number) => Math.abs(net) < 0.005)
                  ? "settled"
                  : "unsettled";
              }
              owedByYou = Number(balances.summary?.owedToYou ?? 0);
              youOwe = Number(balances.summary?.youOwe ?? 0);
            }
          }

          return {
            group: {
              id: group.groupId,
              name: group.name,
              category: "Other",
              status,
              members,
              emoji: "📦",
              owedByYou,
              youOwe,
              createdAt: group.createdAt,
              isCreator: group.createdBy === user.id,
            } satisfies GroupData,
            balanceError,
            archived: group.isArchived,
          };
        }),
      );

      if (!active) return;
      // Never mislabel archived groups as Active when balances are unavailable.
      const failed = results.filter((result) => result.balanceError);
      const savedGroups = results
        .filter((result) => !(result.archived && result.balanceError))
        .map((result) => result.group);
      if (failed.length) {
        setGroupsError(
          `Some balances could not be loaded: ${failed.map((r) => r.balanceError).join("; ")}`,
        );
      } else {
        setGroupsError("");
      }

      setGroups(savedGroups);
      setLoadingGroups(false);
      setInitialPageLoading(false);
    }

    void loadGroups();

    return () => {
      active = false;
    };
  }, [refreshGroups, debouncedSearch]);
  if (initialPageLoading) {
    return (
      <main className="manemi-groups-page">
        <div className="groups-page-content">
          <div className="manemi-groups-skeleton-container">
            <GroupsSkeleton />
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="manemi-groups-page">
      <div className="groups-page-content">
        {/* HEADER */}
        {loadingGroups || groups.length > 0 || Boolean(search) ? (
          <>
            <header className="manemi-rich-header">
              <div className="manemi-rich-avatar" aria-label="Account">
                J
              </div>
              <div className="manemi-rich-header-actions">
                <button
                  type="button"
                  className="manemi-rich-circle"
                  aria-label="Join group"
                  onClick={() => setShowJoinModal(true)}
                >
                  <CustomIcon name="group" size={22} />
                </button>
                <button
                  type="button"
                  className="manemi-rich-circle"
                  aria-label="Search groups"
                  onClick={() =>
                    document.getElementById("manemi-rich-search")?.focus()
                  }
                >
                  <CustomIcon name="search" size={22} />
                </button>
                <button
                  type="button"
                  className="manemi-rich-circle"
                  aria-label="Account menu"
                  aria-expanded={showMenu}
                  onClick={() => setShowMenu(!showMenu)}
                >
                  <CustomIcon name="bell" size={20} />
                </button>
                {showMenu && (
                  <div className="manemi-rich-account-menu">
                    <button type="button" onClick={handleLogout}>
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </header>
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
                  <div className="manemi-rich-balance-grid">
                    <div className="manemi-rich-balance-box">
                      <span>Total collectible</span>
                      <strong className="manemi-rich-green">₱0.00</strong>
                      <small>Owed to you</small>
                    </div>
                    <div className="manemi-rich-balance-box">
                      <span>Total debt</span>
                      <strong className="manemi-rich-red">₱0.00</strong>
                      <small>You owe</small>
                    </div>
                  </div>
                  <p className="manemi-rich-placeholder">
                    Balances will update when expense calculations are
                    connected.
                  </p>
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
                onChange={(event) => {
                  setSearch(event.target.value);
                  setLoadingGroups(true);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <header className="groups-page-header">
              <div className="groups-page-avatar">J</div>
              <div className="groups-notification-wrapper">
                <button
                  type="button"
                  className="groups-notification-button"
                  aria-label="Notifications and account menu"
                  aria-expanded={showMenu}
                  onClick={() => setShowMenu(!showMenu)}
                >
                  <CustomIcon name="bell" size={18} />
                </button>
                {showMenu && (
                  <div className="groups-account-menu">
                    <p>No new notifications</p>
                    <button
                      type="button"
                      className="groups-logout"
                      onClick={handleLogout}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </header>
            <section className="groups-page-greeting">
              <h1>
                Good morning,
                <br />
                Joaquin
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
            {groups.length === 0 && search && (
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
              const sectionGroups = groups.filter(
                (group) => group.status === section.status,
              );
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
                          <div className="manemi-rich-card-balance">
                            <span>
                              {group.status === "settled"
                                ? "Settled"
                                : group.youOwe > 0
                                  ? "You owe"
                                  : group.owedByYou > 0
                                    ? "You're owed"
                                    : "No personal balance"}
                            </span>
                            <strong>
                              ₱
                              {(group.youOwe > 0
                                ? group.youOwe
                                : group.owedByYou
                              ).toLocaleString("en-PH", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </strong>
                            <small>
                              {group.status === "active"
                                ? "Active group"
                                : group.status === "settled"
                                  ? "All balances paid"
                                  : "Outstanding group balances"}
                            </small>
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

      {/* BOTTOM NAVIGATION */}

      <nav className="groups-bottom-navigation" aria-label="Main navigation">
        <div className="groups-nav-pill">
          {/* HOME */}

          <Link href="/dashboard" className="groups-nav-item">
            <CustomIcon name="home" size={20} />
            <span>Home</span>
          </Link>

          {/* GROUPS — ACTIVE */}

          <Link
            href="/groups"
            className="groups-nav-item groups-nav-item-active"
            aria-current="page"
          >
            <CustomIcon name="group" size={20} />
            <span>Groups</span>
          </Link>

          {/* HISTORY */}

          <Link href="/history" className="groups-nav-item">
            <CustomIcon name="clock" size={20} />
            <span>History</span>
          </Link>
        </div>

        {/* ADD BUTTON */}

        <button
          type="button"
          className="groups-nav-add manemi-groups-add-button"
          aria-label="Add expense"
          onClick={() => setShowAddModal(true)}
        >
          <CustomIcon name="plus" size={22} />
        </button>
      </nav>

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

      {/* ADD EXPENSE MODAL */}

      {showAddModal && (
        <div
          className="groups-modal-overlay"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="groups-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="groups-add-expense-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="groups-add-expense-title">Add Expense</h2>

            <p>Your expense creation form will go here.</p>

            <button type="button" onClick={() => setShowAddModal(false)}>
              Close
            </button>
          </div>
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
