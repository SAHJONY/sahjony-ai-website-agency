// Vercel Edge Middleware — protects the owner-only "secret sauce" pages so the
// public can't open them directly. Unauthenticated requests to /playbook.html
// and /scripts.html are redirected to the dashboard login.
//
// Auth: the dashboard login sets an `fda_auth` cookie equal to ADMIN_PASSWORD.
// If ADMIN_PASSWORD is not set, the pages stay open (app still works out of box).
export const config = { matcher: ["/playbook.html", "/scripts.html", "/ava.html", "/contract.html"] };

export default function middleware(request) {
  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) return; // no password configured -> leave open

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)fda_auth=([^;]+)/);
  if (m && decodeURIComponent(m[1]) === admin) return; // authenticated -> allow

  return Response.redirect(new URL("/dashboard.html", request.url), 302);
}
