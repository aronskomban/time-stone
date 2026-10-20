# API

Base path: `/api/v1/workspace`

## GET

Returns the full workspace payload: organization preferences, server clock and week boundaries, employees with managers, teams, projects with tracked seconds and staffing, project memberships, tasks, recent time entries, all-time time-by-employee totals, attendance with break seconds, break log, weekly work logs, timesheets with approvals, leave requests with review notes, notifications, active timer state, dashboard aggregates, workload, and the attendance heatmap.

`now`, `today`, `weekStart`, and `weekDays` are server-authoritative so the client never renders from a divergent clock.

## POST actions

Requests use an `action` discriminator and are validated with Zod. Server errors return HTTP 400 with `{ error }`. `actorId` selects the acting development employee for audit attribution and must be replaced by a server session in production.

| Action | Payload | Notes |
| --- | --- | --- |
| `createTeam` | name, description? | |
| `createEmployee` | name, email, title, teamId | Email lowercased and unique per organization |
| `updateEmployee` | employeeId, name, title, teamId, role, status | Role: employee/manager/admin. Status: active/on_leave/inactive |
| `createProject` | name, code, deadline, budgetHours | Code uppercased, unique per organization |
| `addProjectMember` | projectId, employeeId | Idempotent on conflict |
| `removeProjectMember` | projectId, employeeId | |
| `createTask` | title, projectId, assigneeId, priority, dueDate | Assignee is also added to project membership in one transaction |
| `updateTask` | taskId, status, progress? | `done` forces progress to 100 |
| `startTimer` | employeeId, projectId, taskId? | Rejects a second timer; creates the open time entry |
| `pauseTimer` | employeeId | Banks elapsed seconds and sets state to paused |
| `resumeTimer` | employeeId | Restarts the running segment |
| `stopTimer` | employeeId | Writes `endedAt` and the exact duration, deletes timer state |
| `manualEntry` | employeeId, projectId, taskId?, workDate, hours, note? | hours > 0 and <= 24 |
| `clockIn` | employeeId | First call clocks in, second clocks out |
| `startBreak` | employeeId | Requires an open shift and rejects a second open break |
| `endBreak` | employeeId | Closes the open break |
| `submitTimesheet` | employeeId | Rejects zero-hour weeks and re-submitting an approved sheet; creates a pending approval and notification |
| `reviewTimesheet` | approvalId, decision, comment | Syncs approval and timesheet state, notifies the employee |
| `requestLeave` | employeeId, category, startDate, endDate, reason | Rejects inverted ranges |
| `reviewLeave` | leaveId, decision, note? | Records reviewer, note, and timestamp, then notifies the employee |
| `updateOrganization` | name, timezone, weekStartsOn | |
| `markRead` | notificationId | |
| `markAllRead` | – | |

Mutations respond `{ ok: true, data: WorkspaceData }` so the client can replace state without a refetch.
