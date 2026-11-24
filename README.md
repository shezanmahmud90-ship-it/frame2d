# Frame2D Studio

Matrix structural analysis of plane frames and trusses that runs in the browser. Built for CE 7405
(Statically Indeterminate Structures, LSU, Fall 2026) following McGuire, Gallagher and Ziemian,
*Matrix Structural Analysis*, 2nd ed. (2000).

**Live app:** `https://<shezanmahmud90-ship-it>.github.io/frame2d-studio/` (after you enable GitHub Pages, see below)

Nothing to install: open the link, pick an example or draw a structure, and the results update as you edit.

Highlights:
- **Seven analyses**: linear static, second order (corotational), elastic buckling, plastic collapse, snap-through (arc length), natural frequencies and moving loads.
- **Hand calculations**: a printable, worked solution of the current model (formulas, numbers substituted, results boxed) from DOF numbering to reactions, plus checks by virtual work and equilibrium.
- **Animated results**: deformed shapes and diagrams grow in, load steps and hinge formation play back, mode shapes vibrate, the truck drives across the bridge.
- **Validation Center**: three STAAD.Pro cases (linear, second order, modal) with STAAD input export, entry of STAAD results and automatic differences.

New in version 3:
- **Influence lines** (Müller-Breslau), **load combinations** with envelopes, **AISC 360 member checks** with a worked hand check, **earthquake time history** (Newmark, Rayleigh damping, synthetic or imported records).
- **Temperature and misfit loads**, **inclined rollers**, **shear deformation** (Timoshenko) and **semi-rigid connections** with live fixity sliders.
- **Corrosion Monte Carlo** of the collapse capacity, **baseline comparison** of two model versions.
- **Animated assembly** of [K] in the Method tab, **presentation mode** for the demo, **share link with QR code**, **Excel and DXF export**.

## What it does

| Course topic | In the app |
|---|---|
| Matrix algebra, stiffness vs. flexibility | Checks tab: [F] = [K]ff⁻¹, [K]ff[F] = [I], Maxwell reciprocity |
| Properties of the stiffness matrix | Checks tab: symmetry, rigid-body (zero-energy) modes of [K], positive definiteness of [K]ff, condition number |
| Beam, truss and frame elements | Frame and truss members, moment releases (pins) by static condensation |
| Coordinate transformation | Method tab: [k′], [Γ] and [k] = [Γ]ᵀ[k′][Γ] for any member |
| Global stiffness matrix | Method tab: DOF numbering (free first), assembly by code numbers, partitioned [K] |
| Load vector | Point, uniform, trapezoidal and partial member loads by ∫[N]ᵀq dx; support settlement; springs |
| Principle of virtual work | Checks tab: unit-load method δ = Σ∫Mm/EI + Σ∫Nn/EA, compared with the stiffness solution |
| Introduction to FEM | Elements per member; buckling convergence study (21.6 % error with 1 element, 0.05 % with 4) |
| Nonlinear analysis | Second order (corotational, Newton–Raphson), elastic buckling, plastic hinges, arc length through snap-through |
| Project: damage assessment | Damage tab: intact / member removed / strengthened capacity, C and η, ranking of all members by removal |
| Project: dynamics and moving loads | Modal analysis (consistent or lumped mass, effective modal mass) and moving axle groups with envelopes |
| Hand solution | Hand calculations page: every step of the direct stiffness method with the model's numbers |

## Using it

- **Examples** (top bar): the verification cases from the proposal, each with closed-form references in the Checks tab.
- **New from template**: continuous beam, portal, multistory frame, Pratt/Howe/Warren truss, gable frame, column, or an empty grid.
- **Drawing tools**: Select (V), Node (N), Member (M), Support (S), Load (L); F fits the view; Delete removes; Ctrl+Z undoes.
- **Units**: kN and m. Sections in GPa, cm², cm⁴, cm³ and MPa. Settlements in mm.
- **Load patterns**: loads marked *Constant* (gravity) are applied first and held; loads *Scaled by λ* are increased in the nonlinear analyses.
- **Export**: STAAD.Pro input (.std), results (.csv), drawing (.png/.svg). **Save/Open** uses a JSON model file; the current model is also autosaved in the browser.
- **Hand calculations**: choose the member for the element steps at the top of the page; *Print or save as PDF* gives the report.

## Verification

