import { db } from "@/db";
import { sql, type SQL } from "drizzle-orm";
import { dateOnly, weekDates } from "@/lib/format";
import type { AuthContext } from "@/lib/auth";

export type EmployeeRow = {
  id: number; name: string; email: string; title: string; role: string; status: string;
  teamId: number | null; team: string | null; managerId: number | null; manager: string | null; avatarColor: string;
};

export type WorkspaceData = {
  organization: { id: number; name: string; timezone: string; weekStartsOn: number };
  now: string;
  today: string;
  weekStart: string;
  weekDays: string[];
  employees: EmployeeRow[];
  teams: Array<{ id: number; name: string; description: string | null; department: string | null; departmentId: number | null; members: number }>;
  projects: Array<{ id: number; name: string; code: string; status: string; deadline: string | null; budgetHours: number; trackedSeconds: number; taskCount: number; members: number }>;
  projectMembers: Array<{ id: number; projectId: number; employeeId: number; employee: string }>;
  tasks: Array<{ id: number; title: string; status: string; priority: string; dueDate: string | null; progress: number; projectId: number; project: string; assigneeId: number | null; assignee: string | null }>;
  entries: Array<{ id: number; employeeId: number; employee: string; projectId: number; project: string; taskId: number | null; task: string | null; startedAt: string; endedAt: string | null; durationSeconds: number; note: string | null; source: string }>;
  timeByEmployee: Array<{ employeeId: number; employee: string; seconds: number; entries: number }>;
  attendance: Array<{ id: number; employeeId: number; employee: string; workDate: string; clockIn: string; clockOut: string | null; status: string; breakSeconds: number }>;
  breaks: Array<{ id: number; attendanceId: number; employeeId: number; employee: string; workDate: string; startedAt: string; endedAt: string | null }>;
  weekGrid: Array<{ employeeId: number; employee: string; days: number[]; total: number; status: string | null }>;
  timesheets: Array<{ id: number; employeeId: number; employee: string; weekStart: string; status: string; totalSeconds: number; submittedAt: string | null; approvalId: number | null; approvalStatus: string | null; comment: string | null }>;
  leaves: Array<{ id: number; employeeId: number; employee: string; category: string; startDate: string; endDate: string; reason: string | null; status: string; reviewNote: string | null; reviewedAt: string | null }>;
  notifications: Array<{ id: number; title: string; body: string; kind: string; read: boolean; view: string | null; createdAt: string }>;
  activeTimer: null | { id: number; employeeId: number; employee: string; projectId: number; taskId: number | null; entryId: number; startedAt: string; pausedAt: string | null; state: string; accumulatedSeconds: number };
  stats: { employeeCount: number; weekSeconds: number; openTasks: number; activeProjects: number; pendingApprovals: number; pendingLeave: number };
  workload: Array<{ name: string; label: string; tracked: number; budget: number }>;
  heatmap: Array<{ day: string; present: number; total: number }>;
};

function list<T>(result: { rows: unknown[] }): T[] { return result.rows as T[]; }
function iso(value: unknown): string { return new Date(value as string).toISOString(); }
function optionalIso(value: unknown): string | null { return value ? new Date(value as string).toISOString() : null; }

/** SQL scope for any employee-id column. Alias strings are constants at call sites. */
function personScope(column: string, context: AuthContext): SQL {
  const columnSql = sql.raw(column);
  if (context.role === "owner") return sql`true`;
  if (context.role === "employee") return sql`${columnSql} = ${context.employeeId}`;
  if (context.teamId === null) return sql`false`;
  return sql`${columnSql} in (select scoped_employee.id from employees scoped_employee where scoped_employee.organization_id = ${context.organizationId} and scoped_employee.team_id = ${context.teamId})`;
}

function projectScope(alias: string, context: AuthContext): SQL {
  if (context.role === "owner") return sql`true`;
  if (context.role === "employee") return sql`exists (select 1 from project_members scope_pm where scope_pm.project_id = ${sql.raw(`${alias}.id`)} and scope_pm.employee_id = ${context.employeeId})`;
  if (context.teamId === null) return sql`false`;
  return sql`exists (
    select 1 from project_members scope_pm join employees scope_member on scope_member.id = scope_pm.employee_id
    where scope_pm.project_id = ${sql.raw(`${alias}.id`)} and scope_member.organization_id = ${context.organizationId}
      and scope_member.team_id = ${context.teamId}
  )`;
}

