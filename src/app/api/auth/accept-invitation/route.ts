import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { AuthError, assertSameOrigin, consumeRateLimit, emailDeliveryConfigured, getAppOrigin, hashSecret, isDevMailMode, newSecret, sendVerificationEmail, validatePassword } from "@/lib/auth";
import { db } from "@/db";
import { authUsers, emailVerificationTokens, employeeInvitations } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
const schema = z.object({ token: z.string().min(32).max(128), password: z.string().min(12).max(72) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invitation details" }, { status: 400 });
    const passwordError = validatePassword(parsed.data.password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
    if (!emailDeliveryConfigured()) return NextResponse.json({ error: "Email delivery is not configured" }, { status: 503 });
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await consumeRateLimit(["accept-invitation", ip, hashSecret(parsed.data.token)], 8, 60 * 60);

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const verificationToken = newSecret();
    const verificationHash = hashSecret(verificationToken);
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const account = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        select i.id as invitation_id, i.employee_id as employee_id, i.email, i.role, i.organization_id as organization_id,
               e.organization_id as employee_organization_id, e.status as employee_status
        from employee_invitations i
        join employees e on e.id = i.employee_id
        join organization_domains d on d.organization_id = i.organization_id
          and d.status = 'approved' and d.domain = split_part(lower(i.email), '@', 2)
        where i.token_hash = ${hashSecret(parsed.data.token)}
          and i.expires_at > now() and i.claimed_at is null and i.accepted_at is null
        for update of i, e
      `);
      const invite = result.rows[0] as {
        invitation_id: number; employee_id: number; email: string; role: string; organization_id: number;
        employee_organization_id: number; employee_status: string;
      } | undefined;
      if (!invite || invite.employee_organization_id !== invite.organization_id || invite.employee_status !== "invited" || (invite.role !== "employee" && invite.role !== "manager")) {
        throw new AuthError("Invitation is invalid, expired, or already used", 404);
      }
      const existing = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, invite.email)).limit(1);
      if (existing.length) throw new AuthError("An account already exists for this email", 409);

      const [user] = await tx.insert(authUsers).values({ employeeId: invite.employee_id, email: invite.email, passwordHash, role: invite.role }).returning({ id: authUsers.id });
      await tx.insert(emailVerificationTokens).values({ userId: user.id, tokenHash: verificationHash, expiresAt: verificationExpires });
      await tx.update(employeeInvitations).set({ claimedAt: new Date() }).where(and(eq(employeeInvitations.id, invite.invitation_id), isNull(employeeInvitations.claimedAt)));
      return { userId: user.id, email: invite.email };
    });

    const verificationUrl = new URL(`/verify-email?token=${encodeURIComponent(verificationToken)}`, getAppOrigin(request)).toString();
    const delivered = await sendVerificationEmail(account.email, verificationUrl);
    return NextResponse.json({
      ok: true,
      message: "Your invitation is accepted. Verify your email before signing in.",
      ...(isDevMailMode() ? { developmentVerificationUrl: verificationUrl, emailDelivered: delivered } : {}),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Invitation acceptance failed", error);
    return NextResponse.json({ error: "Could not accept invitation. Please request a new invitation." }, { status: 500 });
  }
}
