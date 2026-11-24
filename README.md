# Frame2D Studio

Matrix structural analysis of plane frames and trusses that runs in the browser. Built for CE 7405
(Statically Indeterminate Structures, LSU, Fall 2026) following McGuire, Gallagher and Ziemian,
*Matrix Structural Analysis*, 2nd ed. (2000).

**Live app: https://shezanmahmud90-ship-it.github.io/frame2d/**

Nothing to install and no login: open the link on a laptop or phone, pick an example or draw a structure,
and the results update as you edit.

## Highlights

- **Ten analysis types**: linear static, second order (corotational), elastic buckling, plastic collapse
  (pushover), snap-through (arc length), natural frequencies, moving loads, influence lines, load
  combinations and earthquake time history.
- **Hand calculations**: a printable, worked solution of the current model (formulas, numbers substituted,
  results boxed) from DOF numbering to reactions, with checks by virtual work and equilibrium.
- **Animated results**: deformed shapes and diagrams grow in, load steps and hinge formation play back, mode
  shapes vibrate, the truck drives across the bridge, and the Method tab animates the assembly of [K].
- **Validation Center**: three STAAD.Pro cases (linear, second order, modal) with STAAD input export, entry
  of STAAD results and automatic differences.
- **Element and load options**: temperature and misfit loads, support settlement, inclined rollers, shear
  deformation (Timoshenko), semi-rigid connections with live fixity sliders, nodal masses.
- **Design and damage**: AISC 360 in-plane member checks with a worked hand check, member-removal and
  strengthening study, corrosion Monte Carlo of the collapse capacity, baseline comparison of two models.
- **Sharing and export**: share link with QR code, presentation mode, STAAD.Pro (.std), Excel (.xlsx),
  CSV, DXF, PNG and SVG.

## Course topics in the app

| Course topic | In the app |
|---|---|
| Matrix algebra, stiffness vs. flexibility | Checks tab: [F] = [K]ff⁻¹, [K]ff[F] = [I], Maxwell reciprocity |
| Properties of the stiffness matrix | Checks tab: symmetry, rigid-body (zero-energy) modes of [K], positive definiteness of [K]ff, condition number |
| Beam, truss and frame elements | Frame and truss members, moment releases (pins) by static condensation, semi-rigid springs, shear deformation |
| Coordinate transformation | Method tab: [k′], [Γ] and [k] = [Γ]ᵀ[k′][Γ] for any member; inclined supports |
| Global stiffness matrix | Method tab: DOF numbering (free first), assembly by code numbers, partitioned [K] |
| Load vector | Point, uniform, trapezoidal and partial member loads by ∫[N]ᵀq dx; temperature, misfit, settlement, springs |
| Principle of virtual work | Checks tab: unit-load method δ = Σ∫Mm/EI + Σ∫Nn/EA, compared with the stiffness solution |
| Introduction to FEM | Elements per member; buckling convergence study (21.6 % error with 1 element, 0.05 % with 4) |
| Nonlinear analysis | Second order (corotational, Newton–Raphson), elastic buckling, plastic hinges, arc length through snap-through |
| Dynamics | Modal analysis (consistent or lumped mass, effective modal mass), Newmark time history with Rayleigh damping |
| Moving loads | Axle groups with envelopes; influence lines by Müller-Breslau |
| Hand solution | Hand calculations page: every step of the direct stiffness method with the model's numbers |

## Using it

- **Examples** (top bar): 25 built-in models, including the verification cases from the proposal, each with
  closed-form references in the Checks tab.
- **New from template**: continuous beam, portal, multistory frame, Pratt/Howe/Warren truss, gable frame,
  column, or an empty grid.
- **Drawing tools**: Select (V), Node (N), Member (M), Support (S), Load (L); F fits the view; Delete removes;
  Ctrl+Z undoes.
- **Units**: kN and m. Sections in GPa, cm², cm⁴, cm³ and MPa. Settlements in mm.
- **Load patterns**: loads marked *Constant* (gravity) are applied first and held; loads *Scaled by λ* are
  increased in the nonlinear analyses. Each load can be given a case (D, L, W, E, S, T) for combinations.
- **Save/Open** uses a JSON model file; the current model is also autosaved in the browser.
- **Hand calculations**: choose the member for the element steps at the top of the page; *Print or save as
  PDF* gives the report.
- **Present**: a guided tour of the main features for a live demo (arrow keys to move, F for full screen).

Links can open an example directly, for example
`https://shezanmahmud90-ship-it.github.io/frame2d/#V1`, or `#portal`, `#truss`, `#euler`, `#toggle`,
`#building`, `#bridge`, `#cantFreq`, `#V2`, `#V3`. A shared model is carried in the link itself (`#m=…`),
so it needs no server.

