/*
 * Reference-curve converter.
 *
 * Every format is parsed by a `from*` function into ONE generalized shape:
 *
 *   Curve = {
 *     name:   string,             // human label, best-effort
 *     device: string | null,      // Dirac DEVICENAME, else null
 *     points: [{ f: number, g: number }]   // target curve, freq(Hz) -> gain(dB), sorted by f
 *   }
 *
 * and written back out by a `to*` function. REW / Dirac / atref round-trip
 * losslessly-ish (atref is quantized to ISO bands + integer dB by design).
 *
 * The `.arc` format is NOT a plain curve: it is a parametric/graphic-EQ filter
 * set that ATF's tool produces with an optimizer. We cannot reproduce their
 * gains byte-for-byte, so `toARC` fits our OWN graphic EQ (least squares over
 * the tool's fixed band template) to approximate the same target curve. The
 * result is well-formed and device-loadable; the gains are ours, not ATF's.
 */

// ---------------------------------------------------------------------------
// ISO 1/3-octave band template (extracted from ATF_Flat.arc)
// ---------------------------------------------------------------------------

// The 30 grid bands, in file order, each with the DEFAULT Q the tool stores
// when the band is bypassed. Bands whose default Q is 2 are the ones the tool
// ever activates ("activatable"); the Q=4.3 bands stay bypassed.
const ARC_TEMPLATE = [
  { f: 25,    q: 4.3 }, { f: 32,    q: 4.3 }, { f: 40,    q: 4.3 },
  { f: 50,    q: 2   }, { f: 63,    q: 4.3 }, { f: 80,    q: 2   },
  { f: 100,   q: 2   }, { f: 125,   q: 4.3 }, { f: 160,   q: 2   },
  { f: 200,   q: 2   }, { f: 250,   q: 2   }, { f: 315,   q: 2   },
  { f: 400,   q: 4.3 }, { f: 500,   q: 2   }, { f: 630,   q: 2   },
  { f: 800,   q: 4.3 }, { f: 1000,  q: 4.3 }, { f: 1250,  q: 2   },
  { f: 1600,  q: 4.3 }, { f: 2000,  q: 4.3 }, { f: 2500,  q: 4.3 },
  { f: 3200,  q: 4.3 }, { f: 4000,  q: 4.3 }, { f: 5000,  q: 4.3 },
  { f: 6300,  q: 4.3 }, { f: 8000,  q: 2   }, { f: 10000, q: 2   },
  { f: 12500, q: 2   }, { f: 16000, q: 2   }, { f: 20000, q: 2   },
];

// Fixed shelf/anchor filters, identical across every sample .arc.
const ARC_SHELVES = [
  { f: 3757.99, g: 0, q: 1, t: 9 },
  { f: 113.52,  g: 0, q: 1, t: 10 },
];

const ARC_ACTIVE_Q = 0.707;     // Q a band takes once activated

// T attribute = EQ filter type. All CONFIRMED against the ATF editor via a
// probe file (one filter per code) + reading back a Parametric band the tool
// itself wrote:
//   0  = Fine EQ        2  = Allpass       3 = Low Shelf
//   4  = High Shelf     17 = Parametric
// Unrecognised codes (1, 5-8, and the 9/10 anchors in ATF's own files) render
// as "Fine EQ" fallback; T=1 shows in red, which ATF uses to mark a bypassed
// band. Our active output only uses the two shelf types.
const EQ_TYPE = {
  FINE_EQ: 0,
  LOW_SHELF: 3,
  HIGH_SHELF: 4,
  ALLPASS: 2,
  PARAMETRIC: 17,
  BYPASS: 1,      // ATF's own code for inactive/flat bands (red in the editor)
};

const ISO_BANDS = ARC_TEMPLATE.map((b) => b.f);

// ---------------------------------------------------------------------------
// small numeric helpers
// ---------------------------------------------------------------------------

// Linear interpolation of the target curve in log-frequency space.
function sampleCurve(curve, freq) {
  const p = curve.points;
  if (p.length === 0) return 0;
  if (freq <= p[0].f) return p[0].g;
  if (freq >= p[p.length - 1].f) return p[p.length - 1].g;
  for (let i = 1; i < p.length; i++) {
    if (freq <= p[i].f) {
      const a = p[i - 1], b = p[i];
      const t = (Math.log(freq) - Math.log(a.f)) / (Math.log(b.f) - Math.log(a.f));
      return a.g + t * (b.g - a.g);
    }
  }
  return p[p.length - 1].g;
}

