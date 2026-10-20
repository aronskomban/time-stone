import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authUsers, emailVerificationTokens } from "@/db/schema";
import { AuthError, assertSameOrigin, consumeRateLimit, emailDeliveryConfigured, getAppOrigin, hashSecret, isDevMailMode, newSecret, normalizeEmail, sendVerificationEmail } from "@/lib/auth";

export const dynamic = "force-dynamic";
const schema = z.object({ email: z.string().trim().email().max(200) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ message: "If the account needs verification, an email will be sent." });
    const email = normalizeEmail(parsed.data.email);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await consumeRateLimit(["resend-verification", ip, email], 5, 60 * 60);
    if (!emailDeliveryConfigured()) throw new AuthError("Email delivery is not configured", 503);

    const [user] = await db.select({ id: authUsers.id }).from(authUsers)
      .where(and(eq(authUsers.email, email), isNull(authUsers.emailVerifiedAt), isNull(authUsers.disabledAt))).limit(1);
    if (!user) return NextResponse.json({ message: "If the account needs verification, an email will be sent." });

    const rawToken = newSecret();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.transaction(async (tx) => {
      await tx.update(emailVerificationTokens).set({ consumedAt: new Date() })
        .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.consumedAt)));
      await tx.insert(emailVerificationTokens).values({ userId: user.id, tokenHash: hashSecret(rawToken), expiresAt });
    });
    const link = new URL(`/verify-email?token=${encodeURIComponent(rawToken)}`, getAppOrigin(request)).toString();
    const delivered = await sendVerificationEmail(email, link);
    return NextResponse.json({
      message: "If the account needs verification, an email will be sent.",
      ...(isDevMailMode() ? { developmentVerificationUrl: link, emailDelivered: delivered } : {}),
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Verification resend failed", error);
    return NextResponse.json({ error: "Could not resend verification email" }, { status: 500 });
  }
}
