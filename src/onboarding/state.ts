/**
 * The interview is resumable: every answer lands on disk the moment it's
 * given. Kill the process mid-interview, re-run `npm start creatoros midas`,
 * and it picks up exactly where it left off.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const INTERVIEW_STEPS = [
  // No AI questions in the form — the interview only collects answers and
  // materializes files (CLAUDE.md + midas/). The user's own agent chat
  // picks them up afterwards via the initialization prompt.
  'mode',
  // CreatorOS key first, then the infrastructure call — with both keys in
  // hand the finish step can provision Railway and light the dashboard up.
  'key',
  'pathway',
  'brand',
  'profiles',
  'finish',
] as const;

export type InterviewStep = (typeof INTERVIEW_STEPS)[number];

export interface ProductOffer {
  /** Destination URL — every CTA points at one of these. */
  link?: string;
  /** What the link is / what's being sold. */
  description: string;
}

export interface BrandAnswers {
  about: string;
  /** What you sell + where it lives: one row per offer (link, explainer). */
  products: ProductOffer[];
  voiceAdjectives: string[];
  voiceNever: string;
  emojiPolicy: string;
  hashtagPolicy: string;
  audience: string;
  competitors: string[];
}

export interface InterviewState {
  /** Steps already completed, in order. */
  completed: InterviewStep[];
  answers: {
    /** Is this an agency running client brands, or a creator? */
    mode?: 'creator' | 'agency';
    /** Agency client labels only — the keys themselves never land in the workspace. */
    clientLabels?: string[];
    brand?: BrandAnswers;
    profiles?: Array<{ accountId: string; platform: string; username: string }>;
    pathway?: {
      automationTarget: 'local' | 'railway';
      timezone: string;
      /** Railway worker URL once deployed — optional at interview time. */
      workerUrl?: string;
      /** Generated for the user; goes into midas.json + the deploy guide. */
      workerToken?: string;
      /** Railway service id for dashboard deploy-status checks. */
      railwayServiceId?: string;
      /** A Railway API token was saved to ~/.midas — the agent can provision. */
      railwayTokenSaved?: boolean;
      /**
       * An AI credential for the cloud worker already exists in ~/.midas
       * (from a prior run or the shell env) — never collected by the form;
       * the agent installs one in chat otherwise.
       */
      aiCredentialSaved?: boolean;
    };
  };
}

export function emptyState(): InterviewState {
  return { completed: [], answers: {} };
}

export function isStepDone(state: InterviewState, step: InterviewStep): boolean {
  return state.completed.includes(step);
}

export function markStepDone(state: InterviewState, step: InterviewStep): InterviewState {
  if (!state.completed.includes(step)) state.completed.push(step);
  return state;
}

/** The first step that still needs doing, or null when the interview is done. */
export function nextStep(state: InterviewState): InterviewStep | null {
  return INTERVIEW_STEPS.find((step) => !isStepDone(state, step)) ?? null;
}

export function isInterviewComplete(state: InterviewState): boolean {
  return nextStep(state) === null;
}

export async function loadState(path: string): Promise<InterviewState> {
  if (!existsSync(path)) return emptyState();
  try {
    return JSON.parse(await readFile(path, 'utf8')) as InterviewState;
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: InterviewState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function clearState(path: string): Promise<void> {
  if (existsSync(path)) await rm(path);
}
