import { describe, expect, it } from 'vitest';
import {
  EMPTY_SLOT,
  type SlotState,
  afterSave,
  beginPick,
  initialSlot,
  pickFailed,
  removed,
  scanFinished,
  scanPollDelays,
  uploadConfirmed,
  uploadFailed,
} from './brand-image-slot';

const SAVED = { fileId: 'f-saved', src: '/api/brand/a-saved', name: 'logo.png' };
const NEW = { src: 'blob:new', name: 'new-logo.png' };
const errorFor = (status: string) => `error:${status}`;

const saved = (): SlotState => initialSlot(SAVED);
const picking = () => beginPick(saved(), NEW, 'uploading');

/** The saved image is back, with the reason (security review M3). */
function expectSavedBack(state: SlotState, error: string) {
  expect(state).toEqual({
    fileId: 'f-saved',
    src: '/api/brand/a-saved',
    name: 'logo.png',
    phase: 'saved',
    error,
    failed: false,
    previous: null,
  });
}

describe('Branding image slot (WP-ADM-02)', () => {
  it('starts from the saved image, or empty; a given-up image is marked', () => {
    expect(saved()).toMatchObject({ ...SAVED, phase: 'saved', previous: null, failed: false });
    expect(initialSlot(null)).toEqual(EMPTY_SLOT);
    expect(initialSlot({ ...SAVED, failed: true }).failed).toBe(true);
  });

  it('a pick shows the new file at once but keeps the saved file until the upload is confirmed', () => {
    const state = picking();
    expect(state).toMatchObject({ fileId: 'f-saved', src: 'blob:new', phase: 'uploading' });
    expect(state.previous).toMatchObject({ fileId: 'f-saved', src: '/api/brand/a-saved' });
  });

  it.each([
    ['the start is refused', 'error:start'],
    ['the upload (PUT) fails', 'error:upload'],
    ['the confirmation is refused', 'error:confirm'],
    ['the file is rejected at confirmation', 'error:rejected'],
  ])('%s: the saved image is back', (_case, error) => {
    expectSavedBack(uploadFailed(picking(), NEW.src, error), error);
  });

  it.each([['infected'], ['rejected'], ['error'], ['deleted']])(
    'the scan says %s: the saved image is back',
    (status) => {
      const checking = uploadConfirmed(picking(), NEW.src, 'f-new', 'uploaded');
      expect(checking).toMatchObject({ fileId: 'f-new', phase: 'checking' });
      expectSavedBack(scanFinished(checking, 'f-new', status, errorFor), `error:${status}`);
    },
  );

  it('a clean scan keeps the new file; nothing to put back any more', () => {
    const checking = uploadConfirmed(picking(), NEW.src, 'f-new', 'uploaded');
    const ready = scanFinished(checking, 'f-new', 'clean', errorFor);
    expect(ready).toMatchObject({
      fileId: 'f-new',
      src: 'blob:new',
      phase: 'ready',
      previous: null,
    });
    const cleanAtOnce = uploadConfirmed(picking(), NEW.src, 'f-new', 'clean');
    expect(cleanAtOnce).toMatchObject({ phase: 'ready', previous: null });
  });

  it('a first image that fails leaves the slot empty, with the reason', () => {
    const first = beginPick(EMPTY_SLOT, NEW, 'uploading');
    expect(uploadFailed(first, NEW.src, 'error:upload')).toEqual({
      ...EMPTY_SLOT,
      error: 'error:upload',
    });
  });

  it('a second pick while the first is checked puts back the image before both', () => {
    const checking = uploadConfirmed(picking(), NEW.src, 'f-new', 'uploaded');
    const again = beginPick(checking, { src: 'blob:other', name: 'other.png' }, 'uploading');
    expect(again).toMatchObject({ fileId: 'f-saved', src: 'blob:other' });
    // The abandoned file's scan result changes nothing.
    expect(scanFinished(again, 'f-new', 'infected', errorFor)).toBe(again);
    expectSavedBack(uploadFailed(again, 'blob:other', 'error:upload'), 'error:upload');
  });

  it('late answers for a removed or replaced pick change nothing', () => {
    const gone = removed();
    expect(uploadConfirmed(gone, NEW.src, 'f-new', 'clean')).toBe(gone);
    expect(uploadFailed(gone, NEW.src, 'x')).toBe(gone);
    const other = beginPick(saved(), { src: 'blob:other', name: 'o.png' }, 'uploading');
    expect(uploadConfirmed(other, NEW.src, 'f-new', 'clean')).toBe(other);
  });

  it('after a save, a failing scan empties the slot (the old image was released by the save)', () => {
    const checking = uploadConfirmed(picking(), NEW.src, 'f-new', 'uploaded');
    const savedNow = afterSave(checking);
    expect(savedNow.previous).toBeNull();
    expect(scanFinished(savedNow, 'f-new', 'infected', errorFor)).toEqual({
      ...EMPTY_SLOT,
      error: 'error:infected',
    });
  });

  it('a preview-only pick keeps the saved file and can be put back', () => {
    const preview = beginPick(saved(), NEW, 'previewOnly');
    expect(preview).toMatchObject({ fileId: 'f-saved', phase: 'previewOnly' });
    expectSavedBack(pickFailed(preview, 'x'), 'x');
  });

  it('polls quickly at first, then slower, for about ten minutes', () => {
    const delays = scanPollDelays();
    const total = delays.reduce((sum, d) => sum + d, 0);
    expect(delays[0]).toBe(2000);
    expect(total).toBeGreaterThanOrEqual(600_000);
    expect(total).toBeLessThan(660_000);
    expect(Math.max(...delays)).toBe(30_000);
    expect(delays.length).toBeLessThan(30);
  });
});
