import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { authRateLimits, authSessions, authUsers, employees, organizations } from "@/db/schema";
import { dateOnly } from "@/lib/format";
import { allowedHostPorts, evaluateSameOrigin, inboundHostPort, parseConfiguredOrigin } from "@/lib/same-origin";
import nodemailer from "nodemailer";

export type WorkspaceRole = "employee" | "manager" | "owner";
export type AuthContext = {
  userId: number;
  employeeId: number;
  organizationId: number;
  teamId: number | null;
  email: string;
  name: string;
  title: string;
  role: WorkspaceRole;
  organizationName: string;
  timezone: string;
  weekStartsOn: number;
};

export const SESSION_COOKIE = "time_stone_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_MIN = 12;

export class AuthError extends Error {
  constructor(message: string, public status = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function normalizeEmail(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export function emailDomain(value: string): string {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).replace(/\.$/, "") : "";
}

export function isWorkEmailDomain(domain: string): boolean {
  const freeDomains = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "outlook.com", "hotmail.com", "live.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
  ]);
  return domain.length <= 253 && domain.includes(".") && !freeDomains.has(domain) &&
    domain.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
}

export function validatePassword(value: string): string | null {
  if (value.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (Buffer.byteLength(value, "utf8") > 72) return "Password must be 72 bytes or fewer";
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) return "Use at least one letter and one number";
  return null;
}

/**
 * Public origin used to build verification and invitation links.
 * APP_ORIGIN may be a full origin (`https://app.example`) or a bare host
 * (`app.example`); bare hosts are treated as https. Invalid values are
 * ignored rather than crashing sign-in. When unset, the inbound request
 * Host / x-forwarded-host is used.
 */
export function getAppOrigin(request?: Request): string {
  const configured = parseConfiguredOrigin(process.env.APP_ORIGIN);
  if (configured) return configured;
  if (!request) return "http://localhost:3000";
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "https" ? "https" : "http";
  try {
    return new URL(`${scheme}://${inboundHostPort(request)}`).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

/**
 * Same-origin (CSRF) verification for state-changing requests.
 *
 * Expects HTTP Origin, Referer, X-App-Origin, and/or Sec-Fetch-Site headers —
 * never a body field. Allowed hosts are the inbound request Host and, when
 * set, APP_ORIGIN. See evaluateSameOrigin for the trust order. Validation is
 * never skipped; the SameSite=Lax session cookie is the second CSRF layer.
 */
export function assertSameOrigin(request: Request): void {
  const decision = evaluateSameOrigin({
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    "x-app-origin": request.headers.get("x-app-origin"),
    "sec-fetch-site": request.headers.get("sec-fetch-site"),
  }, allowedHostPorts(request, process.env.APP_ORIGIN));
  if (!decision.ok) throw new AuthError(decision.message, decision.status);
}

export async function createSession(userId: number): Promise<void> {
  const rawToken = newSecret();
  const now = new Date();
  await db.insert(authSessions).values({
    userId,
    sessionHash: hashSecret(rawToken),
    expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (rawToken) {
    await db.update(authSessions).set({ revokedAt: new Date() })
      .where(and(eq(authSessions.sessionHash, hashSecret(rawToken)), isNull(authSessions.revokedAt)));
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;
  const sessionHash = hashSecret(rawToken);
  const now = new Date();
  const [row] = await db.select({
    userId: authUsers.id,
    employeeId: employees.id,
    organizationId: employees.organizationId,
    teamId: employees.teamId,
    email: authUsers.email,
    name: employees.name,
    title: employees.title,
    role: authUsers.role,
    organizationName: organizations.name,
    timezone: organizations.timezone,
    weekStartsOn: organizations.weekStartsOn,
  }).from(authSessions)
    .innerJoin(authUsers, eq(authSessions.userId, authUsers.id))
    .innerJoin(employees, eq(authUsers.employeeId, employees.id))
    .innerJoin(organizations, eq(employees.organizationId, organizations.id))
    .where(and(
      eq(authSessions.sessionHash, sessionHash),
      gt(authSessions.expiresAt, now),
      isNull(authSessions.revokedAt),
      isNull(authUsers.disabledAt),
      isNotNull(authUsers.emailVerifiedAt),
      eq(employees.status, "active"),
    )).limit(1);
  if (!row || !row.email) return null;
  if (row.role !== "owner" && row.role !== "manager" && row.role !== "employee") return null;
  return { ...row, role: row.role, weekStartsOn: Number(row.weekStartsOn) } as AuthContext;
}

export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw new AuthError("Sign in to continue", 401);
  return context;
}

export function assertRole(context: AuthContext, allowed: WorkspaceRole[]): void {
  if (!allowed.includes(context.role)) throw new AuthError("You do not have permission to do that", 403);
}

export function assertOwnEmployee(context: AuthContext, employeeId: number): void {
  if (context.employeeId !== employeeId && context.role !== "owner") {
    throw new AuthError("You can only access your own records", 403);
  }
}

export async function assertManagerCanAccessEmployee(context: AuthContext, employeeId: number): Promise<void> {
  if (context.role === "owner") return;
  if (context.role === "employee") {
    assertOwnEmployee(context, employeeId);
    return;
  }
  const [target] = await db.select({ teamId: employees.teamId }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, context.organizationId))).limit(1);
  if (!target || target.teamId !== context.teamId) throw new AuthError("Employee is outside your team", 403);
}

export async function assertProjectInOrganization(projectId: number, organizationId: number): Promise<void> {
  const result = await db.execute(sql`select id from projects where id = ${projectId} and organization_id = ${organizationId} limit 1`);
  if (!result.rows.length) throw new AuthError("Project not found", 404);
}

export function assertSameOrganization(context: AuthContext, organizationId: number): void {
  if (context.organizationId !== organizationId) throw new AuthError("Record not found", 404);
}

export async function consumeRateLimit(keyParts: string[], limit: number, windowSeconds: number): Promise<void> {
  const rawKey = keyParts.join("|");
  const key = hashSecret(rawKey).slice(0, 64);
  const now = new Date();
  const windowMs = windowSeconds * 1000;
  const [row] = await db.insert(authRateLimits).values({ key, windowStartedAt: now, attempts: 1 })
    .onConflictDoUpdate({
      target: authRateLimits.key,
      set: {
        windowStartedAt: sql`case when ${authRateLimits.windowStartedAt} <= ${new Date(now.getTime() - windowMs)} then ${now} else ${authRateLimits.windowStartedAt} end`,
        attempts: sql`case when ${authRateLimits.windowStartedAt} <= ${new Date(now.getTime() - windowMs)} then 1 else ${authRateLimits.attempts} + 1 end`,
      },
    }).returning({ attempts: authRateLimits.attempts, windowStartedAt: authRateLimits.windowStartedAt });
  if (Number(row?.attempts ?? 0) > limit) throw new AuthError("Too many attempts. Please try again later.", 429);
}

/**
 * True when real SMTP delivery is configured. In development workspaces
 * without an SMTP server, AUTH_DEV_LINKS=true opts into in-band one-time
 * links (returned by the API and shown in the UI) so the full
 * sign-up → verify → sign-in flow remains testable. Never enable it in a
 * production deployment without SMTP configured.
 */
export function isDevMailMode(): boolean {
  return !(process.env.SMTP_URL && process.env.EMAIL_FROM) && process.env.AUTH_DEV_LINKS === "true";
}

export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && process.env.EMAIL_FROM) || isDevMailMode();
}

