import { pgTable, uniqueIndex, index, foreignKey, serial, integer, varchar, timestamp, text, boolean, date } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const employees = pgTable("employees", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	teamId: integer("team_id"),
	managerId: integer("manager_id"),
	name: varchar({ length: 160 }).notNull(),
	email: varchar({ length: 200 }).notNull(),
	title: varchar({ length: 140 }).notNull(),
	role: varchar({ length: 32 }).default('employee').notNull(),
	status: varchar({ length: 32 }).default('active').notNull(),
	avatarColor: varchar("avatar_color", { length: 16 }).default('#C8FF35').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("employees_org_email_uq").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.email.asc().nullsLast().op("int4_ops")),
	index("employees_team_idx").using("btree", table.teamId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "employees_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.teamId],
			foreignColumns: [teams.id],
			name: "employees_team_id_teams_id_fk"
		}).onDelete("set null"),
]);

export const authUsers = pgTable("auth_users", {
	id: serial().primaryKey().notNull(),
	employeeId: integer("employee_id").notNull(),
	email: varchar({ length: 200 }).notNull(),
	passwordHash: text("password_hash").notNull(),
	mustChangePassword: boolean("must_change_password").default(false).notNull(),
	role: varchar({ length: 16 }).notNull(),
	emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: 'string' }),
	disabledAt: timestamp("disabled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("auth_users_email_uq").using("btree", table.email.asc().nullsLast().op("text_ops")),
	uniqueIndex("auth_users_employee_uq").using("btree", table.employeeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "auth_users_employee_id_employees_id_fk"
		}).onDelete("cascade"),
]);

export const authRateLimits = pgTable("auth_rate_limits", {
	key: varchar({ length: 64 }).primaryKey().notNull(),
	windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: 'string' }).notNull(),
	attempts: integer().default(0).notNull(),
});

export const breaks = pgTable("breaks", {
	id: serial().primaryKey().notNull(),
	attendanceId: integer("attendance_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.attendanceId],
			foreignColumns: [attendance.id],
			name: "breaks_attendance_id_attendance_id_fk"
		}).onDelete("cascade"),
]);

export const attendance = pgTable("attendance", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	workDate: date("work_date").notNull(),
	clockIn: timestamp("clock_in", { withTimezone: true, mode: 'string' }).notNull(),
	clockOut: timestamp("clock_out", { withTimezone: true, mode: 'string' }),
	status: varchar({ length: 24 }).default('present').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("attendance_employee_date_uq").using("btree", table.employeeId.asc().nullsLast().op("int4_ops"), table.workDate.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "attendance_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "attendance_employee_id_employees_id_fk"
		}).onDelete("cascade"),
]);

export const approvals = pgTable("approvals", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	timesheetId: integer("timesheet_id").notNull(),
	reviewerId: integer("reviewer_id"),
	status: varchar({ length: 24 }).default('pending').notNull(),
	comment: text(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("approvals_timesheet_uq").using("btree", table.timesheetId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "approvals_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.timesheetId],
			foreignColumns: [timesheets.id],
			name: "approvals_timesheet_id_timesheets_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewerId],
			foreignColumns: [employees.id],
			name: "approvals_reviewer_id_employees_id_fk"
		}).onDelete("set null"),
]);

export const auditEvents = pgTable("audit_events", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	actorId: integer("actor_id"),
	action: varchar({ length: 80 }).notNull(),
	entityType: varchar("entity_type", { length: 60 }).notNull(),
	entityId: integer("entity_id"),
	details: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "audit_events_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [employees.id],
			name: "audit_events_actor_id_employees_id_fk"
		}).onDelete("set null"),
]);

export const departments = pgTable("departments", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 120 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("departments_org_idx").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "departments_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
]);

export const emailVerificationTokens = pgTable("email_verification_tokens", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("email_verification_token_uq").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("email_verification_user_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [authUsers.id],
			name: "email_verification_tokens_user_id_auth_users_id_fk"
		}).onDelete("cascade"),
]);

export const employeeInvitations = pgTable("employee_invitations", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	invitedByUserId: integer("invited_by_user_id"),
	email: varchar({ length: 200 }).notNull(),
	role: varchar({ length: 16 }).notNull(),
	tokenHash: varchar("token_hash", { length: 64 }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("employee_invitations_org_idx").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.email.asc().nullsLast().op("int4_ops")),
	uniqueIndex("employee_invitations_token_uq").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "employee_invitations_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "employee_invitations_employee_id_employees_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedByUserId],
			foreignColumns: [authUsers.id],
			name: "employee_invitations_invited_by_user_id_auth_users_id_fk"
		}).onDelete("set null"),
]);

export const organizationDomains = pgTable("organization_domains", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	domain: varchar({ length: 253 }).notNull(),
	status: varchar({ length: 16 }).default('pending').notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("organization_domains_domain_uq").using("btree", table.domain.asc().nullsLast().op("text_ops")),
	index("organization_domains_org_idx").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "organization_domains_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
]);

