import { NextResponse } from "next/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, emailVerificationTokens, employeeInvitations, employees, organizationDomains } from "@/db/schema";
import { AuthError, assertSameOrigin, consumeRateLimit, hashSecret } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";
const schema = z.object({ token: z.string().min(32).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Verification link is invalid or expired" }, { status: 400 });
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await consumeRateLimit(["verify-email", ip], 20, 60 * 60);
    const tokenHash = hashSecret(parsed.data.token);

    const verified = await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        select vt.id as token_id, vt.user_id as user_id, u.email, u.role, u.employee_id as employee_id, e.organization_id as organization_id
        from email_verification_tokens vt
        join auth_users u on u.id = vt.user_id
        join employees e on e.id = u.employee_id
        where vt.token_hash = ${tokenHash}
          and vt.consumed_at is null
          and vt.expires_at > now()
          and u.email_verified_at is null
          and u.disabled_at is null
        for update of vt, u
      `);
      const row = locked.rows[0] as { token_id: number; user_id: number; employee_id: number; email: string; role: string; organization_id: number } | undefined;
      if (!row) throw new AuthError("Verification link is invalid or expired", 400);

      const now = new Date();
      await tx.update(emailVerificationTokens).set({ consumedAt: now }).where(and(eq(emailVerificationTokens.id, row.token_id), isNull(emailVerificationTokens.consumedAt)));
      await tx.update(authUsers).set({ emailVerifiedAt: now, updatedAt: now }).where(and(eq(authUsers.id, row.user_id), isNull(authUsers.emailVerifiedAt)));
      await tx.update(employees).set({ status: "active", updatedAt: now }).where(eq(employees.id, row.employee_id));

      if (row.role === "owner") {
        const domain = row.email.slice(row.email.lastIndexOf("@") + 1).toLowerCase();
        const [organizationDomain] = await tx.update(organizationDomains).set({ status: "approved", verifiedAt: now })
          .where(and(eq(organizationDomains.organizationId, row.organization_id), eq(organizationDomains.domain, domain), eq(organizationDomains.status, "pending"))).returning({ id: organizationDomains.id });
        if (!organizationDomain) throw new AuthError("Organization domain could not be approved", 409);
      }
      await tx.update(employeeInvitations).set({ acceptedAt: now })
        .where(and(eq(employeeInvitations.employeeId, row.employee_id), isNull(employeeInvitations.acceptedAt)));
      return { role: row.role };
    });

    return NextResponse.json({ ok: true, message: `Email verified. You can now sign in as ${verified.role}.` });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Email verification failed", error);
    return NextResponse.json({ error: "Could not verify email. Please request a new link." }, { status: 500 });
  }
}
