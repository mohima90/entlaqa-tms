import { describe, expect, it } from 'vitest';
import {
  CENTERED,
  MAX_PICK_BYTES,
  MAX_ZOOM,
  baseScale,
  clampFraming,
  formatBytes,
  moveBy,
  pickProblem,
  sourceRect,
  zoomTo,
} from './profile-photo-crop';

const VIEW = 288;

describe('framing a profile photo (WP-ADM-04)', () => {
  it('a landscape picture just covers the view at zoom 1 and shows its centre square', () => {
    expect(baseScale(1000, 500, VIEW)).toBeCloseTo(VIEW / 500);
    const rect = sourceRect(CENTERED, 1000, 500, VIEW);
    expect(rect.side).toBeCloseTo(500);
    expect(rect.sx).toBeCloseTo(250);
    expect(rect.sy).toBeCloseTo(0);
  });

  it('a portrait picture shows its middle', () => {
    const rect = sourceRect(CENTERED, 500, 1000, VIEW);
    expect(rect.side).toBeCloseTo(500);
    expect(rect.sx).toBeCloseTo(0);
    expect(rect.sy).toBeCloseTo(250);
  });

  it('never leaves an empty border: dragging stops where the picture ends', () => {
    // 1000 x 500 at zoom 1 is 576 x 288 on screen: it can move 144 px either way sideways, not up or down.
    const moved = moveBy(CENTERED, 500, 500, 1000, 500, VIEW);
    expect(moved.x).toBeCloseTo(144);
    expect(moved.y).toBe(0);
    expect(moveBy(CENTERED, -500, 0, 1000, 500, VIEW).x).toBeCloseTo(-144);
    // The saved square is then the left edge of the picture.
    expect(sourceRect(moved, 1000, 500, VIEW).sx).toBeCloseTo(0);
  });

  it('zoom keeps the centre, is limited to 1…4 and re-clamps the position', () => {
    const zoomed = zoomTo(CENTERED, 2, 1000, 500, VIEW);
    expect(zoomed.zoom).toBe(2);
    expect(sourceRect(zoomed, 1000, 500, VIEW).side).toBeCloseTo(250);
    expect(zoomTo(CENTERED, 99, 1000, 500, VIEW).zoom).toBe(MAX_ZOOM);
    expect(zoomTo(CENTERED, 0.1, 1000, 500, VIEW).zoom).toBe(1);
    const far = moveBy(zoomed, 10_000, 10_000, 1000, 500, VIEW);
    const back = zoomTo(far, 1, 1000, 500, VIEW);
    expect(Math.abs(back.x)).toBeLessThanOrEqual(144 + 1e-9);
    expect(back.y).toBe(0);
  });

  it('the saved square always lies inside the picture', () => {
    for (const [w, h] of [
      [1000, 500],
      [500, 1000],
      [800, 800],
      [4000, 3000],
    ] as const) {
      for (const zoom of [1, 1.7, 4]) {
        for (const [x, y] of [
          [0, 0],
          [9999, -9999],
          [-9999, 9999],
        ] as const) {
          const f = clampFraming({ zoom, x, y }, w, h, VIEW);
          const { sx, sy, side } = sourceRect(f, w, h, VIEW);
          expect(sx).toBeGreaterThanOrEqual(-1e-6);
          expect(sy).toBeGreaterThanOrEqual(-1e-6);
          expect(sx + side).toBeLessThanOrEqual(w + 1e-6);
          expect(sy + side).toBeLessThanOrEqual(h + 1e-6);
        }
      }
    }
  });

  it('writes sizes with Latin digits', () => {
    expect(formatBytes(180 * 1024)).toBe('180 KB');
    expect(formatBytes(100)).toBe('1 KB');
    expect(formatBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
  });

  it('refuses a file that is not PNG, JPEG or WebP by its content, and one too big to decode', () => {
    expect(pickProblem('image/png', 1000)).toBeNull();
    expect(pickProblem('image/jpeg', 8 * 1024 * 1024)).toBeNull();
    expect(pickProblem(null, 1000)).toBe('type');
    expect(pickProblem('image/webp', 0)).toBe('type');
    expect(pickProblem('image/jpeg', MAX_PICK_BYTES + 1)).toBe('size');
  });
});
