import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let phones on the same Wi-Fi (and VS Code port forwarding)
  // load the dev server's scripts. Without this, `next dev` blocks them and
  // the page never becomes interactive (e.g. the Login button just reloads).
  // `*` matches one part of the address, so 192.168.*.* covers 192.168.1.23.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.devtunnels.ms"],
};

export default nextConfig;