export async function sendVerificationEmail(email: string, link: string): Promise<boolean> {
  return sendEmail(email, "Verify your Time Stone email", `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#17241f">
      <p style="font-size:12px;letter-spacing:.12em;color:#267455;font-weight:bold">TIME STONE</p>
      <h1 style="font-size:24px">Verify your email address</h1>
      <p>Confirm this email to activate your Time Stone account.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#267455;color:white;text-decoration:none;border-radius:8px">Verify email</a></p>
      <p style="font-size:12px;color:#66756e">This link expires in 24 hours. If you did not request this, you can ignore this email.</p>
    </div>`, link);
}

export async function sendInvitationEmail(email: string, organizationName: string, role: WorkspaceRole, link: string): Promise<boolean> {
  return sendEmail(email, `Invitation to join ${escapeHtml(organizationName)} on Time Stone`, `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#17241f">
      <p style="font-size:12px;letter-spacing:.12em;color:#267455;font-weight:bold">TIME STONE</p>
      <h1 style="font-size:24px">You have been invited</h1>
      <p>You have been invited to join <strong>${escapeHtml(organizationName)}</strong> as a ${escapeHtml(role)}.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#267455;color:white;text-decoration:none;border-radius:8px">Accept invitation</a></p>
      <p style="font-size:12px;color:#66756e">The invitation expires in 7 days and can only be used by the invited email address.</p>
    </div>`, link);
}


export async function sendEmployeeCredentialsEmail(
  email: string,
  organizationName: string,
  role: WorkspaceRole,
  temporaryPassword: string,
): Promise<boolean> {
  return sendEmail(
    email,
    `Your Time Stone login credentials for ${organizationName}`,
    `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#17241f">
        <p style="font-weight:bold;color:#267455">TIME STONE</p>
        <h1>Your account is ready</h1>
        <p>You have been added to <strong>${escapeHtml(organizationName)}</strong> as a ${escapeHtml(role)}.</p>
        <p><strong>Login email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Temporary password:</strong> ${escapeHtml(temporaryPassword)}</p>
        <p>Please sign in and change your temporary password immediately.</p>
      </div>
      `,
  "",
);
}



async function sendEmail(to: string, subject: string, html: string, devLink: string): Promise<boolean> {
    const smtpUrl = process.env.SMTP_URL?.trim().replace(/^["']|["']$/g, "");
  const from = process.env.EMAIL_FROM;

  if (smtpUrl && from) {
    const smtp = new URL(smtpUrl);

    const transport = nodemailer.createTransport({
      host: smtp.hostname,
      port: Number(smtp.port || (smtp.protocol === "smtps:" ? 465 : 587)),
      secure: smtp.protocol === "smtps:",
      auth: {
        user: decodeURIComponent(smtp.username),
        pass: decodeURIComponent(smtp.password),
      },
    });

    await transport.sendMail({ from, to, subject, html });
    return true;
  }if (!isDevMailMode()) throw new Error("Email delivery is not configured. Set SMTP_URL and EMAIL_FROM.");
  console.info(`[Time Stone development email] to=${to} subject=${subject} link=${devLink}`);
  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function clientSafeAuthContext(context: AuthContext) {
  return {
    employeeId: context.employeeId,
    name: context.name,
    title: context.title,
    email: context.email,
    role: context.role,
    organizationName: context.organizationName,
  };
}

export function localDate(value: Date): string {
  return dateOnly(value);
}
