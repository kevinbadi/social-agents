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
import type { MidasConfig } from '../config/midasConfig.js';
import { buildToolRegistry } from './registry.js';
import { appendActivity, describeToolCall, isLoggedAction } from '../util/activityLog.js';

export function buildToolServer(client: CreatorOSClient, workspaceRoot: string, config: MidasConfig | null) {
  const registry = buildToolRegistry(client, workspaceRoot, config);
  // Scheduled runs export MIDAS_WORKFLOW=<skill/cron name>; interactive
  // chat and the dashboard chat default to 'chat'.
  const workflow = process.env.MIDAS_WORKFLOW || 'chat';
  return createSdkMcpServer({
    name: 'creatoros',
    version: '1.0.0',
    tools: registry.map((midasTool) =>
      tool(midasTool.name, midasTool.description, midasTool.shape, async (args) => {
        const result = await midasTool.handler(args as Record<string, unknown>);
        if (isLoggedAction(midasTool.name)) {
          const { platform, target } = describeToolCall(args as Record<string, unknown>);
          await appendActivity(workspaceRoot, {
            ts: new Date().toISOString(),
            workflow,
            action: midasTool.name,
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
