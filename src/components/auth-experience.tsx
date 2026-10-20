"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, ShieldCheck, UserRound, Users, Zap } from "lucide-react";
import type { WorkspaceRole } from "@/lib/auth";
import { appPost, sameAppPath } from "@/lib/client-fetch";

type Mode = "sign-in" | "owner-sign-up";
type InvitePreview = { email: string; role: "employee" | "manager"; name: string; organizationName: string };
type Props = { invitationToken?: string };


const ROLE_OPTIONS: Array<{ role: WorkspaceRole; label: string; copy: string; icon: typeof UserRound }> = [
  { role: "employee", label: "Employee", copy: "Your time, tasks & personal records", icon: UserRound },
  { role: "manager", label: "Manager", copy: "Your team, approvals & reports", icon: Users },
  { role: "owner", label: "Owner", copy: "Your organization & full workspace", icon: ShieldCheck },
];

export default function AuthExperience({ invitationToken }: Props) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [role, setRole] = useState<WorkspaceRole>("employee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verificationLink, setVerificationLink] = useState("");
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(invitationToken));
  const [inviteInvalid, setInviteInvalid] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!invitationToken) return;
    const controller = new AbortController();
    fetch(`/api/auth/invitation-preview?token=${encodeURIComponent(invitationToken)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Invitation is invalid or expired");
        setInvite(body.invite as InvitePreview);
        setEmail(body.invite.email);
      })
      .catch(() => { if (!controller.signal.aborted) setInviteInvalid(true); })
      .finally(() => { if (!controller.signal.aborted) setInviteLoading(false); });
    return () => controller.abort();
  }, [invitationToken]);

  async function submit(event: FormEvent<HTMLFormElement>, endpoint: string, payload: Record<string, unknown>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setVerificationLink("");
    try {
      const response = await appPost(endpoint, payload);
      const body = await response.json();
      if (!response.ok) {
        if (response.headers.get("X-Auth-Reason") === "email-unverified") setNotice("Email verification is still required. Resend a fresh verification link below.");
        throw new Error(body.error ?? "Request could not be completed");
      }
      if (body.redirectTo) {
        window.location.assign(body.redirectTo as string);
        return;
      }
      setNotice(body.message ?? "Check your email for the next step.");
      if (body.developmentVerificationUrl && typeof body.developmentVerificationUrl === "string") {
        setVerificationLink(body.developmentVerificationUrl);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Request could not be completed");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    await submit(event, "/api/auth/sign-in", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      role,
    });
  }

  async function signUpOwner(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    await submit(event, "/api/auth/owner-signup", {
      organizationName: String(form.get("organizationName") ?? ""),
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
  }

  async function acceptInvite(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    await submit(event, "/api/auth/accept-invitation", {
      token: invitationToken,
      password: String(form.get("password") ?? ""),
    });
  }

  async function resendVerification() {
    setBusy(true);
    setError("");
    try {
      const response = await appPost("/api/auth/resend-verification", { email });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not resend verification");
      setNotice(body.message);
      if (body.developmentVerificationUrl) setVerificationLink(body.developmentVerificationUrl);
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Could not resend verification");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-topline"><Link className="auth-brand" href="/signin"><span className="auth-logo"><Zap size={19} fill="currentColor" /></span><span>time stone<span className="auth-brand-dot">.</span></span></Link><span className="auth-topline-note">WORKFORCE, IN GOOD TIME.</span></div>
      <div className="auth-grid">
        <section className="auth-story" aria-label="Time Stone introduction">
          <div className="auth-story-content">
            <span className="auth-kicker"><i /> WORK, IN BETTER BALANCE</span>
            <h1>Make room<br />for <em>great work.</em></h1>
            <p>A considered view of your people, time, and work — all in one place.</p>
            <div className="auth-proof">
              <div className="auth-proof-mark"><Check size={16} /></div>
              <span><b>One calm place to move work forward.</b><small>Time Stone · Workforce platform</small></span>
            </div>
          </div>
          <div className="auth-orbit auth-orbit-one" /><div className="auth-orbit auth-orbit-two" /><div className="auth-orbit auth-orbit-three" />
          <span className="auth-story-foot">PEOPLE FIRST · WORK CLEARLY</span>
        </section>

        <section className="auth-panel-wrap">
          <div className="auth-panel">
            {invitationToken ? (
              <>
                <Link href="/signin" className="auth-back"><ArrowLeft size={15} /> Back to sign in</Link>
                {inviteLoading ? <AuthMessage title="Checking invitation" text="Confirming the invitation with your organization." /> : null}
                {!inviteLoading && inviteInvalid ? <AuthMessage title="Invitation unavailable" text="This invitation is invalid, expired, or already used. Ask your organization owner for a new invitation." error /> : null}
                {!inviteLoading && invite && (
                  <>
                    <span className="auth-form-kicker">YOU’RE INVITED</span>
                    <h2>Join {invite.organizationName}</h2>
                    <p className="auth-subtitle">Set your password to accept your invitation as a {invite.role}.</p>
                    <div className="invite-summary"><span className="invite-summary-icon"><BriefcaseBusiness size={17} /></span><span><b>{invite.name}</b><small>{invite.email} · {invite.role}</small></span></div>
                    <form className="auth-form" onSubmit={acceptInvite}>
                      <PasswordField show={showPassword} setShow={setShowPassword} name="password" label="Create password" autoComplete="new-password" />
                      <small className="password-note">At least 12 characters, with a letter and a number.</small>
                      <AuthFeedback error={error} notice={notice} verificationLink={verificationLink} />
                      <button className="auth-submit" disabled={busy}>{busy ? "Accepting…" : "Accept invitation"}<ArrowRight size={16} /></button>
                    </form>
                  </>
                )}
              </>
            ) : mode === "owner-sign-up" ? (
              <>
                <button className="auth-back auth-back-button" onClick={() => { setMode("sign-in"); setError(""); setNotice(""); }}><ArrowLeft size={15} /> Back to sign in</button>
                <span className="auth-form-kicker">START YOUR WORKSPACE</span>
                <h2>Create your organization</h2>
                <p className="auth-subtitle">Use your organization email. Its domain is approved only after email verification.</p>
                <form className="auth-form" onSubmit={signUpOwner}>
                  <label className="auth-field"><span>Organization name</span><input name="organizationName" required minLength={2} maxLength={160} autoComplete="organization" placeholder="Northstar Studio" /></label>
                  <label className="auth-field"><span>Your name</span><input name="name" required minLength={2} maxLength={160} autoComplete="name" placeholder="Jordan Lee" /></label>
                  <label className="auth-field"><span>Work email</span><input name="email" required type="email" maxLength={200} autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <PasswordField show={showPassword} setShow={setShowPassword} name="password" label="Create password" autoComplete="new-password" />
                  <small className="password-note">At least 12 characters, with a letter and a number. Personal email domains cannot create organizations.</small>
                  <AuthFeedback error={error} notice={notice} verificationLink={verificationLink} />
                  <button className="auth-submit" disabled={busy}>{busy ? "Creating…" : "Create organization"}<ArrowRight size={16} /></button>
                </form>
                <p className="auth-legal">Creating an organization makes you its first owner. Domain access remains pending until you verify this email.</p>
              </>
            ) : (
              <>
                <span className="auth-form-kicker">WELCOME BACK</span>
                <h2>Sign in to your workspace</h2>
                <p className="auth-subtitle">Choose your workspace role to continue.</p>
                <div className="role-options" role="radiogroup" aria-label="Choose sign-in role">
                  {ROLE_OPTIONS.map((option) => (
                    <button key={option.role} className={`role-option ${role === option.role ? "selected" : ""}`} role="radio" aria-checked={role === option.role} onClick={() => setRole(option.role)} type="button">
                      <span className="role-option-icon"><option.icon size={17} /></span>
                      <span className="role-option-copy"><b>{option.label}</b><small>{option.copy}</small></span>
                      <i className="role-radio" />
                    </button>
                  ))}
                </div>
                <form className="auth-form sign-in-form" onSubmit={signIn}>
                  <label className="auth-field"><span>Work email</span><input name="email" required type="email" maxLength={200} autoComplete="username" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                  <PasswordField show={showPassword} setShow={setShowPassword} name="password" label="Password" autoComplete="current-password" />
                  <AuthFeedback error={error} notice={notice} verificationLink={verificationLink} />
                  {notice && notice.includes("verification") && <button type="button" className="resend-link" disabled={busy} onClick={resendVerification}>Resend verification email</button>}
                  <button className="auth-submit" disabled={busy}>{busy ? "Signing in…" : `Sign in as ${role}`}<ArrowRight size={16} /></button>
                </form>
                <div className="auth-divider"><span /> <small>NEW TO TIME STONE?</small> <span /></div>
                <button className="owner-signup-link" onClick={() => { setMode("owner-sign-up"); setError(""); setNotice(""); }}>Create an organization <ArrowRight size={15} /></button>
                <p className="auth-invite-note">Employees and managers join with an invitation from their organization owner.</p>
              </>
            )}
          </div>
          <footer className="auth-panel-footer"><ShieldCheck size={14} /><span>Protected with verified email and organization-scoped access.</span></footer>
        </section>
      </div>
      <footer className="auth-page-footer"><span>© {new Date().getFullYear()} TIME STONE</span><span>BUILT AROUND PEOPLE</span></footer>
    </main>
  );
}

function PasswordField({ show, setShow, name, label, autoComplete }: { show: boolean; setShow: (value: boolean) => void; name: string; label: string; autoComplete: string }) {
  return (
    <label className="auth-field"><span>{label}</span><span className="password-wrap"><input name={name} required type={show ? "text" : "password"} minLength={name === "password" && autoComplete === "current-password" ? undefined : 12} maxLength={72} autoComplete={autoComplete} placeholder="••••••••••••" /><button type="button" className="password-toggle" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
  );
}

function AuthFeedback({ error, notice, verificationLink }: { error: string; notice: string; verificationLink: string }) {
  return (
    <>
      {error && <div className="auth-alert error" role="alert">{error}</div>}
      {notice && <div className="auth-alert notice" role="status">{notice}</div>}
      {verificationLink && <div className="dev-verification"><span>DEVELOPMENT EMAIL LINK</span><Link href={sameAppPath(verificationLink)}>Open email verification <ArrowRight size={14} /></Link><small>This development-only link still verifies the real one-time token.</small></div>}
    </>
  );
}

function AuthMessage({ title, text, error = false }: { title: string; text: string; error?: boolean }) {
  return <div className={`auth-message ${error ? "error" : ""}`}><span>{error ? <ShieldCheck size={18} /> : <Check size={18} />}</span><div><b>{title}</b><p>{text}</p></div></div>;
}
