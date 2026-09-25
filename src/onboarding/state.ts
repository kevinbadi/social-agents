/**
 * The interview is resumable: every answer lands on disk the moment it's
 * given. Kill the process mid-interview, re-run `npm start creatoros social-agents`,
 * and it picks up exactly where it left off.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const INTERVIEW_STEPS = [
  // The form is the API key(s) and a handoff. No AI questions, no brand
  // questionnaire, no infrastructure call — those are conversations the
  // agents have in chat, per workspace, where they can actually follow up.
  'keys',
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

/** A workspace collected by the form. The key itself never lands here. */
export interface SetupWorkspace {
  /** CreatorOS workspace id — the saved key is found by it. */
  workspaceId: string;
  name: string;
  /** Folder under workspaces/. */
  slug: string;
}

export interface PathwayAnswers {
  automationTarget: 'local' | 'railway';
  timezone: string;
  /** Railway worker URL once deployed — optional at interview time. */
  workerUrl?: string;
  /** Generated for the user; goes into social-agents.json + the deploy guide. */
  workerToken?: string;
  /** Railway service id for dashboard deploy-status checks. */
  railwayServiceId?: string;
  /** A Railway API token was saved to ~/.social-agents — the agent can provision. */
  railwayTokenSaved?: boolean;
  /**
   * An AI credential for the cloud worker already exists in ~/.social-agents
   * (from a prior run or the shell env) — never collected by the form;
   * the agent installs one in chat otherwise.
   */
  aiCredentialSaved?: boolean;
}

export interface InterviewState {
  /** Steps already completed, in order. */
  completed: InterviewStep[];
  answers: {
    /** How many CreatorOS API keys the user said they have. */
    keyCount?: number;
    /** One entry per validated key, in the order they were pasted. */
    workspaces?: SetupWorkspace[];
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
