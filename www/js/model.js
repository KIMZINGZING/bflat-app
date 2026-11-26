'use strict';
/* ===== BFlat Studio — 데이터 모델 ===== */
const TPQ = 48;                                   // 4분음표 = 48틱 (셋잇단 16분까지 정수)
const DUR_T = { w: 192, h: 96, q: 48, e: 24, s: 12 };
const DUR_KO = { w: '온음표', h: '2분음표', q: '4분음표', e: '8분음표', s: '16분음표' };
const NUMKEY_DUR = { '3': 's', '`': 'e', '1': 'q', '2': 'h', '4': 'w' };
/** 빠르기말 (BPM 범위가 겹치면 위에서부터 먼저 맞는 것) */
const TEMPO_TERMS = [
  ['Larghissimo', 0, 24], ['Grave', 25, 45], ['Largo', 40, 60], ['Lento', 45, 60], ['Larghetto', 60, 66],
  ['Adagio', 66, 76], ['Adagietto', 72, 76], ['Andante', 76, 108], ['Andantino', 80, 108], ['Andante moderato', 92, 98],
  ['Moderato', 108, 120], ['Allegretto', 112, 120], ['Allegro moderato', 116, 120], ['Allegro', 120, 156],
  ['Vivace', 156, 176], ['Vivacissimo', 172, 176], ['Presto', 168, 200], ['Prestissimo', 200, 9999]];
function tempoTerm(bpm) {
  bpm = +bpm;
  if (!bpm) return '';
  const t = TEMPO_TERMS.find(([, lo, hi]) => bpm >= lo && bpm <= hi);
  return t ? t[0] : '';
}
function tempoRangeText(t) { return t[1] === 0 ? `${t[2]} 이하` : t[2] >= 9999 ? `${t[1]} 이상` : `${t[1]}~${t[2]}`; }
const STEPS = 'CDEFGAB';
const STEP_SEMI = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const KEY_NAMES = { '-7': 'C♭ / a♭m', '-6': 'G♭ / e♭m', '-5': 'D♭ / b♭m', '-4': 'A♭ / fm', '-3': 'E♭ / cm', '-2': 'B♭ / gm', '-1': 'F / dm', '0': 'C / am', '1': 'G / em', '2': 'D / bm', '3': 'A / f♯m', '4': 'E / c♯m', '5': 'B / g♯m', '6': 'F♯ / d♯m', '7': 'C♯ / a♯m' };
const STD_DURS = [ // 큰 것부터
  { dur: 'w', dots: 1, t: 288 }, { dur: 'w', dots: 0, t: 192 }, { dur: 'h', dots: 1, t: 144 }, { dur: 'h', dots: 0, t: 96 },
  { dur: 'q', dots: 1, t: 72 }, { dur: 'q', dots: 0, t: 48 }, { dur: 'e', dots: 1, t: 36 }, { dur: 'e', dots: 0, t: 24 }, { dur: 's', dots: 0, t: 12 }];

let _uid = 1;
function uid() { return _uid++; }
const clone = o => JSON.parse(JSON.stringify(o));

function keyAlter(fifths, step) {
  if (fifths > 0) { const i = SHARP_ORDER.indexOf(step); return i < fifths ? 1 : 0; }
  if (fifths < 0) { const i = FLAT_ORDER.indexOf(step); return i < -fifths ? -1 : 0; }
  return 0;
}
const mod = (a, n) => ((a % n) + n) % n;
function pitchMidi(p) { return 12 * (Math.floor(p.d / 7) + 1) + STEP_SEMI[mod(p.d, 7)] + p.a; }
function pitchLabel(p) { return STEPS[mod(p.d, 7)] + (p.a > 0 ? '♯' : p.a < 0 ? '♭' : '') + (Math.floor(p.d / 7)); }
/** midi 번호를 조표에 맞게 철자 */
function midiToPitch(midi, fifths, prefer) {
  const pc = mod(midi, 12);
  const cands = [];
  for (let s = 0; s < 7; s++) for (const a of [0, 1, -1]) if (mod(STEP_SEMI[s] + a, 12) === pc) cands.push({ s, a });
  let best = cands.find(c => c.a === keyAlter(fifths, c.s));
  if (!best) best = cands.find(c => c.a === 0);
  if (!best) best = cands.find(c => c.a === ((prefer || (fifths < 0 ? -1 : 1)) > 0 ? 1 : -1)) || cands[0];
  const oct = Math.floor((midi - STEP_SEMI[best.s] - best.a) / 12) - 1;
  return { d: oct * 7 + best.s, a: best.a };
}

