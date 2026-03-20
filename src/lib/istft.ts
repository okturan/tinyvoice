import { NFFT, HOP, WLEN, PAD } from "@/lib/constants";

/**
 * Inverse real FFT via Cooley-Tukey radix-2 algorithm.
 * Takes real + imaginary parts of the one-sided spectrum,
 * returns n real-valued time-domain samples.
 *
 * All array indices are provably in-bounds — non-null assertions are safe.
 */
function irfft(re: Float32Array, im: Float32Array, n: number): Float32Array {
  const fR = new Float32Array(n);
  const fI = new Float32Array(n);
  const h = re.length;
  for (let i = 0; i < h; i++) {
    fR[i] = re[i]!;
    fI[i] = im[i]!;
  }
  for (let i = h; i < n; i++) {
    fR[i] = fR[n - i]!;
    fI[i] = -fI[n - i]!;
  }
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      [fR[i], fR[j]] = [fR[j]!, fR[i]!];
      [fI[i], fI[j]] = [fI[j]!, fI[i]!];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  // FFT butterfly
  for (let s = 2; s <= n; s *= 2) {
    const hs = s / 2;
    const a = (2 * Math.PI) / s;
    for (let i = 0; i < n; i += s)
      for (let k = 0; k < hs; k++) {
        const c = Math.cos(a * k);
        const sn = Math.sin(a * k);
        const tR = c * fR[i + hs + k]! - sn * fI[i + hs + k]!;
        const tI = sn * fR[i + hs + k]! + c * fI[i + hs + k]!;
        fR[i + hs + k] = fR[i + k]! - tR;
        fI[i + hs + k] = fI[i + k]! - tI;
        fR[i + k] += tR;
        fI[i + k] += tI;
      }
  }
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = fR[i]! / n;
  return o;
}

/**
 * Inverse Short-Time Fourier Transform.
 * Reconstructs a time-domain signal from magnitude + phase spectrograms
 * using overlap-add synthesis with a Hann window.
 */
export function istft(
  mag: Float32Array,
  ph: Float32Array,
  win: Float32Array
): Float32Array {
  const hN = NFFT / 2 + 1;
  const T = mag.length / hN;
  const oS = (T - 1) * HOP + WLEN;
  const o = new Float32Array(oS);
  const wE = new Float32Array(oS);

  for (let t = 0; t < T; t++) {
    const off = t * hN;
    const r = new Float32Array(hN);
    const im = new Float32Array(hN);
    for (let f = 0; f < hN; f++) {
      r[f] = mag[off + f]! * Math.cos(ph[off + f]!);
      im[f] = mag[off + f]! * Math.sin(ph[off + f]!);
    }
    const fr = irfft(r, im, NFFT);
    const st = t * HOP;
    for (let i = 0; i < WLEN; i++) {
      o[st + i] += fr[i]! * win[i]!;
      wE[st + i] += win[i]! * win[i]!;
    }
  }
  for (let i = 0; i < oS; i++) if (wE[i]! > 1e-8) o[i] /= wE[i]!;
  return o.slice(PAD, oS - PAD);
}
