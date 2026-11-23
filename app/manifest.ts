import type { MetadataRoute } from "next";

// Lets "Add to Home Screen" install Manemi as an app: it opens full screen and
// starts on the dashboard instead of the login page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Manemi",
    short_name: "Manemi",
    description: "Split group expenses and settle up with friends.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#121214",
    theme_color: "#121214",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