/** 음표 위아래에 그리는 꾸밈 표시만 (박자치기 'x' 는 머리 모양이라 빼요) */
function artMarks(n) { return (n.art || []).filter(a => a !== 'x'); }
/** 박자치기 (X 머리) */
function isClap(n) { return !!n && (n.art || []).includes('x'); }
function noteTicks(n, cap) {
  if (n.full) return cap;
  let t = DUR_T[n.dur];
  if (n.dots) t *= 1.5;
  if (n.tri) t = t * 2 / 3;
  return Math.round(t);
}

/* ===== 여러 줄 악보 (오선 / 큰보표 / 3단) ===== */
const SCORE_TYPES = {
  single: { label: '오선 (한 줄)', staves: o => [{ name: '', clef: o.clef || 'treble' }] },
  grand: { label: '큰보표 (피아노)', staves: () => [{ name: '', clef: 'treble', grp: 'piano' }, { name: '', clef: 'bass', grp: 'piano' }] },
  voicePiano: { label: '피아노 + 노래 (3단)', staves: o => [{ name: o.instName || 'Voice', clef: o.clef || 'treble' }, { name: 'Piano', clef: 'treble', grp: 'piano' }, { name: '', clef: 'bass', grp: 'piano' }] },
  instPiano: { label: '피아노 + 악기 (3단)', staves: o => [{ name: o.instName || 'Instrument', clef: o.clef || 'treble' }, { name: 'Piano', clef: 'treble', grp: 'piano' }, { name: '', clef: 'bass', grp: 'piano' }] },
  // 앙상블(2~5중주): 악기마다 한 줄 · 음자리표는 악기마다 (높은음 · 낮은음 · 가온음 1~5줄) · 왼쪽 꺾쇠괄호로 묶고 마디선은 이어서
  ensemble: { label: '앙상블 (2~5중주)', staves: o => ensembleStaves(o.parts && o.parts.length ? o.parts : ENSEMBLE_PRESETS[0].parts) },
};
const ENSEMBLE_SIZES = [[2, '2중주', '듀오'], [3, '3중주', '트리오'], [4, '4중주', '콰르텟'], [5, '5중주', '퀸텟']];
/** 편성 미리 정해 둔 것 (악기 이름 · 음자리표) — 이름·음자리표는 창에서 바꿀 수 있어요 */
const ENSEMBLE_PRESETS = (() => {
  // 짧게 쓰는 악기들 · 'grand' = 큰보표(높은음 + 낮은음 두 줄: 피아노 · 하프)
  const P = (name, clef) => ({ name, clef: clef || 'treble' });
  const Vn = n => P(n ? 'Violin ' + n : 'Violin'), Va = n => P(n ? 'Viola ' + n : 'Viola', 'c3'), Vc = n => P(n ? 'Cello ' + n : 'Cello', 'bass');
  const Cb = P('Contrabass', 'bass'), Pno = P('Piano', 'grand'), Hp = P('Harp', 'grand'), Gtr = P('Guitar');
  const Fl = P('Flute'), Ob = P('Oboe'), Cl = P('Clarinet in B♭'), Bsn = P('Bassoon', 'bass'), Hn = P('Horn in F');
  const Tpt = n => P(n ? 'Trumpet in B♭ ' + n : 'Trumpet in B♭'), Tbn = P('Trombone', 'bass'), Tba = P('Tuba', 'bass');
  const SQ = [Vn(1), Vn(2), Va(), Vc()];
  const L = [
    // 2중주
    ['클라리넷 2중주', [P('Clarinet in B♭ 1'), P('Clarinet in B♭ 2')]],
    ['플루트 2중주', [P('Flute 1'), P('Flute 2')]],
    ['바이올린 2중주', [Vn(1), Vn(2)]],
    ['바이올린 + 비올라', [Vn(), Va()]],
    ['바이올린 + 첼로', [Vn(), Vc()]],
    ['플루트 + 클라리넷', [Fl, Cl]],
    ['플루트 + 기타', [Fl, Gtr]],
    // 3중주
    ['피아노 3중주', [Vn(), Vc(), Pno]],
    ['현악 3중주', [Vn(), Va(), Vc()]],
    ['클라리넷 3중주 (첼로 · 피아노)', [Cl, Vc(), Pno]],
    ['클라리넷 + 비올라 + 피아노', [Cl, Va(), Pno]],
    ['호른 3중주', [Hn, Vn(), Pno]],
    ['바이올린 + 클라리넷 + 피아노', [Vn(), Cl, Pno]],
    ['플루트 + 첼로 + 피아노', [Fl, Vc(), Pno]],
    ['플루트 + 비올라 + 하프', [Fl, Va(), Hp]],
    ['리드 3중주', [Ob, Cl, Bsn]],
    ['목관 3중주', [Fl, Cl, Bsn]],
    ['금관 3중주', [Tpt(), Hn, Tbn]],
    ['클라리넷 3중주 (클라리넷만)', [P('Clarinet in B♭ 1'), P('Clarinet in B♭ 2'), P('Clarinet in B♭ 3')]],
    ['플루트 3중주', [P('Flute 1'), P('Flute 2'), P('Flute 3')]],
    // 4중주
    ['현악 4중주', SQ],
    ['피아노 4중주', [Vn(), Va(), Vc(), Pno]],
    ['플루트 4중주', [Fl, Vn(), Va(), Vc()]],
    ['오보에 4중주', [Ob, Vn(), Va(), Vc()]],
    ['클라리넷 4중주 (클라리넷 + 현악 3중주)', [Cl, Vn(), Va(), Vc()]],
    ['클라리넷 + 바이올린 + 첼로 + 피아노', [Cl, Vn(), Vc(), Pno]],
    ['목관 4중주', [Fl, Ob, Cl, Bsn]],
    ['금관 4중주 (트롬본)', [Tpt(1), Tpt(2), Hn, Tbn]],
    ['금관 4중주 (튜바)', [Tpt(1), Tpt(2), Hn, Tba]],
    ['색소폰 4중주', [P('Soprano Sax'), P('Alto Sax'), P('Tenor Sax'), P('Baritone Sax')]],
    ['클라리넷 4중주 (클라리넷만)', [P('Clarinet in B♭ 1'), P('Clarinet in B♭ 2'), P('Clarinet in B♭ 3'), P('Bass Clarinet')]],
    ['혼성 4부 (SATB)', [P('Soprano'), P('Alto'), P('Tenor'), P('Bass', 'bass')]],
    // 5중주
    ['피아노 5중주', [...SQ, Pno]],
    ['피아노 5중주 (콘트라베이스)', [Vn(), Va(), Vc(), Cb, Pno]],
    ['피아노와 관악 5중주', [Ob, Cl, Hn, Bsn, Pno]],
    ['현악 5중주 (비올라 2)', [Vn(1), Vn(2), Va(1), Va(2), Vc()]],
    ['현악 5중주 (첼로 2)', [Vn(1), Vn(2), Va(), Vc(1), Vc(2)]],
    ['현악 5중주 (콘트라베이스)', [...SQ, Cb]],
    ['클라리넷 5중주', [Cl, ...SQ]],
    ['호른 5중주', [Hn, Vn(), Va(1), Va(2), Vc()]],
    ['기타 5중주', [Gtr, ...SQ]],
    ['목관 5중주', [Fl, Ob, Cl, Hn, Bsn]],
    ['금관 5중주', [Tpt(1), Tpt(2), Hn, Tbn, Tba]],
  ];
  return L.map(([label, parts]) => ({ n: parts.length, label, parts: clone(parts) }));
})();
/** 앙상블 악기 → 오선들 (큰보표 악기는 두 줄: 이름은 윗줄에만, 중괄호로 묶음) */
function ensembleStaves(parts) {
  const out = [];
  parts.forEach(p => {
    if (p.clef === 'grand') { out.push({ name: p.name || '', short: p.short || shortInstName(p.name), clef: 'treble', grp: 'piano' }, { name: '', short: '', clef: 'bass', grp: 'piano' }); return; }
    out.push({ name: p.name || '', short: p.short || shortInstName(p.name), clef: p.clef || 'treble', grp: 'ens' });
  });
  return out;
}
/** 앙상블 악보의 오선들 → 악기들 (피아노 두 줄은 하나로) */
function ensembleParts(staves) {
  const parts = [];
  (staves || []).forEach((st, si) => {
    if (isPianoStaff(st)) { if (si > 0 && staves[si - 1].grp === st.grp) return; parts.push({ name: st.name || 'Piano', clef: 'grand' }); return; }
    parts.push({ name: st.name || '', clef: st.clef || 'treble' });
  });
  return parts;
}
function ensembleStaffN(parts) { return parts.reduce((a, p) => a + (p.clef === 'grand' ? 2 : 1), 0); }
/** 둘째 줄부터 왼쪽에 쓰는 짧은 악기 이름 (Clarinet in B♭ 1 → Cl. 1) */
const INST_SHORT = [[/^clarinet|^클라리넷/i, 'Cl.'], [/^bass clarinet/i, 'B. Cl.'], [/^flute|^플루트/i, 'Fl.'], [/^piano|^피아노/i, 'Pno.'], [/^harp|^하프/i, 'Hp.'], [/^guitar|^기타/i, 'Gtr.'], [/^piccolo/i, 'Picc.'], [/^oboe|^오보에/i, 'Ob.'], [/^bassoon|^바순/i, 'Bsn.'], [/^horn|^호른/i, 'Hn.'], [/^trumpet|^트럼펫/i, 'Tpt.'], [/^trombone|^트롬본/i, 'Tbn.'], [/^tuba|^튜바/i, 'Tba.'], [/^violin|^바이올린/i, 'Vn.'], [/^viola|^비올라/i, 'Va.'], [/^cello|^violoncello|^첼로/i, 'Vc.'], [/^contrabass|^double bass|^콘트라베이스/i, 'Cb.'], [/^soprano sax/i, 'S. Sax.'], [/^alto sax/i, 'A. Sax.'], [/^tenor sax/i, 'T. Sax.'], [/^baritone sax/i, 'Bari. Sax.'], [/^soprano/i, 'S.'], [/^alto/i, 'A.'], [/^tenor/i, 'T.'], [/^bass$|^bass\b/i, 'B.'], [/^voice|^노래/i, 'V.']];
function shortInstName(name) {
  name = (name || '').trim();
  if (!name) return '';
  const hit = INST_SHORT.find(([re]) => re.test(name));
  const num = (/\s(\d)$/.exec(name) || [])[1];
  if (hit) return hit[1] + (num ? ' ' + num : '');
  return name.length <= 6 ? name : name.slice(0, 5) + '.';
}
function isPianoStaff(st) { return !!(st && st.grp && st.grp !== 'ens'); }
function staffCount(s) { return (s.staves && s.staves.length) || 1; }
function staffClef(s, si) { return s.staves && s.staves[si] ? s.staves[si].clef : (s.clef || 'treble'); }
/** 그 마디·그 줄의 음표 배열 (si=0 은 m.notes) */
function SN(m, si) {
  if (!si) return m.notes;
  if (!m.sn) m.sn = {};
  if (!m.sn[si]) m.sn[si] = [];
  return m.sn[si];
}
/** 읽기 전용 (없으면 빈 배열, 만들지 않음) */
function SNr(m, si) { return !si ? m.notes : ((m.sn && m.sn[si]) || []); }
/** 둘째 성부(길이가 다른 화음 음): 마디 안 시작 박 n.t 를 가진 음표들 */
function OV(m, si) { si = si || 0; if (!m.ov) m.ov = {}; if (!m.ov[si]) m.ov[si] = []; return m.ov[si]; }
function OVr(m, si) { return (m.ov && m.ov[si || 0]) || []; }
function measureAllNotes(m) {
  let a = m.notes.slice();
  if (m.sn) Object.keys(m.sn).forEach(k => a = a.concat(m.sn[k] || []));
  if (m.ov) Object.keys(m.ov).forEach(k => a = a.concat(m.ov[k] || []));
  return a;
}
/** 화음까지 포함한 모든 음 */
function notePitches(n) { if (!n || n.rest || !n.p) return []; return [n.p].concat(n.ps || []); }

