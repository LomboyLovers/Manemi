"use client";

import { useState } from "react";
import { initialOf } from "@/lib/manemi/format";

type Props = {
  name: string;
  url?: string | null;
};

/**
 * A person's photo, or their initial when there's no photo (or it fails to
 * load). Fills its circular container; size and color come from the container.
 */
export default function Avatar({ name, url }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  if (url && failed !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user uploads; sizes vary per spot
      <img className="mn-avatar-img" src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} />
    );
  }
  return <>{initialOf(name || "?")}</>;
}
