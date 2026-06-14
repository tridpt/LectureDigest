// @vitest-environment jsdom
//
// Tests for escapers that rely on the DOM (textContent → innerHTML round-trip).
// These run under jsdom so `document` exists. They guard that DOM-based
// escapers still neutralize HTML in a text context.

import { describe, it, expect } from 'vitest';
import { loadFn } from './extract.js';

describe('_lbEscape (leaderboard.js) — DOM-based text escaper', () => {
  const fn = loadFn('leaderboard.js', '_lbEscape');

  it('escapes angle brackets so HTML is not parsed', () => {
    const out = fn('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;');
  });

  it('escapes ampersand', () => {
    expect(fn('Tom & Jerry')).toContain('&amp;');
  });

  it('leaves plain text intact', () => {
    expect(fn('Nguyen Van A')).toBe('Nguyen Van A');
  });
});

describe('_adminEsc (admin.js) — attribute + JS-string escaper', () => {
  const fn = loadFn('admin.js', '_adminEsc');

  it('escapes double quotes (attribute context)', () => {
    expect(fn('a"b')).toContain('&quot;');
  });

  it('escapes single quotes (inline JS-string context)', () => {
    // _adminEsc backslash-escapes single quotes for use inside '...' handlers.
    expect(fn("a'b")).toContain("\\'");
  });

  it('returns empty string for falsy input', () => {
    expect(fn('')).toBe('');
    expect(fn(null)).toBe('');
  });
});