function newMeasure() {
  return { id: uid(), notes: [], chords: [], lyrics: {}, start: '', end: '', volta: 0, marks: [], form: '', width: 0, key: null, time: null, pickup: false };
}
function newNote(dur, p, rest) {
  return { id: uid(), dur: dur || 'q', dots: 0, tri: false, rest: !!rest, full: false, p: p ? { d: p.d, a: p.a } : null, art: [], dyn: '', text: '', edited: false };
}
function newScore(o) {
  o = Object.assign({ title: '', composer: '', lyricist: '', num: 4, den: 4, mpl: 4, lines: 4, clef: 'treble', key: 0, tempo: 90, lyricLines: 1, type: 'single' }, o || {});
  const staves = (SCORE_TYPES[o.type] || SCORE_TYPES.single).staves(o);
  o.clef = staves[0].clef;
  const s = {
    type: SCORE_TYPES[o.type] ? o.type : 'single', staves,
    app: 'BFlat Studio', version: 1, title: o.title, composer: o.composer, lyricist: o.lyricist,
    time: { num: +o.num, den: +o.den }, key: +o.key, clef: o.clef, tempo: +o.tempo || null, tempoText: o.tempoText || '', swing: !!o.swing, lyricLines: +o.lyricLines,
    lines: [], measures: [], slurs: []
  };
  for (let i = 0; i < o.lines; i++) { s.lines.push(+o.mpl); for (let j = 0; j < o.mpl; j++) s.measures.push(newMeasure()); }
  return s;
}
/** 불러온 악보의 id 충돌 방지 */
function fixIds(s) {
  if (!s.staves || !s.staves.length) { s.staves = [{ name: '', clef: s.clef || 'treble' }]; s.type = s.type || 'single'; }
  s.clef = s.staves[0].clef;
  let max = 0;
  s.measures.forEach(m => { max = Math.max(max, m.id || 0); measureAllNotes(m).forEach(n => max = Math.max(max, n.id || 0)); });
  (s.slurs || []).forEach(x => max = Math.max(max, x.id || 0));
  _uid = Math.max(_uid, max + 1);
  s.measures.forEach(m => {
    if (!m.id) m.id = uid();
    measureAllNotes(m).forEach(n => { if (!n.id) n.id = uid(); n.art = n.art || []; });
    m.chords = m.chords || []; m.lyrics = m.lyrics || {}; m.marks = m.marks || [];
  });
  s.slurs = (s.slurs || []).filter(x => x.a && x.b);
  s.slurs.forEach(x => { if (!x.id) x.id = uid(); });
  // 줄 정보 보정
  let total = s.lines.reduce((a, b) => a + b, 0);
  if (total !== s.measures.length) {
    if (total < s.measures.length) s.lines.push(s.measures.length - total);
    else { while (total > s.measures.length && s.lines.length) { const d = Math.min(s.lines[s.lines.length - 1], total - s.measures.length); s.lines[s.lines.length - 1] -= d; total -= d; if (!s.lines[s.lines.length - 1]) s.lines.pop(); } }
  }
  s.lines = s.lines.filter(c => c > 0);
  if (!s.measures.length) { s.measures.push(newMeasure()); s.lines = [1]; }
  return s;
}

