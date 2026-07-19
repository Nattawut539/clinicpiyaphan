import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
    const token = request.cookies.get("adminToken")?.value;

    if (request.nextUrl.pathname.startsWith("/admin") && !token) {
    return NextResponse.redirect(new URL("/userlogin", request.url));
    }

    return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"], // เฝ้าระวังทุกหน้าใน /admin/*
};
