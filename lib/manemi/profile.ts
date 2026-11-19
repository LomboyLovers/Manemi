// Profile editing (AUTH-05): username and profile photo.
// The database (update_profile) has the final say; these checks give the
// same answers instantly while typing.
import type { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Largest photo accepted before resizing. */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** Photos are stored as a square of this many pixels. */
const AVATAR_SIZE = 256;

/** "  Ana   Cruz " -> "Ana Cruz" (what gets saved). */
export function normalizeUsername(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Error to show for a username, or "" when it's fine. Same rules as update_profile. */
export function usernameError(value: string): string {
  const name = normalizeUsername(value);
  if (name.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `Use ${USERNAME_MAX} characters or fewer.`;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(name)) {
    return "Use letters, numbers, spaces, dots, dashes, underscores or apostrophes, starting with a letter or number.";
  }
  return "";
}

/** Error for a chosen photo file, or "". */
export function avatarFileError(file: File): string {
  if (!AVATAR_TYPES.includes(file.type)) return "Choose a JPG, PNG or WebP photo.";
  if (file.size > AVATAR_MAX_BYTES) return "That photo is over 10 MB. Choose a smaller one.";
  return "";
}

/** Center-crops to a square and shrinks to 256 px, so photos stay small and load fast. */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't read that photo. Try another one.");
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (blob && blob.type === "image/webp") return blob;
  // Browsers without WebP encoding fall back to JPEG.
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!jpeg) throw new Error("Couldn't read that photo. Try another one.");
  return jpeg;
}

/** Turns "INVALID: message" / "CONFLICT: message" from the database into plain text. */
function cleanMessage(message: string): string {
  return message.replace(/^(INVALID|CONFLICT|FORBIDDEN|NOT_FOUND):\s*/, "");
}

export type ProfileUpdate = { name: string; avatarUrl: string | null };

/** Saves a new username and/or photo. `photo` null = keep, "remove" = delete it. */
export async function saveProfile(
  supabase: SupabaseClient,
  userId: string,
  changes: { name?: string; photo?: File | "remove" | null; previousAvatarUrl?: string | null },
): Promise<ProfileUpdate> {
  let avatarUrl: string | null = null;
  let uploadedPath: string | null = null;

  if (changes.photo instanceof File) {
    const blob = await squarePhoto(changes.photo);
    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    uploadedPath = `${userId}/${Date.now()}.${extension}`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(uploadedPath, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (error) throw new Error(`Couldn't upload the photo: ${error.message}`);
    avatarUrl = supabase.storage.from("avatars").getPublicUrl(uploadedPath).data.publicUrl;
  }

  const { data, error } = await supabase.rpc("update_profile", {
    p_name: changes.name === undefined ? null : normalizeUsername(changes.name),
    p_avatar_url: avatarUrl,
    p_remove_avatar: changes.photo === "remove",
  });
  if (error) {
    // Don't leave an unused photo behind.
    if (uploadedPath) await supabase.storage.from("avatars").remove([uploadedPath]);
    throw new Error(cleanMessage(error.message));
  }

  // Replaced or removed: delete the old file from our bucket.
  const previous = changes.previousAvatarUrl ?? "";
  const marker = `/storage/v1/object/public/avatars/`;
  if ((changes.photo instanceof File || changes.photo === "remove") && previous.includes(marker)) {
    const oldPath = decodeURIComponent(previous.split(marker)[1] ?? "");
    if (oldPath.startsWith(`${userId}/`)) await supabase.storage.from("avatars").remove([oldPath]);
  }

  const result = data as { name: string; avatarUrl: string | null };
  return { name: result.name, avatarUrl: result.avatarUrl };
}
