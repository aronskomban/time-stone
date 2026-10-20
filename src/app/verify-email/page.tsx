import type { Metadata } from "next";
import VerifyEmail from "@/components/verify-email";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Verify email · Time Stone",
  robots: { index: false, follow: false },
  referrer: "origin",
};

type VerifyPageProps = { searchParams: Promise<{ token?: string }> };

export default async function VerifyEmailPage({ searchParams }: VerifyPageProps) {
  const params = await searchParams;
  return <VerifyEmail token={params.token ?? ""} />;
}
