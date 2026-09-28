/**
 * How a person answered a permission prompt, as far as the log can tell. Only the first
 * five are human judgments; `system` is anything a surface or the mode answered.
 */
export type LabelKind = 'allow' | 'allow_grant' | 'deny_call' | 'deny_steer' | 'deny_stop' | 'system';

/** How much of a denial is about the call itself: a bare deny is, a stopped turn barely is. */
export const LABEL_WEIGHT: Record<Exclude<LabelKind, 'system'>, number> = {
  allow: 1,
  allow_grant: 1,
  deny_call: 1,
  deny_steer: 0.5,
  deny_stop: 0.25,
};

export interface History {
  /** Human decisions earlier in the same project. */
  priorHuman: number;
  priorAllows: number;
  /** The same normalized call was allowed earlier, or denied. */
  seenAllowed: boolean;
  seenDenied: boolean;
}

export interface Example {
  /** `<session>#<callId>`. */
  id: string;
  session: string;
  projectRoot: string;
  project: string;
  ts: number;
  surface: string;
  child: boolean;
  mode: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
  /** The person's latest request when the call was made. Never a feature; kept for labelling and review. */
  request: string;
  decidedBy: string;
  scope: string;
  label: LabelKind;
  /** What the person typed with a denial. Never a feature. */
  feedback?: string;
  /** Tool calls already made in this turn. */
  turnCall: number;
  history: History;
  /** Why the classifier may never auto-allow this call, when it may not. */
  floor?: string;
}

export const isHuman = (example: Example): boolean => example.label !== 'system';
export const isAllow = (example: Example): boolean => example.label === 'allow' || example.label === 'allow_grant';
/** 1 when the person allowed the call, 0 when they did not. */
export const target = (example: Example): 0 | 1 => (isAllow(example) ? 1 : 0);
