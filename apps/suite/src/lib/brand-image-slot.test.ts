import { describe, expect, it } from 'vitest';
import {
  EMPTY_SLOT,
  type SlotState,
  afterSave,
  beginPick,
  initialSlot,
  pickFailed,
  removed,
  saveRefused,
  uploadConfirmed,
  uploadFailed,
} from './brand-image-slot';

const SAVED = { fileId: 'f-saved', src: '/api/brand/a-saved', name: 'logo.png' };
const NEW = { src: 'blob:new', name: 'new-logo.png' };

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

  it('a confirmed upload is ready at once — no scan to wait for (PO, 20 Oct 2026); the saved image can still come back', () => {
    const ready = uploadConfirmed(picking(), NEW.src, 'f-new');
    expect(ready).toMatchObject({ fileId: 'f-new', src: 'blob:new', phase: 'ready', error: null });
    expect(ready.previous).toMatchObject({ fileId: 'f-saved' });
  });

  it('the save refuses the new image (type, size, pixels, damaged): the saved image is back, with the reason', () => {
    const ready = uploadConfirmed(picking(), NEW.src, 'f-new');
    expectSavedBack(saveRefused(ready, 'error:type'), 'error:type');
    // A saved image the save refused keeps showing, with the reason.
    expect(saveRefused(saved(), 'error:x')).toMatchObject({ fileId: 'f-saved', error: 'error:x' });
  });

  it('after a successful save the new image is the saved one; nothing to put back any more', () => {
    const savedNow = afterSave(uploadConfirmed(picking(), NEW.src, 'f-new'));
    expect(savedNow).toMatchObject({ fileId: 'f-new', phase: 'saved', previous: null });
  });

  it('a first image that fails leaves the slot empty, with the reason', () => {
    const first = beginPick(EMPTY_SLOT, NEW, 'uploading');
    expect(uploadFailed(first, NEW.src, 'error:upload')).toEqual({
      ...EMPTY_SLOT,
      error: 'error:upload',
    });
  });

  it('a second pick while the first waits for the save puts back the image before both', () => {
    const ready = uploadConfirmed(picking(), NEW.src, 'f-new');
    const again = beginPick(ready, { src: 'blob:other', name: 'other.png' }, 'uploading');
    expect(again).toMatchObject({ fileId: 'f-saved', src: 'blob:other' });
    expectSavedBack(uploadFailed(again, 'blob:other', 'error:upload'), 'error:upload');
  });

  it('late answers for a removed or replaced pick change nothing', () => {
    const gone = removed();
    expect(uploadConfirmed(gone, NEW.src, 'f-new')).toBe(gone);
    expect(uploadFailed(gone, NEW.src, 'x')).toBe(gone);
    const other = beginPick(saved(), { src: 'blob:other', name: 'o.png' }, 'uploading');
    expect(uploadConfirmed(other, NEW.src, 'f-new')).toBe(other);
  });

  it('a preview-only pick keeps the saved file and can be put back', () => {
    const preview = beginPick(saved(), NEW, 'previewOnly');
    expect(preview).toMatchObject({ fileId: 'f-saved', phase: 'previewOnly' });
    expectSavedBack(pickFailed(preview, 'x'), 'x');
  });
});
