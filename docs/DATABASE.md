# Database

PostgreSQL is accessed through Drizzle ORM. Apply changes with `npx drizzle-kit push`.

## Entities

`organizations` owns `departments`, `teams`, `employees`, `projects`, `tasks`, `time_entries`, `timer_states`, `attendance`, `breaks`, `timesheets`, `approvals`, `leave_requests`, `notifications`, and `audit_events`. `project_members` models many-to-many staffing.

Key relationships:

- Employees belong to a team and may reference a manager within the same table.
- Tasks belong to a project and may reference an assignee.
- Time entries reference an employee, project, and optional task.
- Timer state references the open time entry it is accumulating into.
- Attendance is per employee and work date; `breaks` belong to an attendance record.
- Each timesheet has at most one approval row.
- Leave requests carry `reviewer_id`, `review_note`, and `reviewed_at` once decided.

Tracked work time and attendance are intentionally separate tables: a timer entry never implies presence, and presence never implies billable time.

## Integrity and indexes

- Employee email unique per organization; project code unique per organization.
- Project membership unique per project/employee.
- Timer state unique per employee, which structurally prevents duplicate active timers.
- Attendance unique per employee/work date.
- Timesheet unique per employee/week start; approval unique per timesheet.
- Explicit foreign-key delete behavior on every relation.
- Timezone-aware timestamps for all operational instants; dates stored as `date`.
- Indexes cover organization, team, project, assignee, and employee/time lookups.

## Seeding

`ensureWorkspace()` takes a transaction-scoped advisory lock, re-checks emptiness inside that transaction, and seeds one coherent organization only when no organizations exist. This makes concurrent cold starts safe; verified by issuing parallel first requests after truncation and asserting a single organization.

## Concurrency notes

Timer start and stop, task creation with membership, and seeding each run in a transaction. Timer duration is computed server-side from `started_at` plus banked `accumulated_seconds`, so a paused timer cannot accrue time and a client clock cannot inflate a duration.
