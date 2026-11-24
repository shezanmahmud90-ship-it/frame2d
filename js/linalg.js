/* Frame2D Studio - dense linear algebra helpers (no dependencies).
 * Matrices are arrays of Float64Array rows. Sizes in this tool stay below a few hundred DOFs,
 * so dense O(n^3) routines are fast enough and easy to read. */
(function (root) {
  "use strict";

  function zeros(n, m) {
    const A = new Array(n);
    for (let i = 0; i < n; i++) A[i] = new Float64Array(m === undefined ? n : m);
    return A;
  }
  function vec(n) { return new Float64Array(n); }
  function copy(A) { return A.map(r => Float64Array.from(r)); }
  function eye(n) { const I = zeros(n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; }

  function transpose(A) {
    const n = A.length, m = n ? A[0].length : 0, T = zeros(m, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
    return T;
  }
  function matmul(A, B) {
    const n = A.length, k = B.length, m = k ? B[0].length : 0, C = zeros(n, m);
    for (let i = 0; i < n; i++) {
      const Ai = A[i], Ci = C[i];
      for (let p = 0; p < k; p++) {
        const a = Ai[p]; if (a === 0) continue;
        const Bp = B[p];
        for (let j = 0; j < m; j++) Ci[j] += a * Bp[j];
      }
    }
    return C;
  }
  function matvec(A, x) {
    const n = A.length, y = vec(n);
    for (let i = 0; i < n; i++) { let s = 0; const Ai = A[i]; for (let j = 0; j < x.length; j++) s += Ai[j] * x[j]; y[i] = s; }
    return y;
  }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function norm(a) { return Math.sqrt(dot(a, a)); }
  function sub(A, rows, cols) {
    const S = zeros(rows.length, cols.length);
    for (let i = 0; i < rows.length; i++) { const r = A[rows[i]]; for (let j = 0; j < cols.length; j++) S[i][j] = r[cols[j]]; }
    return S;
  }
  function subv(v, idx) { const o = vec(idx.length); for (let i = 0; i < idx.length; i++) o[i] = v[idx[i]]; return o; }
  /** C = B^T A B for small dense matrices */
  function btab(B, A) { return matmul(transpose(B), matmul(A, B)); }

  /** Solve A x = b by Gaussian elimination with partial pivoting. Throws on a singular matrix. */
  function solve(A0, b0) {
    const n = A0.length, A = copy(A0), b = Float64Array.from(b0);
    let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
    if (scale === 0) scale = 1;
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(A[k][k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i][k]); if (v > mx) { mx = v; p = i; } }
      if (mx <= 1e-13 * scale) { const e = new Error("singular"); e.singular = true; e.dof = k; throw e; }
      if (p !== k) { const t = A[k]; A[k] = A[p]; A[p] = t; const tb = b[k]; b[k] = b[p]; b[p] = tb; }
      const Ak = A[k], akk = Ak[k];
      for (let i = k + 1; i < n; i++) {
        const Ai = A[i], f = Ai[k] / akk; if (f === 0) continue;
        for (let j = k; j < n; j++) Ai[j] -= f * Ak[j];
        b[i] -= f * b[k];
      }
    }
    const x = vec(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; const Ai = A[i]; for (let j = i + 1; j < n; j++) s -= Ai[j] * x[j]; x[i] = s / Ai[i]; }
    return x;
  }

  /** Inverse by repeated solves (small matrices only). */
  function inverse(A) {
    const n = A.length, Inv = zeros(n);
    for (let j = 0; j < n; j++) { const e = vec(n); e[j] = 1; const x = solve(A, e); for (let i = 0; i < n; i++) Inv[i][j] = x[i]; }
    return Inv;
  }

  /** Cholesky factor L (A = L L^T); returns null when A is not positive definite. */
  function cholesky(A, relTol) {
    const n = A.length, L = zeros(n);
    let scale = 0; for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(A[i][i]));
    const tol = (relTol === undefined ? 1e-12 : relTol) * (scale || 1);
    for (let j = 0; j < n; j++) {
      let s = A[j][j];
      for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
      if (!(s > tol)) return null;
      const d = Math.sqrt(s); L[j][j] = d;
      for (let i = j + 1; i < n; i++) {
        let t = A[i][j];
        for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
        L[i][j] = t / d;
      }
    }
    return L;
  }
  function forwardSub(L, b) { const n = L.length, x = vec(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * x[k]; x[i] = s / L[i][i]; } return x; }
  function backSubT(L, b) { const n = L.length, x = vec(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; } return x; }

  /** Cyclic Jacobi eigen-decomposition of a symmetric matrix.
   *  Returns {values, vectors} sorted ascending; vectors[k] is the k-th eigenvector. */
  function eigSym(A0, maxSweeps) {
    const n = A0.length, A = copy(A0), V = eye(n);
    maxSweeps = maxSweeps || 60;
    for (let sweep = 0; sweep < maxSweeps; sweep++) {
      let off = 0, diag = 0;
      for (let i = 0; i < n; i++) { diag += A[i][i] * A[i][i]; for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]; }
      if (off <= 1e-30 * (diag || 1)) break;
      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = A[p][q];
          if (Math.abs(apq) < 1e-300) continue;
          const theta = (A[q][q] - A[p][p]) / (2 * apq);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k][p], akq = A[k][q];
            A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p][k], aqk = A[q][k];
            A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k][p], vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const idx = [...Array(n).keys()].sort((a, b) => A[a][a] - A[b][b]);
    return {
      values: Float64Array.from(idx.map(i => A[i][i])),
      vectors: idx.map(i => Float64Array.from(V.map(r => r[i])))
    };
  }

  const LA = { zeros, vec, copy, eye, transpose, matmul, matvec, dot, norm, sub, subv, btab, solve, inverse,
    cholesky, forwardSub, backSubT, eigSym };
  if (typeof module !== "undefined" && module.exports) module.exports = LA; else root.LA = LA;
})(typeof self !== "undefined" ? self : this);
