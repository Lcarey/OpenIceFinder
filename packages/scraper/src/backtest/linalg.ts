/** Solve A x = b for symmetric positive-definite A (row-major n×n) via Cholesky. A and b are not modified. */
export function solveSpd(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(sum, 1e-12));
      else L[i * n + j] = sum / L[j * n + j]!;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= L[i * n + k]! * y[k]!;
    y[i] = sum / L[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i]! * x[k]!;
    x[i] = sum / L[i * n + i]!;
  }
  return x;
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export function logit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}

export interface LogisticModel {
  /** [intercept, ...weights] on standardized features. */
  beta: Float64Array;
  mean: Float64Array;
  sd: Float64Array;
}

/**
 * L2-regularized logistic regression with soft labels (ties = 0.5), fit by Newton's method.
 * X is row-major n×k. The intercept is not penalized.
 */
export function fitLogistic(X: Float64Array, y: Float64Array, n: number, k: number, l2 = 1, iters = 30): LogisticModel {
  const mean = new Float64Array(k);
  const sd = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i * k + j]!;
    mean[j] = n ? s / n : 0;
    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i * k + j]! - mean[j]!) ** 2;
    const dev = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
    sd[j] = dev > 1e-12 ? dev : 1;
  }
  const d = k + 1;
  const beta = new Float64Array(d);
  const z = new Float64Array(d);
  z[0] = 1;
  for (let it = 0; it < iters; it++) {
    const H = new Float64Array(d * d);
    const g = new Float64Array(d);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) z[j + 1] = (X[i * k + j]! - mean[j]!) / sd[j]!;
      let eta = 0;
      for (let a = 0; a < d; a++) eta += beta[a]! * z[a]!;
      const p = sigmoid(eta);
      const w = Math.max(p * (1 - p), 1e-9);
      const r = p - y[i]!;
      for (let a = 0; a < d; a++) {
        g[a]! += r * z[a]!;
        const wa = w * z[a]!;
        for (let b = 0; b <= a; b++) H[a * d + b]! += wa * z[b]!;
      }
    }
    for (let a = 0; a < d; a++) {
      for (let b = 0; b < a; b++) H[b * d + a] = H[a * d + b]!;
      const pen = a === 0 ? 1e-6 : l2;
      H[a * d + a]! += pen;
      g[a]! += (a === 0 ? 1e-6 : l2) * beta[a]!;
    }
    const step = solveSpd(H, g, d);
    let max = 0;
    for (let a = 0; a < d; a++) {
      beta[a]! -= step[a]!;
      max = Math.max(max, Math.abs(step[a]!));
    }
    if (max < 1e-8) break;
  }
  return { beta, mean, sd };
}

export function predictLogistic(model: LogisticModel, x: ArrayLike<number>): number {
  let eta = model.beta[0]!;
  for (let j = 0; j < model.mean.length; j++) eta += model.beta[j + 1]! * ((x[j]! - model.mean[j]!) / model.sd[j]!);
  return sigmoid(eta);
}

export interface OrderedLogit {
  slope: number;
  /** Cut points on the latent scale: P(away) = σ(c1 − s·x), P(away or tie) = σ(c2 − s·x). */
  c1: number;
  c2: number;
}

/** Three-way (away / tie / home) ordered logit on one signal, fit by gradient ascent with backtracking. */
export function fitOrderedLogit(x: Float64Array, y: Float64Array, idx: number[], init?: OrderedLogit): OrderedLogit {
  let th = init ? [init.slope, init.c1, Math.log(Math.max(1e-3, init.c2 - init.c1))] : [0.5, -0.3, Math.log(0.6)];
  const ll = (t: number[]) => {
    const [s, c1, ld] = t as [number, number, number];
    const c2 = c1 + Math.exp(ld);
    let sum = 0;
    for (const i of idx) {
      const z = s * x[i]!;
      const a = sigmoid(c1 - z);
      const b = sigmoid(c2 - z);
      const p = y[i] === 0 ? a : y[i] === 0.5 ? b - a : 1 - b;
      sum += Math.log(Math.max(p, 1e-12));
    }
    return sum - 0.5 * 1e-3 * s * s;
  };
  let cur = ll(th);
  let step = 1e-3;
  for (let it = 0; it < 120; it++) {
    const g = th.map((_, k) => {
      const e = 1e-5;
      const t2 = [...th];
      t2[k]! += e;
      return (ll(t2) - cur) / e;
    });
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const cand = th.map((v, k) => v + step * g[k]!);
      const val = ll(cand);
      if (val > cur) {
        th = cand;
        cur = val;
        step *= 1.6;
        improved = true;
        break;
      }
      step /= 3;
    }
    if (!improved) break;
  }
  return { slope: th[0]!, c1: th[1]!, c2: th[1]! + Math.exp(th[2]!) };
}

export function orderedProbs(m: OrderedLogit, x: number): { away: number; tie: number; home: number } {
  const a = sigmoid(m.c1 - m.slope * x);
  const b = sigmoid(m.c2 - m.slope * x);
  return { away: a, tie: Math.max(0, b - a), home: 1 - b };
}
