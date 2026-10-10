#!/usr/bin/env python3
"""Median per step over the runs of a `pnpm perf` result (.data/perf/<label>/<profile>.json).

  python3 docs/perf/data/final/summarise.py .data/perf/final-4x-a/slow4g-4x.json [--steps a-start-cold,b1-home-to-library] [--json out.json]

Prints one row per step: ready, LCP, CLS, INP, TBT, LoAF n/ms, worst LoAF, requests, KB, DOM nodes, style ms, heap MB, and the
spread (max-min)/median of `ready`. API requests (host supabase, no preflights) are counted too.
"""
import json
import statistics
import sys

path = sys.argv[1]
steps = None
out = None
if '--steps' in sys.argv:
    steps = sys.argv[sys.argv.index('--steps') + 1].split(',')
if '--json' in sys.argv:
    out = sys.argv[sys.argv.index('--json') + 1]
d = json.load(open(path))
byid = {}
order = []
for run in d['results']:
    for s in run['steps']:
        if not s.get('ok'):
            continue
        if s['id'] not in byid:
            byid[s['id']] = []
            order.append(s['id'])
        byid[s['id']].append(s)


def g(s, *keys):
    for k in keys:
        if s is None:
            return None
        s = s.get(k) if isinstance(s, dict) else None
    return s


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None


def spread(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = statistics.median(xs)
    return round((max(xs) - min(xs)) / m, 3) if m else None


rows = {}
for sid in order:
    if steps and sid not in steps:
        continue
    L = byid[sid]
    api = []
    for s in L:
        reqs = g(s, 'net', 'requests') or 0
        n = 0
        for r in s.get('requests', []) or []:
            if r.get('host') == 'supabase' and r.get('type') != 'preflight':
                n += 1
        api.append(n)
    rows[sid] = {
        'runs': len(L),
        'ready': med([s.get('readyMs') for s in L]),
        'ready_spread': spread([s.get('readyMs') for s in L]),
        'fcp': med([g(s, 'stats', 'fcp') for s in L]),
        'lcp': med([g(s, 'stats', 'lcp', 'ms') for s in L]),
        'cls': med([g(s, 'stats', 'cls', 'value') for s in L]),
        'inp': med([g(s, 'stats', 'inp', 'ms') if isinstance(g(s, 'stats', 'inp'), dict) else g(s, 'stats', 'inp') for s in L]),
        'tbt': med([g(s, 'stats', 'tbt') for s in L]),
        'loaf_n': med([g(s, 'stats', 'loaf', 'n') for s in L]),
        'loaf_ms': med([g(s, 'stats', 'loaf', 'totalMs') for s in L]),
        'loaf_max': med([g(s, 'stats', 'loaf', 'maxMs') for s in L]),
        'req': med([g(s, 'net', 'requests') for s in L]),
        'kb': med([g(s, 'net', 'transferKb') for s in L]),
        'api_req': med(api),
        'nodes': med([g(s, 'cdp', 'nodes') for s in L]),
        'style_ms': med([g(s, 'cdp', 'styleMs') for s in L]),
        'layout_ms': med([g(s, 'cdp', 'layoutMs') for s in L]),
        'heap': med([g(s, 'cdp', 'heapMB') for s in L]),
    }
hdr = ['step', 'runs', 'ready', 'spr', 'fcp', 'lcp', 'cls', 'inp', 'tbt', 'loafN', 'loafMs', 'loafMax', 'req', 'api', 'kb', 'nodes', 'styleMs', 'layoutMs', 'heap']
print(' | '.join(hdr))
for sid, r in rows.items():
    print(' | '.join(str(x) for x in [sid, r['runs'], r['ready'], r['ready_spread'], r['fcp'], r['lcp'], r['cls'], r['inp'], r['tbt'], r['loaf_n'], r['loaf_ms'], r['loaf_max'], r['req'], r['api_req'], r['kb'], r['nodes'], r['style_ms'], r['layout_ms'], r['heap']]))
if out:
    json.dump({'meta': d['meta'], 'steps': rows}, open(out, 'w'), indent=1)
