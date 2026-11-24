import { describe, expect, it } from 'vitest';
import { coverMarkup, coverSpec, coverStyle, hashText, unitArtMarkup } from '../src/ui/cover-art';

describe('generated cover art', () => {
  it('picks the style from tags in a fixed order, then from the source', () => {
    expect(coverStyle({ tags: ['children', 'lullaby'] })).toBe('lullaby');
    expect(coverStyle({ tags: ['classical', 'march'] })).toBe('march');
    expect(coverStyle({ tags: ['Holiday'] })).toBe('holiday');
    expect(coverStyle({ tags: ['carol'] })).toBe('holiday');
    expect(coverStyle({ tags: ['easy version'], source: 'mine' })).toBe('mine');
    expect(coverStyle({ tags: [], source: 'community' })).toBe('shared');
    expect(coverStyle({ tags: [] })).toBe('tune');
  });

  it('is the same every time for a song, and differs between songs', () => {
    const a = { id: 'pack:a', title: 'A', by: 'Traditional', tags: ['folk'] };
    const b = { id: 'pack:b', title: 'B', by: 'Traditional', tags: ['folk'] };
    expect(coverMarkup(a)).toBe(coverMarkup({ ...a }));
    expect(coverMarkup(a)).not.toBe(coverMarkup(b));
  });

  it('keeps one look for a named composer', () => {
    const one = coverSpec({ id: 'x1', by: 'Frédéric Chopin', tags: ['classical'] });
    const two = coverSpec({ id: 'x2', by: 'Frédéric Chopin', tags: ['classical'] });
    expect(one.colorway).toEqual(two.colorway);
    expect(one.motif).toBe(two.motif);
  });

  it('never puts song text into the markup', () => {
    const markup = coverMarkup({ id: '<script>', title: '<img src=x onerror=alert(1)>', by: '"><b>', tags: ['<i>'] });
    expect(markup).not.toMatch(/script|img|onerror|<b>|<i>/);
    expect(markup.startsWith('<rect')).toBe(true);
  });

  it('draws every course unit', () => {
    for (let i = 0; i < 9; i++) expect(unitArtMarkup(i)).toContain('<rect width="120"');
    expect(unitArtMarkup(9)).toBe(unitArtMarkup(9));
  });

  it('hashes text stably', () => {
    expect(hashText('twinkle')).toBe(hashText('twinkle'));
    expect(hashText('twinkle')).not.toBe(hashText('twinkle2'));
  });
});
