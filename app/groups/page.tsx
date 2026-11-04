"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./groups-enhanced.css";

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
  status: "active" | "settled";
  members: number;
  emoji: string;
  owedByYou: number;
  youOwe: number;
  createdAt: string;
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
  const [groupsError, setGroupsError] = useState("");
  const [refreshGroups, setRefreshGroups] = useState(0);
  const [activeFilter, setActiveFilter] = useState("All");
  const [groupMenu, setGroupMenu] = useState<string | null>(null);

  const categories = [
    { name: "Travel", emoji: "✈️" },
    { name: "Roommates", emoji: "🏠" },
    { name: "Group Dinners", emoji: "🍽️" },
    { name: "Events", emoji: "🎉" },
    { name: "Other", emoji: "📦" },
  ];

  const router = useRouter();

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

      setShowCreateModal(false);
      setGroupName("");
      setGroupCategory("Travel");
      setGroupEmoji("🇯🇵");
      setGroupCurrency("PHP");

      setRefreshGroups((previous) => previous + 1);
      alert("Group created successfully!");
    } catch (error) {
      console.error(error);
      setCreateGroupError("Unable to create group. Please try again.");
    } finally {
      setCreatingGroup(false);
    }
  }

  useEffect(() => {
    async function loadGroups() {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setLoadingGroups(false);
        return;
      }

      const { data, error } = await supabase
        .from("Group")
        .select("groupId, name, createdAt")
        .eq("createdBy", user.id)
        .eq("isArchived", false)
        .order("createdAt", { ascending: false });

      if (error) {
        console.error("Error loading groups:", error.message);
        setGroupsError(error.message);
        setLoadingGroups(false);
        return;
      }

      const savedGroups: GroupData[] = (data ?? []).map((group) => ({
        id: group.groupId,
        name: group.name,
        category: "Other",
        status: "active",
        members: 1,
        emoji: "📦",
        owedByYou: 0,
        youOwe: 0,
        createdAt: group.createdAt,
      }));

      setGroupsError("");
      setGroups(savedGroups);
      setLoadingGroups(false);
    }

    loadGroups();
  }, [refreshGroups]);

  return (
    <main className="manemi-groups-page">
      <div className="groups-page-content">
        {/* HEADER */}
        {groups.length > 0 && !loadingGroups ? (
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
                Balances will update when expense calculations are connected.
              </p>
            </section>
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
          <p>Loading groups...</p>
        ) : groups.length === 0 ? (
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
          <section className="manemi-rich-group-section">
            <h2>ACTIVE · {groups.length}</h2>
            {activeFilter !== "All" && (
              <p className="manemi-rich-filter-note">
                Categories are not saved yet. Choose All to see every group.
              </p>
            )}
            <div className="manemi-rich-group-grid">
              {(activeFilter === "All" ? groups : [])
                .filter((group) =>
                  group.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((group) => (
                  <article className="manemi-rich-group-card" key={group.id}>
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
                          onClick={() =>
                            setGroupMenu(
                              groupMenu === group.id ? null : group.id,
                            )
                          }
                        >
                          •••
                        </button>
                        {groupMenu === group.id && (
                          <div className="manemi-rich-card-popover">
                            <span>More group actions coming soon</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <h3>{group.name}</h3>
                    <p className="manemi-rich-members">
                      Created by you · Admin
                    </p>
                    <div className="manemi-rich-card-balance">
                      <span>Balance not available yet</span>
                      <strong>₱0.00</strong>
                      <small>Expense tracking coming soon</small>
                    </div>
                  </article>
                ))}
            </div>
            {activeFilter === "All" &&
              groups.filter((group) =>
                group.name.toLowerCase().includes(search.toLowerCase()),
              ).length === 0 && (
                <p className="manemi-rich-filter-note">
                  No groups match your search.
                </p>
              )}
            <button
              type="button"
              className="manemi-rich-create-another"
              onClick={() => setShowCreateModal(true)}
            >
              + Create Another Group
            </button>
          </section>
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
          className="groups-nav-add"
          aria-label="Add expense"
          onClick={() => setShowAddModal(true)}
        >
          <CustomIcon name="plus" size={22} />
        </button>
      </nav>

      {/* JOIN GROUP MODAL */}

      {showJoinModal && (
        <div
          className="groups-modal-overlay"
          onClick={() => setShowJoinModal(false)}
        >
          <div
            className="groups-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-group-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="join-group-title">Join Group</h2>

            <p>Your group invitation code form will go here.</p>

            <button type="button" onClick={() => setShowJoinModal(false)}>
              Close
            </button>
          </div>
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
