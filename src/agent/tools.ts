/**
 * Claude Agent SDK adapter: wraps the shared tool registry as an MCP
 * server. The registry itself is engine-agnostic — see registry.ts.
 *
 * This wrapper is also where the activity log gets written: every engine
 * funnels through here, so one hook records every ACTION the agent takes
 * (posts, replies, DMs — reads are not logged). The dashboard reads that
 * log; see src/util/activityLog.ts.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import type { SocialAgentsConfig } from '../config/socialAgentsConfig.js';
import { buildToolRegistry } from './registry.js';
import { appendActivity, describeToolCall, isLoggedAction } from '../util/activityLog.js';

export function buildToolServer(client: CreatorOSClient, workspaceRoot: string, config: SocialAgentsConfig | null) {
  const registry = buildToolRegistry(client, workspaceRoot, config);
  // Scheduled runs export SOCIAL_AGENTS_WORKFLOW=<skill/cron name>; interactive
  // chat and the dashboard chat default to 'chat'.
  const workflow = process.env.SOCIAL_AGENTS_WORKFLOW || 'chat';
  return createSdkMcpServer({
    name: 'creatoros',
    version: '1.0.0',
    tools: registry.map((agentTool) =>
      tool(agentTool.name, agentTool.description, agentTool.shape, async (args) => {
        const result = await agentTool.handler(args as Record<string, unknown>);
        if (isLoggedAction(agentTool.name)) {
          const { platform, target } = describeToolCall(args as Record<string, unknown>);
          await appendActivity(workspaceRoot, {
            ts: new Date().toISOString(),
            workflow,
            action: agentTool.name,
            platform,
            target,
            outcome: result.isError ? 'failed' : 'sent',
            ...(result.isError ? { error: result.text.slice(0, 500) } : {}),
          });
        }
        return {
          content: [{ type: 'text' as const, text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        };
      }),
    ),
  });
}