export const leaveRequests = pgTable("leave_requests", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	category: varchar({ length: 48 }).notNull(),
	startDate: date("start_date").notNull(),
	endDate: date("end_date").notNull(),
	reason: text(),
	status: varchar({ length: 24 }).default('pending').notNull(),
	reviewerId: integer("reviewer_id"),
	reviewNote: text("review_note"),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "leave_requests_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "leave_requests_employee_id_employees_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewerId],
			foreignColumns: [employees.id],
			name: "leave_requests_reviewer_id_employees_id_fk"
		}).onDelete("set null"),
]);

export const projectMembers = pgTable("project_members", {
	id: serial().primaryKey().notNull(),
	projectId: integer("project_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("project_members_uq").using("btree", table.projectId.asc().nullsLast().op("int4_ops"), table.employeeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "project_members_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "project_members_employee_id_employees_id_fk"
		}).onDelete("cascade"),
]);

export const projects = pgTable("projects", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	name: varchar({ length: 160 }).notNull(),
	code: varchar({ length: 16 }).notNull(),
	status: varchar({ length: 32 }).default('active').notNull(),
	deadline: date(),
	budgetHours: integer("budget_hours").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("projects_org_code_uq").using("btree", table.organizationId.asc().nullsLast().op("int4_ops"), table.code.asc().nullsLast().op("int4_ops")),
	index("projects_org_idx").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "projects_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
]);

export const tasks = pgTable("tasks", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	projectId: integer("project_id").notNull(),
	assigneeId: integer("assignee_id"),
	title: varchar({ length: 220 }).notNull(),
	status: varchar({ length: 32 }).default('todo').notNull(),
	priority: varchar({ length: 24 }).default('medium').notNull(),
	dueDate: date("due_date"),
	progress: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("tasks_assignee_idx").using("btree", table.assigneeId.asc().nullsLast().op("int4_ops")),
	index("tasks_project_idx").using("btree", table.projectId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "tasks_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "tasks_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.assigneeId],
			foreignColumns: [employees.id],
			name: "tasks_assignee_id_employees_id_fk"
		}).onDelete("set null"),
]);

export const organizations = pgTable("organizations", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 160 }).notNull(),
	timezone: varchar({ length: 64 }).default('UTC').notNull(),
	weekStartsOn: integer("week_starts_on").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const timesheets = pgTable("timesheets", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	weekStart: date("week_start").notNull(),
	status: varchar({ length: 24 }).default('draft').notNull(),
	totalSeconds: integer("total_seconds").default(0).notNull(),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("timesheets_employee_week_uq").using("btree", table.employeeId.asc().nullsLast().op("int4_ops"), table.weekStart.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "timesheets_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "timesheets_employee_id_employees_id_fk"
		}).onDelete("cascade"),
]);

export const authSessions = pgTable("auth_sessions", {
	id: serial().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	sessionHash: varchar("session_hash", { length: 64 }).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("auth_sessions_hash_uq").using("btree", table.sessionHash.asc().nullsLast().op("text_ops")),
	index("auth_sessions_user_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [authUsers.id],
			name: "auth_sessions_user_id_auth_users_id_fk"
		}).onDelete("cascade"),
]);

export const teams = pgTable("teams", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	departmentId: integer("department_id"),
	name: varchar({ length: 120 }).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("teams_org_idx").using("btree", table.organizationId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "teams_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.departmentId],
			foreignColumns: [departments.id],
			name: "teams_department_id_departments_id_fk"
		}).onDelete("set null"),
]);

export const notifications = pgTable("notifications", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	title: varchar({ length: 180 }).notNull(),
	body: text().notNull(),
	kind: varchar({ length: 32 }).default('info').notNull(),
	href: varchar({ length: 200 }),
	read: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "notifications_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "notifications_employee_id_employees_id_fk"
		}).onDelete("cascade"),
]);

export const timeEntries = pgTable("time_entries", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	projectId: integer("project_id").notNull(),
	taskId: integer("task_id"),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	durationSeconds: integer("duration_seconds").default(0).notNull(),
	note: text(),
	source: varchar({ length: 24 }).default('timer').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("time_entries_employee_started_idx").using("btree", table.employeeId.asc().nullsLast().op("int4_ops"), table.startedAt.asc().nullsLast().op("int4_ops")),
	index("time_entries_project_idx").using("btree", table.projectId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "time_entries_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "time_entries_employee_id_employees_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "time_entries_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.id],
			name: "time_entries_task_id_tasks_id_fk"
		}).onDelete("set null"),
]);

export const timerStates = pgTable("timer_states", {
	id: serial().primaryKey().notNull(),
	organizationId: integer("organization_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	projectId: integer("project_id").notNull(),
	taskId: integer("task_id"),
	entryId: integer("entry_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).notNull(),
	pausedAt: timestamp("paused_at", { withTimezone: true, mode: 'string' }),
	accumulatedSeconds: integer("accumulated_seconds").default(0).notNull(),
	state: varchar({ length: 24 }).default('running').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("active_timer_employee_uq").using("btree", table.employeeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.organizationId],
			foreignColumns: [organizations.id],
			name: "timer_states_organization_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "timer_states_employee_id_employees_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "timer_states_project_id_projects_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.id],
			name: "timer_states_task_id_tasks_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.entryId],
			foreignColumns: [timeEntries.id],
			name: "timer_states_entry_id_time_entries_id_fk"
		}).onDelete("cascade"),
]);
