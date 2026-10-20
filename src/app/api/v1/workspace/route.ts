import { db } from "@/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
function generateTemporaryPassword(): string {
  return `${randomBytes(12).toString("base64url")}A7`;
}
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
import {
  approvals, attendance, auditEvents, authUsers, breaks, employeeInvitations, employees, leaveRequests,
  notifications, organizationDomains, organizations, projectMembers, projects, tasks, teams, timeEntries,
  timerStates, timesheets,
} from "@/db/schema";
import { getWorkspace } from "@/lib/workspace";
import {
  assertManagerCanAccessEmployee, assertRole, assertSameOrigin, AuthContext, AuthError, consumeRateLimit, isDevMailMode, requireAuth,
  emailDeliveryConfigured, emailDomain, getAppOrigin, hashSecret, newSecret, normalizeEmail,
  sendInvitationEmail,sendEmployeeCredentialsEmail,
} from "@/lib/auth";
import { dateOnly, secondsBetween } from "@/lib/format";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const positiveId = z.coerce.number().int().positive();
const schemas = {
  createTeam: z.object({ action: z.literal("createTeam"), name: z.string().trim().min(2).max(120), description: z.string().trim().max(400).optional() }),
  createEmployee: z.object({ action: z.literal("createEmployee"), name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(200), title: z.string().trim().min(2).max(140), teamId: positiveId, role: z.enum(["employee", "manager"]) }),
  updateEmployee: z.object({ action: z.literal("updateEmployee"), employeeId: positiveId, name: z.string().trim().min(2).max(160), title: z.string().trim().min(2).max(140), teamId: positiveId.nullable(), role: z.enum(["employee", "manager", "owner"]), status: z.enum(["active", "on_leave", "inactive"]) }),
  updateOwnProfile: z.object({ action: z.literal("updateOwnProfile"), name: z.string().trim().min(2).max(160), title: z.string().trim().min(2).max(140) }),
  createProject: z.object({ action: z.literal("createProject"), name: z.string().trim().min(2).max(160), code: z.string().trim().min(2).max(12).transform((value) => value.toUpperCase()), deadline: z.string().date(), budgetHours: z.coerce.number().int().min(1).max(100000) }),
  addProjectMember: z.object({ action: z.literal("addProjectMember"), projectId: positiveId, employeeId: positiveId }),
  removeProjectMember: z.object({ action: z.literal("removeProjectMember"), projectId: positiveId, employeeId: positiveId }),
  createTask: z.object({ action: z.literal("createTask"), title: z.string().trim().min(3).max(220), projectId: positiveId, assigneeId: positiveId, priority: z.enum(["low", "medium", "high"]), dueDate: z.string().date() }),
  updateTask: z.object({ action: z.literal("updateTask"), taskId: positiveId, status: z.enum(["todo", "in_progress", "review", "done"]), progress: z.coerce.number().int().min(0).max(100).optional() }),
  startTimer: z.object({ action: z.literal("startTimer"), projectId: positiveId, taskId: positiveId.optional() }),
  pauseTimer: z.object({ action: z.literal("pauseTimer") }),
  resumeTimer: z.object({ action: z.literal("resumeTimer") }),
  stopTimer: z.object({ action: z.literal("stopTimer") }),
  manualEntry: z.object({ action: z.literal("manualEntry"), projectId: positiveId, taskId: positiveId.optional(), workDate: z.string().date(), hours: z.coerce.number().positive().max(24), note: z.string().trim().max(400).optional() }),
  clockIn: z.object({ action: z.literal("clockIn") }),
  startBreak: z.object({ action: z.literal("startBreak") }),
  endBreak: z.object({ action: z.literal("endBreak") }),
  submitTimesheet: z.object({ action: z.literal("submitTimesheet") }),
  reviewTimesheet: z.object({ action: z.literal("reviewTimesheet"), approvalId: positiveId, decision: z.enum(["approved", "rejected"]), comment: z.string().trim().min(2).max(400) }),
  requestLeave: z.object({ action: z.literal("requestLeave"), category: z.string().trim().min(2).max(48), startDate: z.string().date(), endDate: z.string().date(), reason: z.string().trim().min(3).max(400) }),
  reviewLeave: z.object({ action: z.literal("reviewLeave"), leaveId: positiveId, decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(400).optional() }),
  updateOrganization: z.object({ action: z.literal("updateOrganization"), name: z.string().trim().min(2).max(160), timezone: z.string().trim().min(2).max(64), weekStartsOn: z.coerce.number().int().min(0).max(6) }),
  markRead: z.object({ action: z.literal("markRead"), notificationId: positiveId }),
  markAllRead: z.object({ action: z.literal("markAllRead") }),
};
type ActionName = keyof typeof schemas;

