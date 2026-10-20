import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, emailVerificationTokens, employees, organizationDomains, organizations } from "@/db/schema";
import {
  AuthError, assertSameOrigin, consumeRateLimit, emailDeliveryConfigured, emailDomain, getAppOrigin,
  isDevMailMode, isWorkEmailDomain, newSecret, normalizeEmail, sendVerificationEmail, validatePassword, hashSecret,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(200),
  password: z.string().min(12).max(72),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid registration" }, { status: 400 });

    const email = normalizeEmail(parsed.data.email);
    const domain = emailDomain(email);
    if (!domain || domain === "example.com" || domain.endsWith(".example") || !isWorkEmailDomain(domain)) {
      return NextResponse.json({ error: "Use a work email on your organization domain. Personal mailbox providers cannot create an organization." }, { status: 400 });
    }
    const passwordError = validatePassword(parsed.data.password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await consumeRateLimit(["owner-signup", ip, email], 5, 60 * 60);
    if (!emailDeliveryConfigured()) return NextResponse.json({ error: "Email delivery is not configured" }, { status: 503 });

    const [existingAccount] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email)).limit(1);
    if (existingAccount) return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });
    const [existingDomain] = await db.select({ organizationId: organizationDomains.organizationId, status: organizationDomains.status })
      .from(organizationDomains).where(eq(organizationDomains.domain, domain)).limit(1);
    if (existingDomain) return NextResponse.json({ error: "This email domain is already registered. Ask your organization owner for an invitation." }, { status: 409 });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const rawToken = newSecret();
    const tokenHash = hashSecret(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const created = await db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({ name: parsed.data.organizationName, timezone: "UTC" }).returning();
      await tx.insert(organizationDomains).values({ organizationId: organization.id, domain, status: "pending" });
      const [employee] = await tx.insert(employees).values({
        organizationId: organization.id,
        name: parsed.data.name,
        email,
        title: "Organization owner",
        role: "owner",
        status: "active",
        avatarColor: "#267455",
      }).returning();
      const [user] = await tx.insert(authUsers).values({ employeeId: employee.id, email, passwordHash, role: "owner" }).returning({ id: authUsers.id });
      await tx.insert(emailVerificationTokens).values({ userId: user.id, tokenHash, expiresAt });
      return { organizationId: organization.id, userId: user.id };
    });

    const verificationUrl = new URL(`/verify-email?token=${encodeURIComponent(rawToken)}`, getAppOrigin(request)).toString();
    const delivered = await sendVerificationEmail(email, verificationUrl);
    return NextResponse.json({
      ok: true,
      message: "Check your email to verify your address before signing in.",
      ...(isDevMailMode() ? { developmentVerificationUrl: verificationUrl, emailDelivered: delivered } : {}),
      organizationId: created.organizationId,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "Could not create organization";
    if (message.includes("organization_domains_domain_uq")) {
      return NextResponse.json({ error: "This email domain is already registered. Ask your organization owner for an invitation." }, { status: 409 });
    }
    console.error("Owner registration failed", error);
    return NextResponse.json({ error: "Could not create organization. Please try again." }, { status: 500 });
  }
}
