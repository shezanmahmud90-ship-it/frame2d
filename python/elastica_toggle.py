"""Exact limit load of the Williams toggle from the extensible elastica (independent of the matrix solver).

Half of the symmetric toggle is one straight member, clamped at the support and, at the apex, free to move
vertically with zero rotation and zero horizontal displacement. The planar extensible elastica
    x' = (1 + N/EA) cos θ,  y' = (1 + N/EA) sin θ,  θ' = M/EI
is integrated from the support with unknown support reactions (H, V, M0), and the apex conditions are met
by Newton's method (shooting). The apex displacement w is prescribed, so the path passes the limit point.
Apex load P = 2V. Data: Williams (1964); EA = 1.885e6 lb, EI = 9.27e3 lb in^2.

Run: python python/elastica_toggle.py   ->   first limit point ≈ 33.87 lb at w ≈ 0.232 in
"""
import math
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import fsolve

E = 10.3e6                      # psi
b, d = 0.753, 0.243             # in
EA, EI = E * b * d, E * b * d ** 3 / 12
half, rise = 12.943, 0.386      # in
L0, psi = math.hypot(half, rise), math.atan2(rise, half)


def end_state(p):
    H, V, M0 = p                 # reactions at the clamped support

    def f(s, z):
        x, y, th = z
        N = -H * math.cos(th) - V * math.sin(th)          # axial force across the section
        M = M0 - (H * y - V * x)                          # bending moment at the section
        stretch = 1 + N / EA
        return [stretch * math.cos(th), stretch * math.sin(th), M / EI]

    return solve_ivp(f, [0, L0], [0, 0, psi], rtol=1e-11, atol=1e-13).y[:, -1]


def residual(p, w):
    x, y, th = end_state(p)
    return [x - half, y - (rise - w), th - psi]


if __name__ == "__main__":
    guess, path = np.zeros(3), []
    for w in np.linspace(1e-4, 0.35, 351):
        guess = fsolve(residual, guess, args=(w,), xtol=1e-12)
        path.append((w, 2 * abs(guess[1])))
    path = np.array(path)
    k = next(i for i in range(1, len(path) - 1) if path[i, 1] >= path[i - 1, 1] and path[i + 1, 1] < path[i, 1])
    print(f"first limit point: P = {path[k, 1]:.4f} lb at apex deflection w = {path[k, 0]:.4f} in")