/** 마디마다 박자·조표·용량 계산 */
function computeContexts(s) {
  const out = [];
  let num = s.time.num, den = s.time.den, key = s.key;
  s.measures.forEach((m, i) => {
    let keyChanged = false, timeChanged = false, prevKey = key;
    if (m.time && (m.time.num !== num || m.time.den !== den || i === 0)) { num = m.time.num; den = m.time.den; timeChanged = i > 0; }
    if (m.key !== null && m.key !== undefined && m.key !== key) { key = m.key; keyChanged = i > 0; }
    const full = Math.round(num * 192 / den);
    const nSt = staffCount(s);
    const sums = [];
    for (let si = 0; si < nSt; si++) sums.push(SNr(m, si).reduce((a, n) => a + noteTicks(n, full), 0));
    const sum = Math.max(...sums);
    let cap = full;
    if (m.pickup && sums[0] > 0 && sums[0] < full) cap = sums[0];
    // 줄마다 상태: 비었음 / 맞음 / 모자람 / 넘침
    const st = sums.map((sm, si) => ({ sum: sm, status: !SNr(m, si).length ? 'empty' : sm < cap ? 'short' : sm > cap ? 'over' : 'ok' }));
    let status = 'ok';
    if (st.every(x => x.status === 'empty')) status = 'empty';
    else if (st.some(x => x.status === 'over')) status = 'over';
    else if (st.some(x => x.status !== 'ok')) status = 'short';
    out.push({ num, den, key, prevKey, keyChanged, timeChanged, full, cap, sum, status, st, beat: 192 / den });
  });
  return out;
}

