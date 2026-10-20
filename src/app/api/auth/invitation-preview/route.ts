import { NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employeeInvitations, employees, organizationDomains, organizations } from "@/db/schema";
import { hashSecret } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (token.length < 32 || token.length > 128) return NextResponse.json({ error: "Invitation is invalid or expired" }, { status: 400 });
  const [invite] = await db.select({
    email: employeeInvitations.email,
    role: employeeInvitations.role,
    name: employees.name,
    organizationName: organizations.name,
  }).from(employeeInvitations)
    .innerJoin(employees, eq(employeeInvitations.employeeId, employees.id))
    .innerJoin(organizations, eq(employeeInvitations.organizationId, organizations.id))
    .innerJoin(organizationDomains, and(
      eq(organizationDomains.organizationId, employeeInvitations.organizationId),
      eq(organizationDomains.status, "approved"),
    ))
    .where(and(
      eq(employeeInvitations.tokenHash, hashSecret(token)),
      gt(employeeInvitations.expiresAt, new Date()),
      isNull(employeeInvitations.claimedAt),
      isNull(employeeInvitations.acceptedAt),
    )).limit(1);
  if (!invite || (invite.role !== "employee" && invite.role !== "manager")) {
    return NextResponse.json({ error: "Invitation is invalid, expired, or already used" }, { status: 404 });
  }
  return NextResponse.json({ invite });
}