// Format a number the way the .arc/.txt files do: trim trailing zeros, no
// scientific notation, keep it terse ("0", "4.75", "-0.5").
function num(x) {
  if (Object.is(x, -0)) x = 0;
  let s = x.toFixed(4);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// ---------------------------------------------------------------------------
// FROM parsers
// ---------------------------------------------------------------------------

function fromREW(text) {
  const lines = text.split(/\r?\n/);
  let name = 'Reference Curve';
  const points = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.match(/Name\s*-\s*(.+)$/i);
      if (m) name = m[1].trim();
      continue;
    }
    const m = line.match(/^(-?[\d.]+)\s+(-?[\d.]+)/);
    if (m) points.push({ f: parseFloat(m[1]), g: parseFloat(m[2]) });
  }
  points.sort((a, b) => a.f - b.f);
  return { name, device: null, points };
}

function fromDirac(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let name = 'Reference Curve';
  let device = null;
  const points = [];
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'NAME') { name = (lines[++i] || name).trim(); section = null; continue; }
    if (upper === 'DEVICENAME') { device = (lines[++i] || '').trim(); section = null; continue; }
    if (upper === 'BREAKPOINTS') { section = 'bp'; continue; }
    if (upper === 'LOWLIMITHZ' || upper === 'HIGHLIMITHZ') { section = null; i++; continue; }
    if (section === 'bp') {
      const m = line.match(/^(-?[\d.]+)\s+(-?[\d.]+)/);
      if (m) points.push({ f: parseFloat(m[1]), g: parseFloat(m[2]) });
    }
  }
  points.sort((a, b) => a.f - b.f);
  return { name, device, points };
}

function fromAtref(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  // First two lines are a header (source + version); the rest are gains.
  const gains = [];
  for (const line of lines) {
    if (/^-?\d+(\.\d+)?$/.test(line)) gains.push(parseFloat(line));
    else if (gains.length === 0) continue; // still in header text
  }
  const points = gains.map((g, i) => ({ f: ISO_BANDS[i], g }))
    .filter((p) => p.f !== undefined);
  return { name: 'Reference Curve', device: null, points };
}

function fromARC(text) {
  // The .arc encodes the curve as cumulative shelf steps outward from a 0 dB
  // anchor: T=3 filters are upward steps on the low side, T=4 are downward
  // steps on the high side. The curve value at band f is therefore:
  //   sum(G of T=3 filters with freq >= f) + sum(G of T=4 filters with freq <= f)
  const fils = [];
  const re = /<Fil\s+([^/]*?)\/>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = {};
    m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
    fils.push({
      f: parseFloat(attrs.F), g: parseFloat(attrs.G),
      q: parseFloat(attrs.Q), t: parseInt(attrs.T, 10),
    });
  }
  const nameM = text.match(/D="([^"]*)"/);
  const points = ISO_BANDS.map((f) => {
    let g = 0;
    for (const fil of fils) {
      if (!fil.g) continue;
      if (fil.t === 3 && fil.f >= f) g += fil.g;       // low-side upward step
      else if (fil.t === 4 && fil.f <= f) g += fil.g;  // high-side downward step
    }
    return { f, g: Math.round(g * 100) / 100 };
  });
  return { name: nameM ? 'ARC ' + nameM[1] : 'ARC Curve', device: null, points };
}

// ---------------------------------------------------------------------------
// TO writers
// ---------------------------------------------------------------------------

function toREW(curve) {
  const out = [
    '# Generated from atref-to-arc converter',
    '# NTT: Name - ' + curve.name,
  ];
  for (const p of curve.points) out.push(num(p.f) + ' ' + num(p.g));
  return out.join('\n') + '\n';
}

function toDirac(curve) {
  const pts = curve.points;
  const out = ['NAME', curve.name, 'DEVICENAME', curve.device || 'ALL', 'BREAKPOINTS'];
  for (const p of pts) out.push(num(p.f) + ' ' + num(p.g));
  out.push('LOWLIMITHZ', num(pts.length ? pts[0].f : 12));
  out.push('HIGHLIMITHZ', num(pts.length ? pts[pts.length - 1].f : 22000));
  return out.join('\n') + '\n';
}

