import { describe, expect, it } from 'vitest';
import { allLessons, COURSE } from '../src/course/curriculum';
import { labelSide, stoneX, TRAIL, trailLayout, trailPath } from '../src/course/map';

describe('course map trail', () => {
  it('winds every stone gently around the middle, never off the edge', () => {
    const xs = allLessons().map((_, i) => stoneX(i));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(50 - TRAIL.amplitude);
      expect(x).toBeLessThanOrEqual(50 + TRAIL.amplitude);
    }
    // It really winds: both sides are used, and neighbours are never on top of each other.
    expect(xs.some((x) => x < 35)).toBe(true);
    expect(xs.some((x) => x > 65)).toBe(true);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1]), `stone ${i}`).toBeGreaterThan(3);
  });

  it('lays out a unit as rows from the top, with room above and below', () => {
    const { points, height } = trailLayout(5, 4);
    expect(points.map((p) => p.y)).toEqual([TRAIL.top, TRAIL.top + TRAIL.row, TRAIL.top + 2 * TRAIL.row, TRAIL.top + 3 * TRAIL.row]);
    expect(points.map((p) => p.x)).toEqual([5, 6, 7, 8].map((i) => stoneX(i)));
    expect(height).toBe(TRAIL.top + 3 * TRAIL.row + TRAIL.bottom);
    // Stones keep their place across units: the wave runs on through the whole course.
    let start = 0;
    for (const unit of COURSE.units) {
      const layout = trailLayout(start, unit.lessons.length);
      expect(layout.points[0].x).toBe(stoneX(start));
      expect(layout.height).toBeGreaterThan(layout.points[layout.points.length - 1].y);
      start += unit.lessons.length;
    }
    expect(trailLayout(0, 0)).toEqual({ points: [], height: TRAIL.top + TRAIL.bottom });
  });

  it('draws one smooth curve between each pair of points', () => {
    expect(trailPath([])).toBe('');
    expect(trailPath([{ x: 50, y: 0 }])).toBe('M50 0');
    const d = trailPath([
      { x: 50, y: 0 },
      { x: 30, y: 100 },
      { x: 70.25, y: 200 },
    ]);
    expect(d).toBe('M50 0 C50 50 30 50 30 100 C30 150 70.3 150 70.3 200');
    expect(d.match(/C/g)).toHaveLength(2);
  });

  it('puts the words on the roomier side of each stone', () => {
    expect(labelSide(30)).toBe('right');
    expect(labelSide(50)).toBe('right');
    expect(labelSide(70)).toBe('left');
  });
});
