"""
frame2d.core - matrix structural analysis kernel for 2D frames (no GUI imports).

Units are user-defined but must be consistent. The presets use kN and m.

Formulation (CE 7405 topics)
----------------------------
* Direct stiffness method, 3 DOF per node (ux, uy, rz), Euler-Bernoulli frame element.
* First-order analysis: linear kinematics, K u = P.
* Second-order analysis: corotational formulation with geometric stiffness,
  incremental Newton-Raphson with load control.
* Elastic buckling: (K_E + lambda K_G) phi = 0 from the first-order axial forces.
* Inelastic analysis: concentrated plastic hinges (event-to-event with step
  bisection), optional axial-moment interaction.
* Arc-length (Crisfield cylindrical) path following through limit points.

Member loads: uniform load w perpendicular to the member, positive toward the
-y direction of the local axes (downward on a beam drawn from left to right).
Fixed-end actions are applied as equivalent nodal loads in the undeformed
geometry.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np
import scipy.linalg as sla


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------
@dataclass
class Section:
    name: str
    E: float          # Young's modulus
    A: float          # area
    I: float          # second moment of area
    Zp: float = 0.0   # plastic section modulus (0 -> elastic only)
    fy: float = 0.0   # yield stress
    rho: float = 0.0  # unit weight (force per volume), used only for self-weight

    @property
    def Mp(self) -> float:
        return self.Zp * self.fy

    @property
    def Py(self) -> float:
        return self.A * self.fy

    def scaled(self, factor_A: float, factor_I: float, factor_Z: float, name: str = None):
        return Section(name or self.name, self.E, self.A * factor_A, self.I * factor_I,
                       self.Zp * factor_Z, self.fy, self.rho)


@dataclass
class Member:
    i: int
    j: int
    sec: Section
    pin_i: bool = False
    pin_j: bool = False
    w: float = 0.0     # uniform load perpendicular to member (see module doc)


@dataclass
class Structure:
    nodes: List[Tuple[float, float]]
    members: List[Member]
    supports: Dict[int, Tuple[bool, bool, bool]] = field(default_factory=dict)
    settle: Dict[int, Tuple[float, float, float]] = field(default_factory=dict)
    loads_const: Dict[int, Tuple[float, float, float]] = field(default_factory=dict)
    loads_ref: Dict[int, Tuple[float, float, float]] = field(default_factory=dict)
    interaction: bool = True     # axial-moment interaction for plastic hinges
    springs: Dict[int, Tuple[float, float, float]] = field(default_factory=dict)   # elastic supports (kx, ky, krz)

    # ---- sizes and helpers
    @property
    def ndof(self) -> int:
        return 3 * len(self.nodes)

    def fixed_dofs(self) -> np.ndarray:
        d = []
        for n, flags in self.supports.items():
            for k in range(3):
                if flags[k]:
                    d.append(3 * n + k)
        return np.array(sorted(d), dtype=int)

    def free_dofs(self) -> np.ndarray:
        fixed = set(self.fixed_dofs().tolist())
        return np.array([d for d in range(self.ndof) if d not in fixed], dtype=int)

    def prescribed(self) -> np.ndarray:
        u = np.zeros(self.ndof)
        for n, vals in self.settle.items():
            flags = self.supports.get(n, (False, False, False))
            for k in range(3):
                if flags[k]:
                    u[3 * n + k] = vals[k]
        return u

    def geom0(self, e: int):
        m = self.members[e]
        (xi, yi), (xj, yj) = self.nodes[m.i], self.nodes[m.j]
        dx, dy = xj - xi, yj - yi
        L = math.hypot(dx, dy)
        return L, dx / L, dy / L, math.atan2(dy, dx)

    def member_dofs(self, e: int) -> np.ndarray:
        m = self.members[e]
        return np.array([3 * m.i, 3 * m.i + 1, 3 * m.i + 2, 3 * m.j, 3 * m.j + 1, 3 * m.j + 2])

    # ---- loads
    def load_vectors(self) -> Tuple[np.ndarray, np.ndarray]:
        """Return (P0, Pref): constant load vector (incl. member loads) and reference vector."""
        P0 = np.zeros(self.ndof)
        Pr = np.zeros(self.ndof)
        for n, v in self.loads_const.items():
            P0[3 * n:3 * n + 3] += v
        for n, v in self.loads_ref.items():
            Pr[3 * n:3 * n + 3] += v
        for e, m in enumerate(self.members):
            if m.w != 0.0:
                L, c, s, _ = self.geom0(e)
                wl = m.w
                loc = np.array([0.0, -wl * L / 2, -wl * L ** 2 / 12, 0.0, -wl * L / 2, wl * L ** 2 / 12])
                g = np.zeros(6)
                for k in (0, 3):
                    fy = loc[k + 1]
                    g[k] = -s * fy
                    g[k + 1] = c * fy
                    g[k + 2] = loc[k + 2]
                P0[self.member_dofs(e)] += g
        return P0, Pr


# --------------------------------------------------------------------------
# Hinge state and element routine
# --------------------------------------------------------------------------
def initial_hinges(S: Structure) -> List[List[Optional[float]]]:
    """None = elastic end, 0.0 = pin, +1/-1 = plastic hinge with that moment sign."""
    return [[0.0 if m.pin_i else None, 0.0 if m.pin_j else None] for m in S.members]


def mp_eff(sec: Section, N: float, interaction: bool) -> float:
    Mp = sec.Mp
    if not interaction or sec.Py <= 0:
        return Mp
    p = min(abs(N) / sec.Py, 1.0)
    m = 1.0 - p / 2.0 if p < 0.2 else (9.0 / 8.0) * (1.0 - p)
    return Mp * max(m, 0.0)


def _wrap(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


def element(S: Structure, e: int, ue: np.ndarray, hinge, linear: bool = False):
    """Internal force vector, tangent stiffness and basic data of member e."""
    m = S.members[e]
    sec = m.sec
    L0, c0, s0, a0 = S.geom0(e)
    EA = sec.E * sec.A / L0
    EI = sec.E * sec.I
    if linear:
        c, s, Ln = c0, s0, L0
        dux, duy = ue[3] - ue[0], ue[4] - ue[1]
        ub = c * dux + s * duy
        rot = (-s * dux + c * duy) / L0
        th1, th2 = ue[2] - rot, ue[5] - rot
    else:
        dxn = (S.nodes[m.j][0] - S.nodes[m.i][0]) + ue[3] - ue[0]
        dyn = (S.nodes[m.j][1] - S.nodes[m.i][1]) + ue[4] - ue[1]
        Ln = math.hypot(dxn, dyn)
        c, s = dxn / Ln, dyn / Ln
        ub = Ln - L0
        dal = _wrap(math.atan2(dyn, dxn) - a0)
        th1, th2 = ue[2] - dal, ue[5] - dal
    z = np.array([-s, c])
    a = np.concatenate([z, [0.0], -z, [0.0]]) / Ln
    B = np.zeros((3, 6))
    B[0] = [-c, -s, 0, c, s, 0]
    B[1] = a
    B[1, 2] += 1.0
    B[2] = a
    B[2, 5] += 1.0

    N = EA * ub
    fem1 = m.w * L0 ** 2 / 12.0
    fem2 = -fem1
    h1, h2 = hinge[0], hinge[1]

    def target(h):
        return 0.0 if h == 0.0 else h * mp_eff(sec, N, S.interaction)

    c2 = 2.0 * EI / L0
    kb = np.zeros((3, 3))
    kb[0, 0] = EA
    if h1 is None and h2 is None:
        M1 = c2 * (2 * th1 + th2)
        M2 = c2 * (th1 + 2 * th2)
        kb[1:, 1:] = [[4 * EI / L0, 2 * EI / L0], [2 * EI / L0, 4 * EI / L0]]
    elif h1 is not None and h2 is None:
        m1 = target(h1) - fem1
        M1 = m1
        M2 = 0.5 * m1 + 3 * EI / L0 * th2
        kb[2, 2] = 3 * EI / L0
    elif h1 is None and h2 is not None:
        m2 = target(h2) - fem2
        M2 = m2
        M1 = 0.5 * m2 + 3 * EI / L0 * th1
        kb[1, 1] = 3 * EI / L0
    else:
        M1 = target(h1) - fem1
        M2 = target(h2) - fem2

    q = np.array([N, M1, M2])
    f = B.T @ q
    K = B.T @ kb @ B
    if not linear:
        Zv = np.outer(z, z)
        w = np.concatenate([-z, [0.0], z, [0.0]])
        K = K + (N / Ln) * np.outer(w, w)
        r = np.array([c, s])
        S2 = np.outer(r, z) + np.outer(z, r)
        G = np.zeros((6, 6))
        G[0:2, 0:2] = S2
        G[0:2, 3:5] = -S2
        G[3:5, 0:2] = -S2
        G[3:5, 3:5] = S2
        K = K + ((M1 + M2) / Ln ** 2) * G
    info = dict(N=N, M1=M1 + fem1, M2=M2 + fem2, L0=L0, Ln=Ln, c=c, s=s)
    return f, K, info


def assemble(S: Structure, u: np.ndarray, hinges, linear: bool = False):
    n = S.ndof
    F = np.zeros(n)
    K = np.zeros((n, n))
    infos = []
    for e in range(len(S.members)):
        d = S.member_dofs(e)
        f, k, info = element(S, e, u[d], hinges[e], linear)
        F[d] += f
        K[np.ix_(d, d)] += k
        infos.append(info)
    for n, ks in S.springs.items():
        for k in range(3):
            if ks[k]:
                F[3 * n + k] += ks[k] * u[3 * n + k]
                K[3 * n + k, 3 * n + k] += ks[k]
    return F, K, infos


def _solve_free(K, rhs, free):
    Kff = K[np.ix_(free, free)].copy()
    scale = np.max(np.abs(np.diag(Kff))) if len(free) else 1.0
    rot = np.array([i for i, d in enumerate(free) if d % 3 == 2], dtype=int)
    Kff[rot, rot] += 1e-9 * scale        # regularise pinned-only joints
    return np.linalg.solve(Kff, rhs[free])


def newton(S, u0, hinges, P, linear=False, tol=1e-9, maxit=40):
    """Newton-Raphson for K_T du = P - F_int(u). Returns (u, converged, iterations)."""
    free = S.free_dofs()
    u = u0.copy()
    for it in range(maxit + 1):
        F, K, _ = assemble(S, u, hinges, linear)
        R = P - F
        err = np.linalg.norm(R[free])
        if err <= tol * (1.0 + np.linalg.norm(P[free])):
            return u, True, it
        if it == maxit:
            break
        try:
            du = _solve_free(K, R, free)
        except np.linalg.LinAlgError:
            return u, False, it
        u[free] += du
        if not np.all(np.isfinite(u)):
            return u, False, it
    return u, False, maxit


# --------------------------------------------------------------------------
# Results containers
# --------------------------------------------------------------------------
@dataclass
class Result:
    kind: str
    u: np.ndarray                       # final displacement vector
    infos: list                         # per-member end actions at final state
    reactions: np.ndarray
    lam: Optional[np.ndarray] = None    # load factor history
    ctrl: Optional[np.ndarray] = None   # control displacement history
    u_hist: Optional[list] = None
    hinges: Optional[list] = None       # final hinge states
    events: Optional[list] = None       # hinge formation events
    lam_cr: Optional[float] = None
    mode: Optional[np.ndarray] = None
    note: str = ""


def first_order(S: Structure, lam: float = 1.0) -> Result:
    """Linear (first-order) analysis for load P0 + lam*Pref."""
    hinges = initial_hinges(S)
    P0, Pr = S.load_vectors()
    P = P0 + lam * Pr
    u0 = S.prescribed()
    u, ok, _ = newton(S, u0, hinges, P, linear=True)
    F, _, infos = assemble(S, u, hinges, True)
    react = (F - P)[S.fixed_dofs()]
    return Result("first_order", u, infos, react, hinges=hinges)


def second_order(S: Structure, lam_max: float = 1.0, steps: int = 20, gravity_steps: int = 4) -> Result:
    """Geometrically nonlinear analysis by incremental Newton-Raphson (load control)."""
    hinges = initial_hinges(S)
    P0, Pr = S.load_vectors()
    u = S.prescribed()
    lam_hist, ctrl_hist, uh = [0.0], [0.0], [u.copy()]
    note = ""
    # stage 1: constant (gravity) load
    if np.linalg.norm(P0) > 0:
        for g in np.linspace(0, 1, gravity_steps + 1)[1:]:
            u, ok, _ = newton(S, u, hinges, g * P0)
            if not ok:
                note = "Newton-Raphson failed during gravity stage"
                break
    uh[0] = u.copy()
    lam = 0.0
    dlam = lam_max / steps
    while lam < lam_max - 1e-12 and not note:
        step = min(dlam, lam_max - lam)
        trial = step
        for _ in range(12):
            un, ok, _ = newton(S, u, hinges, P0 + (lam + trial) * Pr)
            if ok:
                break
            trial *= 0.5
        if not ok:
            note = f"no convergence beyond load factor {lam:.4g} (limit point or instability)"
            break
        u = un
        lam += trial
        lam_hist.append(lam)
        uh.append(u.copy())
    F, _, infos = assemble(S, u, hinges, False)
    react = (F - (P0 + lam * Pr))[S.fixed_dofs()]
    return Result("second_order", u, infos, react, lam=np.array(lam_hist), u_hist=uh,
                  hinges=hinges, note=note)


def geometric_stiffness_linear(S: Structure, infos) -> np.ndarray:
    """Assemble K_G (undeformed geometry) from member forces of a first-order solution.

    Members without end releases use the consistent (cubic-shape-function) geometric
    stiffness matrix; members with a pinned end use the string-type matrix N/L, which
    is exact for a member whose end rotation is free. The end-moment term is added
    for both.
    """
    K = np.zeros((S.ndof, S.ndof))
    for e, info in enumerate(infos):
        m = S.members[e]
        L, c, s, _ = S.geom0(e)
        N = info["N"]
        M1, M2 = info["M1"], info["M2"]
        if not (m.pin_i or m.pin_j):
            kl = (N / L) * np.array([
                [1, 0, 0, -1, 0, 0],
                [0, 6 / 5, L / 10, 0, -6 / 5, L / 10],
                [0, L / 10, 2 * L ** 2 / 15, 0, -L / 10, -L ** 2 / 30],
                [-1, 0, 0, 1, 0, 0],
                [0, -6 / 5, -L / 10, 0, 6 / 5, -L / 10],
                [0, L / 10, -L ** 2 / 30, 0, -L / 10, 2 * L ** 2 / 15]])
            T = np.zeros((6, 6))
            R = np.array([[c, s], [-s, c]])
            T[0:2, 0:2] = R
            T[3:5, 3:5] = R
            T[2, 2] = 1.0
            T[5, 5] = 1.0
            kg = T.T @ kl @ T
        else:
            z = np.array([-s, c])
            w = np.concatenate([-z, [0.0], z, [0.0]])
            kg = (N / L) * np.outer(w, w)
        r = np.array([c, s])
        z = np.array([-s, c])
        S2 = np.outer(r, z) + np.outer(z, r)
        G = np.zeros((6, 6))
        G[0:2, 0:2] = S2
        G[0:2, 3:5] = -S2
        G[3:5, 0:2] = -S2
        G[3:5, 3:5] = S2
        kg = kg + ((M1 + M2) / L ** 2) * G
        d = S.member_dofs(e)
        K[np.ix_(d, d)] += kg
    return K


def buckling(S: Structure, lam: float = 1.0) -> Result:
    """Elastic buckling load factor from (K_E + lam_cr K_G) phi = 0.

    K_G comes from the member forces of the first-order solution for P0 + lam*Pref,
    so lam_cr multiplies that whole load set.
    """
    base = first_order(S, lam)
    hinges = initial_hinges(S)
    _, KE, _ = assemble(S, np.zeros(S.ndof), hinges, True)
    KG = geometric_stiffness_linear(S, base.infos)
    free = S.free_dofs()
    KEf = KE[np.ix_(free, free)].copy()
    KGf = KG[np.ix_(free, free)]
    scale = np.max(np.abs(np.diag(KEf)))
    rot = np.array([i for i, d in enumerate(free) if d % 3 == 2])
    KEf[rot, rot] += 1e-9 * scale
    w, v = sla.eig(KEf, -KGf)
    best, idx = np.inf, None
    for k, val in enumerate(w):
        if np.isfinite(val) and abs(val.imag) < 1e-8 * max(1.0, abs(val.real)) and val.real > 1e-9:
            if val.real < best:
                best, idx = val.real, k
    mode = np.zeros(S.ndof)
    if idx is not None:
        mode[free] = np.real(v[:, idx])
        mx = np.max(np.abs(mode))
        if mx > 0:
            mode /= mx
    res = Result("buckling", base.u, base.infos, base.reactions, lam_cr=None if idx is None else best * lam,
                 mode=mode, hinges=hinges)
    return res


# --------------------------------------------------------------------------
# Inelastic (plastic hinge) analysis
# --------------------------------------------------------------------------
def orphan_rotations(S: Structure, hinges) -> set:
    """Rotation DOFs with no stiffness (every member end at the node is hinged, node not restrained)."""
    ends = {}
    for e, m in enumerate(S.members):
        ends.setdefault(m.i, []).append(hinges[e][0] is not None)
        ends.setdefault(m.j, []).append(hinges[e][1] is not None)
    out = set()
    for n, flags in ends.items():
        restrained = n in S.supports and S.supports[n][2]
        if all(flags) and not restrained:
            out.add(3 * n + 2)
    return out


def _yield_ratios(S, infos, hinges):
    out = []
    for e, info in enumerate(infos):
        m = S.members[e]
        if m.sec.Mp <= 0:
            continue
        lim = mp_eff(m.sec, info["N"], S.interaction)
        if lim <= 0:
            continue
        for k, key in ((0, "M1"), (1, "M2")):
            if hinges[e][k] is None:
                out.append((abs(info[key]) / lim, e, k, math.copysign(1.0, info[key])))
    return out


def pushover(S: Structure, lam_max: float = 10.0, dlam: float = 0.05, geometric: bool = True,
             gravity_steps: int = 4, max_events: int = 200, ctrl_dof: Optional[int] = None) -> Result:
    """Event-to-event plastic hinge analysis in load control.

    geometric=True uses the corotational (second-order) element, False uses first-order kinematics.
    Collapse is reported when the tangent stiffness loses positive definiteness.
    """
    linear = not geometric
    hinges = initial_hinges(S)
    P0, Pr = S.load_vectors()
    u = S.prescribed()
    free = S.free_dofs()
    if ctrl_dof is None:
        ctrl_dof = int(np.argmax(np.abs(Pr)))
    note = ""
    # gravity stage (hinge check included)
    if np.linalg.norm(P0) > 0:
        for g in np.linspace(0, 1, gravity_steps + 1)[1:]:
            u, ok, _ = newton(S, u, hinges, g * P0, linear=linear)
            if not ok:
                note = "gravity stage did not converge"
    lam = 0.0
    lam_hist, ctrl_hist, uh, events = [0.0], [u[ctrl_dof]], [u.copy()], []

    def ratios_at(uu):
        _, _, inf = assemble(S, uu, hinges, linear)
        return _yield_ratios(S, inf, hinges), inf

    r_prev = max([r[0] for r in ratios_at(u)[0]], default=0.0)
    if r_prev > 1.0 + 1e-6:
        note = "gravity load alone causes plastic hinges"
    step = dlam
    tol_y = 1e-4
    collapse = False
    while lam < lam_max - 1e-12 and len(events) < max_events and not note and not collapse:
        trial = min(step, lam_max - lam)
        accepted = False
        for _ in range(60):
            un, ok, _ = newton(S, u, hinges, P0 + (lam + trial) * Pr, linear=linear)
            if not ok:
                trial *= 0.5
                if trial < 1e-10:
                    break
                continue
            rs, inf = ratios_at(un)
            rmax = max([r[0] for r in rs], default=0.0)
            if rmax <= 1.0 + tol_y:
                accepted = True
                break
            # interpolate to the yield event
            frac = (1.0 - r_prev) / (rmax - r_prev) if rmax > r_prev else 0.5
            trial *= min(max(frac, 0.02), 0.9)
            if trial < 1e-10:
                un, accepted = un, True
                break
        if not accepted:
            note = "stopped: no convergence (mechanism or instability)"
            collapse = True
            break
        u = un
        lam += trial
        lam_hist.append(lam)
        ctrl_hist.append(u[ctrl_dof])
        uh.append(u.copy())
        rs, inf = ratios_at(u)
        rmax = max([r[0] for r in rs], default=0.0)
        r_prev = rmax
        newly = [r for r in rs if r[0] >= 1.0 - tol_y]
        for (ratio, e, k, sgn) in newly:
            hinges[e][k] = sgn
            events.append(dict(lam=lam, member=e, end="i" if k == 0 else "j", sign=sgn))
        if newly:
            # singular tangent -> mechanism
            _, K, _ = assemble(S, u, hinges, linear)
            orphan = orphan_rotations(S, hinges)
            keep = np.array([d for d in free if d not in orphan], dtype=int)
            Kff = K[np.ix_(keep, keep)]
            ev = np.linalg.eigvalsh(0.5 * (Kff + Kff.T))
            if ev.min() <= 1e-7 * np.max(np.abs(np.diag(Kff))):
                note = "collapse mechanism formed"
                collapse = True
        else:
            step = min(step * 1.5, dlam)
        r_prev = max([r[0] for r in ratios_at(u)[0]], default=0.0)
    F, _, infos = assemble(S, u, hinges, linear)
    react = (F - (P0 + lam * Pr))[S.fixed_dofs()]
    res = Result("pushover", u, infos, react, lam=np.array(lam_hist), ctrl=np.array(ctrl_hist),
                 u_hist=uh, hinges=hinges, events=events, note=note)
    res.lam_cr = lam    # last converged load factor (collapse load if a mechanism formed)
    return res


# --------------------------------------------------------------------------
# Arc-length (Crisfield, cylindrical) for elastic geometric nonlinearity
# --------------------------------------------------------------------------
def arc_length(S: Structure, ctrl_dof: int, ds: float, nsteps: int = 200, lam_limit: Optional[float] = None,
               disp_limit: Optional[float] = None, gravity_steps: int = 4, maxit: int = 30, tol: float = 1e-8) -> Result:
    hinges = initial_hinges(S)
    P0, Pr = S.load_vectors()
    free = S.free_dofs()
    u = S.prescribed()
    if np.linalg.norm(P0) > 0:
        for g in np.linspace(0, 1, gravity_steps + 1)[1:]:
            u, _, _ = newton(S, u, hinges, g * P0)
    lam = 0.0
    lam_hist, ctrl_hist, uh = [0.0], [u[ctrl_dof]], [u.copy()]
    du_prev = None
    ds_cur = ds
    note = ""

    def ksolve(K, rhs):
        return _solve_free(K, rhs, free)

    for step in range(nsteps):
        converged = False
        for attempt in range(10):
            F, K, _ = assemble(S, u, hinges)
            dut = ksolve(K, Pr)
            dtot = np.zeros(len(free))
            if du_prev is None:
                sgn = 1.0
            else:
                sgn = 1.0 if float(dut @ du_prev) >= 0 else -1.0
            dlam_inc = sgn * ds_cur / math.sqrt(float(dut @ dut))
            dtot = dlam_inc * dut
            lam_t = lam + dlam_inc
            u_t = u.copy()
            u_t[free] += dtot
            dlam_tot = dlam_inc
            ok = False
            for it in range(maxit):
                F, K, _ = assemble(S, u_t, hinges)
                R = (P0 + lam_t * Pr - F)[free]
                if np.linalg.norm(R) <= tol * (1 + np.linalg.norm((P0 + lam_t * Pr)[free])):
                    ok = True
                    break
                dut = ksolve(K, Pr)
                dur = ksolve(K, P0 + lam_t * Pr - F)
                a = float(dut @ dut)
                b = 2.0 * float((dtot + dur) @ dut)
                c = float((dtot + dur) @ (dtot + dur)) - ds_cur ** 2
                disc = b * b - 4 * a * c
                if disc < 0:
                    break
                r1 = (-b + math.sqrt(disc)) / (2 * a)
                r2 = (-b - math.sqrt(disc)) / (2 * a)
                d1 = dtot + dur + r1 * dut
                d2 = dtot + dur + r2 * dut
                ref = dtot if np.linalg.norm(dtot) > 0 else dut
                pick = r1 if float(d1 @ ref) >= float(d2 @ ref) else r2
                dtot = dtot + dur + pick * dut
                lam_t += pick
                u_t = u.copy()
                u_t[free] += dtot
            if ok:
                converged = True
                break
            ds_cur *= 0.5
        if not converged:
            note = f"arc-length stopped at step {step} (no convergence)"
            break
        du_prev = dtot.copy()
        u, lam = u_t, lam_t
        lam_hist.append(lam)
        ctrl_hist.append(u[ctrl_dof])
        uh.append(u.copy())
        ds_cur = min(ds_cur * 1.2, ds)
        if lam_limit is not None and lam >= lam_limit:
            break
        if disp_limit is not None and abs(u[ctrl_dof]) >= disp_limit:
            break
    F, _, infos = assemble(S, u, hinges)
    react = (F - (P0 + lam * Pr))[S.fixed_dofs()]
    return Result("arc_length", u, infos, react, lam=np.array(lam_hist), ctrl=np.array(ctrl_hist),
                  u_hist=uh, hinges=hinges, note=note)


# --------------------------------------------------------------------------
# Post-processing
# --------------------------------------------------------------------------
def member_diagram(S: Structure, e: int, info: dict, npts: int = 21):
    """Return x, V, M (sagging positive), N along member e from end actions (reference length)."""
    m = S.members[e]
    L = info["L0"]
    M1, M2, N = info["M1"], info["M2"], info["N"]
    wp = m.w
    V1 = (M1 + M2) / L + wp * L / 2.0
    x = np.linspace(0, L, npts)
    Mx = -M1 + V1 * x - wp * x ** 2 / 2.0
    Vx = V1 - wp * x
    return x, Vx, Mx, np.full_like(x, N)


def deformed_member(S: Structure, e: int, u: np.ndarray, scale: float = 1.0, npts: int = 15):
    """Cubic Hermite interpolation of the deformed member (global coordinates)."""
    m = S.members[e]
    L0, c0, s0, _ = S.geom0(e)
    d = u[S.member_dofs(e)]
    # local displacements in the initial frame
    Tm = np.array([[c0, s0], [-s0, c0]])
    ui = Tm @ d[0:2]
    uj = Tm @ d[3:5]
    ti, tj = d[2], d[5]
    xi = np.array(S.nodes[m.i])
    xs = np.linspace(0, 1, npts)
    out = []
    for t in xs:
        N1 = 1 - 3 * t ** 2 + 2 * t ** 3
        N2 = L0 * (t - 2 * t ** 2 + t ** 3)
        N3 = 3 * t ** 2 - 2 * t ** 3
        N4 = L0 * (-t ** 2 + t ** 3)
        ulx = (1 - t) * ui[0] + t * uj[0]
        uly = N1 * ui[1] + N2 * ti + N3 * uj[1] + N4 * tj
        loc = np.array([t * L0 + scale * ulx, scale * uly])
        g = xi + Tm.T @ loc
        out.append(g)
    return np.array(out)
