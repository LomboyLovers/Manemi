import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SplashScreen from "@/components/SplashScreen";

// Inter is the Manemi design system font. next/font self-hosts it, so there
// is no request to Google at runtime and no layout shift.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Manemi",
  description: "Split group expenses and settle up with friends.",
  // iOS home-screen app: full screen, no Safari bars.
  appleWebApp: { capable: true, title: "Manemi", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#121214",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      // Browsers and extensions add attributes here before React loads (e.g.
      // Chrome on iPhone adds __gcrremoteframetoken). Ignore those on this tag
      // only; mismatches anywhere else in the app are still reported.
      suppressHydrationWarning
    >
      <body className={`${inter.className} min-h-full flex flex-col`}>
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
