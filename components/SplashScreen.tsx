"use client";

import { useEffect, useState } from "react";
import "./splash.css";

const MIN_VISIBLE_MS = 900;
const FADE_MS = 450;

/**
 * Loading screen: the Manemi logo, tagline and a spinning loader. It shows
 * whenever the app starts loading (opening it, reloading, logging out or in)
 * and fades out once the page is ready, after a short minimum so it never just
 * flashes. Moving between pages inside the app uses the page skeletons instead.
 */
export default function SplashScreen() {
  const [phase, setPhase] = useState<"show" | "leave" | "gone">("show");

  useEffect(() => {
    const started = Date.now();
    let timer = 0;
    const finish = () => {
      timer = window.setTimeout(() => setPhase("leave"), Math.max(0, MIN_VISIBLE_MS - (Date.now() - started)));
    };
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });
    return () => {
      window.removeEventListener("load", finish);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (phase !== "leave") return;
    const timer = window.setTimeout(() => setPhase("gone"), FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div className={`mn-splash ${phase === "leave" ? "is-leaving" : ""}`} role="status" aria-label="Loading Manemi">
      <div className="mn-splash-center">
        <span className="mn-splash-glow" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element -- plain img so it paints in the server HTML */}
        <img className="mn-splash-logo" src="/Logo_manemi.svg" alt="" width={180} height={177} />
        <h1 className="mn-splash-title">Manemi</h1>
        <p className="mn-splash-tagline">Split it. Track it. Settle it.</p>
      </div>
      <span className="mn-splash-spinner" aria-hidden="true" />
    </div>
  );
}
