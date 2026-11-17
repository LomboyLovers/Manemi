import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className={`${inter.className} min-h-full flex flex-col`}>{children}</body>
    </html>
  );
}