function toAtref(curve) {
  const out = ['atref-to-arc converter', 'Version 1.0'];
  for (const f of ISO_BANDS) out.push(String(Math.round(sampleCurve(curve, f))));
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// .arc generation (cumulative shelf-step encoding)
// ---------------------------------------------------------------------------

// Encode the target curve as per-band shelf steps, the way ATF's reference
// .arc files do. The curve is sampled + rounded to integer dB at the 30 ISO
// bands (identical to the .atref), then steps are placed on the activatable
// bands relative to a 0 dB anchor:
//   - anchor  = lowest-frequency band whose |gain| is minimal (the 0 region)
//   - low side  (freq < anchor): G = target[band] - target[prev band toward anchor], T=3
//   - high side (freq > anchor): same difference walking upward, T=4
// Cumulative-summing these steps outward from the anchor reconstructs the
// integer curve exactly, so fromARC(toARC(x)) round-trips.
function stepEncode(curve) {
  const targetInt = ISO_BANDS.map((f) => Math.round(sampleCurve(curve, f)));

  // anchor: first band with the smallest absolute gain
  let anchorIdx = 0;
  for (let i = 1; i < targetInt.length; i++) {
    if (Math.abs(targetInt[i]) < Math.abs(targetInt[anchorIdx])) anchorIdx = i;
  }
  const anchorFreq = ISO_BANDS[anchorIdx];

  // Steps may land on ANY of the 30 ISO bands. (Earlier samples only ever
  // activated the Q=2 subset, but that subset has gaps — nothing below 50 Hz
  // and nothing between 1250 and 8000 Hz — so restricting to it silently drops
  // sub-bass shelves and mid-treble dips. Using every band reconstructs the
  // curve exactly; inactive bands still keep their template default Q.)
  const bands = ISO_BANDS;
  const steps = {}; // freq -> { g, t }

  // low side: bands below anchor, walked from anchor downward
  const low = bands.filter((f) => f < anchorFreq).sort((a, b) => b - a);
  let prev = 0;
  for (const f of low) {
    const v = targetInt[ISO_BANDS.indexOf(f)];
    const g = v - prev;
    prev = v;
    if (g !== 0) steps[f] = { g, t: EQ_TYPE.LOW_SHELF };
  }

  // high side: bands above anchor, walked from anchor upward
  const high = bands.filter((f) => f > anchorFreq).sort((a, b) => a - b);
  prev = 0;
  for (const f of high) {
    const v = targetInt[ISO_BANDS.indexOf(f)];
    const g = v - prev;
    prev = v;
    if (g !== 0) steps[f] = { g, t: EQ_TYPE.HIGH_SHELF };
  }

  return steps;
}

// Precise-frequency step encoding. Since a filter's F is adjustable (not
// locked to the ISO grid), walk the curve outward from the 0 dB anchor and
// drop a step at the EXACT frequency where the rounded curve crosses each dB
// level. Dips-and-recoveries fall out naturally as opposing steps whose
// corners sit at the true feature frequencies. Returns a flat filter list
// [{ f, g, t }] at arbitrary frequencies (plus, implicitly, the shelves).
function stepEncodeExact(curve) {
  const N = 1024, lo = 12, hi = 22000;
  const grid = [];
  for (let i = 0; i < N; i++) grid.push(lo * Math.pow(hi / lo, i / (N - 1)));
  const lvl = grid.map((f) => Math.round(sampleCurve(curve, f)));

  // anchor: grid point of minimal |level| (nearest to 0 dB)
  let a = 0;
  for (let i = 1; i < N; i++) if (Math.abs(lvl[i]) < Math.abs(lvl[a])) a = i;

  const filters = [];
  let prev = lvl[a];
  for (let i = a - 1; i >= 0; i--) {          // low side, descending freq
    if (lvl[i] !== prev) {
      filters.push({ f: +grid[i].toFixed(2), g: lvl[i] - prev, t: EQ_TYPE.LOW_SHELF });
      prev = lvl[i];
    }
  }
  prev = lvl[a];
  for (let i = a + 1; i < N; i++) {           // high side, ascending freq
    if (lvl[i] !== prev) {
      filters.push({ f: +grid[i].toFixed(2), g: lvl[i] - prev, t: EQ_TYPE.HIGH_SHELF });
      prev = lvl[i];
    }
  }
  return filters;
}

// Build the timestamp attribute: DDMMYYYYHHMM.
function arcTimestamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + p(d.getMonth() + 1) + d.getFullYear() +
    p(d.getHours()) + p(d.getMinutes());
}

