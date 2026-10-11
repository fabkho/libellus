#!/usr/bin/env python3
"""Perf assessment: self and total time per function (and per chunk) from the .cpuprofile files of perf/flows.ts --profile.

  python3 perf/cpuprofile.py .data/perf/flows-6x   (pnpm perf:flows --profile) [flow ...]
"""
import json, sys, os, glob, collections


def summarise(path, top=18):
    p = json.load(open(path))
    nodes = {n['id']: n for n in p['nodes']}
    parent = {}
    for n in p['nodes']:
        for c in n.get('children', []):
            parent[c] = n['id']
    dts = p['timeDeltas']
    self_t = collections.Counter()
    for sid, dt in zip(p['samples'], dts):
        self_t[sid] += dt
    by_fn = collections.Counter()
    by_chunk = collections.Counter()
    total_fn = collections.Counter()
    for nid, t in self_t.items():
        cf = nodes[nid]['callFrame']
        key = f"{cf['functionName'] or '(anon)'} {os.path.basename(cf['url']) or cf['url'] or ''}:{cf['lineNumber']}:{cf['columnNumber']}"
        by_fn[key] += t
        by_chunk[os.path.basename(cf['url']) or cf['functionName']] += t
        # inclusive: walk up once per distinct ancestor
        seen = set()
        cur = nid
        while cur in nodes:
            c = nodes[cur]['callFrame']
            k = f"{c['functionName'] or '(anon)'} {os.path.basename(c['url'])}:{c['lineNumber']}:{c['columnNumber']}"
            if k not in seen:
                total_fn[k] += t
                seen.add(k)
            cur = parent.get(cur)
    ms = lambda c: [(k, round(v / 1000, 1)) for k, v in c.most_common(top)]
    return {'self': ms(by_fn), 'chunk': ms(by_chunk), 'total': ms(total_fn)}


if __name__ == '__main__':
    d = sys.argv[1]
    flows = sys.argv[2:]
    for p in sorted(glob.glob(os.path.join(d, '*.cpuprofile'))):
        name = os.path.basename(p).replace('.cpuprofile', '')
        if flows and name not in flows:
            continue
        s = summarise(p)
        print('==', name)
        for k in ('chunk', 'self', 'total'):
            print(' ', k)
            for f, v in s[k]:
                print('    ', v, f)
