"use client";

import { useState } from "react";
import { Plus, X, HandCoins, CreditCard, UsersRound } from "lucide-react";
import "./Add_Button.css";
import CreateGroupModal from "./CreateGroupModal";

type MenuItem = {
  label: string;
  icon: typeof HandCoins;
  // Called when this menu item is clicked, after the popup menu closes.
  onSelect?: () => void;
};

export default function AddButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  const menuItems: MenuItem[] = [
    { label: "Request", icon: HandCoins },
    { label: "Pay Debt", icon: CreditCard },
    {
      label: "Create Group",
      icon: UsersRound,
      onSelect: () => setIsCreateGroupOpen(true),
    },
  ];

  return (
    <div className="add-button-container">
      {isOpen && (
        <div className="add-button-menu" role="menu">
          {menuItems.map(({ label, icon: Icon, onSelect }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className="add-button-menu-item"
              onClick={() => {
                setIsOpen(false);
                onSelect?.();
              }}
            >
              <span className="add-button-menu-icon">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="add-button-menu-label">{label}</span>
            </button>
            ))}
        </div>
      )}

      <button
        type="button"
        className="add-button-fab"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Close menu" : "Open menu"}
        aria-expanded={isOpen}
      >
        {isOpen ? <X size={24} strokeWidth={2.5} /> : <Plus size={24} strokeWidth={2.5} />}
      </button>

      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
      />
    </div>
  );
}
