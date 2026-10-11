#!/usr/bin/env python3
"""Perf assessment (research/perf-assessment): summarise the Chrome traces written by perf/flows.ts.

  python3 perf/analyse.py .data/perf/flows-4x > .data/perf/flows-4x/trace-summary.json
"""
import json, sys, os, glob, collections

MAIN_BUCKETS = {
    'FunctionCall': 'script', 'EvaluateScript': 'script', 'v8.compile': 'script', 'TimerFire': 'script',
    'FireAnimationFrame': 'script', 'EventDispatch': 'script', 'v8.callFunction': 'script',
    'UpdateLayoutTree': 'style', 'Layout': 'layout', 'PrePaint': 'prepaint', 'Paint': 'paint',
    'Layerize': 'layerize', 'UpdateLayer': 'layerize', 'Commit': 'commit', 'CompositeLayers': 'composite',
    'Decode Image': 'decode', 'ImageDecodeTask': 'decode', 'Decode LazyPixelRef': 'decode',
    'ParseHTML': 'parse', 'GPUTask': 'gpu',
}


def load(path):
    with open(path) as f:
        data = json.load(f)
    return data['traceEvents'] if isinstance(data, dict) else data


def analyse(path):
    ev = load(path)
    threads = {}
    for e in ev:
        if e.get('ph') == 'M' and e.get('name') == 'thread_name':
            threads[(e['pid'], e['tid'])] = e['args']['name']
    # Renderer main: the CrRendererMain with the most events.
    counts = collections.Counter((e['pid'], e['tid']) for e in ev if threads.get((e.get('pid'), e.get('tid'))) == 'CrRendererMain')
    if not counts:
        return {}
    main = counts.most_common(1)[0][0]
    rpid = main[0]
    xs = [e for e in ev if e.get('ph') == 'X' and 'dur' in e]
    t0 = min(e['ts'] for e in xs)
    # Top-level tasks on main.
    tasks = sorted([e for e in xs if (e['pid'], e['tid']) == main and e['name'] in ('RunTask', 'ThreadControllerImpl::RunTask')], key=lambda e: e['ts'])
    long = []
    for t in tasks:
        if t['dur'] < 50000:
            continue
        end = t['ts'] + t['dur']
        inner = collections.Counter()
        for e in xs:
            if (e['pid'], e['tid']) == main and t['ts'] <= e['ts'] < end and e['name'] in MAIN_BUCKETS:
                inner[MAIN_BUCKETS[e['name']]] += e['dur']
        long.append({'at_ms': round((t['ts'] - t0) / 1000), 'ms': round(t['dur'] / 1000), 'inner_ms_overlapping': {k: round(v / 1000) for k, v in inner.most_common()}})
    # Totals on main by bucket (exclusive-ish: top events of each kind, nested double counts possible for script).
    totals = collections.Counter()
    for e in xs:
        if (e['pid'], e['tid']) == main and e['name'] in MAIN_BUCKETS and MAIN_BUCKETS[e['name']] != 'script':
            totals[MAIN_BUCKETS[e['name']]] += e['dur']
    # Thread busy time per named thread (top-level X events only approximated by summing RunTask-like).
    busy = collections.Counter()
    for e in xs:
        name = threads.get((e['pid'], e['tid']), '?')
        if e['name'] in ('RunTask', 'ThreadControllerImpl::RunTask', 'TaskGraphRunner::RunTask', 'ThreadPool_RunTask'):
            busy[name] += e['dur']
    # Image decodes and which thread.
    decodes = collections.Counter()
    for e in xs:
        if e['name'] in ('Decode Image', 'ImageDecodeTask', 'Decode LazyPixelRef'):
            decodes[threads.get((e['pid'], e['tid']), '?')] += e['dur']
    # Frames (compositor's view).
    states = collections.Counter()
    for e in ev:
        if e.get('name') == 'PipelineReporter' and e.get('ph') in ('b', 'X'):
            st = (e.get('args', {}).get('chrome_frame_reporter') or {}).get('state')
            if st:
                states[st] += 1
    dropped = sum(1 for e in ev if e.get('name') in ('DroppedFrame',))
    # Animations that could not run on the compositor.
    failed = collections.Counter()
    for e in ev:
        if e.get('name') == 'Animation' and e.get('ph') in ('b', 'n', 'e'):
            d = (e.get('args') or {}).get('data') or {}
            if d.get('compositeFailed'):
                failed[(d.get('compositeFailed'), tuple(d.get('unsupportedProperties') or []))] += 1
    # Compositor draw cost per frame (headless = software compositing: a CPU stand-in for the GPU's work,
    # filters and backdrop-filters included).
    draws = sorted(e['dur'] / 1000 for e in xs if e['name'] == 'Display::DrawAndSwap')
    pct = lambda q: round(draws[min(len(draws) - 1, int(q * len(draws)))], 1) if draws else 0
    filt = collections.Counter()
    for e in xs:
        if 'Filter' in e['name'] or 'Backdrop' in e['name']:
            filt[e['name']] += e['dur']
    viz = {'frames': len(draws), 'mean_ms': round(sum(draws) / len(draws), 1) if draws else 0, 'p50': pct(0.5), 'p95': pct(0.95), 'max': pct(1.0), 'total_ms': round(sum(draws)), 'filter_events_ms': {k: round(v / 1000, 1) for k, v in filt.most_common(5)}}
    return {
        'viz_draw': viz,
        'long_tasks': long,
        'main_ms': {k: round(v / 1000, 1) for k, v in totals.most_common()},
        'thread_busy_ms': {k: round(v / 1000) for k, v in busy.most_common(8)},
        'decode_ms_by_thread': {k: round(v / 1000, 1) for k, v in decodes.items()},
        'frame_states': dict(states),
        'dropped_frame_events': dropped,
        'non_composited_animations': [{'reason': r, 'props': list(p), 'n': n} for (r, p), n in failed.items()],
    }


if __name__ == '__main__':
    d = sys.argv[1]
    out = {}
    for p in sorted(glob.glob(os.path.join(d, '*.trace.json'))):
        out[os.path.basename(p).replace('.trace.json', '')] = analyse(p)
    print(json.dumps(out, indent=1))
