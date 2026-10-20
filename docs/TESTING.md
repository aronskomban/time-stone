# Testing

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| Route and app types | `npx next typegen` | Pass |
| Strict TypeScript | `npm exec tsc -- --noEmit --pretty false` | Pass, no errors |
| Unit tests | `npx vitest run` | Pass, 34 tests in 1 file |
| Production build | `npm run build` | Pass |
| Managed start and health | `build_and_start` (`/api/health`) | Pass |
| Rendered page smoke test | `curl /` | HTTP 200 |
| Workflow integration | scripted `POST` assertions against `/api/v1/workspace` | Pass, 23 assertions |

## Unit test coverage

`src/lib/format.test.ts` covers clock formatting, hour formatting and rounding, initial extraction, Monday-of-week calculation across a week boundary, seven-day sequence generation, date and weekday labels including invalid input, elapsed-seconds math with negative and invalid clamping, running versus paused timer accumulation, closed and open break totals, and CSV escaping for separators, quotes, and multiline values.

## Integration coverage

Executed against the running server and real PostgreSQL: duplicate timer rejection, pause freezing accumulation, resume, stop writing a non-zero duration, second open break rejection, break closure with an end timestamp, inverted leave-range rejection, leave approval with reviewer note and timestamp, task progress persistence, `done` forcing 100%, invalid status rejection, employee create and edit, project member add/remove, organization preference persistence, mark-all-read, report aggregates, and the weekly grid.

An earlier run of this suite exposed a real defect: the attendance control offered "Clock out" on a day whose seeded shift was already closed, which the server correctly rejected. The control now disables itself and reads "Day complete".

## Manual checklist

1. Create a team, then add an employee to it.
2. Create a project, add a member, and assign a task.
3. Select that employee in the role control, start the timer, refresh to confirm recovery, pause, resume, then stop.
4. Add a manual entry and confirm it appears with the `manual` source chip.
5. Clock in, start and end a break, then clock out.
6. Submit the week and confirm the daily log and timesheet rows update.
7. Switch to a manager role and approve with a comment.
8. Confirm dashboard KPIs, reports, and CSV exports reflect the persisted data.

## Design-redesign verification and limits

- `npm run lint`, typegen, strict TypeScript, 34 Vitest tests, production build, and managed health validation are run after the redesign.
- The redesigned shell uses live PostgreSQL records; no sample metrics or fake trend graphs were introduced.
- Browser automation, visual regression, screen-reader auditing, and physical-device testing are not configured in this environment. Responsive breakpoints, modal focus handling, safe-area padding, reduced-motion/transparency/contrast fallbacks, coarse-pointer 16px inputs, and hover gating were reviewed in code, but iOS Safari keyboard/notch and 200%-zoom layout must still be tested on real hardware.
- No automated screenshot claim is made: a browser binary was not available in the sandbox.
- Django backend tests and database migration tests do not apply to this Next.js and Drizzle runtime; schema changes are applied with `drizzle-kit push`.
- The development role selector is not a security control and must not be treated as an authorization test.
