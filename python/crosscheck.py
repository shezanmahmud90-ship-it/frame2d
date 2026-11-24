"""Cross-check of the browser solver (js/solver.js) against the original Python kernel (core.py).

Run:  node tests/export_for_python.js   then   python python/crosscheck.py
Compares displacements (linear, second order), the elastic critical load factor and the
plastic-hinge collapse load factor and hinge sequence on the same models.
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from core import Section, Member, Structure, first_order, second_order, buckling, pushover

HERE = os.path.dirname(__file__)
cases = json.load(open(os.path.join(HERE, "..", "tests", "crosscheck.json")))


def to_core(m, nsub):
    nodes = [(n["x"], n["y"]) for n in m["nodes"]]
    secs = [Section(s["name"], s["E"], s["A"], s["I"], s.get("Z", 0), s.get("fy", 0)) for s in m["sections"]]
    members = []
    for mi, mm in enumerate(m["members"]):
        w = 0.0
        for ld in m["memberLoads"]:
            if ld["member"] != mi:
                continue
            (xi, yi), (xj, yj) = nodes[mm["i"]], nodes[mm["j"]]
            L = math.hypot(xj - xi, yj - yi); c = (xj - xi) / L
            if ld["dir"] == "local":
                w += -ld["w1"]
            elif ld["dir"] == "GY" and abs(yj - yi) < 1e-12:
                w += -ld["w1"] * c
            else:
                raise ValueError("load not representable in core.py")
        n = 1 if mm["type"] == "truss" else nsub
        prev = mm["i"]
        (xi, yi), (xj, yj) = nodes[mm["i"]], nodes[mm["j"]]
        for k in range(n):
            if k == n - 1:
                nxt = mm["j"]
            else:
                nxt = len(nodes); nodes.append((xi + (xj - xi) * (k + 1) / n, yi + (yj - yi) * (k + 1) / n))
            members.append(Member(prev, nxt, secs[mm["sec"]], pin_i=(k == 0 and mm["relI"]), pin_j=(k == n - 1 and mm["relJ"]), w=w))
            prev = nxt
    sup = {s["node"]: (s["ux"], s["uy"], s["rz"]) for s in m["supports"]}
    lc, lr = {}, {}
    for ld in m["nodeLoads"]:
        d = lc if ld["pat"] == "G" else lr
        v = d.get(ld["node"], (0, 0, 0)); d[ld["node"]] = (v[0] + ld["fx"], v[1] + ld["fy"], v[2] + ld["mz"])
    return Structure(nodes, members, supports=sup, loads_const=lc, loads_ref=lr, interaction=m["settings"].get("interaction", True))


def rel(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float(np.max(np.abs(a - b)) / max(np.max(np.abs(b)), 1e-30))


ok = True
for c in cases:
    S = to_core(c["model"], c["nsub"])
    r1 = first_order(S); e1 = rel(c["linear"], r1.u)
    r2 = second_order(S, 1.0, 10); e2 = rel(c["second"], r2.u)
    b = buckling(S); eb = abs(c["lamCr"] - b.lam_cr) / b.lam_cr
    line = f"{c['name']:<9} linear {e1:.1e}  second-order {e2:.1e}  buckling λcr js={c['lamCr']:.5g} py={b.lam_cr:.5g} ({eb:.1e})"
    ok &= e1 < 1e-6 and e2 < 1e-5 and eb < 1e-6
    for geo in (False, True):
        key = f"push_{'true' if geo else 'false'}"
        if c["name"] == "twoSpan":
            continue
        p = pushover(S, 10.0, 0.05, geometric=geo)
        js = c[key]
        seq_py = [(e["member"], 0 if e["end"] == "i" else 1) for e in p.events]
        seq_js = [tuple(x) for x in js["events"]]
        same = seq_py == seq_js
        ep = abs(js["lam"] - p.lam_cr) / max(p.lam_cr, 1e-12)
        ok &= ep < 1e-4 and same
        line += f"\n          pushover {'P-Δ ' if geo else '1st '} λ js={js['lam']:.5f} py={p.lam_cr:.5f} ({ep:.1e}), hinge sequence {'identical' if same else 'DIFFERENT'} ({len(seq_py)} hinges)"
    print(line)
print("CROSS-CHECK PASS" if ok else "CROSS-CHECK FAIL")
