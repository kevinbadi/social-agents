import { PageHeader } from "@/components/PageHeader";
import { AgentPostsDesk } from "@/components/AgentPostsDesk";
import { listAgentPosts } from "@/lib/agent-posts/store";
import { listAgentPostTargets } from "@/lib/agent-posts/targets";
import { formatSlotEt, withNextSlots } from "@/lib/agent-posts/slots";

export const metadata = { title: "Agent Posts Done for You · Marketing OS" };
export const dynamic = "force-dynamic";

export default async function AgentPostsPage() {
  const [jobs, targets] = await Promise.all([
    listAgentPosts(40),
    listAgentPostTargets().then(withNextSlots),
  ]);

  const nextLine = targets
    .map((t) =>
      t.nextSlot
        ? `${t.name} ${formatSlotEt(new Date(t.nextSlot))}`
        : `${t.name} (no open slot)`,
    )
    .join(" · ");

  return (
    <main className="w-full px-6 pb-6 pt-4">
      <PageHeader
        title="Agent Posts Done for You"
        description={
          nextLine
            ? `Next open slot: ${nextLine}. Kev AI stays at least 1 hour after Kev Builds Apps. Title, caption, and DM resource link are optional.`
            : "Pick one or both Kev Builds Apps socials, then drop a video. Title, caption, and DM resource link are optional. Cover and the next slot land on the cut sheet. Kev AI is +1 hour vs Kev Builds Apps."
        }
      />
      <AgentPostsDesk initialJobs={jobs} initialTargets={targets} />
    </main>
  );
}
