"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, MailCheck, ShieldCheck, Zap } from "lucide-react";
import { appPost } from "@/lib/client-fetch";

export default function VerifyEmail({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  async function verify() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await appPost("/api/auth/verify-email", { token });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "This verification link could not be used");
      setMessage(body.message);
      setVerified(true);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Could not verify email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-topline"><Link className="auth-brand" href="/signin"><span className="auth-logo"><Zap size={19} fill="currentColor" /></span><span>time stone<span className="auth-brand-dot">.</span></span></Link><span className="auth-topline-note">WORKFORCE, IN GOOD TIME.</span></div>
      <div className="verify-card">
        <span className={`verify-icon ${verified ? "verified" : ""}`}>{verified ? <Check size={26} /> : <MailCheck size={26} />}</span>
        <span className="auth-form-kicker">{verified ? "EMAIL VERIFIED" : "ONE LAST STEP"}</span>
        <h1>{verified ? "You’re verified." : "Confirm your email."}</h1>
        <p>{verified ? "Your account is ready. Sign in using the role assigned to your invitation." : "Confirm that you own this address. This single-use link expires after 24 hours."}</p>
        {error && <div className="auth-alert error" role="alert">{error}</div>}
        {message && <div className="auth-alert notice" role="status">{message}</div>}
        {verified ? (
          <Link className="auth-submit auth-link-button" href="/signin">Continue to sign in <ArrowRight size={16} /></Link>
        ) : (
          <button className="auth-submit" disabled={busy || !token} onClick={verify}>{busy ? "Verifying…" : "Verify email address"}<ArrowRight size={16} /></button>
        )}
        {!token && <p className="verify-invalid">This link is missing its verification token. Request a new verification email from sign in.</p>}
        <div className="auth-panel-footer"><ShieldCheck size={14} /><span>Verification links are single-use and expire automatically.</span></div>
      </div>
      <footer className="auth-page-footer"><span>© {new Date().getFullYear()} TIME STONE</span><span>BUILT AROUND PEOPLE</span></footer>
    </main>
  );
}
