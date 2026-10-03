import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from '../errors';
import { findCrossings } from './crossings';

const F = 2030 * 12;

describe('findCrossings (PRD E11)', () => {
  it('records a crossing at the first month the lead flips; leader = plan that just took the lead', () => {
    expect(findCrossings([[5, 5, 5, 5], [1, 4, 6, 9]], F)).toEqual([{ leader: 1, trailer: 0, month: F + 2 }]);
  });

  it('ties carry the prior sign: tie then the same leader again is no crossing', () => {
    expect(findCrossings([[2, 3, 3, 4], [1, 3, 3, 3]], F)).toEqual([]);
  });

  it('tie then the opposite leader crosses at the first strictly opposite month', () => {
    expect(findCrossings([[2, 3, 3, 3], [1, 3, 3, 4]], F)).toEqual([{ leader: 1, trailer: 0, month: F + 3 }]);
  });

  it('touch-and-return produces none', () => {
    expect(findCrossings([[2, 3, 5], [1, 3, 4]], F)).toEqual([]);
  });

  it('identical prefixes set the initial sign without a crossing', () => {
    expect(findCrossings([[1, 2, 3, 4], [1, 2, 4, 6]], F)).toEqual([]);
  });

  it('identical forever: none', () => {
    expect(findCrossings([[1, 2], [1, 2]], F)).toEqual([]);
  });

  it('cross-backs and multiple crossings in the same year each produce an event', () => {
    const A = [3, 1, 3, 1, 3];
    const B = [1, 2, 2, 2, 2];
    expect(findCrossings([A, B], F)).toEqual([
      { leader: 1, trailer: 0, month: F + 1 },
      { leader: 0, trailer: 1, month: F + 2 },
      { leader: 1, trailer: 0, month: F + 3 },
      { leader: 0, trailer: 1, month: F + 4 },
    ]);
  });

  it('three plans: ordered by month, then pair order A-B, A-C, B-C', () => {
    const A = [10, 10, 10, 10];
    const B = [0, 5, 12, 12];
    const C = [0, 5, 11, 20];
    expect(findCrossings([A, B, C], F)).toEqual([
      { leader: 1, trailer: 0, month: F + 2 }, // A-B
      { leader: 2, trailer: 0, month: F + 2 }, // A-C
      { leader: 2, trailer: 1, month: F + 3 }, // B-C
    ]);
  });

  it('events sort by month before pair order', () => {
    const A = [10, 10, 10];
    const B = [0, 0, 20]; // A-B at 2
    const C = [0, 15, 15]; // A-C at 1
    expect(findCrossings([A, B, C], F).map((c) => [c.leader, c.trailer, c.month - F])).toEqual([
      [2, 0, 1],
      [1, 0, 2],
      [1, 2, 2],
    ]);
  });

  it('single plan or no plans: none; mismatched lengths and non-finite values throw', () => {
    expect(findCrossings([[1, 2]], F)).toEqual([]);
    expect(findCrossings([], F)).toEqual([]);
    expect(() => findCrossings([[1, 2], [1]], F)).toThrow(InvalidProjectionInputError);
    expect(() => findCrossings([[1, Number.NaN], [1, 2]], F)).toThrow(InvalidProjectionInputError);
  });
});
