// Helper: extract a named top-level function from a source file and return it
// as a callable, WITHOUT executing the rest of the (browser-coupled) module.
//
// Why: the frontend ships as non-module global scripts that reference browser
// globals at load time. We only want to unit-test individual pure-ish helpers
// (the XSS escapers). So we slice out a single `function name(...) { ... }`
// block by brace-matching, then eval just that block. This means the test runs
// the REAL source — if someone edits the escaper to be unsafe, the test fails.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_DIR = join(__dirname, '..', 'js');
const FRONTEND_DIR = join(__dirname, '..');

function sliceFunction(source, name) {
  const sig = new RegExp(`function\\s+${name}\\s*\\(`);
  const m = sig.exec(source);
  if (!m) throw new Error(`function ${name} not found`);
  // Find the opening brace of the body.
  let i = source.indexOf('{', m.index);
  if (i < 0) throw new Error(`opening brace for ${name} not found`);
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(m.index, j + 1);
      }
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

// Load a named function from a frontend JS file (relative to frontend/js).
export function loadFn(file, name) {
  const source = readFileSync(join(JS_DIR, file), 'utf8');
  const block = sliceFunction(source, name);
  // eslint-disable-next-line no-eval
  const factory = eval(`(function(){ ${block}; return ${name}; })`);
  return factory();
}

// Load a function from a file directly under frontend/ (e.g. concept-explainer.js).
export function loadFnFromFrontend(file, name) {
  const source = readFileSync(join(FRONTEND_DIR, file), 'utf8');
  const block = sliceFunction(source, name);
  // eslint-disable-next-line no-eval
  const factory = eval(`(function(){ ${block}; return ${name}; })`);
  return factory();
}
