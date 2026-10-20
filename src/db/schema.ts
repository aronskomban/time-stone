import { boolean, date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).default("UTC").notNull(),
  weekStartsOn: integer("week_starts_on").default(1).notNull(),
  ...audit,
});

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  ...audit,
}, (t) => [index("departments_org_idx").on(t.organizationId)]);

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  ...audit,
}, (t) => [index("teams_org_idx").on(t.organizationId)]);

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
  managerId: integer("manager_id"),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 200 }).notNull(),
  title: varchar("title", { length: 140 }).notNull(),
  role: varchar("role", { length: 32 }).default("employee").notNull(),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  avatarColor: varchar("avatar_color", { length: 16 }).default("#C8FF35").notNull(),
  ...audit,
}, (t) => [uniqueIndex("employees_org_email_uq").on(t.organizationId, t.email), index("employees_team_idx").on(t.teamId)]);

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  code: varchar("code", { length: 16 }).notNull(),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  deadline: date("deadline"),
  budgetHours: integer("budget_hours").default(0).notNull(),
  ...audit,
}, (t) => [uniqueIndex("projects_org_code_uq").on(t.organizationId, t.code), index("projects_org_idx").on(t.organizationId)]);

export const projectMembers = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  ...audit,
}, (t) => [uniqueIndex("project_members_uq").on(t.projectId, t.employeeId)]);

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  assigneeId: integer("assignee_id").references(() => employees.id, { onDelete: "set null" }),
  title: varchar("title", { length: 220 }).notNull(),
  status: varchar("status", { length: 32 }).default("todo").notNull(),
  priority: varchar("priority", { length: 24 }).default("medium").notNull(),
  dueDate: date("due_date"),
  progress: integer("progress").default(0).notNull(),
  ...audit,
}, (t) => [index("tasks_project_idx").on(t.projectId), index("tasks_assignee_idx").on(t.assigneeId)]);

export const timeEntries = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds").default(0).notNull(),
  note: text("note"),
  source: varchar("source", { length: 24 }).default("timer").notNull(),
  ...audit,
}, (t) => [index("time_entries_employee_started_idx").on(t.employeeId, t.startedAt), index("time_entries_project_idx").on(t.projectId)]);

export const timerStates = pgTable("timer_states", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }).notNull(),
  taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
  entryId: integer("entry_id").references(() => timeEntries.id, { onDelete: "cascade" }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  accumulatedSeconds: integer("accumulated_seconds").default(0).notNull(),
  state: varchar("state", { length: 24 }).default("running").notNull(),
  ...audit,
}, (t) => [uniqueIndex("active_timer_employee_uq").on(t.employeeId)]);

export const attendance = pgTable("attendance", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  workDate: date("work_date").notNull(),
  clockIn: timestamp("clock_in", { withTimezone: true }).notNull(),
  clockOut: timestamp("clock_out", { withTimezone: true }),
  status: varchar("status", { length: 24 }).default("present").notNull(),
  ...audit,
}, (t) => [uniqueIndex("attendance_employee_date_uq").on(t.employeeId, t.workDate)]);

export const breaks = pgTable("breaks", {
  id: serial("id").primaryKey(),
  attendanceId: integer("attendance_id").references(() => attendance.id, { onDelete: "cascade" }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  ...audit,
});

export const timesheets = pgTable("timesheets", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  weekStart: date("week_start").notNull(),
  status: varchar("status", { length: 24 }).default("draft").notNull(),
  totalSeconds: integer("total_seconds").default(0).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("timesheets_employee_week_uq").on(t.employeeId, t.weekStart)]);

export const approvals = pgTable("approvals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  timesheetId: integer("timesheet_id").references(() => timesheets.id, { onDelete: "cascade" }).notNull(),
  reviewerId: integer("reviewer_id").references(() => employees.id, { onDelete: "set null" }),
  status: varchar("status", { length: 24 }).default("pending").notNull(),
  comment: text("comment"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("approvals_timesheet_uq").on(t.timesheetId)]);

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  category: varchar("category", { length: 48 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  status: varchar("status", { length: 24 }).default("pending").notNull(),
  reviewerId: integer("reviewer_id").references(() => employees.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  ...audit,
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  kind: varchar("kind", { length: 32 }).default("info").notNull(),
  href: varchar("href", { length: 200 }),
  read: boolean("read").default(false).notNull(),
  ...audit,
});

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  actorId: integer("actor_id").references(() => employees.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entity_type", { length: 60 }).notNull(),
  entityId: integer("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Password hashes and authoritative roles are never returned to clients. */
export const authUsers = pgTable("auth_users", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  email: varchar("email", { length: 200 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("auth_users_email_uq").on(t.email), uniqueIndex("auth_users_employee_uq").on(t.employeeId)]);

/** Opaque random session secrets are hashed at rest. */
export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => authUsers.id, { onDelete: "cascade" }).notNull(),
  sessionHash: varchar("session_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("auth_sessions_hash_uq").on(t.sessionHash), index("auth_sessions_user_idx").on(t.userId)]);

/** A domain is globally claimed only after its owner verifies their email. */
export const organizationDomains = pgTable("organization_domains", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  domain: varchar("domain", { length: 253 }).notNull(),
  status: varchar("status", { length: 16 }).default("pending").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("organization_domains_domain_uq").on(t.domain), index("organization_domains_org_idx").on(t.organizationId)]);

/** Invitation role is set by an owner on the server, never by the invitee. */
export const employeeInvitations = pgTable("employee_invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  employeeId: integer("employee_id").references(() => employees.id, { onDelete: "cascade" }).notNull(),
  invitedByUserId: integer("invited_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
  email: varchar("email", { length: 200 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("employee_invitations_token_uq").on(t.tokenHash), index("employee_invitations_org_idx").on(t.organizationId, t.email)]);

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => authUsers.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("email_verification_token_uq").on(t.tokenHash), index("email_verification_user_idx").on(t.userId)]);

/** Fixed-window rate limits live in Postgres so they are shared across workers. */
export const authRateLimits = pgTable("auth_rate_limits", {
  key: varchar("key", { length: 64 }).primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").default(0).notNull(),
});
