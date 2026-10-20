import { relations } from "drizzle-orm/relations";
import { organizations, employees, teams, authUsers, attendance, breaks, approvals, timesheets, auditEvents, departments, emailVerificationTokens, employeeInvitations, organizationDomains, leaveRequests, projects, projectMembers, tasks, authSessions, notifications, timeEntries, timerStates } from "./schema";

export const employeesRelations = relations(employees, ({one, many}) => ({
	organization: one(organizations, {
		fields: [employees.organizationId],
		references: [organizations.id]
	}),
	team: one(teams, {
		fields: [employees.teamId],
		references: [teams.id]
	}),
	authUsers: many(authUsers),
	attendances: many(attendance),
	approvals: many(approvals),
	auditEvents: many(auditEvents),
	employeeInvitations: many(employeeInvitations),
	leaveRequests_employeeId: many(leaveRequests, {
		relationName: "leaveRequests_employeeId_employees_id"
	}),
	leaveRequests_reviewerId: many(leaveRequests, {
		relationName: "leaveRequests_reviewerId_employees_id"
	}),
	projectMembers: many(projectMembers),
	tasks: many(tasks),
	timesheets: many(timesheets),
	notifications: many(notifications),
	timeEntries: many(timeEntries),
	timerStates: many(timerStates),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	employees: many(employees),
	attendances: many(attendance),
	approvals: many(approvals),
	auditEvents: many(auditEvents),
	departments: many(departments),
	employeeInvitations: many(employeeInvitations),
	organizationDomains: many(organizationDomains),
	leaveRequests: many(leaveRequests),
	projects: many(projects),
	tasks: many(tasks),
	timesheets: many(timesheets),
	teams: many(teams),
	notifications: many(notifications),
	timeEntries: many(timeEntries),
	timerStates: many(timerStates),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	employees: many(employees),
	organization: one(organizations, {
		fields: [teams.organizationId],
		references: [organizations.id]
	}),
	department: one(departments, {
		fields: [teams.departmentId],
		references: [departments.id]
	}),
}));

export const authUsersRelations = relations(authUsers, ({one, many}) => ({
	employee: one(employees, {
		fields: [authUsers.employeeId],
		references: [employees.id]
	}),
	emailVerificationTokens: many(emailVerificationTokens),
	employeeInvitations: many(employeeInvitations),
	authSessions: many(authSessions),
}));

export const breaksRelations = relations(breaks, ({one}) => ({
	attendance: one(attendance, {
		fields: [breaks.attendanceId],
		references: [attendance.id]
	}),
}));

export const attendanceRelations = relations(attendance, ({one, many}) => ({
	breaks: many(breaks),
	organization: one(organizations, {
		fields: [attendance.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [attendance.employeeId],
		references: [employees.id]
	}),
}));

export const approvalsRelations = relations(approvals, ({one}) => ({
	organization: one(organizations, {
		fields: [approvals.organizationId],
		references: [organizations.id]
	}),
	timesheet: one(timesheets, {
		fields: [approvals.timesheetId],
		references: [timesheets.id]
	}),
	employee: one(employees, {
		fields: [approvals.reviewerId],
		references: [employees.id]
	}),
}));

export const timesheetsRelations = relations(timesheets, ({one, many}) => ({
	approvals: many(approvals),
	organization: one(organizations, {
		fields: [timesheets.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [timesheets.employeeId],
		references: [employees.id]
	}),
}));

export const auditEventsRelations = relations(auditEvents, ({one}) => ({
	organization: one(organizations, {
		fields: [auditEvents.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [auditEvents.actorId],
		references: [employees.id]
	}),
}));

export const departmentsRelations = relations(departments, ({one, many}) => ({
	organization: one(organizations, {
		fields: [departments.organizationId],
		references: [organizations.id]
	}),
	teams: many(teams),
}));

export const emailVerificationTokensRelations = relations(emailVerificationTokens, ({one}) => ({
	authUser: one(authUsers, {
		fields: [emailVerificationTokens.userId],
		references: [authUsers.id]
	}),
}));

export const employeeInvitationsRelations = relations(employeeInvitations, ({one}) => ({
	organization: one(organizations, {
		fields: [employeeInvitations.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [employeeInvitations.employeeId],
		references: [employees.id]
	}),
	authUser: one(authUsers, {
		fields: [employeeInvitations.invitedByUserId],
		references: [authUsers.id]
	}),
}));

export const organizationDomainsRelations = relations(organizationDomains, ({one}) => ({
	organization: one(organizations, {
		fields: [organizationDomains.organizationId],
		references: [organizations.id]
	}),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({one}) => ({
	organization: one(organizations, {
		fields: [leaveRequests.organizationId],
		references: [organizations.id]
	}),
	employee_employeeId: one(employees, {
		fields: [leaveRequests.employeeId],
		references: [employees.id],
		relationName: "leaveRequests_employeeId_employees_id"
	}),
	employee_reviewerId: one(employees, {
		fields: [leaveRequests.reviewerId],
		references: [employees.id],
		relationName: "leaveRequests_reviewerId_employees_id"
	}),
}));

export const projectMembersRelations = relations(projectMembers, ({one}) => ({
	project: one(projects, {
		fields: [projectMembers.projectId],
		references: [projects.id]
	}),
	employee: one(employees, {
		fields: [projectMembers.employeeId],
		references: [employees.id]
	}),
}));

export const projectsRelations = relations(projects, ({one, many}) => ({
	projectMembers: many(projectMembers),
	organization: one(organizations, {
		fields: [projects.organizationId],
		references: [organizations.id]
	}),
	tasks: many(tasks),
	timeEntries: many(timeEntries),
	timerStates: many(timerStates),
}));

export const tasksRelations = relations(tasks, ({one, many}) => ({
	organization: one(organizations, {
		fields: [tasks.organizationId],
		references: [organizations.id]
	}),
	project: one(projects, {
		fields: [tasks.projectId],
		references: [projects.id]
	}),
	employee: one(employees, {
		fields: [tasks.assigneeId],
		references: [employees.id]
	}),
	timeEntries: many(timeEntries),
	timerStates: many(timerStates),
}));

export const authSessionsRelations = relations(authSessions, ({one}) => ({
	authUser: one(authUsers, {
		fields: [authSessions.userId],
		references: [authUsers.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	organization: one(organizations, {
		fields: [notifications.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [notifications.employeeId],
		references: [employees.id]
	}),
}));

export const timeEntriesRelations = relations(timeEntries, ({one, many}) => ({
	organization: one(organizations, {
		fields: [timeEntries.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [timeEntries.employeeId],
		references: [employees.id]
	}),
	project: one(projects, {
		fields: [timeEntries.projectId],
		references: [projects.id]
	}),
	task: one(tasks, {
		fields: [timeEntries.taskId],
		references: [tasks.id]
	}),
	timerStates: many(timerStates),
}));

export const timerStatesRelations = relations(timerStates, ({one}) => ({
	organization: one(organizations, {
		fields: [timerStates.organizationId],
		references: [organizations.id]
	}),
	employee: one(employees, {
		fields: [timerStates.employeeId],
		references: [employees.id]
	}),
	project: one(projects, {
		fields: [timerStates.projectId],
		references: [projects.id]
	}),
	task: one(tasks, {
		fields: [timerStates.taskId],
		references: [tasks.id]
	}),
	timeEntry: one(timeEntries, {
		fields: [timerStates.entryId],
		references: [timeEntries.id]
	}),
}));