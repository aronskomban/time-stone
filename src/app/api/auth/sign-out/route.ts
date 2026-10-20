import { NextResponse } from "next/server";
import { AuthError, assertSameOrigin, destroyCurrentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await destroyCurrentSession();
    return NextResponse.json({ ok: true, redirectTo: "/signin" });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Sign-out failed", error);
    return NextResponse.json({ error: "Could not sign out" }, { status: 500 });
  }
}
