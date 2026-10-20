import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthExperience from "@/components/auth-experience";
import { getAuthContext } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Sign in · Time Stone",
  description: "Sign in to your organization’s Time Stone workspace.",
  robots: { index: false, follow: false },
  referrer: "origin",
};

type SignInPageProps = { searchParams: Promise<{ invite?: string }> };

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const context = await getAuthContext();
  const params = await searchParams;
  if (context && !params.invite) redirect("/");
  return <AuthExperience invitationToken={params.invite} />;
}
