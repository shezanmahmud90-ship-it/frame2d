# Validation against STAAD.Pro

The proposal (Sec. 6) plans to verify "selected linear, second-order and modal cases" in an independent
commercial program. Frame2D Studio carries these three cases as **V1, V2 and V3**. Open them from the
**Validation** button in the top bar (or the welcome screen).

| Case | Model | What it checks |
|---|---|---|
| V1. Linear static | Two-story, one-bay fixed-base steel frame, UDL 30 kN/m on the beams, 25 + 50 kN lateral | Geometry, supports, member loads, assembly, force recovery (indeterminate to degree 6) |
| V2. Second order | Fixed-base portal, 2000 kN on each column, 50 kN lateral | Geometric stiffness and Newton–Raphson: sway amplification |
| V3. Modal | W14x90 cantilever column, L = 4 m, 20 members, self-weight mass | Mass matrix and generalized eigenvalue solution |

## Workflow

1. The ready-made input files are in the [staad/](../staad/) folder. Or, in the Validation Center, choose a case
   and press **Download STAAD.Pro input**. The `.std` file uses
   `STAAD PLANE`, units kN and m, prismatic sections (`AX`, `IZ`, so no shear deformation, the same as
   Frame2D's Euler–Bernoulli elements) and the analysis command for that case:
   - V1: `PERFORM ANALYSIS`
   - V2: `PDELTA 30 ANALYSIS SMALLDELTA` (P-Δ and P-δ)
   - V3: material `DENSITY`, `SELFWEIGHT X 1` and `SELFWEIGHT Y 1` converted to mass, `MODAL CALCULATION REQUESTED`
2. Open the file in STAAD.Pro and run it. Check the command syntax against your STAAD.Pro version's
   Technical Reference.
3. Type STAAD's values into the STAAD.Pro column. The difference and the pass mark update at once and are
   saved in the browser. **Export table (.csv)** gives the table for the report.

## Where to read STAAD's numbers

- Displacements: *Joint Displacements*. STAAD prints them in cm even with `UNIT METER KN`; multiply by 10 for the app's mm.
- Reactions: *Support Reactions*. STAAD gives the force the support exerts on the structure, the same sign
  convention as Frame2D.
- Member end moments: *Member End Forces*, MZ at the start/end joint, in member local axes.
- Frequencies: *Calculated Frequencies for Load Case 1*.

## Results so far

V1 was run in STAAD.Pro on 2026-11-24. All ten compared quantities agree, with a largest difference of
0.16 % (the vertical displacement of node 5, which STAAD prints to 0.001 cm):

| Quantity | Frame2D | STAAD.Pro |
|---|---:|---:|
| Roof drift, node 5 (mm) | 8.1428 | 8.14282 |
| Level 1 drift, node 3 (mm) | 3.5737 | 3.574 |
| Vertical displacement, node 5 (mm) | −0.2157 | −0.216 |
| Base shear, node 1 (kN) | −25.313 | −25.31 |
| Vertical reaction, node 1 (kN) | 137.930 | 137.93 |
| Base moment, node 1 (kN·m) | 78.054 | 78.05 |
| Base moment, node 2 (kN·m) | 107.027 | 107.03 |
| Roof beam end moment, node 5 (kN·m) | 22.911 | 22.91 |
| Σ base shear (kN) | −75.00 | −75.00 |
| Σ vertical reactions (kN) | 360.00 | 360.00 |

V2 and V3: to be added.

## Expected differences

- V1 should agree to round-off (< 0.5 % target).
- V2: STAAD's P-Delta is an approximate iterative method, Frame2D uses a corotational formulation; expect
  agreement within about 1 %.
- V3: STAAD lumps masses at the joints, so the case uses Frame2D's lumped mass matrix (switch to
  *Consistent* in the modal options to see the more accurate value against theory). With 20 members the
  first frequencies agree with exact beam theory within 0.7 %.

Frame2D's values for all three cases are listed in [VERIFICATION.md](VERIFICATION.md).