function weekStartFor(date: Date, startsOn: number): Date {
  const result = new Date(date);
  const day = result.getUTCDay();
  const difference = (day - startsOn + 7) % 7;
  result.setUTCDate(result.getUTCDate() - difference);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Every query derives organization and record scope from the authenticated server
 * context. Never call this with request-supplied ids, roles, or organization ids.
 */
export async function getWorkspace(context: AuthContext): Promise<WorkspaceData> {
  const now = new Date();
  const today = dateOnly(now);
  const weekStartDate = weekStartFor(now, context.weekStartsOn);
  const weekStart = dateOnly(weekStartDate);
  const weekDays = weekDates(weekStartDate);
  const visibleEmployees = personScope("e.id", context);
  const visibleMember = personScope("pm.employee_id", context);
  const visibleAssignee = personScope("ta.assignee_id", context);
  const visibleEntry = personScope("te.employee_id", context);
  const visibleAttendance = personScope("a.employee_id", context);
  const visibleTimesheet = personScope("ts.employee_id", context);
  const visibleLeave = personScope("l.employee_id", context);
  const visibleProject = projectScope("p", context);

  const [employeeResult, teamResult, projectResult, memberResult, taskResult, entryResult, weekResult, employeeTotalsResult, attendanceResult, breakResult, sheetResult, leaveResult, notificationResult, timerResult] = await Promise.all([
    db.execute(sql`select e.id, e.name, e.email, e.title, e.role, e.status, e.team_id as "teamId", t.name as team, e.manager_id as "managerId", m.name as manager, e.avatar_color as "avatarColor"
      from employees e left join teams t on t.id = e.team_id left join employees m on m.id = e.manager_id
      where e.organization_id = ${context.organizationId} and (${visibleEmployees}) order by e.name`),
    db.execute(sql`select t.id, t.name, t.description, t.department_id as "departmentId", d.name as department, count(e.id)::int as members
      from teams t left join departments d on d.id = t.department_id
      left join employees e on e.team_id = t.id and e.organization_id = ${context.organizationId}
      where t.organization_id = ${context.organizationId} and (${context.role === "owner" ? sql`true` : context.teamId === null ? sql`false` : sql`t.id = ${context.teamId}`})
      group by t.id, t.department_id, d.name order by t.name`),
    db.execute(sql`select p.id, p.name, p.code, p.status, p.deadline, p.budget_hours as "budgetHours",
        coalesce(sum(case when (${visibleEntry}) then te.duration_seconds else 0 end), 0)::int as "trackedSeconds",
        count(distinct case when (${visibleAssignee}) then ta.id end)::int as "taskCount",
        count(distinct case when (${visibleMember}) then pm.employee_id end)::int as members
      from projects p
      left join time_entries te on te.project_id = p.id and te.organization_id = ${context.organizationId}
      left join tasks ta on ta.project_id = p.id and ta.organization_id = ${context.organizationId}
      left join project_members pm on pm.project_id = p.id
      where p.organization_id = ${context.organizationId} and (${visibleProject})
      group by p.id order by p.created_at`),
    db.execute(sql`select pm.id, pm.project_id as "projectId", pm.employee_id as "employeeId", e.name as employee
      from project_members pm join employees e on e.id = pm.employee_id
      where e.organization_id = ${context.organizationId} and (${visibleMember})
        and pm.project_id in (select p.id from projects p where p.organization_id = ${context.organizationId} and (${visibleProject}))
      order by e.name`),
    db.execute(sql`select ta.id, ta.title, ta.status, ta.priority, ta.due_date as "dueDate", ta.progress,
        ta.project_id as "projectId", p.name as project, ta.assignee_id as "assigneeId", e.name as assignee
      from tasks ta join projects p on p.id = ta.project_id left join employees e on e.id = ta.assignee_id
      where ta.organization_id = ${context.organizationId} and p.organization_id = ${context.organizationId}
        and (${visibleProject}) and ((${visibleAssignee}) or (${context.role === "manager" ? sql`ta.assignee_id is null` : sql`false`}))
      order by ta.created_at desc`),
    db.execute(sql`select te.id, te.employee_id as "employeeId", e.name as employee, te.project_id as "projectId", p.name as project,
        te.task_id as "taskId", ta.title as task, te.started_at as "startedAt", te.ended_at as "endedAt",
        te.duration_seconds as "durationSeconds", te.note, te.source
      from time_entries te join employees e on e.id = te.employee_id join projects p on p.id = te.project_id left join tasks ta on ta.id = te.task_id
      where te.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and (${visibleEntry})
      order by te.started_at desc limit 25`),
    db.execute(sql`select te.employee_id as "employeeId", e.name as employee, te.started_at as "startedAt", te.duration_seconds as "durationSeconds"
      from time_entries te join employees e on e.id = te.employee_id
      where te.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and te.started_at >= ${weekStartDate} and (${visibleEntry})
      order by te.started_at`),
    db.execute(sql`select te.employee_id as "employeeId", e.name as employee, coalesce(sum(te.duration_seconds), 0)::int as seconds, count(*)::int as entries
      from time_entries te join employees e on e.id = te.employee_id
      where te.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and (${visibleEntry})
      group by te.employee_id, e.name order by seconds desc`),
    db.execute(sql`select a.id, a.employee_id as "employeeId", e.name as employee, a.work_date as "workDate", a.clock_in as "clockIn", a.clock_out as "clockOut", a.status
      from attendance a join employees e on e.id = a.employee_id
      where a.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and (${visibleAttendance})
      order by a.work_date desc, a.clock_in desc limit 100`),
    db.execute(sql`select b.id, b.attendance_id as "attendanceId", a.employee_id as "employeeId", e.name as employee, a.work_date as "workDate", b.started_at as "startedAt", b.ended_at as "endedAt"
      from breaks b join attendance a on a.id = b.attendance_id join employees e on e.id = a.employee_id
      where a.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and (${visibleAttendance})
      order by b.started_at desc limit 100`),
    db.execute(sql`select ts.id, ts.employee_id as "employeeId", e.name as employee, ts.week_start as "weekStart", ts.status,
        ts.total_seconds as "totalSeconds", ts.submitted_at as "submittedAt", ap.id as "approvalId", ap.status as "approvalStatus", ap.comment
      from timesheets ts join employees e on e.id = ts.employee_id left join approvals ap on ap.timesheet_id = ts.id
      where ts.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and (${visibleTimesheet})
      order by ts.week_start desc, e.name`),
    db.execute(sql`select l.id, l.employee_id as "employeeId", e.name as employee, l.category, l.start_date as "startDate", l.end_date as "endDate", l.reason, l.status, l.review_note as "reviewNote", l.reviewed_at as "reviewedAt"
      from leave_requests l join employees e on e.id = l.employee_id
      where l.organization_id = ${context.organizationId} and e.organization_id = ${context.organizationId} and (${visibleLeave})
      order by l.start_date desc`),
    db.execute(sql`select id, title, body, kind, read, href, created_at as "createdAt"
      from notifications where organization_id = ${context.organizationId} and employee_id = ${context.employeeId}
      order by read asc, created_at desc limit 50`),
    db.execute(sql`select ts.id, ts.employee_id as "employeeId", e.name as employee, ts.project_id as "projectId", ts.task_id as "taskId", ts.entry_id as "entryId",
        ts.started_at as "startedAt", ts.paused_at as "pausedAt", ts.state, ts.accumulated_seconds as "accumulatedSeconds"
      from timer_states ts join employees e on e.id = ts.employee_id
      where ts.organization_id = ${context.organizationId} and ts.employee_id = ${context.employeeId} limit 1`),
  ]);

  const employeeRows = list<EmployeeRow>(employeeResult);
  const teamRows = list<WorkspaceData["teams"][number]>(teamResult).map((row) => ({ ...row, members: Number(row.members) }));
  const projectRows = list<WorkspaceData["projects"][number]>(projectResult).map((project) => ({
    ...project, budgetHours: Number(project.budgetHours), trackedSeconds: Number(project.trackedSeconds),
    taskCount: Number(project.taskCount), members: Number(project.members),
  }));
  const taskRows = list<WorkspaceData["tasks"][number]>(taskResult).map((row) => ({ ...row, progress: Number(row.progress) }));
  const breakRows = list<WorkspaceData["breaks"][number]>(breakResult).map((row) => ({ ...row, startedAt: iso(row.startedAt), endedAt: optionalIso(row.endedAt) }));
  const breakByAttendance = new Map<number, number>();
  for (const row of breakRows) {
    const end = row.endedAt ?? now.toISOString();
    const seconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(row.startedAt).getTime()) / 1000));
    breakByAttendance.set(row.attendanceId, (breakByAttendance.get(row.attendanceId) ?? 0) + seconds);
  }
  const attendanceRows = list<Omit<WorkspaceData["attendance"][number], "breakSeconds">>(attendanceResult)
    .map((row) => ({ ...row, clockIn: iso(row.clockIn), clockOut: optionalIso(row.clockOut), breakSeconds: breakByAttendance.get(row.id) ?? 0 }));
  const weekly = list<{ employeeId: number; employee: string; startedAt: string; durationSeconds: number }>(weekResult);
  const weekSeconds = weekly.reduce((sum, row) => sum + Number(row.durationSeconds), 0);
  const sheetRows = list<WorkspaceData["timesheets"][number]>(sheetResult).map((row) => ({ ...row, totalSeconds: Number(row.totalSeconds), submittedAt: optionalIso(row.submittedAt) }));
  const sheetStatusByEmployee = new Map(sheetRows.filter((row) => row.weekStart === weekStart).map((row) => [row.employeeId, row.status]));
  const gridMap = new Map<number, { employee: string; days: number[]; total: number }>();
  for (const row of employeeRows) gridMap.set(row.id, { employee: row.name, days: weekDays.map(() => 0), total: 0 });
  for (const row of weekly) {
    const slot = gridMap.get(row.employeeId);
    if (!slot) continue;
    const dayIndex = weekDays.indexOf(dateOnly(new Date(row.startedAt)));
    if (dayIndex >= 0) slot.days[dayIndex] += Number(row.durationSeconds);
    slot.total += Number(row.durationSeconds);
  }
  const heatmapCounts = new Map<string, number>();
  for (const row of attendanceRows) heatmapCounts.set(row.workDate, (heatmapCounts.get(row.workDate) ?? 0) + 1);
  const recentSeven = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now);
    day.setUTCDate(now.getUTCDate() - 6 + index);
    return dateOnly(day);
  });
  const projectMembersRows = list<WorkspaceData["projectMembers"][number]>(memberResult);
  const timeByEmployee = list<WorkspaceData["timeByEmployee"][number]>(employeeTotalsResult).map((row) => ({ ...row, seconds: Number(row.seconds), entries: Number(row.entries) }));
  const leaveRows = list<WorkspaceData["leaves"][number]>(leaveResult).map((row) => ({ ...row, reviewedAt: optionalIso(row.reviewedAt) }));
  const entryRows = list<WorkspaceData["entries"][number]>(entryResult).map((row) => ({ ...row, durationSeconds: Number(row.durationSeconds), startedAt: iso(row.startedAt), endedAt: optionalIso(row.endedAt) }));
  const activeTimerRow = list<NonNullable<WorkspaceData["activeTimer"]>>(timerResult)[0];

  return {
    organization: { id: context.organizationId, name: context.organizationName, timezone: context.timezone, weekStartsOn: context.weekStartsOn },
    now: now.toISOString(), today, weekStart, weekDays,
    employees: employeeRows,
    teams: teamRows,
    projects: projectRows,
    projectMembers: projectMembersRows,
    tasks: taskRows,
    entries: entryRows,
    timeByEmployee,
    attendance: attendanceRows,
    breaks: breakRows,
    weekGrid: Array.from(gridMap, ([employeeId, slot]) => ({ employeeId, employee: slot.employee, days: slot.days, total: slot.total, status: sheetStatusByEmployee.get(employeeId) ?? null })),
    timesheets: sheetRows,
    leaves: leaveRows,
    notifications: list<Omit<WorkspaceData["notifications"][number], "createdAt" | "view"> & { createdAt: string; href: string | null }>(notificationResult).map((row) => ({
      id: row.id, title: row.title, body: row.body, kind: row.kind, read: row.read,
      view: row.href?.match(/view=([a-z]+)/)?.[1] ?? null, createdAt: iso(row.createdAt),
    })),
    activeTimer: activeTimerRow ? {
      id: activeTimerRow.id, employeeId: activeTimerRow.employeeId, employee: employeeRows.find((employee) => employee.id === activeTimerRow.employeeId)?.name ?? context.name,
      projectId: activeTimerRow.projectId, taskId: activeTimerRow.taskId, entryId: activeTimerRow.entryId,
      startedAt: iso(activeTimerRow.startedAt), pausedAt: optionalIso(activeTimerRow.pausedAt), state: activeTimerRow.state,
      accumulatedSeconds: Number(activeTimerRow.accumulatedSeconds),
    } : null,
    stats: {
      employeeCount: employeeRows.filter((row) => row.status === "active").length,
      weekSeconds,
      openTasks: taskRows.filter((row) => row.status !== "done").length,
      activeProjects: projectRows.filter((row) => row.status === "active").length,
      pendingApprovals: sheetRows.filter((row) => row.approvalStatus === "pending").length,
      pendingLeave: leaveRows.filter((row) => row.status === "pending").length,
    },
    workload: projectRows.map((project) => ({ name: project.code, label: project.name, tracked: Math.round(project.trackedSeconds / 3600), budget: project.budgetHours })),
    heatmap: recentSeven.map((day) => ({ day, present: heatmapCounts.get(day) ?? 0, total: employeeRows.length })),
  };
}
