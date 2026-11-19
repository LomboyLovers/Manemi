"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AVATAR_TYPES,
  avatarFileError,
  normalizeUsername,
  saveProfile,
  usernameError,
  type ProfileUpdate,
} from "@/lib/manemi/profile";
import Avatar from "./Avatar";

type Props = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  onSaved: (profile: ProfileUpdate) => void;
  onCancel: () => void;
};

/** AUTH-05: change your username and profile photo. */
export default function ProfileEditor({ userId, name, email, avatarUrl, onSaved, onCancel }: Props) {
  const [username, setUsername] = useState(name);
  const [nameError, setNameError] = useState("");
  const [photo, setPhoto] = useState<File | "remove" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // Local preview of a newly chosen photo.
  useEffect(() => {
    if (!(photo instanceof File)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const shownPhoto = photo === "remove" ? null : preview ?? avatarUrl;
  const nameChanged = normalizeUsername(username) !== name;
  const changed = nameChanged || photo !== null;

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    const problem = avatarFileError(file);
    setPhotoError(problem);
    if (!problem) setPhoto(file);
  }

  async function save() {
    const problem = nameChanged ? usernameError(username) : "";
    setNameError(problem);
    if (problem || !changed || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const saved = await saveProfile(createClient(), userId, {
        name: nameChanged ? username : undefined,
        photo,
        previousAvatarUrl: avatarUrl,
      });
      onSaved(saved);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Couldn't save your profile. Try again.";
      // A taken username belongs next to the field.
      if (/taken|username|characters|letters/i.test(message)) setNameError(message);
      else setSaveError(message);
      setSaving(false);
    }
  }

  return (
    <form
      className="mn-profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
    >
      <div className="mn-profile-photo">
        <div className="mn-account-avatar" aria-hidden="true">
          <Avatar name={normalizeUsername(username) || name} url={shownPhoto} />
        </div>
        <div className="mn-profile-photo-actions">
          <button type="button" className="mn-profile-secondary" onClick={() => fileRef.current?.click()} disabled={saving}>
            {shownPhoto ? "Change photo" : "Add photo"}
          </button>
          {shownPhoto && (
            <button
              type="button"
              className="mn-profile-link"
              disabled={saving}
              onClick={() => {
                setPhoto(avatarUrl ? "remove" : null);
                setPhotoError("");
              }}
            >
              Remove photo
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_TYPES.join(",")}
            className="mn-visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        <small className="mn-profile-hint">JPG, PNG or WebP. Cropped to a square.</small>
        {photoError && (
          <p className="mn-profile-error" role="alert">
            {photoError}
          </p>
        )}
      </div>

      <div className="mn-profile-field">
        <label htmlFor={`${id}-username`}>Username</label>
        <input
          id={`${id}-username`}
          value={username}
          maxLength={40}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={Boolean(nameError)}
          aria-describedby={`${id}-username-help`}
          onChange={(event) => {
            setUsername(event.target.value);
            if (nameError) setNameError("");
          }}
          onBlur={() => setNameError(nameChanged ? usernameError(username) : "")}
          disabled={saving}
        />
        <small id={`${id}-username-help`} className={nameError ? "mn-profile-error" : "mn-profile-hint"} role={nameError ? "alert" : undefined}>
          {nameError || "3–30 characters. Your friends and groups see this name."}
        </small>
      </div>

      <div className="mn-profile-field">
        <span className="mn-profile-label">Email</span>
        <p className="mn-profile-static">{email}</p>
        <small className="mn-profile-hint">Used to sign in. It can&apos;t be changed here.</small>
      </div>

      {saveError && (
        <p className="mn-popup-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="mn-profile-actions">
        <button type="button" className="mn-profile-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="mn-profile-primary" disabled={!changed || saving}>
          {saving ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </form>
  );
}
