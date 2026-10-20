import WorkspaceApp from "@/components/workspace-app";
import { clientSafeAuthContext, getAuthContext } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const context = await getAuthContext();
  if (!context) redirect("/signin");
  const [workspace] = await Promise.all([getWorkspace(context)]);
  return <WorkspaceApp initialData={workspace} session={clientSafeAuthContext(context)} />;
}
