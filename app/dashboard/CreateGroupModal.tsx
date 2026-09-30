"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import { X, ChevronDown, Undo2 } from "lucide-react";
import "./CreateGroupModal.css";

const CATEGORY_OPTIONS = ["Travel", "Roommates", "Events", "Dinner"];
const CUSTOM_OPTION = "Custom";

type CreateGroupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  // Optional hook for later — not wired up to anything yet.
  onSave?: (data: { name: string; category: string }) => void;
};

export default function CreateGroupModal({ isOpen, onClose, onSave }: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState("");
  const [category, setCategory] = useState("");
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset the form each time the popup is opened fresh.
  useEffect(() => {
    if (isOpen) {
      setGroupName("");
      setCategory("");
      setIsCustomCategory(false);
      setCustomCategory("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleCategoryChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === CUSTOM_OPTION) {
      setIsCustomCategory(true);
      setCategory("");
    } else {
      setCategory(value);
    }
  };

  const handleRevertToDropdown = () => {
    setIsCustomCategory(false);
    setCustomCategory("");
    setCategory("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const finalCategory = isCustomCategory ? customCategory : category;
    // No backend wiring yet — UI only, per earlier scope.
    onSave?.({ name: groupName, category: finalCategory });
    onClose();
  };

  return (
    <div className="create-group-overlay" onMouseDown={handleOverlayClick}>
      <div
        className="create-group-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        ref={dialogRef}
      >
        <div className="create-group-header">
          <h2 id="create-group-title">Create Group</h2>
          <button
            type="button"
            className="create-group-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="create-group-name">Group Name</label>
            <input
              id="create-group-name"
              type="text"
              name="groupName"
              placeholder="e.g. Japan 2026"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="create-group-category">Category</label>

            {!isCustomCategory ? (
              <div className="create-group-select-wrapper">
                <select
                  id="create-group-category"
                  name="category"
                  value={category}
                  onChange={handleCategoryChange}
                  required
                >
                  <option value="" disabled>
                    Select category
                  </option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION}>Custom</option>
                </select>
                <ChevronDown size={18} className="create-group-select-icon" />
              </div>
            ) : (
              <div className="create-group-custom-wrapper">
                <input
                  id="create-group-category"
                  type="text"
                  name="customCategory"
                  placeholder="Type a custom category"
                  value={customCategory}
                  onChange={(event) => setCustomCategory(event.target.value)}
                  autoFocus
                  required
                />
                <button
                  type="button"
                  className="create-group-revert"
                  onClick={handleRevertToDropdown}
                  aria-label="Back to category list"
                  title="Back to category list"
                >
                  <Undo2 size={16} />
                </button>
              </div>
            )}
          </div>

          <button type="submit" className="create-group-save-button">
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
