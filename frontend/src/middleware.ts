import { NextRequest, NextResponse } from "next/server";

const RAW_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:5000");
const API_ORIGIN = RAW_API_BASE.replace(/\/api\/?$/, "").replace(/\/$/, "");
const SESSION_API_ORIGIN = (
  process.env.BACKEND_INTERNAL_URL ||
  process.env.BACKEND_ORIGIN ||
  API_ORIGIN ||
  "http://localhost:5000"
).replace(/\/api\/?$/, "").replace(/\/$/, "");
const STAFF_ROLES = new Set(["admin", "super_admin", "superadmin", "doctor", "assistant"]);
const SUPER_ADMIN_ROLES = new Set(["super_admin", "superadmin"]);
const MEDICAL_RECORD_ROLES = new Set(["doctor", "super_admin", "superadmin"]);

async function getSession(token: string) {
  try {
    const response = await fetch(`${SESSION_API_ORIGIN}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const session = await response.json();
    return {
      role: String(session?.role || "").toLowerCase() || null,
      profileCompleted: Boolean(session?.profile_completed),
      registrationSource: String(session?.registration_source || "local").toLowerCase(),
    };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requiresAdmin = pathname.startsWith("/admin");
  const profileProvider = pathname === "/google/complete-profile"
    ? "google"
    : pathname === "/line/complete-profile"
      ? "line"
      : null;
  const isOAuthProfileCompletion = Boolean(profileProvider);
  const requiresUser = pathname.startsWith("/users") || isOAuthProfileCompletion;
  const requiresSuperAdmin = pathname === "/admin/audit-logs"
    || pathname.startsWith("/admin/audit-logs/")
    || pathname === "/admin/hardware"
    || pathname.startsWith("/admin/hardware/");
  const requiresMedicalRecordRole = pathname === "/admin/medicalrecords" || pathname.startsWith("/admin/medicalrecords/");
  const cookieName = requiresAdmin ? "adminToken" : "userToken";
  const token = request.cookies.get(cookieName)?.value || "";
  const session = token ? await getSession(token) : null;
  const role = session?.role || null;
  const validSession = requiresSuperAdmin
    ? Boolean(role && SUPER_ADMIN_ROLES.has(role))
    : requiresMedicalRecordRole
      ? Boolean(role && MEDICAL_RECORD_ROLES.has(role))
    : requiresAdmin
      ? Boolean(role && STAFF_ROLES.has(role))
      : Boolean(role === "user" || role === "users");

  if ((requiresAdmin || requiresUser) && !validSession) {
    if ((requiresSuperAdmin || requiresMedicalRecordRole) && role && STAFF_ROLES.has(role)) {
      const deniedFeature = requiresSuperAdmin
        ? pathname.startsWith("/admin/hardware") ? "hardware" : "audit_logs"
        : "medicalrecords";
      return NextResponse.redirect(new URL(`/admin/dashboard?access_denied=${deniedFeature}`, request.url));
    }
    const loginUrl = new URL("/userlogin", request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(cookieName);
    return response;
  }

  if (
    requiresUser &&
    validSession &&
    !session?.profileCompleted &&
    session?.registrationSource === "google" &&
    !isOAuthProfileCompletion
  ) {
    return NextResponse.redirect(new URL("/google/complete-profile", request.url));
  }

  if (
    requiresUser &&
    validSession &&
    !session?.profileCompleted &&
    !isOAuthProfileCompletion &&
    pathname !== "/users/userprofile" &&
    !pathname.startsWith("/users/userprofile/")
  ) {
    return NextResponse.redirect(new URL("/users/userprofile?complete=1", request.url));
  }

  if (isOAuthProfileCompletion && validSession) {
    if (session?.profileCompleted) {
      return NextResponse.redirect(new URL("/users/userHome", request.url));
    }
    if (session?.registrationSource !== profileProvider) {
      return NextResponse.redirect(new URL("/users/userprofile?complete=1", request.url));
    }
  }

  const response = NextResponse.next();
  if (requiresAdmin || requiresUser) {
    response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/users/:path*",
    "/google/complete-profile",
    "/line/complete-profile",
  ],
};
