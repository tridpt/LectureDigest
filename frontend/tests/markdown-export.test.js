// Tests for the Markdown study-guide builder. _buildStudyGuideMarkdown is a
// pure function (data in → markdown string out), so we extract and call it
// directly. It references the global `fmtSecs` for numeric bookmark times, so
// we provide a stub before loading it.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadFn } from './extract.js';

let build;

beforeAll(() => {
  // _buildStudyGuideMarkdown references fmtSecs() for numeric bookmark times.
  globalThis.fmtSecs = (s) => {
    const m = Math.floor(s / 60);
    const sec = String(Math.floor(s % 60)).padStart(2, '0');
    return `${m}:${sec}`;
  };
  build = loadFn('pdf-export.js', '_buildStudyGuideMarkdown');
});

const SAMPLE = {
  title: 'Intro to Recursion',
  author: 'Prof. Ada',
  video_id: 'abc123',
  difficulty: 'medium',
  overview: 'A gentle introduction to recursion.',
  key_takeaways: ['Base case stops recursion', 'Recursive case shrinks the problem'],
  topics: [
    { timestamp_str: '00:30', emoji: '🔁', title: 'What is recursion', summary: 'A function calling itself.' },
  ],
  highlights: [
    { timestamp_str: '02:15', title: 'Stack overflow', description: 'Too deep recursion crashes.' },
  ],
  quiz: [
    {
      question: 'What stops recursion?',
      options: ['Base case', 'Loop', 'Return', 'Nothing'],
      correct_index: 0,
      explanation: 'The base case terminates the recursion.',
    },
  ],
};

describe('_buildStudyGuideMarkdown', () => {
  it('emits YAML front-matter with title, author, source, difficulty', () => {
    const md = build(SAMPLE, '', []);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "Intro to Recursion"');
    expect(md).toContain('author: "Prof. Ada"');
    expect(md).toContain('source: https://youtube.com/watch?v=abc123');
    expect(md).toContain('difficulty: medium');
    expect(md).toContain('tags: [lecturedigest, study-guide]');
  });

  it('includes all content sections', () => {
    const md = build(SAMPLE, '', []);
    expect(md).toContain('## 📋 Overview');
    expect(md).toContain('A gentle introduction to recursion.');
    expect(md).toContain('## ✅ Key Takeaways');
    expect(md).toContain('- Base case stops recursion');
    expect(md).toContain('## 🗺️ Chapter Timeline');
    expect(md).toContain('`00:30`');
    expect(md).toContain('## 🔥 Key Moments');
    expect(md).toContain('## 🧠 Knowledge Quiz');
  });

  it('marks the correct quiz answer with a check', () => {
    const md = build(SAMPLE, '', []);
    // Correct option (index 0) gets ✅, others do not.
    expect(md).toMatch(/- A\) Base case ✅/);
    expect(md).toMatch(/- B\) Loop\n/);
    expect(md).toContain('> 💡 The base case terminates the recursion.');
  });

  it('includes personal notes when provided', () => {
    const md = build(SAMPLE, 'My note line', []);
    expect(md).toContain('## ✏️ Personal Notes');
    expect(md).toContain('My note line');
  });

  it('omits the notes section when empty', () => {
    const md = build(SAMPLE, '   ', []);
    expect(md).not.toContain('## ✏️ Personal Notes');
  });

  it('renders bookmarks with numeric times via fmtSecs', () => {
    const md = build(SAMPLE, '', [{ time: 95, label: 'key point' }]);
    expect(md).toContain('## 🔖 Bookmarks');
    expect(md).toContain('`1:35` key point');
  });

  it('handles a minimal object without crashing', () => {
    const md = build({ title: 'Bare' }, '', []);
    expect(md).toContain('# Bare');
    expect(md).not.toContain('## 📋 Overview');
  });

  it('falls back to a default title', () => {
    const md = build({}, '', []);
    expect(md).toContain('# Study Guide');
  });
});
