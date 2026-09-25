import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything Social Agents write for the user lives under `social-agents/` in the
 * workspace root. The whole directory is gitignored — it holds the brand
 * pack, profile map, config, skills, and knowledge base for one client.
 */
export interface SocialAgentsPaths {
  root: string;
  /** Repo-root CLAUDE.md — the generated briefing any agent chat reads. */
  claudeMd: string;
  socialAgentsDir: string;
  brandMd: string;
  profilesMd: string;
  configJson: string;
  setupStateJson: string;
  skillsDir: string;
  knowledgeDir: string;
  competitorsMd: string;
  tutorialsMd: string;
  contentLibraryDir: string;
}

export function socialAgentsPaths(root: string = process.cwd()): SocialAgentsPaths {
  const socialAgentsDir = join(root, 'social-agents');
  const knowledgeDir = join(socialAgentsDir, 'knowledge');
  return {
    root,
    claudeMd: join(root, 'CLAUDE.md'),
    socialAgentsDir,
    brandMd: join(socialAgentsDir, 'BRAND.md'),
    profilesMd: join(socialAgentsDir, 'PROFILES.md'),
    configJson: join(socialAgentsDir, 'social-agents.json'),
    setupStateJson: join(socialAgentsDir, '.setup-state.json'),
    skillsDir: join(socialAgentsDir, 'skills'),
    knowledgeDir,
    competitorsMd: join(knowledgeDir, 'COMPETITORS.md'),
    tutorialsMd: join(knowledgeDir, 'TUTORIALS.md'),
    contentLibraryDir: join(root, 'content-library'),
  };
}

/**
 * Pre-rename workspaces live in `midas/` with `midas.json`. Move them to
 * `social-agents/` once, so every path above resolves. No-op otherwise.
 */
export function migrateLegacyWorkspace(root: string = process.cwd()): void {
  const legacyDir = join(root, 'midas');
  const paths = socialAgentsPaths(root);
  if (!existsSync(legacyDir) || existsSync(paths.socialAgentsDir)) return;
  renameSync(legacyDir, paths.socialAgentsDir);
  const legacyConfig = join(paths.socialAgentsDir, 'midas.json');
  if (existsSync(legacyConfig) && !existsSync(paths.configJson)) renameSync(legacyConfig, paths.configJson);
}
