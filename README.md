# Time Stone

Time Stone is a greenfield enterprise workforce operations application: employees, teams, projects, tasks, time tracking, attendance with breaks, timesheets, approvals, leave management, reports, notifications, and settings — backed by PostgreSQL.

## Runtime adaptation

The Arena workspace provides a managed **Next.js App Router + PostgreSQL + Drizzle ORM** runtime. The requested Vite/Django split was adapted to the supported full-stack runtime rather than misrepresented. UI, data access, and API code remain separated under `src/components`, `src/lib`, `src/db`, and `src/app/api/v1`. PostgreSQL is real; every workflow mutation persists through Drizzle inside transactions.

Authentication is required. See **`docs/SETUP.md`** for environment variables, database push, email, origin/CSRF configuration, first-owner creation, invitations, and troubleshooting `Request origin is required`.

See `docs/DESIGN_SYSTEM.md` for visual tokens. CSS translucency does not claim native Apple lensing.

## Start

1. Copy `.env.example` to `.env` and provide `DATABASE_URL`.
2. Install dependencies: `npm install`
3. Apply schema: `npx drizzle-kit push`
4. Develop: `npm run dev` — then open `http://localhost:3000`
5. Production: `npm run build && npm start`

No login is required. The first request seeds a development organization only when `organizations` is empty, guarded by a transaction-scoped advisory lock.

## Checks

```bash
npx next typegen                         # route and app types
npm exec tsc -- --noEmit --pretty false  # strict TypeScript
npx vitest run                           # unit tests
npm run build                            # production build
```

See `docs/IMPLEMENTATION_STATUS.md` for exact scope and `docs/TESTING.md` for executed verification.