function organizationWeekStart(context: AuthContext): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day - context.weekStartsOn + 7) % 7;
  now.setUTCDate(now.getUTCDate() - diff);
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

function assertSelf(context: AuthContext): number { return context.employeeId; }

async function personInOrganization(context: AuthContext, employeeId: number) {
  const [person] = await db.select({ id: employees.id, teamId: employees.teamId, status: employees.status })
    .from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, context.organizationId))).limit(1);
  if (!person) throw new AuthError("Employee not found", 404);
  return person;
}

async function projectInOrganization(context: AuthContext, projectId: number) {
  const [project] = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, context.organizationId))).limit(1);
  if (!project) throw new AuthError("Project not found", 404);
}

async function ensureProjectAccess(context: AuthContext, projectId: number, forAssignment = false) {
  await projectInOrganization(context, projectId);
  if (context.role === "owner") return;
  const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.employeeId, context.employeeId))).limit(1);
  if (membership) return;
  if (context.role === "manager" && forAssignment && context.teamId !== null) {
    const [teamMember] = await db.select({ id: projectMembers.id }).from(projectMembers)
      .innerJoin(employees, eq(projectMembers.employeeId, employees.id))
      .where(and(eq(projectMembers.projectId, projectId), eq(employees.organizationId, context.organizationId), eq(employees.teamId, context.teamId))).limit(1);
    if (teamMember) return;
  }
  throw new AuthError("Project is outside your access scope", 403);
}

async function audit(context: AuthContext, action: string, entityType: string, entityId: number, details: string | null) {
  await db.insert(auditEvents).values({ organizationId: context.organizationId, actorId: context.employeeId, action, entityType, entityId, details });
}

async function createEmployeeInvitation(context: AuthContext, data: z.infer<typeof schemas.createEmployee>, request: Request) {
  assertRole(context, ["owner"]);
  if (!emailDeliveryConfigured()) throw new AuthError("Email delivery is not configured", 503);
  const email = normalizeEmail(data.email);
  const domain = emailDomain(email);
  const [approvedDomain] = await db.select({ id: organizationDomains.id }).from(organizationDomains)
    .where(and(eq(organizationDomains.organizationId, context.organizationId), eq(organizationDomains.domain, domain), eq(organizationDomains.status, "approved"))).limit(1);
  if (!approvedDomain) throw new AuthError("This email domain is not approved for your organization", 403);
  const [team] = await db.select({ id: teams.id }).from(teams)
    .where(and(eq(teams.id, data.teamId), eq(teams.organizationId, context.organizationId))).limit(1);
  if (!team) throw new AuthError("Team not found", 404);
  const [existingUser] = await db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, email)).limit(1);
  if (existingUser) throw new AuthError("An account already exists for this email", 409);
  const [existingEmployee] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.organizationId, context.organizationId), eq(employees.email, email))).limit(1);
  if (existingEmployee) throw new AuthError("An employee record already exists for this email", 409);

  await consumeRateLimit(["invite", String(context.userId)], 50, 24 * 60 * 60);
 
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const created = await db.transaction(async (tx) => {
    const [employee] = await tx.insert(employees).values({
      organizationId: context.organizationId,
      teamId: data.teamId,
      name: data.name,
      email,
      title: data.title,
      role: data.role,
      status: "active",
      avatarColor: "#267455",
    }).returning();

    const [account] = await tx.insert(authUsers).values({
      employeeId: employee.id,
      email,
      passwordHash,
      mustChangePassword: true,
      role: data.role,
      emailVerifiedAt: new Date(),
    }).returning({ id: authUsers.id });

    return { employeeId: employee.id, userId: account.id };
  });

  try {
    await sendEmployeeCredentialsEmail(
      email,
      context.organizationName,
      data.role,
      temporaryPassword,
    );
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.delete(authUsers).where(eq(authUsers.id, created.userId));
      await tx.delete(employees).where(eq(employees.id, created.employeeId));
    });
    throw error;
  }

  await audit(context, "employee.created", "employee", created.employeeId, email);
  const workspace = await getWorkspace(context);
  return { ok: true, data: workspace };
}