function fil(f, g, q, t) {
  return '  <Fil F="' + (typeof f === 'number' ? f.toFixed(2) : f) +
    '" G="' + num(g) + '" I="0" FilBBR="0" FilBy="0" Q="' + num(q) +
    '" T="' + t + '"/>';
}

// mode: 'iso' snaps steps to the 30 ISO bands (matches ATF's sample structure);
// 'exact' places steps at their true crossing frequencies (tighter fit).
function toARC(curve, date, opts) {
  // 'iso' is the default because it reproduces ATF's own file STRUCTURE: the
  // full 30-band ISO skeleton emitted as Fine EQ (T=1) bands, with shelves
  // (T=3/T=4) replacing the bands where the curve is shaped — always 32 <Fil>
  // total (30 bands + 2 anchors). Every ATF-provided file is built this way, so
  // a fixed-band device almost certainly expects the skeleton. 'exact' places
  // shelves at true crossing frequencies with NO skeleton (fewer filters, the
  // editor honors it) — kept as an option but not ATF-shaped.
  const mode = (opts && opts.mode) || 'iso';

  let filters;
  if (mode === 'iso') {
    const steps = stepEncode(curve);
    filters = ARC_TEMPLATE.map((band) => {
      const step = steps[band.f];
      return step
        ? { f: band.f, g: step.g, q: ARC_ACTIVE_Q, t: step.t }
        : { f: band.f, g: 0, q: band.q, t: EQ_TYPE.BYPASS };
    });
  } else {
    filters = stepEncodeExact(curve).map((s) => ({ f: s.f, g: s.g, q: ARC_ACTIVE_Q, t: s.t }));
  }
  filters = filters.concat(ARC_SHELVES);
  // Emit in ascending frequency order so the editor lists bands left-to-right
  // (EQ response is order-independent, so this is purely cosmetic).
  filters.sort((a, b) => a.f - b.f);

  const lines = [
    '<ATF D="' + arcTimestamp(date) + '" OUTS="1">',
    ' <OC HPi="31" Finit="30" LPi="30" ON="0">',
  ];
  for (const fl of filters) lines.push(fil(fl.f, fl.g, fl.q, fl.t));
  lines.push(' </OC>', '</ATF>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// format detection + dispatch
// ---------------------------------------------------------------------------

function detectFormat(text) {
  const t = text.trim();
  if (t.startsWith('<ATF') || t.indexOf('<Fil') >= 0) return 'arc';
  if (/\bBREAKPOINTS\b/i.test(t)) return 'dirac';
  // Distinguish REW (freq/gain pairs) from atref (single column of gains) by
  // the shape of the DATA lines, ignoring comment/header lines. Both can carry
  // "#" comment headers, so header style alone is not enough.
  const dataLines = t.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && /\d/.test(l) && /^[-\d.]/.test(l));
  if (dataLines.length) {
    const pairs = dataLines.filter((l) => /^-?[\d.]+\s+-?[\d.]+/.test(l)).length;
    return pairs > dataLines.length / 2 ? 'rew' : 'atref';
  }
  return 'rew';
}

const PARSERS = { rew: fromREW, dirac: fromDirac, atref: fromAtref, arc: fromARC };
const WRITERS = { rew: toREW, dirac: toDirac, atref: toAtref, arc: toARC };

function convert(text, from, to) {
  const parse = PARSERS[from] || PARSERS[detectFormat(text)];
  const write = WRITERS[to];
  if (!write) throw new Error('Unknown output format: ' + to);
  return write(parse(text));
}

// export for both browser and node (self-test)
const API = {
  fromREW, fromDirac, fromAtref, fromARC,
  toREW, toDirac, toAtref, toARC,
  detectFormat, convert, sampleCurve,
  ISO_BANDS, ARC_TEMPLATE,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.RefCurve = API;
