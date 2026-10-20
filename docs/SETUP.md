# Time Stone setup and deployment

This is a **Next.js App Router** application with **PostgreSQL** via **Drizzle ORM**. There is no separate Django/Vite process. The frontend pages and the API live in the same Node server.

## What is already implemented

- Role-based authentication: **Owner**, **Manager**, **Employee**
- Separate sign-in options for each role (the selected role is checked against the **server-stored** account role)
- Owner registration with work-email domain claim
- Invitation-only employee and manager join
- Email verification (single-use, expiring tokens)
- HttpOnly `SameSite=Lax` session cookies; roles are never taken from the client
- Organization- and team-scoped workspace data
- Same-origin (CSRF) checks on every state-changing request

## What you must configure

These are **your** actions. The app will not send mail or bind to your public hostname until you set them.

1. PostgreSQL `DATABASE_URL`
2. `APP_ORIGIN` — the **exact public URL** users open (scheme + host)
3. `SMTP_URL` and `EMAIL_FROM` for real email (production)
4. DNS / TLS / reverse proxy in front of `next start` if you are not using a platform that does that for you
5. Create the first owner, verify email, then invite staff

---

## 1. Environment variables

Copy `.env.example` to `.env` (never commit `.env`):

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_ORIGIN` | Yes in production | Public origin, e.g. `https://app.example.com`. Bare hosts like `app.example.com` are treated as `https://`. Used for email links **and** as an allowed host for CSRF. |
| `SMTP_URL` | Yes in production | Nodemailer URL, e.g. `smtps://USER:PASSWORD@smtp.example.com:465` |
| `EMAIL_FROM` | Yes with SMTP | From address, e.g. `Time Stone <no-reply@app.example.com>` |
| `AUTH_DEV_LINKS` | Dev only | `true` shows one-time verify/invite links in the UI when SMTP is unset. **Do not enable on a public site.** |

`APP_ORIGIN` must match the host in the browser address bar. Do **not** set it to `0.0.0.0`, an internal bind address, or a hostname users never open.

Same-origin checks read **HTTP headers**, not a JSON body field:

- `Origin` (browser)
- `Referer` (browser; auth pages send origin-only referrers)
- `X-App-Origin` (set by the app on every POST from `window.location.origin`)
- `Sec-Fetch-Site` (browser)

Allowed hosts are the request `Host` / `x-forwarded-host` **and** the host from `APP_ORIGIN`.

---

## 2. Database

PostgreSQL 14+ with a dedicated database. Apply the schema (no separate migration folder in this project):

```bash
npx drizzle-kit push
```

This creates organization, employee, time, attendance, and authentication tables (`auth_users`, `auth_sessions`, `organization_domains`, `employee_invitations`, `email_verification_tokens`, `auth_rate_limits`).

---

## 3. Install and run

```bash
npm install
npx drizzle-kit push
npm run dev          # development: http://localhost:3000
```

Production process (same app serves UI and API):

```bash
npm run build
npm start            # listens on port 3000 unless PORT is set
```

Put a TLS reverse proxy (nginx, Caddy, or your platform) in front so browsers open `https://your-domain`. Forward `Host` and `X-Forwarded-Proto`.

---

## 4. Email verification

**Production:** set `SMTP_URL` and `EMAIL_FROM`. Owner signup and invitations send mail. Users click the link, then **Verify email address** (the token is consumed on that POST, not on page load).

**Local / sandbox without SMTP:** set `AUTH_DEV_LINKS=true`. After signup or invite, the UI shows a one-time link. That link still verifies the real token.

---

## 5. Build and deploy

```bash
npm run build
npm start
```

Platform notes:

- Set every variable from section 1 in the host’s secret store
- Health check: `GET /api/health`
- Do not expose `AUTH_DEV_LINKS=true`
- Session cookie is `Secure` when `NODE_ENV=production`

---

## 6. Application URL and security

1. `APP_ORIGIN=https://YOUR_PUBLIC_HOST` (include `https://`)
2. Proxy must not strip `Origin`, `Referer`, `Sec-Fetch-Site`, or `X-App-Origin`
3. Users must open the same host as `APP_ORIGIN` (www vs apex is a mismatch)

---

## 7. First owner, then staff

1. Open `/signin` → **Create an organization**
2. Use a **work email** on the company domain (personal providers such as Gmail are rejected)
3. Verify the email
4. Sign in with the **Owner** option
5. Create a team, then **Invite employee** (role Employee or Manager)
6. Invitee opens the invite link, sets a password, verifies email
7. Invitee signs in with the matching role option (Employee or Manager)

Employees and managers **cannot** self-register. Owners are not created by invitation.

---

## 8. Test roles after deploy

| Role | Should see | Must not do |
| --- | --- | --- |
| Employee | Own dashboard, tracker, timesheets, attendance, tasks, leave, notifications, profile | Org settings, invites, project create, approvals of others |
| Manager | Team directory, team tasks, timesheet/leave review, team reports | Org settings, create teams/projects |
| Owner | Full organization | — |

Sign in with the **wrong role option** for an account is rejected (401). Switching roles requires a different verified account.

---

## 9. Troubleshooting “Request origin is required”

This is a **header** check, not a missing JSON `origin` field.

1. Confirm `APP_ORIGIN` is a URL or host users actually open, with `https://` preferred.
2. Confirm the reverse proxy forwards `Host` / `X-Forwarded-Host` and does not strip `Origin`, `Referer`, or `X-App-Origin`.
3. Hard-refresh so the client bundle that sends `X-App-Origin` and `referrerPolicy: origin` is loaded.
4. In DevTools → Network, a sign-in POST should show `Origin` and/or `Referer` and `X-App-Origin` equal to the page origin.
5. `Cross-origin request rejected` means a header was present but its host did not match `Host` or `APP_ORIGIN` (www vs apex, preview URL vs production host).
6. `Email delivery is not configured` means set `SMTP_URL` + `EMAIL_FROM`, or `AUTH_DEV_LINKS=true` only in development.

---

## Checklist (your actions)

- [ ] PostgreSQL running and `DATABASE_URL` set
- [ ] `npx drizzle-kit push`
- [ ] `APP_ORIGIN` = public https origin
- [ ] `SMTP_URL` + `EMAIL_FROM` (production) **or** `AUTH_DEV_LINKS=true` (local only)
- [ ] `npm run build` and `npm start` behind TLS
- [ ] Proxy preserves origin-related headers
- [ ] First owner registered and email verified
- [ ] Employee and manager invited, verified, and signed in with the matching role