## Verification

| Check | Command |
|---|---|
| Closed-form benchmarks (beams, truss, settlement, portal collapse, Euler column, beam-column, Williams toggle) | `node tests/run_tests.js` |
| Member loads, virtual work, equilibrium, K properties, determinacy, damage study | `node tests/feature_tests.js` |
| Temperature, misfit, inclined supports, Timoshenko, semi-rigid connections | `node tests/v3_tests.js` |
| Influence lines, combinations, AISC, corrosion, Newmark vs. exact SDOF | `node tests/advanced_tests.js` |
| Same models solved by the original Python kernel `python/core.py` | `node tests/export_for_python.js` then `python python/crosscheck.py` |
| Exact Williams toggle limit load (extensible elastica) | `python python/elastica_toggle.py` |
| Report with all tables | `node tests/report.js` → [docs/VERIFICATION.md](docs/VERIFICATION.md) |
| STAAD.Pro comparison (cases V1–V3) | Validation button in the app, input files in [staad/](staad/), guide in [docs/STAAD_VALIDATION.md](docs/STAAD_VALIDATION.md) |

`npm test` runs the four JavaScript suites (Node.js 18+). The Python checks need NumPy and SciPy.

Case V1 (two-story frame, linear static) matches STAAD.Pro in all ten compared quantities, with a largest
difference of 0.16 %, which comes from the precision of STAAD's printed output.

## Run it locally

Double-click `index.html`: it works straight from the folder, with no server and no internet connection,
which makes it a safe backup for a live demo. Or serve the folder with `python -m http.server 8000` and
open `http://localhost:8000`.

## Project layout

```
index.html            the app
css/style.css         layout and colours
css/pages.css         welcome screen, hand calculations, validation center, presentation mode
js/linalg.js          dense linear algebra (Gauss, Cholesky, Jacobi eigenvalues)
js/solver.js          analysis kernel: elements, assembly, linear, second order, buckling, plastic hinges, arc length
js/dynamics.js        modal analysis and moving loads
js/advanced.js        influence lines, load combinations, AISC checks, corrosion sampling, time history
js/examples.js        section library, templates, examples and validation cases with references
js/staad.js           STAAD.Pro .std writer
js/calcsheet.js       hand calculation page (KaTeX)
js/validation.js      STAAD.Pro validation center
js/welcome.js         welcome screen
js/share.js           share link and QR code, Excel and DXF export
js/present.js         presentation mode (edit STEPS to change the demo)
js/ui-*.js, app.js    interface: canvas, model editor, results, method walkthrough, checks, damage study
vendor/katex/         KaTeX math typesetting (MIT license), bundled so the app works offline
vendor/qrcode/        QR code generator (MIT license)
staad/                STAAD.Pro input files for validation cases V1–V3
python/core.py        original Python kernel (reference implementation)
python/crosscheck.py  compares the two kernels
tests/                Node.js test scripts
docs/                 verification report and STAAD.Pro guide
```

## Assumptions and limits

- Plane frames and trusses with in-plane loads; prismatic members.
- Euler–Bernoulli elements by default; Timoshenko shear deformation is optional per section.
- Linear elastic material except concentrated plastic hinges at element ends (Mp = fy Z, optional P–M
  interaction). Hinges form only at element ends, so place a node where a hinge may form inside a span
  (or subdivide members).
- Small strains, with large rotations only in the corotational analyses; member loads keep their original
  direction.
- Member removal is static only (no dynamic effects).
- AISC 360 checks are in-plane and assume laterally braced members. W-shape properties should be checked
  against the AISC Shapes Database before results are quoted.
- STAAD.Pro export of temperature loads, connection springs and inclined supports should be checked for
  syntax before use.

## Acknowledgements

Dr. Yen-Fang Su (course instructor, CE 7405), the Department of Civil and Environmental Engineering at LSU,
and the Laboratory of AIM³S for Future. STAAD.Pro (Bentley Systems) was used for validation, and Python
(NumPy, SciPy) for the original solver and the cross-check.

## AI use

Developed with assistance from Claude (Anthropic), ChatGPT (OpenAI) and Microsoft Copilot for coding,
debugging, interface design, test scripts and documentation, as allowed by the course policy. The
formulation follows McGuire et al. (2000). The author checked the equations, the benchmark results and
their interpretation, and is responsible for the submitted work.

## License

MIT License, see [LICENSE](LICENSE).

## Reference

McGuire, W., Gallagher, R. H., and Ziemian, R. D. (2000). *Matrix Structural Analysis* (2nd ed.).
John Wiley & Sons.