/** 길이 합을 표준 음표로 나누기 */
function decompose(total, compound) {
  const parts = [];
  let rem = total;
  if (compound) { while (rem >= 72) { parts.push({ dur: 'q', dots: 1, t: 72 }); rem -= 72; } }
  while (rem > 0) {
    const d = STD_DURS.find(x => x.t <= rem);
    if (!d) break;
    parts.push(Object.assign({}, d)); rem -= d.t;
  }
  return parts;
}
/** 음표 개수 고르기: total 틱을 count 개로 나눔 */
function splitFill(total, count, compound) {
  let parts = decompose(total, compound);
  if (compound && parts.length > count) parts = decompose(total, false);
  let guard = 0;
  while (parts.length < count && guard++ < 200) {
    let bi = -1, bt = 0;
    parts.forEach((p, i) => { if (p.t >= bt && p.t > 12) { bt = p.t; bi = i; } });
    if (bi < 0) break;
    const p = parts[bi];
    let a, b;
    if (p.dots) { a = { dur: p.dur, dots: 0, t: DUR_T[p.dur] }; const ht = DUR_T[p.dur] / 2; b = Object.assign({}, STD_DURS.find(x => x.t === ht)); }
    else { const ht = p.t / 2; a = Object.assign({}, STD_DURS.find(x => x.t === ht)); b = Object.assign({}, a); }
    parts.splice(bi, 1, a, b);
  }
  return parts;
}
/** 남은 박자를 쉼표로 채우기 (박 위치 정렬) */
function restsFor(start, rem) {
  const out = [];
  let cur = start, guard = 0;
  while (rem > 0 && guard++ < 64) {
    const d = STD_DURS.find(x => !x.dots && x.t <= rem && cur % x.t === 0) || STD_DURS.find(x => x.t <= rem);
    if (!d) break;
    out.push(d); cur += d.t; rem -= d.t;
  }
  return out;
}

