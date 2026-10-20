# Architecture

Time Stone is a Next.js App Router application. Pages and `/api/*` route handlers share one Node process and one PostgreSQL database (Drizzle ORM).

## Auth boundary

- Passwords are bcrypt-hashed in `auth_users`. The account **role** (`owner` | `manager` | `employee`) is stored there and copied onto the employee row for display.
- Sessions are random secrets, stored only as SHA-256 hashes, in an HttpOnly `SameSite=Lax` cookie.
- Unverified, disabled, or inactive accounts cannot obtain a session.
- Workspace GET/POST require `requireAuth()`. Actor and organization always come from the session, never from a client `actorId`.
- Employees see their own records; managers see their team; owners see the organization.

## CSRF / origin

State-changing routes call `assertSameOrigin`. Allowed hosts are the inbound `Host`/`x-forwarded-host` and, when set, `APP_ORIGIN`. Signals: `Origin`, `Referer`, `X-App-Origin` (frontend), `Sec-Fetch-Site`. There is no JSON `origin` field.

## Entry points

- `/signin` — role-specific sign-in, owner registration, invitation acceptance
- `/verify-email` — consumes a one-time token via POST
- `/` — authenticated workspace (redirects to `/signin` if anonymous)
- `/api/health` — process + database ping
