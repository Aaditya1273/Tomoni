/** The action state machine (DATA_MODEL `action.state`), rule 2.3: confirm → do → verify. */
export type ActionState =
  | 'proposed'
  | 'awaiting_approval'
  | 'approved'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'rejected'
  | 'failed'
  | 'handoff'
  | 'cancelled';

const NEXT: Record<ActionState, ActionState[]> = {
  proposed: ['awaiting_approval', 'approved', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['running', 'cancelled'],
  running: ['verifying', 'approved', 'handoff', 'failed'],
  verifying: ['succeeded', 'approved', 'handoff', 'failed'],
  handoff: ['approved', 'cancelled'],
  succeeded: [],
  rejected: [],
  failed: [],
  cancelled: [],
};

export const canMove = (from: ActionState, to: ActionState) => NEXT[from].includes(to);

export function move(from: ActionState, to: ActionState): ActionState {
  if (!canMove(from, to)) throw new Error(`action cannot go from ${from} to ${to}`);
  return to;
}

/** After this many failed attempts a person in ops takes over. */
export const MAX_ATTEMPTS = 3;
export const backoffMs = (attempt: number) => 60_000 * 2 ** (attempt - 1); // 1, 2, 4 minutes
