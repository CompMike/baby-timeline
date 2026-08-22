#!/usr/bin/env python3
"""Regenerate artifact.html from index.html.

Claude's Artifact host wraps the file it publishes in its own
<!doctype html><head></head><body> skeleton, so the published copy must be the
page *contents* only. Everything else — styles, markup, script — is identical,
which keeps index.html the single source of truth.

Run this after editing index.html, then republish artifact.html.
"""
import re, pathlib

src = pathlib.Path(__file__).with_name('index.html').read_text()

head = re.search(r'<head>(.*?)</head>', src, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)

# drop the tags the host supplies itself; keep <title> so the artifact is named
head = re.sub(r'<meta[^>]*>\s*', '', head)
head = re.sub(r'<!--.*?-->\s*', '', head, flags=re.S)
# The artifact is a static snapshot on another origin: config.js will not exist and
# the Worker would refuse it on CORS anyway, so drop it. window.BT_API stays unset,
# the page keeps its baked-in dates, and the editor removes itself.
head = re.sub(r'<script src="config\.js"></script>\s*', '', head)

out = (head.strip() + '\n' + body.strip() + '\n')
pathlib.Path(__file__).with_name('artifact.html').write_text(out)
print(f'artifact.html written ({len(out):,} bytes)')
