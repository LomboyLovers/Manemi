"use client";

import { useEffect } from "react";

export default function JoinPage() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    window.location.replace(
      code ? `/groups?code=${encodeURIComponent(code)}` : "/groups",
    );
  }, []);

  return (
    <main
      style={{
        padding: 24,
        color: "white",
        background: "#1e1e25",
        minHeight: "100vh",
      }}
    >
      Opening Manemi invitation...
    </main>
  );
}
