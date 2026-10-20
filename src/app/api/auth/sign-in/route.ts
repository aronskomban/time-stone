import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, employees } from "@/db/schema";
import { AuthError, assertSameOrigin, consumeRateLimit, createSession, normalizeEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
const schema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(72), role: z.enum(["employee", "manager", "owner"]) });
let dummyHashPromise: Promise<string> | null = null;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
    const email = normalizeEmail(parsed.data.email);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await consumeRateLimit(["sign-in", ip, email], 10, 15 * 60);

    const [account] = await db.select({
      id: authUsers.id,
      email: authUsers.email,
      passwordHash: authUsers.passwordHash,
      role: authUsers.role,
      emailVerifiedAt: authUsers.emailVerifiedAt,
      disabledAt: authUsers.disabledAt,
      employeeStatus: employees.status,
    }).from(authUsers).innerJoin(employees, eq(authUsers.employeeId, employees.id))
      .where(eq(authUsers.email, email)).limit(1);

    if (!account) {
      dummyHashPromise ??= bcrypt.hash("time-stone-invalid-login-account", 12);
      await bcrypt.compare(parsed.data.password, await dummyHashPromise);
      return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
    }
    const passwordValid = await bcrypt.compare(parsed.data.password, account.passwordHash);
    if (!passwordValid || account.role !== parsed.data.role || account.disabledAt || account.employeeStatus !== "active") {
      return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
    }
    if (!account.emailVerifiedAt) {
      return NextResponse.json({ error: "Verify your email before signing in. Use Resend verification if you need a new link." }, { status: 403, headers: { "X-Auth-Reason": "email-unverified" } });
    }
    await createSession(account.id);
    return NextResponse.json({ ok: true, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Sign-in failed", error);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable" }, { status: 500 });
  }
}