export async function GET() {
  try {
    const context = await requireAuth();
    return Response.json(await getWorkspace(context), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Workspace read failed", error);
    return Response.json({ error: "Unable to load workspace" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireAuth();
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || !("action" in raw) || typeof raw.action !== "string") {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }
    const action = raw.action as ActionName;
    const schema = schemas[action];
    if (!schema) return Response.json({ error: "Unknown action" }, { status: 400 });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const data = parsed.data;

    if (data.action === "createEmployee") return Response.json(await createEmployeeInvitation(context, data, request), { status: 201, headers: { "Cache-Control": "private, no-store" } });

    switch (data.action) {
      case "createTeam": {
        assertRole(context, ["owner"]);
        const [record] = await db.insert(teams).values({ organizationId: context.organizationId, name: data.name, description: data.description }).returning();
        await audit(context, "team.created", "team", record.id, data.name);
        break;
      }
      case "updateEmployee": {
        assertRole(context, ["owner"]);
        const person = await personInOrganization(context, data.employeeId);
        if (data.teamId !== null) {
          const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, data.teamId), eq(teams.organizationId, context.organizationId))).limit(1);
          if (!team) throw new AuthError("Team not found", 404);
        }
        if (person.status === "active") {
          const [authUser] = await db.select({ id: authUsers.id, role: authUsers.role }).from(authUsers).where(eq(authUsers.employeeId, data.employeeId)).limit(1);
          if (authUser?.role === "owner" && data.role !== "owner") {
            const ownerCountResult = await db.execute(sql`select count(*)::int as count from auth_users u join employees e on e.id=u.employee_id where e.organization_id=${context.organizationId} and u.role='owner' and u.email_verified_at is not null and u.disabled_at is null and e.status='active'`);
            const ownerCount = ownerCountResult.rows[0] as { count?: number } | undefined;
            if (Number(ownerCount?.count ?? 0) <= 1) throw new AuthError("An organization must keep at least one active owner", 409);
          }
        }
        await db.transaction(async (tx) => {
          await tx.update(employees).set({ name: data.name, title: data.title, teamId: data.teamId, role: data.role, status: data.status, updatedAt: new Date() })
            .where(and(eq(employees.id, data.employeeId), eq(employees.organizationId, context.organizationId)));
          await tx.update(authUsers).set({ role: data.role, updatedAt: new Date() }).where(eq(authUsers.employeeId, data.employeeId));
          await tx.update(employeeInvitations).set({ role: data.role }).where(and(eq(employeeInvitations.employeeId, data.employeeId), isNull(employeeInvitations.acceptedAt)));
        });
        await audit(context, "employee.updated", "employee", data.employeeId, `${data.role}/${data.status}`);
        break;
      }
      case "updateOwnProfile": {
        const [record] = await db.update(employees).set({ name: data.name, title: data.title, updatedAt: new Date() })
          .where(and(eq(employees.id, context.employeeId), eq(employees.organizationId, context.organizationId))).returning();
        if (!record) throw new AuthError("Profile not found", 404);
        await audit(context, "profile.updated", "employee", context.employeeId, null);
        break;
      }
      case "createProject": {
        assertRole(context, ["owner"]);
        const [record] = await db.insert(projects).values({ organizationId: context.organizationId, name: data.name, code: data.code, deadline: data.deadline, budgetHours: data.budgetHours }).returning();
        await audit(context, "project.created", "project", record.id, record.code);
        break;
      }
      case "addProjectMember": {
        assertRole(context, ["owner", "manager"]);
        await projectInOrganization(context, data.projectId);
        const person = await personInOrganization(context, data.employeeId);
        if (context.role === "manager" && person.teamId !== context.teamId) throw new AuthError("Employee is outside your team", 403);
        await db.insert(projectMembers).values({ projectId: data.projectId, employeeId: data.employeeId }).onConflictDoNothing();
        await audit(context, "project.member_added", "project", data.projectId, String(data.employeeId));
        break;
      }
      case "removeProjectMember": {
        assertRole(context, ["owner", "manager"]);
        await projectInOrganization(context, data.projectId);
        const person = await personInOrganization(context, data.employeeId);
        if (context.role === "manager" && person.teamId !== context.teamId) throw new AuthError("Employee is outside your team", 403);
        await db.delete(projectMembers).where(and(eq(projectMembers.projectId, data.projectId), eq(projectMembers.employeeId, data.employeeId)));
        await audit(context, "project.member_removed", "project", data.projectId, String(data.employeeId));
        break;
      }
      case "createTask": {
        assertRole(context, ["owner", "manager"]);
        await ensureProjectAccess(context, data.projectId, true);
        const assignee = await personInOrganization(context, data.assigneeId);
        if (context.role === "manager" && assignee.teamId !== context.teamId) throw new AuthError("You can only assign tasks to your team", 403);
        const [record] = await db.transaction(async (tx) => {
          const inserted = await tx.insert(tasks).values({ organizationId: context.organizationId, projectId: data.projectId, assigneeId: data.assigneeId, title: data.title, priority: data.priority, dueDate: data.dueDate }).returning();
          await tx.insert(projectMembers).values({ projectId: data.projectId, employeeId: data.assigneeId }).onConflictDoNothing();
          return inserted;
        });
        await audit(context, "task.assigned", "task", record.id, data.title);
        break;
      }
      case "updateTask": {
        const [task] = await db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId })
          .from(tasks).where(and(eq(tasks.id, data.taskId), eq(tasks.organizationId, context.organizationId))).limit(1);
        if (!task) throw new AuthError("Task not found", 404);
        if (context.role === "employee" && task.assigneeId !== context.employeeId) throw new AuthError("You can only update tasks assigned to you", 403);
        if (context.role === "manager") {
          if (task.assigneeId !== null) await assertManagerCanAccessEmployee(context, task.assigneeId);
          else await ensureProjectAccess(context, task.projectId, true);
        }
        const progress = data.status === "done" ? 100 : data.progress;
        await db.update(tasks).set({ status: data.status, ...(progress === undefined ? {} : { progress }), updatedAt: new Date() })
          .where(and(eq(tasks.id, data.taskId), eq(tasks.organizationId, context.organizationId)));
        await audit(context, "task.updated", "task", task.id, `${data.status}${progress === undefined ? "" : ` ${progress}%`}`);
        break;
      }
      case "startTimer": {
        const employeeId = assertSelf(context);
        await ensureProjectAccess(context, data.projectId);
        if (data.taskId) {
          const [task] = await db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId }).from(tasks)
            .where(and(eq(tasks.id, data.taskId), eq(tasks.organizationId, context.organizationId))).limit(1);
          if (!task || task.projectId !== data.projectId || (task.assigneeId !== employeeId && context.role !== "owner")) throw new AuthError("Task is unavailable", 403);
        }
        await db.transaction(async (tx) => {
          const existing = await tx.select({ id: timerStates.id }).from(timerStates).where(eq(timerStates.employeeId, employeeId));
          if (existing.length) throw new AuthError("You already have an active timer", 409);
          const startedAt = new Date();
          const [entry] = await tx.insert(timeEntries).values({ organizationId: context.organizationId, employeeId, projectId: data.projectId, taskId: data.taskId, startedAt, source: "timer" }).returning();
          await tx.insert(timerStates).values({ organizationId: context.organizationId, employeeId, projectId: data.projectId, taskId: data.taskId, entryId: entry.id, startedAt });
        });
        await audit(context, "timer.started", "employee", employeeId, null);
        break;
      }
      case "pauseTimer": {
        const employeeId = assertSelf(context);
        await db.transaction(async (tx) => {
          const [timer] = await tx.select().from(timerStates).where(and(eq(timerStates.employeeId, employeeId), eq(timerStates.organizationId, context.organizationId)));
          if (!timer) throw new AuthError("No active timer found", 404);
          if (timer.state === "paused") throw new AuthError("Timer is already paused", 409);
          const now = new Date();
          const accumulated = timer.accumulatedSeconds + secondsBetween(timer.startedAt, now.toISOString());
          await tx.update(timerStates).set({ state: "paused", pausedAt: now, accumulatedSeconds: accumulated, updatedAt: now }).where(eq(timerStates.id, timer.id));
        });
        await audit(context, "timer.paused", "employee", employeeId, null);
        break;
      }
      case "resumeTimer": {
        const employeeId = assertSelf(context);
        await db.transaction(async (tx) => {
          const [timer] = await tx.select().from(timerStates).where(and(eq(timerStates.employeeId, employeeId), eq(timerStates.organizationId, context.organizationId)));
          if (!timer) throw new AuthError("No active timer found", 404);
          if (timer.state !== "paused") throw new AuthError("Timer is already running", 409);
          await tx.update(timerStates).set({ state: "running", startedAt: new Date(), pausedAt: null, updatedAt: new Date() }).where(eq(timerStates.id, timer.id));
        });
        await audit(context, "timer.resumed", "employee", employeeId, null);
        break;
      }
      case "stopTimer": {
        const employeeId = assertSelf(context);
        await db.transaction(async (tx) => {
          const [timer] = await tx.select().from(timerStates).where(and(eq(timerStates.employeeId, employeeId), eq(timerStates.organizationId, context.organizationId)));
          if (!timer) throw new AuthError("No active timer found", 404);
          const now = new Date();
          const duration = timer.accumulatedSeconds + (timer.state === "paused" ? 0 : secondsBetween(timer.startedAt, now.toISOString()));
          await tx.update(timeEntries).set({ endedAt: now, durationSeconds: duration, updatedAt: now })
            .where(and(eq(timeEntries.id, timer.entryId), eq(timeEntries.organizationId, context.organizationId), eq(timeEntries.employeeId, employeeId)));
          await tx.delete(timerStates).where(and(eq(timerStates.id, timer.id), eq(timerStates.employeeId, employeeId)));
        });
        await audit(context, "timer.stopped", "employee", employeeId, null);
        break;
      }
      case "manualEntry": {
        const employeeId = assertSelf(context);
        await ensureProjectAccess(context, data.projectId);
        if (data.taskId) {
          const [task] = await db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId }).from(tasks)
            .where(and(eq(tasks.id, data.taskId), eq(tasks.organizationId, context.organizationId))).limit(1);
          if (!task || task.projectId !== data.projectId || (task.assigneeId !== employeeId && context.role !== "owner")) throw new AuthError("Task is unavailable", 403);
        }
        const start = new Date(`${data.workDate}T09:00:00.000Z`);
        const durationSeconds = Math.round(data.hours * 3600);
        const [record] = await db.insert(timeEntries).values({ organizationId: context.organizationId, employeeId, projectId: data.projectId, taskId: data.taskId, startedAt: start, endedAt: new Date(start.getTime() + durationSeconds * 1000), durationSeconds, note: data.note, source: "manual" }).returning();
        await audit(context, "time_entry.created", "time_entry", record.id, `${data.hours}h`);
        break;
      }
      case "clockIn": {
        const employeeId = assertSelf(context);
        const today = dateOnly(new Date());
        const [existing] = await db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), eq(attendance.organizationId, context.organizationId), eq(attendance.workDate, today)));
        if (existing) {
          if (existing.clockOut) throw new AuthError("Attendance is already complete for today", 409);
          const [openBreak] = await db.select({ id: breaks.id }).from(breaks).where(and(eq(breaks.attendanceId, existing.id), isNull(breaks.endedAt)));
          if (openBreak) throw new AuthError("End your break before clocking out", 409);
          await db.update(attendance).set({ clockOut: new Date(), updatedAt: new Date() }).where(and(eq(attendance.id, existing.id), eq(attendance.organizationId, context.organizationId)));
          await audit(context, "attendance.clock_out", "attendance", existing.id, null);
        } else {
          const [record] = await db.insert(attendance).values({ organizationId: context.organizationId, employeeId, workDate: today, clockIn: new Date() }).returning();
          await audit(context, "attendance.clock_in", "attendance", record.id, null);
        }
        break;
      }
      case "startBreak": {
        const employeeId = assertSelf(context);
        const today = dateOnly(new Date());
        const [shift] = await db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), eq(attendance.organizationId, context.organizationId), eq(attendance.workDate, today)));
        if (!shift || shift.clockOut) throw new AuthError("Clock in before starting a break", 409);
        const [open] = await db.select({ id: breaks.id }).from(breaks).where(and(eq(breaks.attendanceId, shift.id), isNull(breaks.endedAt)));
        if (open) throw new AuthError("A break is already running", 409);
        const [record] = await db.insert(breaks).values({ attendanceId: shift.id, startedAt: new Date() }).returning();
        await audit(context, "break.started", "break", record.id, null);
        break;
      }
      case "endBreak": {
        const employeeId = assertSelf(context);
        const today = dateOnly(new Date());
        const [shift] = await db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), eq(attendance.organizationId, context.organizationId), eq(attendance.workDate, today)));
        if (!shift) throw new AuthError("No attendance record for today", 404);
        const [open] = await db.select().from(breaks).where(and(eq(breaks.attendanceId, shift.id), isNull(breaks.endedAt)));
        if (!open) throw new AuthError("No open break to end", 404);
        await db.update(breaks).set({ endedAt: new Date(), updatedAt: new Date() }).where(eq(breaks.id, open.id));
        await audit(context, "break.ended", "break", open.id, null);
        break;
      }
      case "submitTimesheet": {
        const employeeId = assertSelf(context);
        const weekStartDate = organizationWeekStart(context);
        const weekStart = dateOnly(weekStartDate);
        const result = await db.transaction(async (tx) => {
          const [existing] = await tx.select().from(timesheets).where(and(eq(timesheets.employeeId, employeeId), eq(timesheets.organizationId, context.organizationId), eq(timesheets.weekStart, weekStart))).for("update");
          if (existing?.status === "approved") throw new AuthError("This timesheet has already been approved", 409);
          const aggregate = await tx.execute(sql`select coalesce(sum(duration_seconds), 0)::int as total from time_entries
            where organization_id=${context.organizationId} and employee_id=${employeeId} and started_at >= ${weekStartDate} and started_at < ${new Date(weekStartDate.getTime() + 7 * 86400000)}`);
          const total = Number((aggregate.rows[0] as { total?: number } | undefined)?.total ?? 0);
          if (total <= 0) throw new AuthError("Record time before submitting a timesheet", 400);
          const [sheet] = await tx.insert(timesheets).values({ organizationId: context.organizationId, employeeId, weekStart, status: "submitted", totalSeconds: total, submittedAt: new Date() })
            .onConflictDoUpdate({ target: [timesheets.employeeId, timesheets.weekStart], set: { status: "submitted", totalSeconds: total, submittedAt: new Date(), updatedAt: new Date() } }).returning();
          await tx.insert(approvals).values({ organizationId: context.organizationId, timesheetId: sheet.id, reviewerId: context.employeeId, status: "pending" })
            .onConflictDoUpdate({ target: approvals.timesheetId, set: { status: "pending", comment: null, reviewedAt: null, reviewerId: context.employeeId, updatedAt: new Date() } });
          await tx.insert(notifications).values({ organizationId: context.organizationId, employeeId: context.employeeId, title: "Timesheet submitted", body: `A timesheet totalling ${Math.round(total / 360) / 10}h is ready for review.`, kind: "approval", href: "/?view=approvals" });
          return sheet;
        });
        await audit(context, "timesheet.submitted", "timesheet", result.id, null);
        break;
      }
      case "reviewTimesheet": {
        assertRole(context, ["owner", "manager"]);
        const outcome = await db.transaction(async (tx) => {
          const locked = await tx.execute(sql`select a.id as approval_id, a.timesheet_id as timesheet_id, ts.employee_id as employee_id, ts.organization_id as organization_id
            from approvals a join timesheets ts on ts.id=a.timesheet_id
            where a.id=${data.approvalId} and a.organization_id=${context.organizationId} and ts.organization_id=${context.organizationId}
              and a.status='pending' for update of a, ts`);
          const row = locked.rows[0] as { approval_id: number; timesheet_id: number; employee_id: number; organization_id: number } | undefined;
          if (!row) throw new AuthError("Pending approval not found", 404);
          if (row.employee_id === context.employeeId) throw new AuthError("You cannot review your own timesheet", 403);
          await assertManagerCanAccessEmployee(context, row.employee_id);
          await tx.update(approvals).set({ status: data.decision, comment: data.comment, reviewedAt: new Date(), reviewerId: context.employeeId, updatedAt: new Date() }).where(eq(approvals.id, row.approval_id));
          const [sheet] = await tx.update(timesheets).set({ status: data.decision, updatedAt: new Date() }).where(and(eq(timesheets.id, row.timesheet_id), eq(timesheets.organizationId, context.organizationId))).returning({ employeeId: timesheets.employeeId });
          if (sheet) await tx.insert(notifications).values({ organizationId: context.organizationId, employeeId: sheet.employeeId, title: `Timesheet ${data.decision}`, body: data.comment, kind: "approval", href: "/?view=timesheets" });
          return row.timesheet_id;
        });
        await audit(context, `timesheet.${data.decision}`, "timesheet", outcome, data.comment);
        break;
      }
      case "requestLeave": {
        const employeeId = assertSelf(context);
        if (data.endDate < data.startDate) throw new AuthError("End date must be on or after the start date", 400);
        const [record] = await db.insert(leaveRequests).values({ organizationId: context.organizationId, employeeId, category: data.category, startDate: data.startDate, endDate: data.endDate, reason: data.reason }).returning();
        await audit(context, "leave.requested", "leave_request", record.id, data.category);
        break;
      }
      case "reviewLeave": {
        assertRole(context, ["owner", "manager"]);
        const [existing] = await db.select({ employeeId: leaveRequests.employeeId, status: leaveRequests.status }).from(leaveRequests)
          .where(and(eq(leaveRequests.id, data.leaveId), eq(leaveRequests.organizationId, context.organizationId))).limit(1);
        if (!existing || existing.status !== "pending") throw new AuthError("Pending leave request not found", 404);
        if (existing.employeeId === context.employeeId) throw new AuthError("You cannot review your own leave request", 403);
        await assertManagerCanAccessEmployee(context, existing.employeeId);
        const [record] = await db.update(leaveRequests).set({ status: data.decision, reviewerId: context.employeeId, reviewNote: data.note ?? null, reviewedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(leaveRequests.id, data.leaveId), eq(leaveRequests.organizationId, context.organizationId), eq(leaveRequests.status, "pending"))).returning();
        if (!record) throw new AuthError("Leave request was already reviewed", 409);
        await db.insert(notifications).values({ organizationId: context.organizationId, employeeId: record.employeeId, title: `Leave request ${data.decision}`, body: data.note ?? `${record.category} leave ${record.startDate} to ${record.endDate}`, kind: "leave", href: "/?view=leave" });
        await audit(context, `leave.${data.decision}`, "leave_request", record.id, data.note ?? null);
        break;
      }
      case "updateOrganization": {
        assertRole(context, ["owner"]);
        try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); }
        catch { throw new AuthError("Timezone is not recognized", 400); }
        const [record] = await db.update(organizations).set({ name: data.name, timezone: data.timezone, weekStartsOn: data.weekStartsOn, updatedAt: new Date() })
          .where(eq(organizations.id, context.organizationId)).returning({ id: organizations.id, name: organizations.name });
        if (!record) throw new AuthError("Organization not found", 404);
        await audit(context, "organization.updated", "organization", record.id, record.name);
        break;
      }
      case "markRead": {
        await db.update(notifications).set({ read: true, updatedAt: new Date() })
          .where(and(eq(notifications.id, data.notificationId), eq(notifications.organizationId, context.organizationId), eq(notifications.employeeId, context.employeeId)));
        break;
      }
      case "markAllRead": {
        await db.update(notifications).set({ read: true, updatedAt: new Date() })
          .where(and(eq(notifications.organizationId, context.organizationId), eq(notifications.employeeId, context.employeeId), eq(notifications.read, false)));
        break;
      }
    }

    return Response.json({ ok: true, data: await getWorkspace(context) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "Request failed";
    if (message.includes("unique") || message.includes("duplicate key")) return Response.json({ error: "That record already exists" }, { status: 409 });
    console.error("Workspace mutation failed", error);
    return Response.json({ error: "Could not complete the requested action" }, { status: 500 });
  }
}
