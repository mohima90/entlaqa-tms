/**
 * One image slot of the Branding page (WP-ADM-02; security review M3): what the slot shows and which file
 * a save would keep, through a pick → upload → scan. A failed REPLACEMENT never loses the image the slot
 * had: the slot remembers it (`previous`) when a new file is picked and puts it back on any failure —
 * start, upload or confirmation refused, the scan finding the file infected, rejected or failing. Pure state
 * transitions (the form holds them in React state), so every path is unit-tested.
 */

export type SlotPhase = 'none' | 'saved' | 'uploading' | 'checking' | 'ready' | 'previewOnly';

/** What a slot shows and keeps. */
export interface SlotImage {
  readonly fileId: string | null;
  /** What the previews show: the published copy, or the picked file (blob:). */
  readonly src: string | null;
  readonly name: string | null;
  readonly phase: SlotPhase;
}

export interface SlotState extends SlotImage {
  readonly error: string | null;
  /** The saved image cannot be used (the worker gave up publishing it): the page asks for another. */
  readonly failed: boolean;
  /** The image before the pick in progress, put back if the pick fails (null: nothing to put back). */
  readonly previous: SlotImage | null;
}

export const EMPTY_SLOT: SlotState = {
  fileId: null,
  src: null,
  name: null,
  phase: 'none',
  error: null,
  failed: false,
  previous: null,
};

export interface SavedImage {
  readonly fileId: string;
  readonly src: string | null;
  readonly name: string | null;
  readonly failed?: boolean;
}

/** The slot as loaded: the saved image, or empty. */
export function initialSlot(image: SavedImage | null): SlotState {
  if (!image) return EMPTY_SLOT;
  return {
    ...EMPTY_SLOT,
    fileId: image.fileId,
    src: image.src,
    name: image.name,
    phase: 'saved',
    failed: image.failed === true,
  };
}

const inProgress = (phase: SlotPhase) => phase === 'uploading' || phase === 'checking';

function snapshot(state: SlotState): SlotImage | null {
  if (state.fileId === null && state.src === null) return null;
  return { fileId: state.fileId, src: state.src, name: state.name, phase: state.phase };
}

/**
 * A file was picked and passed the browser's checks: the previews show it at once. The image to put back is
 * the one the slot had — or, when a pick was still uploading or being checked, the one before that pick. The
 * slot keeps the old file id until the new upload is confirmed (a save meanwhile keeps the old image).
 */
export function beginPick(
  state: SlotState,
  picked: { readonly src: string; readonly name: string },
  phase: 'uploading' | 'previewOnly',
): SlotState {
  const previous = inProgress(state.phase) ? state.previous : snapshot(state);
  const keptFileId = inProgress(state.phase) ? (previous?.fileId ?? null) : state.fileId;
  return {
    fileId: phase === 'uploading' ? keptFileId : state.fileId,
    src: picked.src,
    name: picked.name,
    phase,
    error: null,
    failed: false,
    previous,
  };
}

/** The pick failed (any step): the image before it is back, with the reason. */
export function pickFailed(state: SlotState, error: string): SlotState {
  const back = state.previous;
  if (!back) return { ...EMPTY_SLOT, error };
  return { ...EMPTY_SLOT, ...back, error };
}

/** Is the slot still uploading the file picked as `src` (not removed or replaced meanwhile)? */
const uploading = (state: SlotState, src: string) =>
  state.phase === 'uploading' && state.src === src;

/** Starting, sending or confirming the upload of `src` failed: the image before the pick is back. */
export function uploadFailed(state: SlotState, src: string, error: string): SlotState {
  return uploading(state, src) ? pickFailed(state, error) : state;
}

/**
 * The upload of `src` was confirmed: the slot keeps the new file (clean: ready; else checked by the scan).
 * Ignored when the slot moved on meanwhile.
 */
export function uploadConfirmed(
  state: SlotState,
  src: string,
  fileId: string,
  status: string,
): SlotState {
  if (!uploading(state, src)) return state;
  const clean = status === 'clean';
  return {
    ...state,
    fileId,
    phase: clean ? 'ready' : 'checking',
    error: null,
    previous: clean ? null : state.previous,
  };
}

export const SCAN_FINAL = new Set(['clean', 'infected', 'rejected', 'error', 'deleted']);

/**
 * The scan of `fileId` finished. Ignored when the slot moved on (another file picked, removed, saved
 * over). Clean: ready. Otherwise the image before the pick is back, with the reason.
 */
export function scanFinished(
  state: SlotState,
  fileId: string,
  status: string,
  errorFor: (status: string) => string,
): SlotState {
  if (state.fileId !== fileId || state.phase !== 'checking') return state;
  if (status === 'clean') return { ...state, phase: 'ready', previous: null };
  return pickFailed(state, errorFor(status));
}

/** Removed by the admin: nothing to put back (a save removes the saved image). */
export function removed(): SlotState {
  return EMPTY_SLOT;
}

/**
 * After a successful save: what the slot holds is now the saved image — the image before a pick still being
 * checked was released by the save, so a failing scan then empties the slot instead of putting it back.
 */
export function afterSave(state: SlotState): SlotState {
  return { ...state, previous: null, failed: state.failed && state.phase === 'saved' };
}

/**
 * Waits between scan status checks: quick at first, then slower, ≈ 10 minutes in all (a scan that takes
 * longer is still applied: the image shows once the check is done, the page says so).
 */
export function scanPollDelays(): readonly number[] {
  const delays = [2000, 3000, 5000, 8000, 12_000, 20_000];
  let total = delays.reduce((sum, d) => sum + d, 0);
  while (total < 600_000) {
    delays.push(30_000);
    total += 30_000;
  }
  return delays;
}
