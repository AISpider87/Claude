import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SuperLega", template: "%s · SuperLega" },
  description: "Gestione rose e mercato della SuperLega 2026/27.",
  applicationName: "SuperLega",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "SuperLega" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // theme-color is owned by ThemeScript so it can follow the saved theme.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="it"
      className={`dark ${inter.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="bg-primary text-on-primary sr-only z-50 rounded-[var(--radius-control)] px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Vai al contenuto
        </a>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
