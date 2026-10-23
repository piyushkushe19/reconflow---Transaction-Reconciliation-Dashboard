import { it, expect } from 'vitest'; import { inr } from './utils.js';
it('formats INR with Indian grouping', () => { expect(inr('1299500.5')).toContain('12,99,500.50'); expect(inr(null)).toBe('—'); });
