import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SuperLega",
    short_name: "SuperLega",
    description: "Gestione rose e mercato della SuperLega.",
    lang: "it",
    start_url: "/rosa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05080f",
    theme_color: "#05080f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
