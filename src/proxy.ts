import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const PUBLIC_PREFIXES = [
  "/login",
  "/registrati",
  "/password-dimenticata",
  "/verifica-email",
  "/auth/",
  "/offline",
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (!userId && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (userId && (pathname === "/login" || pathname === "/registrati")) {
    const url = request.nextUrl.clone();
    url.pathname = "/rosa";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the service worker and PWA files.
    "/((?!_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|icon\\.svg|.*\\.(?:png|svg|ico|jpg|webp)$).*)",
  ],
};
