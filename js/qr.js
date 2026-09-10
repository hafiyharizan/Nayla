/* A minimal QR encoder, so pairing can be a scan instead of typing 32
 * characters by hand.
 *
 * Deliberately narrow: byte mode, error-correction level L, versions 1-10
 * (up to 271 bytes). That covers a pairing URL several times over, and
 * leaves out the half of the spec we would never exercise.
 *
 * Written out rather than pulled from a CDN because the app has no
 * dependencies and has to work with no signal — a script tag pointing at
 * someone else's server fails exactly when a parent is offline at 3am.
 *
 * Verified module-for-module against the `segno` reference implementation
 * across every version and mask it supports; see test/qr.test.mjs.
 */
const QR = (() => {

  /* ── GF(256), primitive polynomial 0x11D ─────────────────── */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /** Generator polynomial for `n` error-correction codewords. */
  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= mul(g[j], 1);
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }

  /** Remainder of data·xⁿ ÷ generator — the block's EC codewords. */
  function ecc(data, n) {
    const gen = generator(n);
    const res = new Uint8Array(data.length + n);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (coef === 0) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  /* ── block layout, level L, versions 1-10 ────────────────── */
  // version: [ec codewords per block, [[block count, data codewords], ...]]
  const LAYOUT = {
    1:  [7,  [[1, 19]]],
    2:  [10, [[1, 34]]],
    3:  [15, [[1, 55]]],
    4:  [20, [[1, 80]]],
    5:  [26, [[1, 108]]],
    6:  [18, [[2, 68]]],
    7:  [20, [[2, 78]]],
    8:  [24, [[2, 97]]],
    9:  [30, [[2, 116]]],
    10: [18, [[2, 68], [2, 69]]],
  };

  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  const dataCodewords = v => LAYOUT[v][1].reduce((n, [c, d]) => n + c * d, 0);
  const countBits = v => v < 10 ? 8 : 16;
  const byteCapacity = v => Math.floor((dataCodewords(v) * 8 - 4 - countBits(v)) / 8);

  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) if (byteCapacity(v) >= len) return v;
    throw new Error(`${len} bytes is more than this encoder handles (max ${byteCapacity(10)})`);
  }

  /* ── bitstream -> interleaved codewords ──────────────────── */
  function codewords(bytes, version) {
    const bits = [];
    const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); };

    push(0b0100, 4);                       // byte mode
    push(bytes.length, countBits(version));
    for (const b of bytes) push(b, 8);

    const capacity = dataCodewords(version) * 8;
    push(0, Math.min(4, capacity - bits.length));       // terminator
    while (bits.length % 8) bits.push(0);
    const pad = [0xec, 0x11];
    for (let i = 0; bits.length < capacity; i++) push(pad[i % 2], 8);

    const all = new Uint8Array(bits.length / 8);
    for (let i = 0; i < all.length; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
      all[i] = b;
    }

    // split into blocks, compute EC, then interleave both halves
    const [ecPerBlock, groups] = LAYOUT[version];
    const dataBlocks = [], ecBlocks = [];
    let at = 0;
    for (const [count, size] of groups) {
      for (let i = 0; i < count; i++) {
        const block = all.slice(at, at + size);
        at += size;
        dataBlocks.push(block);
        ecBlocks.push(ecc(block, ecPerBlock));
      }
    }

    const out = [];
    const maxData = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxData; i++)
      for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecPerBlock; i++)
      for (const b of ecBlocks) out.push(b[i]);
    return out;
  }

  /* ── the module grid ─────────────────────────────────────── */
  function blank(version) {
    const size = 17 + 4 * version;
    const m = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
    const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++)
        for (let c = -1; c <= 7; c++) {
          const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const ring = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          set(r0 + r, c0 + c, inner && (ring || core) ? 1 : 0);
        }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {           // timing
      const bit = i % 2 === 0 ? 1 : 0;
      m[6][i] = bit; m[i][6] = bit;
    }

    const centers = ALIGN[version];
    for (const r of centers)
      for (const c of centers) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++)
          for (let dc = -2; dc <= 2; dc++)
            set(r + dr, c + dc,
                (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0);
      }

    m[size - 8][8] = 1;                            // always-dark module

    for (let i = 0; i < 9; i++) {                  // format info, reserved
      if (m[8][i] === -1) m[8][i] = 0;
      if (m[i][8] === -1) m[i][8] = 0;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === -1) m[8][size - 1 - i] = 0;
      if (m[size - 1 - i][8] === -1) m[size - 1 - i][8] = 0;
    }

    if (version >= 7) {                            // version info, reserved
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 3; j++) {
          m[size - 11 + j][i] = 0;
          m[i][size - 11 + j] = 0;
        }
    }
    return m;
  }

  /** Which cells the data stream may write to. */
  function reserved(version) {
    const m = blank(version);
    return m.map(row => Array.from(row, v => v !== -1));
  }

  function place(matrix, isReserved, words) {
    const size = matrix.length;
    let bit = 0;
    const next = () => {
      const byte = words[bit >> 3];
      const v = byte === undefined ? 0 : (byte >> (7 - (bit & 7))) & 1;
      bit++;
      return v;
    };
    let upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right--;                    // skip the vertical timing column
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (const col of [right, right - 1]) {
          if (isReserved[row][col]) continue;
          matrix[row][col] = next();
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  /* Format string: 2 bits EC level (L = 01) + 3 bits mask, BCH(15,5). */
  function formatBits(mask) {
    let v = (0b01 << 3) | mask;
    let d = v << 10;
    for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= 0b10100110111 << i;
    return ((v << 10) | d) ^ 0b101010000010010;
  }

  function versionBits(version) {
    let d = version << 12;
    for (let i = 5; i >= 0; i--) if ((d >> (i + 12)) & 1) d ^= 0b1111100100101 << i;
    return (version << 12) | d;
  }

  function applyFormat(matrix, mask) {
    const size = matrix.length;
    const bits = formatBits(mask);
    const at = i => (bits >> i) & 1;
    // Copy 1 runs down column 8 then left along row 8, around the
    // top-left finder; copy 2 runs right along row 8 and up column 8.
    for (let i = 0; i <= 5; i++) matrix[i][8] = at(i);
    matrix[7][8] = at(6);
    matrix[8][8] = at(7);
    matrix[8][7] = at(8);
    for (let i = 9; i <= 14; i++) matrix[8][14 - i] = at(i);
    for (let i = 0; i <= 7; i++) matrix[8][size - 1 - i] = at(i);
    for (let i = 8; i <= 14; i++) matrix[size - 15 + i][8] = at(i);
    matrix[size - 8][8] = 1;
  }

  function applyVersion(matrix, version) {
    if (version < 7) return;
    const size = matrix.length;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const r = Math.floor(i / 3), c = i % 3;
      matrix[size - 11 + c][r] = bit;
      matrix[r][size - 11 + c] = bit;
    }
  }

  /* ── mask penalties (spec rules 1-4) ─────────────────────── */
  function penalty(m) {
    const size = m.length;
    let score = 0;

    const runs = line => {
      let s = 0, run = 1;
      for (let i = 1; i < size; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    };
    for (let i = 0; i < size; i++) {
      score += runs(m[i]);
      score += runs(m.map(row => row[i]));
    }

    for (let r = 0; r < size - 1; r++)
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }

    const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const hits = line => {
      let s = 0;
      for (let i = 0; i + 11 <= size; i++) {
        let a = true, b = true;
        for (let j = 0; j < 11; j++) {
          if (line[i + j] !== A[j]) a = false;
          if (line[i + j] !== B[j]) b = false;
        }
        if (a) s += 40;
        if (b) s += 40;
      }
      return s;
    };
    for (let i = 0; i < size; i++) {
      score += hits(m[i]);
      score += hits(m.map(row => row[i]));
    }

    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;

    return score;
  }

  /* ── public ──────────────────────────────────────────────── */

  /** Encode text as a boolean matrix (true = dark). */
  function matrix(text, forced) {
    const bytes = new TextEncoder().encode(text);
    const version = pickVersion(bytes.length);
    const words = codewords(bytes, version);
    const isReserved = reserved(version);

    let best = null;
    const masks = forced === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forced];
    for (const mask of masks) {
      const m = blank(version).map(row => Array.from(row));
      place(m, isReserved, words);
      for (let r = 0; r < m.length; r++)
        for (let c = 0; c < m.length; c++)
          if (!isReserved[r][c] && MASKS[mask](r, c)) m[r][c] ^= 1;
      applyFormat(m, mask);
      applyVersion(m, version);
      const score = penalty(m);
      if (!best || score < best.score) best = { score, m, mask, version };
    }
    return { modules: best.m.map(row => Array.from(row, v => v === 1)), version: best.version, mask: best.mask };
  }

  /** Encode text as an inline SVG string. */
  function svg(text, { size = 240, quiet = 4, dark = '#241d16', light = '#ffffff' } = {}) {
    const { modules } = matrix(text);
    const n = modules.length;
    const total = n + quiet * 2;
    let path = '';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
           `width="${size}" height="${size}" shape-rendering="crispEdges" role="img" ` +
           `aria-label="Pairing QR code">` +
           `<rect width="${total}" height="${total}" fill="${light}"/>` +
           `<path d="${path}" fill="${dark}"/></svg>`;
  }

  return { matrix, svg, byteCapacity };
})();

if (typeof module !== 'undefined') module.exports = QR;
