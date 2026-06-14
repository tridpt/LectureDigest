// Regression tests for the XSS escape helpers. These guard the fixes made to
// prevent attribute-context and stored XSS. If anyone "simplifies" an escaper
// back to something that misses quotes, these tests fail.

import { describe, it, expect } from 'vitest';
import { loadFn } from './extract.js';

// Helpers that must escape ALL of: & < > " '  (safe in text AND attributes).
const FULL_ESCAPERS = [
  ['core.js', 'esc'],
  ['chat-rooms.js', '_crEsc'],
  ['study-rooms.js', '_srEsc'],
  ['english.js', '_engEsc'],
  ['notifications.js', '_notifEsc'],
];

describe('full escapers (escape quotes for attribute safety)', () => {
  for (const [file, name] of FULL_ESCAPERS) {
    describe(`${name} (${file})`, () => {
      const fn = loadFn(file, name);

      it('escapes angle brackets and ampersand', () => {
        expect(fn('<script>')).toBe('&lt;script&gt;');
        expect(fn('a & b')).toBe('a &amp; b');
      });

      it('escapes double quotes (attribute breakout)', () => {
        expect(fn('" onerror="alert(1)')).not.toContain('"');
        expect(fn('x"y')).toContain('&quot;');
      });

      it('escapes single quotes (inline-handler breakout)', () => {
        expect(fn("'); alert(1);//")).not.toMatch(/'/);
        expect(fn("a'b")).toMatch(/&#0?39;|&apos;/);
      });

      it('neutralizes a classic stored-XSS payload', () => {
        const out = fn('"><img src=x onerror=alert(1)>');
        expect(out).not.toContain('<img');
        expect(out).not.toContain('">');
      });

      it('returns empty string for falsy input', () => {
        expect(fn('')).toBe('');
      });
    });
  }
});

describe('escHtml (core.js) escapes quotes', () => {
  const escHtml = loadFn('core.js', 'escHtml');
  it('escapes double quotes', () => {
    expect(escHtml('"')).toBe('&quot;');
  });
  it('escapes angle brackets', () => {
    expect(escHtml('<b>')).toBe('&lt;b&gt;');
  });
});