| Check | Command |
|---|---|
| Closed-form benchmarks (beams, truss, settlement, portal collapse, Euler column, beam-column, Williams toggle) | `node tests/run_tests.js` |
| Member loads, virtual work, equilibrium, K properties, determinacy, damage study | `node tests/feature_tests.js` |
| Temperature, misfit, inclined supports, Timoshenko, semi-rigid connections | `node tests/v3_tests.js` |
| Influence lines, combinations, AISC, corrosion, Newmark vs exact SDOF | `node tests/advanced_tests.js` |
| Same models solved by the original Python kernel `python/core.py` | `node tests/export_for_python.js` then `python python/crosscheck.py` |
| Exact Williams toggle limit load (extensible elastica) | `python python/elastica_toggle.py` |
| Report with all tables | `node tests/report.js` → [docs/VERIFICATION.md](docs/VERIFICATION.md) |
| STAAD.Pro comparison (cases V1–V3) | Validation button in the app, and [docs/STAAD_VALIDATION.md](docs/STAAD_VALIDATION.md) |

Node.js 18+ runs the JavaScript tests. The Python checks need NumPy and SciPy.

## Run it locally

Double-click `index.html`: it works straight from the folder, with no server and no internet connection, which makes it a safe backup for the live demo.
Or serve the folder: `python -m http.server 8000` and open `http://localhost:8000`.

## Publish on GitHub Pages

1. Create a public repository named `frame2d-studio` on GitHub.
2. Upload the contents of this folder (keep `index.html` at the top level), or from a terminal:
   ```
   git init
   git add .
   git commit -m "Frame2D Studio"
   git branch -M main
   git remote add origin https://github.com/<your-github-username>/frame2d-studio.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → main / (root) → Save**.
4. After a minute the app is live at `https://<your-github-username>.github.io/frame2d-studio/`.
   A shared model is carried in the link itself (`#m=…`), so it works on GitHub Pages without a server. Links to an example open it directly, e.g. `…/frame2d-studio/#portal` or `#truss`, `#euler`, `#toggle`, `#building`, `#bridge`, `#cantFreq`, `#V1`, `#V2`, `#V3`.

## Project layout

```
index.html            the app
css/style.css         layout and colours
js/linalg.js          dense linear algebra (Gauss, Cholesky, Jacobi eigenvalues)
js/solver.js          analysis kernel: elements, assembly, linear, second order, buckling, plastic hinges, arc length
js/dynamics.js        modal analysis and moving loads
js/calcsheet.js       hand calculation page (KaTeX)
js/validation.js      STAAD.Pro validation center
js/welcome.js         welcome screen
js/advanced.js        influence lines, load combinations, AISC checks, corrosion sampling, time history
js/ui-advanced.js     interface for those, baseline comparison and the animated assembly
js/share.js           share link and QR code, Excel and DXF export
js/present.js         presentation mode (edit STEPS to change the demo)
vendor/qrcode/        QR code generator (MIT licence)
vendor/katex/         KaTeX math typesetting (MIT licence), bundled so the app works offline
js/examples.js        section library, templates, verification examples with references
js/staad.js           STAAD.Pro .std writer
js/ui-*.js, app.js    interface: drawing canvas, model editor, results, method walkthrough, checks, damage study
python/core.py        original Python kernel (reference implementation)
python/crosscheck.py  compares the two kernels
tests/                Node.js test scripts
docs/                 verification report and STAAD.Pro guide
```

## Assumptions and limits

Plane frames and trusses; prismatic Euler–Bernoulli elements (no shear deformation); linear elastic material
except concentrated plastic hinges at element ends (Mp = fy Z, optional P–M interaction); small strains with
large rotations in the corotational analyses; member loads stay in their original direction. Plastic hinges
form only at element ends, so place a node where a hinge may form inside a span (or subdivide members).
Static member removal only (no dynamic effects). W-shape properties should be checked against the AISC
Shapes Database before results are quoted.

## AI use

Developed with assistance from Claude (Anthropic) and OpenAI Codex for coding, interface design, test
scripts and documentation, as allowed by the course policy. The formulation follows McGuire et al. (2000);
the author checked the equations, the benchmark results and their interpretation and is responsible for the
submitted work.

## Reference

McGuire, W., Gallagher, R. H., and Ziemian, R. D. (2000). *Matrix Structural Analysis* (2nd ed.). John Wiley & Sons.
