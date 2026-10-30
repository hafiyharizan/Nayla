/* WHO Child Growth Standards, birth to 24 months.
 *
 * Each row is one completed month of age: [L, M, S], the Box-Cox
 * parameters WHO publishes for every indicator. From them any measurement
 * becomes a z-score, and any percentile becomes a curve:
 *
 *   z     = ((x / M)^L − 1) / (L · S)
 *   value = M · (1 + L · S · z)^(1/L)
 *
 * Values are copied unchanged from WHO's own tables (weight-for-age,
 * length-for-age 0–2 years, head-circumference-for-age), as packaged by
 * pygrowup 0.8.2. Weight is kg; length and head are cm. Between whole
 * months the parameters are interpolated, which is how WHO's own software
 * treats ages it has no daily row for.
 *
 * Length is "lying down" length — WHO switches to standing height at 24
 * months, which is one reason the charts stop there.
 */
const Who = (() => {
  const DAYS_PER_MONTH = 30.4375;   // WHO's own conversion
  const MAX_MONTHS = 24;

  const TABLES = {
  girls: {
    weight: [
      [0.3809, 3.2322, 0.14171],
      [0.1714, 4.1873, 0.13724],
      [0.0962, 5.1282, 0.13],
      [0.0402, 5.8458, 0.12619],
      [-0.005, 6.4237, 0.12402],
      [-0.043, 6.8985, 0.12274],
      [-0.0756, 7.297, 0.12204],
      [-0.1039, 7.6422, 0.12178],
      [-0.1288, 7.9487, 0.12181],
      [-0.1507, 8.2254, 0.12199],
      [-0.17, 8.48, 0.12223],
      [-0.1872, 8.7192, 0.12247],
      [-0.2024, 8.9481, 0.12268],
      [-0.2158, 9.1699, 0.12283],
      [-0.2278, 9.387, 0.12294],
      [-0.2384, 9.6008, 0.12299],
      [-0.2478, 9.8124, 0.12303],
      [-0.2562, 10.0226, 0.12306],
      [-0.2637, 10.2315, 0.12309],
      [-0.2703, 10.4393, 0.12315],
      [-0.2762, 10.6464, 0.12323],
      [-0.2815, 10.8534, 0.12335],
      [-0.2862, 11.0608, 0.1235],
      [-0.2903, 11.2688, 0.12369],
      [-0.2941, 11.4775, 0.1239],
    ],
    length: [
      [1.0, 49.1477, 0.0379],
      [1.0, 53.6872, 0.0364],
      [1.0, 57.0673, 0.03568],
      [1.0, 59.8029, 0.0352],
      [1.0, 62.0899, 0.03486],
      [1.0, 64.0301, 0.03463],
      [1.0, 65.7311, 0.03448],
      [1.0, 67.2873, 0.03441],
      [1.0, 68.7498, 0.0344],
      [1.0, 70.1435, 0.03444],
      [1.0, 71.4818, 0.03452],
      [1.0, 72.771, 0.03464],
      [1.0, 74.015, 0.03479],
      [1.0, 75.2176, 0.03496],
      [1.0, 76.3817, 0.03514],
      [1.0, 77.5099, 0.03534],
      [1.0, 78.6055, 0.03555],
      [1.0, 79.671, 0.03576],
      [1.0, 80.7079, 0.03598],
      [1.0, 81.7182, 0.0362],
      [1.0, 82.7036, 0.03643],
      [1.0, 83.6654, 0.03666],
      [1.0, 84.604, 0.03688],
      [1.0, 85.5202, 0.03711],
      [1.0, 86.4153, 0.03734],
    ],
    head: [
      [1.0, 33.8787, 0.03496],
      [1.0, 36.5463, 0.0321],
      [1.0, 38.2521, 0.03168],
      [1.0, 39.5328, 0.0314],
      [1.0, 40.5817, 0.03119],
      [1.0, 41.459, 0.03102],
      [1.0, 42.1995, 0.03087],
      [1.0, 42.829, 0.03075],
      [1.0, 43.3671, 0.03063],
      [1.0, 43.83, 0.03053],
      [1.0, 44.2319, 0.03044],
      [1.0, 44.5844, 0.03035],
      [1.0, 44.8965, 0.03027],
      [1.0, 45.1752, 0.03019],
      [1.0, 45.4265, 0.03012],
      [1.0, 45.6551, 0.03006],
      [1.0, 45.865, 0.02999],
      [1.0, 46.0598, 0.02993],
      [1.0, 46.2424, 0.02987],
      [1.0, 46.4152, 0.02982],
      [1.0, 46.5801, 0.02977],
      [1.0, 46.7384, 0.02972],
      [1.0, 46.8913, 0.02967],
      [1.0, 47.0391, 0.02962],
      [1.0, 47.1822, 0.02957],
    ],
  },
  boys: {
    weight: [
      [0.3487, 3.3464, 0.14602],
      [0.2297, 4.4709, 0.13395],
      [0.197, 5.5675, 0.12385],
      [0.1738, 6.3762, 0.11727],
      [0.1553, 7.0023, 0.11316],
      [0.1395, 7.5105, 0.1108],
      [0.1257, 7.934, 0.10958],
      [0.1134, 8.297, 0.10902],
      [0.1021, 8.6151, 0.10882],
      [0.0917, 8.9014, 0.10881],
      [0.082, 9.1649, 0.10891],
      [0.073, 9.4122, 0.10906],
      [0.0644, 9.6479, 0.10925],
      [0.0563, 9.8749, 0.10949],
      [0.0487, 10.0953, 0.10976],
      [0.0413, 10.3108, 0.11007],
      [0.0343, 10.5228, 0.11041],
      [0.0275, 10.7319, 0.11079],
      [0.0211, 10.9385, 0.11119],
      [0.0148, 11.143, 0.11164],
      [0.0087, 11.3462, 0.11211],
      [0.0029, 11.5486, 0.11261],
      [-0.0028, 11.7504, 0.11314],
      [-0.0083, 11.9514, 0.11369],
      [-0.0137, 12.1515, 0.11426],
    ],
    length: [
      [1.0, 49.8842, 0.03795],
      [1.0, 54.7244, 0.03557],
      [1.0, 58.4249, 0.03424],
      [1.0, 61.4292, 0.03328],
      [1.0, 63.886, 0.03257],
      [1.0, 65.9026, 0.03204],
      [1.0, 67.6236, 0.03165],
      [1.0, 69.1645, 0.03139],
      [1.0, 70.5994, 0.03124],
      [1.0, 71.9687, 0.03117],
      [1.0, 73.2812, 0.03118],
      [1.0, 74.5388, 0.03125],
      [1.0, 75.7488, 0.03137],
      [1.0, 76.9186, 0.03154],
      [1.0, 78.0497, 0.03174],
      [1.0, 79.1458, 0.03197],
      [1.0, 80.2113, 0.03222],
      [1.0, 81.2487, 0.0325],
      [1.0, 82.2587, 0.03279],
      [1.0, 83.2418, 0.0331],
      [1.0, 84.1996, 0.03342],
      [1.0, 85.1348, 0.03376],
      [1.0, 86.0477, 0.0341],
      [1.0, 86.941, 0.03445],
      [1.0, 87.8161, 0.03479],
    ],
    head: [
      [1.0, 34.4618, 0.03686],
      [1.0, 37.2759, 0.03133],
      [1.0, 39.1285, 0.02997],
      [1.0, 40.5135, 0.02918],
      [1.0, 41.6317, 0.02868],
      [1.0, 42.5576, 0.02837],
      [1.0, 43.3306, 0.02817],
      [1.0, 43.9803, 0.02804],
      [1.0, 44.53, 0.02796],
      [1.0, 44.9998, 0.02792],
      [1.0, 45.4051, 0.0279],
      [1.0, 45.7573, 0.02789],
      [1.0, 46.0661, 0.02789],
      [1.0, 46.3395, 0.02789],
      [1.0, 46.5844, 0.02791],
      [1.0, 46.806, 0.02792],
      [1.0, 47.0088, 0.02795],
      [1.0, 47.1962, 0.02797],
      [1.0, 47.3711, 0.028],
      [1.0, 47.5357, 0.02803],
      [1.0, 47.6919, 0.02806],
      [1.0, 47.8408, 0.0281],
      [1.0, 47.9833, 0.02813],
      [1.0, 48.1201, 0.02817],
      [1.0, 48.2515, 0.02821],
    ],
  },
  };

  /** Fractional months between a yyyy-mm-dd birth date and a timestamp. */
  function ageInMonths(dob, at) {
    if (!dob) return null;
    const born = new Date(dob + 'T00:00:00').getTime();
    if (!Number.isFinite(born)) return null;
    return (at - born) / 86400000 / DAYS_PER_MONTH;
  }

  function lms(sex, indicator, months) {
    const rows = TABLES[sex === 'boy' ? 'boys' : 'girls']?.[indicator];
    if (!rows || months == null || months < 0 || months > MAX_MONTHS) return null;
    const i = Math.min(Math.floor(months), MAX_MONTHS - 1);
    const t = months - i;
    const a = rows[i], b = rows[i + 1];
    return a.map((v, k) => v + (b[k] - v) * t);
  }

  function zScore(value, [L, M, S]) {
    return L === 0 ? Math.log(value / M) / S : (Math.pow(value / M, L) - 1) / (L * S);
  }

  function valueAt(z, [L, M, S]) {
    return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
  }

  /** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
  function phi(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  /** Percentile (0–100) for a measurement, or null outside 0–24 months. */
  function percentile(sex, indicator, months, value) {
    const p = lms(sex, indicator, months);
    if (!p || !(value > 0)) return null;
    return phi(zScore(value, p)) * 100;
  }

  /** The value on a given percentile curve at an age. */
  function curve(sex, indicator, months, pct) {
    const p = lms(sex, indicator, months);
    return p ? valueAt(inverseZ(pct / 100), p) : null;
  }

  /* Only the percentiles the chart draws are needed, so a lookup is exact
   * enough and avoids an inverse-normal approximation. */
  const Z_FOR = { 3: -1.880794, 15: -1.036433, 50: 0, 85: 1.036433, 97: 1.880794 };
  function inverseZ(p) {
    const z = Z_FOR[Math.round(p * 100)];
    if (z == null) throw new Error(`no z for percentile ${p}`);
    return z;
  }

  /** "55th", "3rd", "below the 3rd". Extremes stay as words, never "0.4th". */
  function describe(pct) {
    if (pct == null) return '';
    if (pct < 3) return 'below the 3rd percentile';
    if (pct > 97) return 'above the 97th percentile';
    const n = Math.round(pct);
    return `${ordinal(n)} percentile`;
  }

  function ordinal(n) {
    const s = n % 100;
    if (s >= 11 && s <= 13) return `${n}th`;
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  return { ageInMonths, percentile, curve, describe, ordinal, MAX_MONTHS, CURVES: [3, 15, 50, 85, 97] };
})();

if (typeof module !== 'undefined') module.exports = Who;
