"""
LectureDigest — Build script for CSS/JS minification.

Usage:
    python build.py          # minify in-place
    python build.py --check  # dry-run, show savings only

Requires: pip install cssmin rjsmin
"""

import os
import sys
import glob

def get_size_str(b):
    return f"{b / 1024:.1f} KB"

def minify_css(content):
    """Simple CSS minification — remove comments, whitespace, newlines."""
    import re
    # Remove comments
    content = re.sub(r'/\*[\s\S]*?\*/', '', content)
    # Remove newlines and excess whitespace
    content = re.sub(r'\s+', ' ', content)
    # Remove spaces around special chars
    content = re.sub(r'\s*([{}:;,>~+])\s*', r'\1', content)
    # Remove trailing semicolons before }
    content = re.sub(r';}', '}', content)
    return content.strip()

def minify_js(content):
    """JS minification using rjsmin if available, else basic."""
    try:
        import rjsmin
        return rjsmin.jsmin(content)
    except ImportError:
        # Basic: remove single-line comments (not in strings), collapse whitespace
        import re
        lines = content.split('\n')
        result = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith('//'):
                continue
            result.append(stripped)
        return '\n'.join(result)

def main():
    check_only = '--check' in sys.argv

    base = os.path.dirname(os.path.abspath(__file__))
    frontend = os.path.join(base, 'frontend')

    css_dir = os.path.join(frontend, 'css')
    js_dirs = [os.path.join(frontend, 'js'), frontend]

    total_before = 0
    total_after = 0
    file_count = 0

    # CSS files
    css_files = glob.glob(os.path.join(css_dir, '*.css'))
    for f in css_files:
        original = open(f, 'r', encoding='utf-8').read()
        minified = minify_css(original)
        before = len(original.encode('utf-8'))
        after = len(minified.encode('utf-8'))
        total_before += before
        total_after += after
        file_count += 1

        saved_pct = (1 - after / before) * 100 if before > 0 else 0
        if saved_pct > 1:
            print(f"  CSS {os.path.basename(f):30s} {get_size_str(before):>8s} -> {get_size_str(after):>8s}  ({saved_pct:.0f}% saved)")

        if not check_only and saved_pct > 1:
            with open(f, 'w', encoding='utf-8', newline='') as fh:
                fh.write(minified)

    # JS files
    for js_dir in js_dirs:
        js_files = glob.glob(os.path.join(js_dir, '*.js'))
        for f in js_files:
            if os.path.basename(f) == 'sw.js':
                continue  # Don't minify service worker
            original = open(f, 'r', encoding='utf-8').read()
            minified = minify_js(original)
            before = len(original.encode('utf-8'))
            after = len(minified.encode('utf-8'))
            total_before += before
            total_after += after
            file_count += 1

            saved_pct = (1 - after / before) * 100 if before > 0 else 0
            if saved_pct > 1:
                print(f"  JS  {os.path.basename(f):30s} {get_size_str(before):>8s} -> {get_size_str(after):>8s}  ({saved_pct:.0f}% saved)")

            if not check_only and saved_pct > 1:
                with open(f, 'w', encoding='utf-8', newline='') as fh:
                    fh.write(minified)

    print(f"\n{'[DRY RUN] ' if check_only else ''}Summary:")
    print(f"  Files: {file_count}")
    print(f"  Before: {get_size_str(total_before)}")
    print(f"  After:  {get_size_str(total_after)}")
    print(f"  Saved:  {get_size_str(total_before - total_after)} ({(1 - total_after / total_before) * 100:.0f}%)")

    if check_only:
        print("\n  Run without --check to apply minification.")
    else:
        print("\n  Done! Files minified in-place.")

if __name__ == '__main__':
    main()
