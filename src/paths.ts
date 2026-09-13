import { join } from 'node:path';

/**
 * Everything Midas writes for the user lives under `midas/` in the
 * workspace root. The whole directory is gitignored — it holds the brand
 * pack, profile map, config, skills, and knowledge base for one client.
 */
export interface MidasPaths {
  root: string;
  /** Repo-root CLAUDE.md — the generated briefing any agent chat reads. */
  claudeMd: string;
  midasDir: string;
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

export function midasPaths(root: string = process.cwd()): MidasPaths {
  const midasDir = join(root, 'midas');
  const knowledgeDir = join(midasDir, 'knowledge');
  return {
    root,
    claudeMd: join(root, 'CLAUDE.md'),
    midasDir,
    brandMd: join(midasDir, 'BRAND.md'),
    profilesMd: join(midasDir, 'PROFILES.md'),
    configJson: join(midasDir, 'midas.json'),
    setupStateJson: join(midasDir, '.setup-state.json'),
    skillsDir: join(midasDir, 'skills'),
    knowledgeDir,
    competitorsMd: join(knowledgeDir, 'COMPETITORS.md'),
    tutorialsMd: join(knowledgeDir, 'TUTORIALS.md'),
    contentLibraryDir: join(root, 'content-library'),
  };
}