/* ===== 가사 ===== */
const HANGUL = /[가-힣ㄱ-ㆎ]/;
function parseLyrics(text) {
  const out = [];
  if (!text) return out;
  let i = 0, buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  while (i < text.length) {
    const c = text[i];
    if (c === '[') { flush(); const j = text.indexOf(']', i); const g = text.slice(i + 1, j < 0 ? text.length : j); if (g) out.push(g); i = j < 0 ? text.length : j + 1; continue; }
    if (/\s/.test(c)) { flush(); i++; continue; }
    if (c === '-') { flush(); i++; continue; }
    if (c === '_') { flush(); out.push('_'); i++; continue; }
    if (HANGUL.test(c)) { flush(); out.push(c); i++; continue; }
    buf += c; i++;
  }
  flush();
  return out;
}

/* ===== 코드 이름 ===== */
const CHORD_RE = /^([A-Ga-g])([#b♯♭]?)([^/]*)(?:\/([A-Ga-g])([#b♯♭]?))?$/;
function accVal(s) { return s === '#' || s === '♯' ? 1 : s === 'b' || s === '♭' ? -1 : 0; }
function accStr(a) { return a > 0 ? '#'.repeat(a) : a < 0 ? 'b'.repeat(-a) : ''; }
function parseChord(name) {
  const m = CHORD_RE.exec((name || '').trim());
  if (!m) return null;
  return { step: STEPS.indexOf(m[1].toUpperCase()), alt: accVal(m[2]), q: m[3] || '', bass: m[4] ? { step: STEPS.indexOf(m[4].toUpperCase()), alt: accVal(m[5]) } : null };
}
function chordToString(c) {
  return STEPS[c.step] + accStr(c.alt) + c.q + (c.bass ? '/' + STEPS[c.bass.step] + accStr(c.bass.alt) : '');
}
/** 코드 구성음 (midi, 루트 C3 근처) */
function chordTones(name) {
  const c = parseChord(name);
  if (!c) return null;
  const root = STEP_SEMI[c.step] + c.alt;
  const q = c.q.replace(/^maj/, 'M').replace(/^min/, 'm').replace(/^-/, 'm');
  let iv = [0, 4, 7];
  if (/^m(?!aj|M)/.test(q) && !/^m7b5|^m7♭5/.test(q)) iv = [0, 3, 7];
  if (/dim|°/.test(q)) iv = [0, 3, 6];
  if (/aug|\+/.test(q)) iv = [0, 4, 8];
  if (/sus4|sus(?!2)/.test(q)) iv = [0, 5, 7];
  if (/sus2/.test(q)) iv = [0, 2, 7];
  if (/m7b5|m7♭5|ø/.test(q)) iv = [0, 3, 6, 10];
  else if (/M7|Δ/.test(q)) iv = iv.concat(11);
  else if (/dim7|°7/.test(q)) iv = [0, 3, 6, 9];
  else if (/7|9|11|13/.test(q)) iv = iv.concat(10);
  if (/6/.test(q) && !/7/.test(q)) iv = iv.concat(9);
  if (/9/.test(q)) iv = iv.concat(14);
  // 5음 바꾸기: -5 / b5 / ♭5 (예: G♯m-5 = G♯ B D) · +5 / #5 / ♯5
  if (/[-b♭]5/.test(q.replace(/m7b5|m7♭5/, ''))) iv = iv.map(x => x === 7 ? 6 : x);
  if (/[+#♯]5/.test(q)) iv = iv.map(x => x === 7 ? 8 : x);
  const base = 48 + mod(root, 12);
  const bass = c.bass ? 36 + mod(STEP_SEMI[c.bass.step] + c.bass.alt, 12) : 36 + mod(root, 12);
  return { bass, tones: iv.map(x => base + x) };
}
function transposeChordName(name, dSteps, semis) {
  const c = parseChord(name);
  if (!c) return name;
  const tr = (step, alt) => {
    const ns = mod(step + dSteps, 7);
    const target = mod(STEP_SEMI[step] + alt + semis, 12);
    let a = target - STEP_SEMI[ns];
    while (a > 6) a -= 12; while (a < -6) a += 12;
    return { step: ns, alt: a };
  };
  const r = tr(c.step, c.alt);
  c.step = r.step; c.alt = r.alt;
  if (c.bass) c.bass = tr(c.bass.step, c.bass.alt);
  return chordToString(c);
}
function prettyChord(name) { return (name || '').replace(/([A-G])#/g, '$1♯').replace(/([A-G])b/g, '$1♭'); }

/* ===== 재생 순서 (도돌이표·괄호·D.S./D.C.·Coda·Fine) ===== */
function playOrder(s) {
  const M = s.measures, n = M.length, order = [];
  const has = (i, k) => (M[i].marks || []).includes(k);
  let i = 0, pass = 1, repStart = 0, jumped = false, jumpMode = '';
  const taken = new Set();
  let guard = 0, prevVolta = false;
  while (i < n && guard++ < 20000) {
    const m = M[i];
    if (m.start === 'repeatStart' && repStart !== i) { repStart = i; pass = 1; }
    if (m.volta) {
      const maxV = Math.max(...M.slice(Math.max(0, i - 4), Math.min(n, i + 5)).map(x => x.volta || 0));
      const want = jumped ? maxV : pass;
      if (m.volta !== want) { i++; prevVolta = true; continue; }
      prevVolta = true;
    } else if (prevVolta) { prevVolta = false; if (pass > 1) { pass = 1; repStart = i; } }
    order.push(i);
    if (jumped && jumpMode === 'fine' && has(i, 'fine')) break;
    if (jumped && jumpMode === 'coda' && has(i, 'tocoda')) {
      const c = M.findIndex((x, k) => k > i && (x.marks || []).includes('coda'));
      if (c >= 0) { i = c; jumpMode = ''; continue; }
    }
    if (m.end === 'repeatEnd' && !jumped && !taken.has(i)) { taken.add(i); pass++; i = repStart; prevVolta = false; continue; }
    if (m.end === 'repeatEnd' && !jumped && taken.has(i) && !m.volta) { repStart = i + 1; pass = 1; }
    if (!jumped) {
      const ds = ['ds', 'dsalcoda', 'dsalfine'].find(k => has(i, k));
      const dc = ['dc', 'dcalcoda', 'dcalfine'].find(k => has(i, k));
      if (ds || dc) {
        jumped = true;
        const k = ds || dc;
        jumpMode = /coda/.test(k) ? 'coda' : /fine/.test(k) ? 'fine' : (M.some(x => (x.marks || []).includes('fine')) ? 'fine' : (M.some(x => (x.marks || []).includes('tocoda')) ? 'coda' : ''));
        const seg = M.findIndex(x => (x.marks || []).includes('segno'));
        i = ds ? Math.max(0, seg) : 0; pass = 2; prevVolta = false; continue;
      }
    }
    i++;
  }
  return order;
}
function orderToText(order) {
  if (!order.length) return '';
  const parts = [];
  let a = order[0], b = order[0];
  for (let k = 1; k <= order.length; k++) {
    const x = order[k];
    if (x === b + 1) { b = x; continue; }
    parts.push(a === b ? `${a + 1}` : `${a + 1}–${b + 1}`);
    a = b = x;
  }
  return parts.join(', ');
}

/* ===== 되돌리기 ===== */
const History = {
  stack: [], redoStack: [],
  push(s) { this.stack.push(JSON.stringify(s)); if (this.stack.length > 300) this.stack.shift(); this.redoStack = []; },
  undo(s) { if (!this.stack.length) return null; this.redoStack.push(JSON.stringify(s)); return JSON.parse(this.stack.pop()); },
  redo(s) { if (!this.redoStack.length) return null; this.stack.push(JSON.stringify(s)); return JSON.parse(this.redoStack.pop()); },
  clear() { this.stack = []; this.redoStack = []; }
};
