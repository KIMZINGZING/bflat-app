'use strict';
/* ===== BFlat Studio — 악보 그리기 (SVG) ===== */
const L = { PW: 1008, ML: 54, MR: 54, SP: 9, MAXH: 1426, TOPM: 44, BOTM: 44, MPAD_L: 16, MPAD_R: 12, PAD_MIN: 0.3 };
const MUSIC_FONT = "'Segoe UI Symbol','Noto Music','Bravura Text',serif";
const MARK_LABEL = { segno: '𝄋', coda: '𝄌', ds: 'D.S.', dsalcoda: 'D.S. al Coda', dsalfine: 'D.S. al Fine', dc: 'D.C.', dcalcoda: 'D.C. al Coda', dcalfine: 'D.C. al Fine', fine: 'Fine', tocoda: 'To Coda 𝄌' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = v => Math.round(v * 10) / 10;

/* 음자리표: 'treble' · 'bass' · 가온음자리표 'c1'~'c5' (숫자 = 가온 다(C4)가 놓이는 줄, 아래에서부터 · c3 = 알토) */
function isCClef(clef) { return /^c[1-5]$/.test(clef || ''); }
function cLineOf(clef) { return isCClef(clef) ? +clef[1] : 3; }
function bottomD(clef) { if (isCClef(clef)) return 28 - 2 * (cLineOf(clef) - 1); return clef === 'bass' ? 18 : 30; }
function clefMidD(clef) { return bottomD(clef) + 4; }       // 가운데 줄의 음
function posOf(p, clef) { return p.d - bottomD(clef); }
function yOf(staffTop, pos) { return staffTop + (8 - pos) * L.SP / 2; }
function clefKeyPos(clef, trebleList) {
  if (clef === 'bass') return trebleList.map(x => x - 2);
  if (!isCClef(clef)) return trebleList;
  // 가온음자리표: 높은음자리표 자리에서 한 옥타브 아래 음으로, 오선 밖으로 너무 나가면 옥타브 조정
  return trebleList.map(p => { let q = (p + 30 - 7) - bottomD(clef); while (q > 9) q -= 7; while (q < 0) q += 7; return q; });
}
function sharpPositions(clef) { return clefKeyPos(clef, [8, 5, 9, 6, 3, 7, 4]); }
function flatPositions(clef) { return clefKeyPos(clef, [4, 7, 3, 6, 2, 5, 1]); }
function clefWide(clef) { return clef && clef !== 'treble'; }
function isCompound(c) { return c.den === 8 && c.num % 3 === 0 && c.num > 3; }

/* ---------- 글자 폭 (실제 글꼴로 재요) ----------
 * 가사·계이름·코드 이름이 서로 겹치지 않게 간격을 정할 때, 글자 수로 어림하지 않고
 * 악보에 쓰는 글꼴 그대로 캔버스에서 폭을 재요. (글꼴이 늦게 올라오면 다시 재요) */
function scoreFontFamily() {
  const basic = typeof App !== 'undefined' && App.settings && App.settings.scoreFont === 'basic';
  return basic ? "'Malgun Gothic','Noto Sans KR',sans-serif" : "'Yeeun','Malgun Gothic',sans-serif";
}
const _tw = { cache: new Map(), ctx: null };
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => _tw.cache.clear());
function textW(str, size, bold, family) {
  str = String(str);
  family = family || scoreFontFamily();
  const key = (bold ? 'b' : '') + size + '|' + family + '|' + str;
  let w = _tw.cache.get(key);
  if (w !== undefined) return w;
  try {
    if (!_tw.ctx) _tw.ctx = document.createElement('canvas').getContext('2d');
    _tw.ctx.font = `${bold ? '700 ' : ''}${size}px ${family}`;
    w = _tw.ctx.measureText(str).width;
  } catch (e) { w = 0; }
  // 캔버스를 못 쓰거나 이상하면 어림값 (한글은 넓게)
  const guess = [...str].reduce((a, ch) => a + (HANGUL.test(ch) ? 0.95 : /[A-Zmw♭♯#]/.test(ch) ? 0.68 : 0.55), 0) * size;
  if (!(w > 0)) w = guess;
  _tw.cache.set(key, w);
  return w;
}

/** 가사 row번째 줄(절)의 글자 밑줄 y (첫 오선 아래) */
function lyrRowY(sys, row) { return sys.staffTop + 4 * L.SP + 25 + row * 21 + Math.max(0, sys.lyrShift || 0); }

/* ---------- 레이아웃 ---------- */
function computeLayout(s, ctxs, opt) {
  const lay = { pages: [], systems: [], meas: [], notes: {}, lyr: [], slurs: [], startY: 0 };
  const nSt = staffCount(s);
  const clefs = Array.from({ length: nSt }, (_, si) => staffClef(s, si));
  const names = (s.staves || []).map(x => x.name || '');
  // 피아노(큰보표) 악보는 앞에 이름을 안 써요
  const pianoOnly = s.type === 'grand' || (s.type !== 'ensemble' && nSt === 2 && clefs[1] === 'bass');
  const hasNames = nSt > 1 && !pianoOnly && names.some(Boolean);
  // 악기 이름 자리: 첫 줄은 긴 이름, 둘째 줄부터는 짧은 이름(앙상블)
  const nameW = hasNames ? Math.max(...names.map(n => textW(n, 14))) : 0;
  const shorts = (s.staves || []).map(x => (s.type === 'ensemble' ? (x.short || shortInstName(x.name)) : ''));
  const shortW = hasNames && shorts.some(Boolean) ? Math.max(...shorts.map(n => textW(n, 13))) : 0;
  const indent1 = hasNames ? Math.min(170, Math.max(62, nameW + 18)) : 0, indentN = shortW ? Math.min(90, shortW + 16) : 0;
  lay.shorts = shorts;
  let headH = 34;
  if (s.title) headH += 52;
  if (s.composer || s.lyricist) headH += 14;
  lay.headH = headH;
  let y = L.TOPM + headH, page = { index: 0, systems: [], h: 0 };
  lay.pages.push(page);
  const tied = tieSets(s);
  // 쉬는 마디가 2마디 이상 이어지면 한 마디에 숫자로 (마디 편집 모드에서는 다 펼쳐요)
  const runs = opt && opt.noMr ? new Map() : restRuns(s, ctxs);
  displayLines(s, runs).forEach(dl => {
    const idxs = dl.idxs, li = dl.li;
    if (!idxs.length) return;
    const first = idxs[0], c0 = ctxs[first];
    const keyN = Math.abs(c0.key);
    const showTime = first === 0 || c0.timeChanged;
    const clefW = clefs.some(clefWide) ? 38 : 32;
    const headerW = 6 + clefW + (keyN ? keyN * 9 + 6 : 0) + (showTime ? 24 : 0) + 2;
    const indent = li === 0 ? indent1 : indentN;            // 첫 줄: 악기 이름 자리 (앙상블은 둘째 줄부터 짧은 이름)
    const x0 = L.ML + indent;
    const prefix = idxs.map((i, k) => {
      if (k === 0) return s.measures[i].start === 'repeatStart' ? 12 : 0;
      const c = ctxs[i];
      let w = 0;
      if (c.keyChanged) w += (Math.abs(c.prevKey) * (Math.sign(c.prevKey) !== Math.sign(c.key) || Math.abs(c.key) < Math.abs(c.prevKey) ? 1 : 0) + Math.abs(c.key)) * 9 + 10;
      if (c.timeChanged) w += 26;
      if (s.measures[i].start === 'repeatStart') w += 12;
      return w;
    });
    const avail = L.PW - x0 - L.MR - headerW;
    const verses = [];
    // 가사 모드에서는 모든 절의 칸을 줄마다 펼쳐요 (빈 절도 눌러서 쓸 수 있게) · 다른 모드·인쇄는 쓴 절만
    for (let v = 0; v < (s.lyricLines || 1); v++) if ((opt && opt.lyrAll) || idxs.some(i => (s.measures[i].lyrics[v] || '').trim())) verses.push(v);
    // 마디마다 음표 간격(구간) 먼저 계산 → 음표가 많은 마디는 넓게 (마디 폭을 똑같이 나누면 빽빽한 마디에서 음표가 겹쳐요)
    const pre = idxs.map((i, k) => measureSegs(s, ctxs[i], s.measures[i], nSt, tied, verses));
    const PAD = L.MPAD_L + L.MPAD_R;
    let padS = 1;          // 마디 앞뒤 여백 비율 (줄이 빠듯하면 여백부터 줄여요 · 음표·글자 간격은 그대로)
    const isMr = idxs.map(i => runs.has(i));
    let need = pre.map((p, k) => Math.max(isMr[k] ? 96 : 0, prefix[k] + PAD + p.lead + p.segs.reduce((a, sg) => a + sg.min, 0)));
    const needFull = need.slice();
    const nat = pre.map((p, k) => Math.max(isMr[k] ? 130 : 0, prefix[k] + PAD + p.lead + p.segs.reduce((a, sg) => a + Math.max(sg.min, sg.f * 46), 0)));
    // 여러 마디 쉼표는 이 줄의 보통 마디 폭만큼 (악보마다 자동 폭)
    const plain = nat.filter((w, k) => !isMr[k]);
    if (plain.length && isMr.some(Boolean)) { const avgW = plain.reduce((a, b) => a + b, 0) / plain.length; isMr.forEach((mr, k) => { if (mr) nat[k] = Math.max(nat[k], avgW); }); }
    let ws = idxs.map(i => s.measures[i].width || 0);
    const fixed = ws.filter(w => w > 0), autoN = ws.length - fixed.length;
    let overflow = false;
    if (fixed.length) {
      // 사용자가 폭을 정한 줄: 예전처럼 비율대로
      const sumFixed = fixed.reduce((a, b) => a + b, 0);
      if (autoN) { const aw = Math.max(40, (avail - sumFixed) / autoN); ws = ws.map(w => w || aw); }
      const tot = ws.reduce((a, b) => a + b, 0);
      ws = ws.map(w => w * avail / tot);
    } else {
      let sumNeed = need.reduce((a, b) => a + b, 0);
      if (sumNeed > avail) {
        // 1) 마디 앞뒤 여백을 (30%까지) 줄여서 맞춰 봐요
        padS = Math.max(L.PAD_MIN, 1 - (sumNeed - avail) / (PAD * need.length));
        need = need.map(w => w - PAD * (1 - padS));
        sumNeed = need.reduce((a, b) => a + b, 0);
      }
      // 2) 그래도 넘치면 → 줄을 나눠야 해요 (refitLines) · 나누기 전까지는 같은 비율로 좁혀서 그려요
      if (sumNeed > avail + 0.5) { overflow = true; ws = need.map(w => w * avail / sumNeed); }
      else if (padS < 1) ws = need.map(w => w + (avail - sumNeed) / need.length);
      else {
        // 자연 폭 비율로 나누되, 모자란 마디는 최소 폭을 지켜요
        const fix = new Set();
        let scale = 1;
        for (let pass = 0; pass < 8; pass++) {
          const free = avail - [...fix].reduce((a, k) => a + need[k], 0);
          const sn = nat.reduce((a, w, k) => a + (fix.has(k) ? 0 : w), 0);
          scale = sn > 0 ? free / sn : 1;
          let ch = false;
          nat.forEach((w, k) => { if (!fix.has(k) && w * scale < need[k]) { fix.add(k); ch = true; } });
          if (!ch) break;
        }
        ws = nat.map((w, k) => fix.has(k) ? need[k] : w * scale);
      }
    }
    const hasForm = idxs.some(i => s.measures[i].form);
    const hpSt = hpStaves(s, idxs);   // 이 줄에 걸친 크레셴도·데크레셴도 (오선 번호 → true)
    const hasRow2 = !!hpSt[0] || idxs.some(i => { const m = s.measures[i]; return m.volta || (m.marks && m.marks.length) || m.notes.some(n => n.dyn || n.text); });
    const ext = clefs.map((clef, si) => {
      let lo = 0, hi = 8;
      idxs.forEach(i => SNr(s.measures[i], si).forEach(n => notePitches(n).forEach(p => { const q = posOf(p, clef); lo = Math.min(lo, q); hi = Math.max(hi, q); })));
      // 화음 성부(아래 기둥)의 기둥 끝까지 아래 공간 확보
      idxs.forEach(i => OVr(s.measures[i], si).forEach(n => { if (n.rest || !n.p || n.dur === 'w') return; const q = Math.min(...notePitches(n).map(p => posOf(p, clef))); lo = Math.min(lo, q - 7); }));
      let above = Math.max(0, (hi - 11) * L.SP / 2);
      if (si > 0) {
        // 둘째 줄부터: 위로 뻗은 기둥·빔·머리 위 꾸밈(스타카토 등)까지 — 윗줄 가사·계이름과 겹치지 않게
        let tp = 8;
        idxs.forEach(i => { tp = Math.max(tp, staffTopPos(s.measures[i], si, clef, ctxs[i])); });
        above = Math.max(above, (tp - 8) * L.SP / 2 - 6);
        // 이 줄 음표에 붙은 셈여림·글자(오선 위에 써요)
        if (hpSt[si] || idxs.some(i => SNr(s.measures[i], si).some(n => n.dyn || n.text))) above = Math.max(above, 24);
      }
      // 아래 덧줄 음: 머리 아래 끝까지 (가사·계이름이 머리에 닿지 않게)
      // 아래로 내린 기둥·빔 끝도 (높은 음이 많으면 기둥이 아래로 가요 — 조옮김으로 음이 올라갔을 때)
      const lowPos = stemLowPos(s, idxs, si, clef);
      return { above, below: Math.max(0, (-lo - 1) * L.SP / 2, -lowPos * L.SP / 2 - 9), lowPos };
    });
    // 위로 뻗은 기둥 끝이 코드 이름과 겹치지 않게: 첫 줄에서 가장 높이 올라가는 기둥
    // (음표 머리·위로 뻗은 기둥·빔·머리 위 꾸밈까지 — 그리는 규칙과 똑같이 기둥 방향을 정해서)
    let stemHi = 8;
    idxs.forEach(i => { stemHi = Math.max(stemHi, staffTopPos(s.measures[i], 0, clefs[0], ctxs[i])); });
    const chordDy = (m0HasChords(s, idxs) || hasRow2) ? Math.max(0, (stemHi - 9) * L.SP / 2) : 0;
    const above0 = 40 + (hasRow2 ? 20 : 0) + (hasForm ? 24 : 0) + Math.max(ext[0].above, chordDy);
    // 계이름: 켠 줄마다, 이 줄(시스템)에서 화음이 가장 많이 쌓인 만큼 줄 수
    const solH = clefs.map((_, si) => {
      if (!solfaOn(s, si)) return 0;
      let rows = 1;
      idxs.forEach(i => {
        const m = s.measures[i], cap = ctxs[i].cap, byT = {};
        let t = 0;
        SNr(m, si).forEach(n => { byT[t] = (byT[t] || 0) + notePitches(n).length; t += noteTicks(n, cap); });
        OVr(m, si).forEach(n => { const k = n.t || 0; byT[k] = (byT[k] || 0) + notePitches(n).length; });
        Object.values(byT).forEach(v => rows = Math.max(rows, v));
      });
      // 아래로 내린 기둥·빔 끝이 오선 밑으로 얼마나 내려가는지 (계이름을 그 아래에 쓰니까 자리 확보)
      const stemExtra = Math.max(0, -ext[si].lowPos * L.SP / 2 - ext[si].below);
      return Math.min(6, rows) * 14 + 10 + stemExtra;
    });
    const staffTops = [];
    let cy = y + above0;
    for (let si = 0; si < nSt; si++) {
      if (si > 0) {
        const prevBelow = ext[si - 1].below + solH[si - 1] + (si === 1 ? verses.length * 21 : 0);
        const sameGrp = s.staves[si].grp && s.staves[si].grp === s.staves[si - 1].grp;
        const gap = Math.max(sameGrp ? 46 : 40, 18 + prevBelow + ext[si].above + (si === 1 && verses.length ? 14 : 0));
        cy += 4 * L.SP + gap;
      }
      staffTops.push(cy);
    }
    const belowLast = 30 + ext[nSt - 1].below + solH[nSt - 1] + (nSt === 1 ? verses.length * 21 : 0);
    const h = (staffTops[nSt - 1] - y) + 4 * L.SP + belowLast;
    if (page.systems.length && y + h > L.MAXH - L.BOTM) {
      page.h = y + L.BOTM;
      page = { index: lay.pages.length, systems: [], h: 0 };
      lay.pages.push(page);
      const dy = L.TOPM - y; y = L.TOPM;
      for (let si = 0; si < nSt; si++) staffTops[si] += dy;
    }
    const sys = { li, packed: dl.packed, page: page.index, top: y, staffTop: staffTops[0], staffTops, clefs, h, headerW, idxs, verses, hasForm, hasRow2, showTime, x0, x1: L.PW - L.MR, above: above0, indent, chordDy, lyrShift: ext[0].below + solH[0], solH, ext, overflow, hasChords: m0HasChords(s, idxs) };
    sys.staffBottom = staffTops[nSt - 1] + 4 * L.SP;
    let x = x0 + headerW;
    idxs.forEach((i, k) => {
      const c = ctxs[i], m = s.measures[i];
      const denom = Math.max(c.cap, c.sum) || c.cap;
      const g = { mi: i, sys, page: page.index, x, w: ws[k], prefixW: prefix[k], staffTop: staffTops[0], staffTops };
      g.cx = x + prefix[k] + L.MPAD_L * padS;
      g.cw = Math.max(10, ws[k] - prefix[k] - (L.MPAD_L + L.MPAD_R) * padS);
      g.denom = denom;
      const { evs, segs, lead, startsSt } = pre[k];
      g.startsSt = startsSt;
      g.starts = g.startsSt[0];
      g.need = need[k]; g.needFull = needFull[k];
      // 마디가 최소 폭보다 좁으면 최소 폭을 같은 비율로 줄여요 (음표가 다음 마디로 넘어가지 않게)
      const sumMin = lead + segs.reduce((a, sg) => a + sg.min, 0);
      if (sumMin > g.cw && sumMin > 0) { const r = g.cw / sumMin; segs.forEach(sg => { sg.min *= r; }); }
      let fixedSet = new Set(), unit = 0;
      for (let pass = 0; pass < 5; pass++) {
        const free = g.cw - lead - [...fixedSet].reduce((a, q) => a + segs[q].min, 0);
        const fsum = segs.reduce((a, sg, q) => a + (fixedSet.has(q) ? 0 : sg.f), 0);
        unit = fsum > 0 ? Math.max(0, free) / fsum : 0;
        let changed = false;
        segs.forEach((sg, q) => { if (!fixedSet.has(q) && unit * sg.f < sg.min) { fixedSet.add(q); changed = true; } });
        if (!changed) break;
      }
      const anchors = [[0, g.cx + lead]];
      let xx = g.cx + lead;
      segs.forEach((sg, q) => { xx += fixedSet.has(q) ? sg.min : unit * sg.f; anchors.push([sg.tb, xx]); });
      if (!evs.length) anchors.splice(1, anchors.length, [c.cap, g.cx + g.cw]);
      g.anchors = anchors;
      lay.meas[i] = g;
      if (runs.has(i)) {
        // 여러 마디 쉼: 첫 마디에 그리고, 나머지 마디는 같은 자리(숨김)를 가리켜요
        g.mrEnd = runs.get(i); g.mr = g.mrEnd - i + 1;
        for (let j = i + 1; j <= g.mrEnd; j++) lay.meas[j] = Object.assign({}, g, { mi: j, hidden: true, mrFirst: i, mr: 0 });
      }
      x += ws[k];
    });
    sys.bottom = y + h;
    page.systems.push(sys); lay.systems.push(sys);
    y += h;
  });
  page.h = Math.max(y + L.BOTM, 300);
  lay.tied = tied;
  return lay;
}
/**
 * 한 마디의 음표 간격 구간: 모든 줄의 박을 모아 구간마다 무게(f)와 최소 폭(min)
 * (마디 폭과 상관없이 계산 → 줄 안에서 마디 폭을 나눌 때도 써요)
 */
function measureSegs(s, c, m, nSt, tied, verses) {
  const startsSt = [];
  const evs = [];   // 모든 줄의 음표: {t, d, min, ph}
  for (let si = 0; si < nSt; si++) {
    const arr = SNr(m, si), st = [];
    let t = 0;
    arr.forEach(n => {
      st.push(t); const d = noteTicks(n, c.cap);
      // 임시표 자리 (대략): 조표와 다른 음 개수만큼 왼쪽에 공간
      const nAcc = notePitches(n).filter(p => p.a !== keyAlter(c.key, mod(p.d, 7))).length;
      // 점·2도 화음(옆으로 비킨 머리)도 자리를 차지해요
      const ps = notePitches(n).map(p => p.d).sort((a, b) => a - b);
      const second = ps.some((d0, q) => q && d0 - ps[q - 1] === 1);
      // 2도 화음: 기둥이 아래면 비킨 머리가 왼쪽으로 가요 → 앞 구간에서 자리 확보 (임시표처럼)
      // 꾸밈음도 앞쪽에 자리를 차지해요 (작은 음 하나에 9 · 임시표가 붙으면 7 더)
      const grW = (n.gr && n.gr.length && !n.rest) ? 6 + n.gr.length * 9 + n.gr.filter(p => p.a !== keyAlter(c.key, mod(p.d, 7))).length * 7 : 0;
      evs.push({ t, d, min: 14 + ((n.ps && n.ps.length) ? 4 : 0) + (n.dots ? 6 : 0) + (second ? 10 : 0), accW: (nAcc ? 8 + nAcc * 7 : 0) + (second ? 11 : 0) + grW, ph: n.ph, si, n }); t += d;
    });
    startsSt.push(st);
    // 둘째 성부 (길이가 다른 화음 음)
    OVr(m, si).forEach(n => {
      const d = noteTicks(n, c.cap);
      const nAcc = notePitches(n).filter(p => p.a !== keyAlter(c.key, mod(p.d, 7))).length;
      evs.push({ t: n.t || 0, d, min: 14 + (n.dots ? 6 : 0), accW: nAcc ? 8 + nAcc * 7 : 0, si, n, ov: true });
    });
  }
  // 같은 때(박)끼리 x를 맞추기: 모든 줄의 시작 박을 모아 구간마다 폭 나누기
  const ticks = [...new Set(evs.map(e => e.t).concat(evs.map(e => e.t + e.d)).concat([0]))].sort((a, b) => a - b);
  const endT = ticks[ticks.length - 1] || 0;
  if (endT < c.cap) ticks.push(c.cap);
  const allPh = evs.length && evs.every(e => e.ph);
  const segs = [];
  for (let q = 0; q < ticks.length - 1; q++) {
    const ta = ticks[q], tb = ticks[q + 1], dt = tb - ta;
    const starting = evs.filter(e => e.t === ta);
    const inGap = ta >= endT;
    // 같은 박의 둘째 성부 음이 여럿이면 옆으로 비켜 놓을 자리
    const ovN = Math.max(0, ...[...new Set(starting.map(e => e.si))].map(s0 => starting.filter(e => e.ov && e.si === s0).length));
    const min = starting.length ? Math.max(...starting.map(e => e.min)) + Math.max(0, ovN - 1) * 15 + (ovN ? 11 : 0) : 0;
    // 구간 무게: 그 박에서 시작하는 가장 짧은 음표 기준
    const shortest = starting.length ? Math.min(...starting.map(e => e.d)) : dt;
    let f;
    if (inGap) f = dt / 48;
    else if (allPh) f = starting.length ? 1 : 0.2;
    else if (starting.some(e => e.ph)) f = 0.8 * dt / Math.max(dt, shortest);
    else f = Math.pow(shortest / 48, 0.62) * (dt / shortest);
    // 다음 박 음표의 임시표가 들어갈 자리도 이 구간에서 확보
    const nextAcc = Math.max(0, ...evs.filter(e => e.t === tb).map(e => e.accW));
    segs.push({ ta, tb, f, min: (starting.length ? min : 6) + nextAcc });
  }
  // 첫 박 음표에 임시표가 여럿이면 마디 앞쪽을 조금 비워요
  let lead = Math.max(0, Math.max(0, ...evs.filter(e => e.t === 0).map(e => e.accW)) - 10);
  // ── 글자끼리 겹치지 않게 (가사 · 계이름 · 코드 이름) ──
  // 글자 줄마다 이웃한 두 글자의 실제 폭으로 "이 박에서 저 박까지 최소 얼마나 떨어져야 하는지" 정하고,
  // 그 사이 구간들이 모자라면 늘려요. (음표 x = 박 위치 + 4, 가사·계이름은 가운데 맞춤, 코드는 왼쪽 맞춤 x−3)
  const capT = Math.max(c.cap, endT);
  const padMinL = L.MPAD_L * L.PAD_MIN, padMinR = L.MPAD_R * L.PAD_MIN;
  const cons = [];                    // [ta, tb, 필요한 거리]
  const leadNeed = [];                // [t, 마디 앞에서 그 박까지 필요한 거리]
  const rowCons = (row, gap) => {     // row: [{t, l, r}] (l/r = 음표 x에서 왼쪽·오른쪽으로 차지하는 폭)
    row = row.filter(it => it.l + it.r > 0).sort((a, b) => a.t - b.t);
    for (let q = 1; q < row.length; q++) if (row[q].t > row[q - 1].t) cons.push([row[q - 1].t, row[q].t, row[q - 1].r + row[q].l + gap]);
    if (!row.length) return;
    // 마디 끝(다음 마디 첫 글자) · 마디 앞(앞 마디 끝 글자)도 넘지 않게 — 마디선에서 2px씩 띄워요
    const last = row[row.length - 1], first = row[0];
    if (last.t < capT) cons.push([last.t, capT, last.r + 4 + 2 - padMinR]);
    leadNeed.push([first.t, first.l + 2 - 4 - padMinL]);
  };
  // 가사 (첫 줄 음표 · 절마다 한 줄)
  const lyrTargets = evs.filter(e => e.si === 0 && !e.ov && lyrSlot(e.n, tied.noSyl));   // 쉼표도 한 자리
  verses.forEach(v => {
    const row = [];
    parseLyrics(m.lyrics[v]).forEach((sy, k) => { const e = lyrTargets[k]; if (!e || !sy || sy === '_') return; const w = textW(sy, 14); row.push({ t: e.t, l: w / 2, r: w / 2 }); });
    rowCons(row, 7);
  });
  // 계이름 (켠 줄마다 · 화음이면 가장 넓은 글자)
  if (s.solfa && s.solfa.staves) {
    const style = s.solfa.style || 'ko';
    for (let si = 0; si < nSt; si++) {
      if (!solfaOn(s, si)) continue;
      const byT = new Map();
      evs.filter(e => e.si === si && !e.n.rest && e.n.p).forEach(e => {
        const w = Math.max(...notePitches(e.n).map(p => textW(solfaName(p, style), 12.5)));
        byT.set(e.t, Math.max(byT.get(e.t) || 0, w));
      });
      rowCons([...byT.entries()].map(([t, w]) => ({ t, l: w / 2, r: w / 2 })), 4);
    }
  }
  // 코드 이름 (맨 윗줄 위 · 왼쪽 맞춤)
  const chRow = (m.chords || []).map(ch => ({ t: ch.t, l: 0, r: textW(prettyChord(ch.name), 16, true) - 3 }));
  rowCons(chRow, 8);
  cons.forEach(([a, b, need]) => {
    const inSp = segs.filter(sg => sg.ta >= a && sg.tb <= b);
    if (!inSp.length) return;
    const have = inSp.reduce((x, sg) => x + sg.min, 0);
    if (have >= need) return;
    // 모자란 만큼 구간 길이(박) 비율로 나눠서 늘려요
    const span = inSp.reduce((x, sg) => x + (sg.tb - sg.ta), 0) || 1;
    inSp.forEach(sg => { sg.min += (need - have) * (sg.tb - sg.ta) / span; });
  });
  leadNeed.forEach(([t, need]) => {
    const before = segs.filter(sg => sg.tb <= t).reduce((x, sg) => x + sg.min, 0);
    lead = Math.max(lead, need - before);
  });
  return { evs, segs, lead, startsSt };
}
/** 한 줄(시스템)·한 오선에서 가장 아래로 내려가는 자리(오선 위치 단위, 0 = 맨 아랫줄): 아래 기둥·빔 끝 · 머리 아래 꾸밈 */
function stemLowPos(s, idxs, si, clef) {
  let lowPos = 0;
  idxs.forEach(i => {
    const m = s.measures[i], twoV = OVr(m, si).length > 0;
    const look = (n, isOv) => {
      if (n.rest || !n.p || n.dur === 'w' || n.ph) return;
      const ps = notePitches(n).map(p => posOf(p, clef)), lo = Math.min(...ps), hi = Math.max(...ps);
      const down = isOv || (!twoV && (lo + hi) / 2 >= 4);
      // 기둥이 위로 가면 스타카토 같은 꾸밈은 머리 아래에 붙어요 → 그 밑까지 자리 확보
      const arts = artMarks(n).filter(a => a !== 'fermata').length;
      const artPos =!down && arts ? lo - 1 - (11 + (arts - 1) * 8 + 4) / (L.SP / 2) : 0;
      lowPos = Math.min(lowPos, down ? lo - 7 - (n.dur === 's' ? 2 : 0) : lo - 1, artPos);
    };
    SNr(m, si).forEach(n => look(n, false));
    OVr(m, si).forEach(n => look(n, true));
  });
  return lowPos;
}
/** 한 마디 한 줄에서 가장 높이 올라가는 자리(오선 위치 단위): 머리 · 위 기둥 끝 · 빔 · 머리 위 꾸밈 */
function staffTopPos(m, si, clef, c) {
  const twoV = OVr(m, si).length > 0;
  const groupLen = isCompound(c) ? 72 : 48;
  const items = [];
  let t = 0;
  SNr(m, si).forEach(n => { items.push({ n, t }); t += noteTicks(n, c.cap); });
  // 빔 묶음 (drawStaffNotes 와 같은 규칙)
  let cur = [];
  const groups = [];
  const flush = () => { if (cur.length >= 2) groups.push(cur); cur = []; };
  items.forEach(it => {
    const n = it.n;
    const beamable = !n.rest && n.p && !n.ph && (n.dur === 'e' || n.dur === 's') && !n.full;
    const last = cur[cur.length - 1];
    const contiguous = last && last.t + noteTicks(last.n, c.cap) === it.t;
    if (beamable) { if (cur.length && Math.floor(cur[0].t / groupLen) === Math.floor(it.t / groupLen) && contiguous) cur.push(it); else { flush(); cur.push(it); } }
    else flush();
  });
  flush();
  items.forEach(it => {
    const n = it.n; if (n.rest || !n.p) return;
    const ps = notePitches(n).map(p => posOf(p, clef));
    it.hi = Math.max(...ps); it.mid = (it.hi + Math.min(...ps)) / 2;
  });
  groups.forEach(gr => { const avg = gr.reduce((a, x) => a + x.mid, 0) / gr.length; gr.forEach(x => { x.grpUp = avg < 4; x.grp = gr; }); });
  let top = 8;
  items.forEach(it => {
    const n = it.n; if (n.rest || !n.p) return;
    let up = twoV ? true : (it.grp ? it.grpUp : it.mid < 4);
    if (n.ph || n.dur === 'w') up = false;
    let y = up ? it.hi + 7 + (it.grp ? Math.max(...it.grp.map(x => x.hi)) - it.hi + 2 : 0) : it.hi + 1.5;
    const arts = artMarks(n).filter(a => a !== 'fermata').length;
    if (!up && arts) y = Math.max(y, it.hi + (11 + (arts - 1) * 8 + 6) / (L.SP / 2));
    if ((n.art || []).includes('fermata')) y = Math.max(y, Math.max(it.hi, 8) + 5);
    // 꾸밈음: 작은 기둥이 위로
    if (n.gr && n.gr.length) y = Math.max(y, Math.max(...n.gr.map(p => posOf(p, clef))) + 5.5);
    top = Math.max(top, y);
  });
  OVr(m, si).forEach(n => { if (!n.rest && n.p) top = Math.max(top, Math.max(...notePitches(n).map(p => posOf(p, clef))) + 1.5); });
  return top;
}
/**
 * 줄에 마디가 너무 많아 음표끼리 겹치면 그 줄을 나눠요 (자동 인식처럼 원래 악보 줄 나눔을 그대로 가져올 때)
 * → 바뀌었으면 true
 */
/** 쉬기만 하는 마디: 모든 줄이 쉼표뿐 (박자 맞음) · 코드·가사·송폼·기호·괄호·셈여림 없음 */
function isRestMeasure(s, c, m) {
  if (!c || c.status !== 'ok' || m.pickup || m.form || m.volta || (m.marks && m.marks.length) || (m.chords && m.chords.length)) return false;
  if (Object.values(m.lyrics || {}).some(t => (t || '').trim())) return false;
  const nSt = staffCount(s);
  for (let si = 0; si < nSt; si++) {
    const arr = SNr(m, si);
    if (!arr.length || OVr(m, si).length) return false;
    if (!arr.every(n => n.rest && !n.dyn && !n.text && !(n.art && n.art.length))) return false;
  }
  return true;
}
/** 2마디 이상 이어진 쉬는 마디 → Map(첫 마디 → 끝 마디) · 조·박자 바뀜, 도돌이표·겹세로줄에서는 끊어요 */
function restRuns(s, ctxs) {
  const runs = new Map(), N = s.measures.length;
  let i = 0;
  while (i < N) {
    if (!isRestMeasure(s, ctxs[i], s.measures[i])) { i++; continue; }
    let e = i;
    while (e + 1 < N && !s.measures[e].end && s.measures[e + 1].start !== 'repeatStart' && !ctxs[e + 1].keyChanged && !ctxs[e + 1].timeChanged && isRestMeasure(s, ctxs[e + 1], s.measures[e + 1])) e++;
    if (e > i) runs.set(i, e);
    i = e + 1;
  }
  return runs;
}
/** 그릴 줄: 보통은 s.lines 그대로 · 여러 마디 쉼이 있으면 그 묶음을 한 마디로 세어 줄마다 같은 칸 수로 채워요 (악보가 짧아져요) */
function displayLines(s, runs) {
  const orig = [];
  let mi = 0;
  s.lines.forEach((cnt, li) => {
    const idxs = [];
    for (let k = 0; k < cnt && mi + k < s.measures.length; k++) idxs.push(mi + k);
    mi += cnt;
    if (idxs.length) orig.push({ li, idxs });
  });
  if (!runs.size) return orig;
  const units = [];
  for (let i = 0; i < s.measures.length;) { const e = runs.has(i) ? runs.get(i) : i; units.push([i, e]); i = e + 1; }
  const out = [];
  let u = 0;
  // 여러 마디 쉼표를 만들며 늘어난 줄(예: 4마디 줄 → 8마디)은 숨은 마디만큼 칸 수를 줄여요 (보통 줄 길이까지)
  const sorted = s.lines.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)] || 4;
  const hidden = new Set(); runs.forEach((e, i) => { for (let j = i + 1; j <= e; j++) hidden.add(j); });
  orig.forEach(o => {
    if (u >= units.length) return;
    const hid = o.idxs.filter(i => hidden.has(i)).length;
    const cap = Math.max(1, o.idxs.length - Math.min(hid, Math.max(0, o.idxs.length - med)));
    const take = units.slice(u, u + cap); u += take.length;
    const idxs = take.map(x => x[0]);
    const same = idxs.length === o.idxs.length && take.every((x, k) => x[0] === x[1] && x[0] === o.idxs[k]);
    out.push({ li: o.li, idxs, packed: !same });
  });
  while (u < units.length) { const take = units.slice(u, u + 4); u += take.length; out.push({ li: orig.length, idxs: take.map(x => x[0]), packed: true }); }
  return out;
}
function refitLines(s, opt) {
  let changed = false;
  for (let guard = 0; guard < 40; guard++) {
    const lay = computeLayout(s, computeContexts(s), opt || {});
    const bad = lay.systems.find(sy => sy.overflow && sy.idxs.length > 1 && !sy.packed);
    if (!bad) break;
    // 고르게 나누기: 2줄, 3줄 … 으로 나눠서 모든 줄이 들어가는 가장 적은 줄 수
    // 들어갈 수 있는 폭: 마디 앞뒤 여백은 (마디마다) 30%까지 줄일 수 있어요 — computeLayout 과 같은 규칙
    const avail = L.PW - bad.x0 - L.MR - bad.headerW;
    const PADCUT = (L.MPAD_L + L.MPAD_R) * (1 - L.PAD_MIN);
    const needs = bad.idxs.map(i => lay.meas[i].needFull || lay.meas[i].need), cnt = needs.length;
    let parts = null;
    for (let k = 2; k <= cnt && !parts; k++) {
      const sizes = Array.from({ length: k }, (_, q) => Math.floor(cnt / k) + (q < cnt % k ? 1 : 0));
      let at = 0;
      const ok = sizes.every(z => { const sum = needs.slice(at, at + z).reduce((a, b) => a + b, 0); at += z; return z === 1 || sum - z * PADCUT <= avail; });
      if (ok) parts = sizes;
    }
    s.lines.splice(bad.li, 1, ...(parts || needs.map(() => 1)));
    changed = true;
  }
  return changed;
}
/* ---------- 계이름 ---------- */
const SOLFA_KO = ['도', '레', '미', '파', '솔', '라', '시'];
// 계이름 글자는 화면 언어에 맞춰요 (한국어 도레미 · English Do Re Mi · 日本語 ドレミ)
const SOLFA_BY_LANG = { ko: SOLFA_KO, en: ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'], ja: ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'] };
function solfaOn(s, si) { return !!(s.solfa && s.solfa.staves && s.solfa.staves[si]); }
/** 고정도: C = 도 · 올림/내림은 #/♭ 를 붙여요 (예: 파#, 시♭) */
function solfaName(p, style) {
  const step = mod(p.d, 7);
  const lang = typeof I18N !== 'undefined' ? I18N.lang : 'ko';
  const base = style === 'abc' ? STEPS[step] : (SOLFA_BY_LANG[lang] || SOLFA_KO)[step];
  const acc = p.a > 0 ? '#'.repeat(p.a) : p.a < 0 ? '♭'.repeat(-p.a) : '';
  return base + acc;
}
/* ---------- 셈여림표 ---------- */
const DYN_LETTERS = /^[pmfszrn]+$/;
/** 셈여림 글자 너비 (뒤에 붙는 글자 자리) */
function dynW(d) { return DYN_LETTERS.test(d) ? d.length * 9 : d.length * 6.6; }
/** ppp~fff·sfz 같은 기호 = 굵은 기울임 · subito p = "subito" + 굵은 p · cresc. 같은 말 = 기울임 */
function svgDyn(d, x, y, col) {
  const serif = `font-family="'Times New Roman',serif" font-style="italic"`;
  if (DYN_LETTERS.test(d)) return `<text x="${f1(x)}" y="${f1(y)}" ${serif} font-weight="700" font-size="16" fill="${col}">${esc(d)}</text>`;
  const m = /^(subito)\s+([pmf]+)$/.exec(d);
  if (m) return `<text x="${f1(x)}" y="${f1(y)}" ${serif} font-size="14" fill="${col}">${m[1]} <tspan font-weight="700" font-size="16">${m[2]}</tspan></text>`;
  return `<text x="${f1(x)}" y="${f1(y)}" ${serif} font-size="14" fill="${col}">${esc(d)}</text>`;
}
/** 줄(마디 목록)에 걸친 크레셴도·데크레셴도가 있는 오선 → { 오선 번호: true } */
function hpStaves(s, idxs) {
  const out = {};
  if (!s.hairpins || !s.hairpins.length || !idxs.length) return out;
  const idx = new Map(); s.measures.forEach((m, i) => idx.set(m.id, i));
  const lo = idxs[0], hi = idxs[idxs.length - 1];
  s.hairpins.forEach(hp => {
    const ia = idx.get(hp.a.m), ib = idx.get(hp.b.m);
    if (ia === undefined || ib === undefined) return;
    if (ia <= hi && ib >= lo) out[hp.si || 0] = true;
  });
  return out;
}
/** 크레셴도(<)·데크레셴도(>) 그리기 · 줄이 바뀌면 나눠서 · 고른 것은 양 끝 ○ (끌어서 길이) */
function drawHairpins(s, lay, st, pages) {
  lay.hps = []; lay.hpEnds = {};
  const hps = s.hairpins || [];
  if (!hps.length) return;
  const idx = new Map(); s.measures.forEach((m, i) => idx.set(m.id, i));
  const H = 11;
  hps.forEach(hp => {
    const ia = idx.get(hp.a.m), ib = idx.get(hp.b.m);
    if (ia === undefined || ib === undefined) return;
    const ga = lay.meas[ia], gb = lay.meas[ib]; if (!ga || !gb) return;
    const s0 = lay.systems.indexOf(ga.sys), s1 = lay.systems.indexOf(gb.sys);
    if (s0 < 0 || s1 < s0) return;
    const xa = tickX(ga, hp.a.t), xb = tickX(gb, hp.b.t);
    const segs = [];
    for (let k = s0; k <= s1; k++) {
      const sy = lay.systems[k];
      const x1 = k === s0 ? xa : sy.x0 + sy.headerW + 4, x2 = k === s1 ? xb : sy.x1 - 4;
      if (x2 > x1 + 1) segs.push({ sy, x1, x2 });
    }
    if (!segs.length) return;
    const total = segs.reduce((a, g) => a + g.x2 - g.x1, 0);
    const sel = st.selHp === hp.id;
    const open = c => hp.type === 'dim' ? H * (1 - c / total) : H * c / total;
    let cum = 0;
    const ends = lay.hpEnds[hp.id] = {};
    segs.forEach((g, k) => {
      const si = Math.min(hp.si || 0, g.sy.staffTops.length - 1);
      const y = g.sy.staffTops[si] - 31 - (si === 0 ? (g.sy.chordDy || 0) : 0);
      const o1 = open(cum) / 2, o2 = open(cum + g.x2 - g.x1) / 2;
      cum += g.x2 - g.x1;
      const d = `M${f1(g.x1)} ${f1(y - o1)} L${f1(g.x2)} ${f1(y - o2)} M${f1(g.x1)} ${f1(y + o1)} L${f1(g.x2)} ${f1(y + o2)}`;
      const P = pages[g.sy.page].parts;
      if (sel) P.push(`<path d="${d}" fill="none" stroke="rgba(37,99,235,.28)" stroke-width="6" stroke-linecap="round"/>`);
      P.push(`<path d="${d}" fill="none" stroke="#111" stroke-width="1.2" stroke-linecap="round"/>`);
      lay.hps.push({ id: hp.id, page: g.sy.page, x1: g.x1, x2: g.x2, y, h: H });
      if (k === 0) ends.a = { page: g.sy.page, x: g.x1, y };
      if (k === segs.length - 1) ends.b = { page: g.sy.page, x: g.x2, y };
    });
    if (sel && st.mode === 'slur') ['a', 'b'].forEach(k => { const e = ends[k]; if (e) pages[e.page].parts.push(`<circle cx="${f1(e.x)}" cy="${f1(e.y)}" r="${st.slurHandleR || 4}" fill="#fff" stroke="#2563eb" stroke-width="1.6"/>`); });
  });
}
function m0HasChords(s, idxs) { return idxs.some(i => s.measures[i].chords && s.measures[i].chords.length); }
function tickX(g, t) {
  const a = g.anchors;
  if (!a || a.length < 2) return g.cx + g.cw * t / g.denom;
  if (t <= a[0][0]) return a[0][1];
  for (let k = 1; k < a.length; k++) if (t <= a[k][0]) { const [t0, x0] = a[k - 1], [t1, x1] = a[k]; return t1 === t0 ? x0 : x0 + (x1 - x0) * (t - t0) / (t1 - t0); }
  return a[a.length - 1][1];
}
function xTick(g, x) {
  const a = g.anchors;
  if (!a || a.length < 2) return (x - g.cx) / g.cw * g.denom;
  if (x <= a[0][1]) return 0;
  for (let k = 1; k < a.length; k++) if (x <= a[k][1]) { const [t0, x0] = a[k - 1], [t1, x1] = a[k]; return x1 === x0 ? t0 : t0 + (t1 - t0) * (x - x0) / (x1 - x0); }
  return a[a.length - 1][0];
}

function tieSets(s) {
  const from = new Map(), into = new Set();
  (s.slurs || []).forEach(x => { if (x.type === 'tie') { from.set(x.a, x.b); into.add(x.b); } });
  return { from, into, noSyl: noSylSet(s, into) };
}

/* ---------- 그리기 도우미 ---------- */
function svgSharp(x, y, col) {
  return `<g fill="${col}" stroke="${col}"><line x1="${f1(x - 2)}" y1="${f1(y - 10)}" x2="${f1(x - 2)}" y2="${f1(y + 11)}" stroke-width="1.1"/><line x1="${f1(x + 2)}" y1="${f1(y - 11)}" x2="${f1(x + 2)}" y2="${f1(y + 10)}" stroke-width="1.1"/>` +
    `<polygon points="${f1(x - 5)},${f1(y - 1.6)} ${f1(x + 5)},${f1(y - 4.6)} ${f1(x + 5)},${f1(y - 2)} ${f1(x - 5)},${f1(y + 1)}" stroke="none"/>` +
    `<polygon points="${f1(x - 5)},${f1(y + 4.4)} ${f1(x + 5)},${f1(y + 1.4)} ${f1(x + 5)},${f1(y + 4)} ${f1(x - 5)},${f1(y + 7)}" stroke="none"/></g>`;
}
function svgFlat(x, y, col) {
  return `<g fill="none" stroke="${col}"><line x1="${f1(x - 3)}" y1="${f1(y - 14)}" x2="${f1(x - 3)}" y2="${f1(y + 4.5)}" stroke-width="1.2"/>` +
    `<path d="M${f1(x - 3)} ${f1(y + 4.5)} C${f1(x + 7)} ${f1(y - 1)} ${f1(x + 4)} ${f1(y - 7)} ${f1(x - 3)} ${f1(y - 1.5)}" stroke-width="1.9"/></g>`;
}
function svgNatural(x, y, col) {
  return `<g fill="${col}" stroke="${col}"><line x1="${f1(x - 3)}" y1="${f1(y - 11)}" x2="${f1(x - 3)}" y2="${f1(y + 5)}" stroke-width="1.1"/><line x1="${f1(x + 3)}" y1="${f1(y - 5)}" x2="${f1(x + 3)}" y2="${f1(y + 11)}" stroke-width="1.1"/>` +
    `<polygon points="${f1(x - 3)},${f1(y - 2)} ${f1(x + 3)},${f1(y - 4.5)} ${f1(x + 3)},${f1(y - 1.8)} ${f1(x - 3)},${f1(y + 0.7)}" stroke="none"/>` +
    `<polygon points="${f1(x - 3)},${f1(y + 4.2)} ${f1(x + 3)},${f1(y + 1.7)} ${f1(x + 3)},${f1(y + 4.4)} ${f1(x - 3)},${f1(y + 6.9)}" stroke="none"/></g>`;
}
function svgAcc(a, x, y, col) { return a > 0 ? svgSharp(x, y, col) : a < 0 ? svgFlat(x, y, col) : svgNatural(x, y, col); }

function svgRest(dur, x, staffTop, col) {
  const y = p => yOf(staffTop, p);
  switch (dur) {
    case 'w': return `<rect x="${f1(x - 6)}" y="${f1(y(6))}" width="12" height="4.6" fill="${col}"/>`;
    case 'h': return `<rect x="${f1(x - 6)}" y="${f1(y(4) - 4.6)}" width="12" height="4.6" fill="${col}"/>`;
    case 'q': {
      const t = y(7) + 1;
      return `<path d="M${f1(x - 2.5)} ${f1(t)} L${f1(x + 3.5)} ${f1(t + 7.5)} L${f1(x - 1)} ${f1(t + 13)} L${f1(x + 3.8)} ${f1(t + 19.5)} C${f1(x - 1)} ${f1(t + 17)} ${f1(x - 4)} ${f1(t + 21)} ${f1(x)} ${f1(t + 26)}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<path d="M${f1(x + 3.5)} ${f1(t + 7.5)} L${f1(x - 1)} ${f1(t + 13)}" stroke="${col}" stroke-width="4"/>`;
    }
    case 'e': {
      const t = y(5) + 1;
      return `<circle cx="${f1(x - 2.5)}" cy="${f1(t)}" r="2.5" fill="${col}"/><path d="M${f1(x - 2.5)} ${f1(t + 1.5)} Q${f1(x + 1)} ${f1(t + 3)} ${f1(x + 4)} ${f1(t - 1.5)} L${f1(x - 0.5)} ${f1(t + 15)}" fill="none" stroke="${col}" stroke-width="1.4"/>`;
    }
    case 's': {
      const t = y(5) + 1;
      return `<circle cx="${f1(x - 1.5)}" cy="${f1(t)}" r="2.4" fill="${col}"/><circle cx="${f1(x - 3.5)}" cy="${f1(t + 8)}" r="2.4" fill="${col}"/>` +
        `<path d="M${f1(x - 1.5)} ${f1(t + 1.5)} Q${f1(x + 2)} ${f1(t + 3)} ${f1(x + 5)} ${f1(t - 1.5)} L${f1(x - 1)} ${f1(t + 23)} M${f1(x - 3.5)} ${f1(t + 9.5)} Q${f1(x)} ${f1(t + 11)} ${f1(x + 3)} ${f1(t + 6.5)}" fill="none" stroke="${col}" stroke-width="1.4"/>`;
    }
  }
  return '';
}
function svgFlag(sx, sy, up, col, n) {
  let o = '';
  for (let k = 0; k < n; k++) {
    const yy = up ? sy + k * 7 : sy - k * 7;
    o += up
      ? `<path d="M${f1(sx)} ${f1(yy)} C${f1(sx + 1)} ${f1(yy + 6)} ${f1(sx + 10)} ${f1(yy + 8)} ${f1(sx + 8)} ${f1(yy + 18)} C${f1(sx + 8)} ${f1(yy + 11)} ${f1(sx + 3)} ${f1(yy + 9)} ${f1(sx)} ${f1(yy + 7)}Z" fill="${col}"/>`
      : `<path d="M${f1(sx)} ${f1(yy)} C${f1(sx + 1)} ${f1(yy - 6)} ${f1(sx + 10)} ${f1(yy - 8)} ${f1(sx + 8)} ${f1(yy - 18)} C${f1(sx + 8)} ${f1(yy - 11)} ${f1(sx + 3)} ${f1(yy - 9)} ${f1(sx)} ${f1(yy - 7)}Z" fill="${col}"/>`;
  }
  return o;
}
function svgClef(clef, x, staffTop) {
  // 로고에서 맞춘 좌표(줄 간격 10, 맨 윗줄 y36)를 오선 간격에 맞게 줄여서 그려요
  const s = L.SP / 10;
  if (isCClef(clef)) {
    // 가온음자리표: 가운데가 그 줄(가온 다)에 오도록 · 오선 높이만큼
    const cy = yOf(staffTop, 2 * (cLineOf(clef) - 1));
    const fs = 4 * L.SP / 0.76;            // 글자 잉크 높이 = 글자 크기의 76%
    return `<text x="${f1(x - fs * 0.04)}" y="${f1(cy + fs * 0.39)}" font-family="${MUSIC_FONT}" font-size="${f1(fs)}" fill="#111">𝄡</text>`;
  }
  if (clef === 'bass') {
    // 낮은음자리표: 머리와 두 점이 아래에서 넷째 줄(F)
    return `<g transform="translate(${f1(x - 50 * s)},${f1(staffTop - 36 * s)}) scale(${s})" fill="#111">` +
      `<path d="M52 46 C52 33 80 30 80 48 C80 62 68 71 51 77 L50.5 75 C64 68 72 60 72 48 C72 36 58 35 57 43 Z"/>` +
      `<circle cx="56" cy="46" r="5"/><circle cx="85" cy="41" r="2.6"/><circle cx="85" cy="51" r="2.6"/></g>`;
  }
  // 높은음자리표: 소용돌이가 아래에서 둘째 줄(G)
  return `<g transform="translate(${f1(x - 13 * s)},${f1(staffTop - 36 * s)}) scale(${s})"><text x="13" y="79" font-family="${MUSIC_FONT}" font-size="64" fill="#111">𝄞</text></g>`;
}
function svgKey(key, clef, x, staffTop, col) {
  let o = '';
  const n = Math.abs(key);
  const ps = key > 0 ? sharpPositions(clef) : flatPositions(clef);
  for (let k = 0; k < n; k++) {
    const yy = yOf(staffTop, ps[k]);
    o += key > 0 ? svgSharp(x + 5 + k * 9, yy, col || '#111') : svgFlat(x + 5 + k * 9, yy, col || '#111');
  }
  return o;
}
function svgKeyCancel(prev, key, clef, x, staffTop) {
  // 이전 조표 취소(제자리표) 후 새 조표
  let o = '', cx = x;
  const cancelN = (Math.sign(prev) !== Math.sign(key)) ? Math.abs(prev) : Math.max(0, Math.abs(prev) - Math.abs(key));
  const ps = prev > 0 ? sharpPositions(clef) : flatPositions(clef);
  const startIdx = (Math.sign(prev) !== Math.sign(key)) ? 0 : Math.abs(key);
  for (let k = 0; k < cancelN; k++) { o += svgNatural(cx + 5, yOf(staffTop, ps[startIdx + k]), '#111'); cx += 9; }
  o += svgKey(key, clef, cx, staffTop);
  return o;
}
function svgTime(num, den, x, staffTop) {
  const st = `font-family="'Times New Roman',serif" font-weight="900" font-size="22" text-anchor="middle" fill="#111"`;
  return `<text x="${f1(x)}" y="${f1(staffTop + 16.5)}" ${st}>${num}</text><text x="${f1(x)}" y="${f1(staffTop + 34.5)}" ${st}>${den}</text>`;
}

/* ---------- 악보 전체 그리기 ---------- */
function renderScore(s, ctxs, lay, st) {
  const font = st.scoreFont === 'basic' ? "'Malgun Gothic','Noto Sans KR',sans-serif" : "'Yeeun','Malgun Gothic',sans-serif";
  const pages = lay.pages.map(p => ({ index: p.index, h: p.h, parts: [] }));
  const selSet = new Set(st.sel || []);
  const selM = new Set(st.selMeasures || []);
  const SP = L.SP;
  const P = pages[0].parts;
  // 머리말
  let hy = L.TOPM;
  if (s.title) { P.push(`<text x="${L.PW / 2}" y="${hy + 30}" text-anchor="middle" font-family="${font}" font-size="26" font-weight="700" fill="#111">${esc(s.title)}</text>`); hy += 52; }
  if (s.composer || s.lyricist) {
    if (s.composer) P.push(`<text x="${L.PW - L.MR}" y="${hy + 6}" text-anchor="end" font-family="${font}" font-size="13" fill="#333">${esc(s.composer)}</text>`);
    if (s.lyricist) P.push(`<text x="${L.ML}" y="${hy + 6}" font-family="${font}" font-size="13" fill="#333">${esc(s.lyricist)}</text>`);
    hy += 14;
  }
  // 빠르기 표시: "Moderato ♩ = 112" / "Moderato" / "♩ = 90" / (둘 다 비면 없음)
  if (s.tempoText) {
    P.push(`<text class="tempo-mark" x="${L.ML}" y="${hy + 10}" font-family="${font}" fill="#111"><tspan font-size="16" font-weight="700">${esc(s.tempoText)}</tspan>` +
      (s.tempo ? `<tspan dx="7" font-family="${MUSIC_FONT}" font-size="17">♩</tspan><tspan font-size="13"> = ${s.tempo}</tspan>` : '') + `</text>`);
  } else if (s.tempo) {
    P.push(`<g class="tempo-mark"><path d="M${L.ML + 5} ${hy + 6} v-20" stroke="#111" stroke-width="1.3"/><ellipse cx="${L.ML + 1}" cy="${hy + 6.5}" rx="5" ry="3.6" transform="rotate(-20 ${L.ML + 1} ${hy + 6.5})" fill="#111"/>` +
      `<text x="${L.ML + 10}" y="${hy + 10}" font-family="${font}" font-size="13" fill="#111">= ${s.tempo}</text></g>`);
  }
  // 스윙: ♫ = ♩♪ (셋잇단) — 8분음표 둘을 "한 박 + 반 박"처럼 (2:1) 연주
  if (s.swing) {
    const tw = s.tempoText ? s.tempoText.length * 9 + (s.tempo ? 52 : 0) + 18 : s.tempo ? 70 : 0;
    P.push(svgSwing(L.ML + tw + 4, hy + 7));
  }

  const numOffset = s.measures[0] && s.measures[0].pickup ? 0 : 1;
  // 마디 편집 탭은 여러 마디 쉼표를 펼쳐 보여요 → 묶음을 점선 칸 + "N마디 쉼표"로 알려 줘요
  const mrOf = new Map();
  if (st.mode === 'measure') restRuns(s, ctxs).forEach((e, i) => { for (let j = i; j <= e; j++) mrOf.set(j, { a: i, e }); });

  lay.systems.forEach(sys => {
    const out = pages[sys.page].parts;
    const tops = sys.staffTops, nSt = tops.length;
    const top = tops[0], botAll = sys.staffBottom;
    // 마디 배경 (줄마다: 빈 칸 파랑 / 박자 안 맞음 빨강) · 고른 마디
    sys.idxs.forEach(i => {
      const g = lay.meas[i], c = ctxs[i];
      for (let si = 0; si < nSt; si++) {
        const stt = c.st[si] ? c.st[si].status : c.status, t = tops[si];
        if (stt === 'empty') out.push(`<rect x="${f1(g.x)}" y="${f1(t - 6)}" width="${f1(g.w)}" height="${f1(4 * SP + 12)}" fill="#e6f3fb"/>`);
        else if (stt !== 'ok') out.push(`<rect x="${f1(g.x)}" y="${f1(t - 6)}" width="${f1(g.w)}" height="${f1(4 * SP + 12)}" fill="#fde6e6"/>`);
      }
      if (selM.has(i)) {
        // 빈 마디 커서는 그 줄만, 마디 편집은 모든 줄
        const one = st.mode === 'note' && nSt > 1;
        const ta = one ? tops[st.staff || 0] : top, tb = one ? tops[st.staff || 0] + 4 * SP : botAll;
        out.push(`<rect x="${f1(g.x + 1)}" y="${f1(ta - 14)}" width="${f1(g.w - 2)}" height="${f1(tb - ta + 28)}" rx="3" fill="rgba(37,99,235,.13)" stroke="#2563eb" stroke-width="1.5"/>`);
      }
      if (st.hoverMeasure === i && (st.mode === 'lyric' || st.mode === 'bar' || st.mode === 'measure' || (st.mode === 'note' && !st.write)))
        out.push(`<rect x="${f1(g.x + 1)}" y="${f1(top - 10)}" width="${f1(g.w - 2)}" height="${f1(botAll - top + 20)}" rx="3" fill="rgba(37,99,235,.06)"/>`);
    });
    if (mrOf.size) {
      const done = new Set();
      sys.idxs.forEach(i => {
        const r = mrOf.get(i); if (!r || done.has(r.a)) return;
        done.add(r.a);
        const inSys = sys.idxs.filter(j => j >= r.a && j <= r.e);
        const ga = lay.meas[inSys[0]], gb = lay.meas[inSys[inSys.length - 1]];
        const x1 = ga.x + 2, x2 = gb.x + gb.w - 2, n = r.e - r.a + 1;
        out.push(`<rect x="${f1(x1)}" y="${f1(top - 18)}" width="${f1(x2 - x1)}" height="${f1(botAll - top + 26)}" rx="4" fill="none" stroke="#7c3aed" stroke-width="1.2" stroke-dasharray="4 3"/>`);
        const lbl = typeof LG === 'function' ? LG(`${n}마디 쉼표 (다른 탭에서 한 마디로 보여요)`, `${n}-measure rest (shown as one in other tabs)`, `${n}小節休符 (他のタブで1小節に表示)`) : `${n}마디 쉼표`;
        if (inSys[0] === r.a) out.push(`<text x="${f1(x1 + 4)}" y="${f1(top - 22)}" font-family="sans-serif" font-size="11" font-weight="700" fill="#7c3aed">${lbl}</text>`);
      });
    }
    // 가사 모드: 줄마다 절 칸 (1절·2절…) · 지금 쓰는 절은 파란 띠 · 빈 마디는 점선 칸 (눌러서 그 절·그 마디/줄 가사 쓰기)
    if (st.mode === 'lyric') sys.verses.forEach((v, row) => {
      const yy = lyrRowY(sys, row), cur = v === st.verse;
      const xa = lay.meas[sys.idxs[0]].x, xb = sys.x1;
      if (cur) out.push(`<rect x="${f1(xa)}" y="${f1(yy - 15)}" width="${f1(xb - xa)}" height="20" rx="3" fill="rgba(37,99,235,.10)"/>`);
      const lbl = typeof LG === 'function' ? LG(`${v + 1}절`, `V${v + 1}`, `${v + 1}番`) : `${v + 1}절`;
      out.push(`<text x="${f1(xa - 4)}" y="${f1(yy)}" text-anchor="end" font-family="sans-serif" font-size="11" font-weight="${cur ? 700 : 400}" fill="${cur ? '#2563eb' : '#7c8db5'}">${lbl}</text>`);
      sys.idxs.forEach(i => {
        if ((s.measures[i].lyrics[v] || '').trim()) return;
        const g = lay.meas[i];
        out.push(`<rect x="${f1(g.x + 5)}" y="${f1(yy - 13)}" width="${f1(Math.max(8, g.w - 10))}" height="16" rx="3" fill="none" stroke="${cur ? '#60a5fa' : '#b7c3de'}" stroke-width="1" stroke-dasharray="3 3"/>`);
      });
    });
    // 오선 (줄마다)
    tops.forEach(t => { for (let k = 0; k < 5; k++) out.push(`<line x1="${sys.x0}" y1="${f1(t + k * SP)}" x2="${sys.x1}" y2="${f1(t + k * SP)}" stroke="#222" stroke-width="1"/>`); });
    // 맨 앞 세로줄: 모든 줄을 이어요
    out.push(`<line x1="${sys.x0}" y1="${f1(top)}" x2="${sys.x0}" y2="${f1(botAll)}" stroke="#222" stroke-width="1.4"/>`);
    // 피아노 묶음 = 중괄호
    staffGroups(s).forEach(gp => {
      if (gp.b === gp.a || !s.staves[gp.a].grp) return;
      // 앙상블 = 꺾쇠괄호 · 피아노 = 중괄호
      if (s.staves[gp.a].grp === 'ens') out.push(svgBracket(sys.x0 - 7, tops[gp.a], tops[gp.b] + 4 * SP));
      else out.push(svgBrace(sys.x0 - 5, tops[gp.a], tops[gp.b] + 4 * SP));
    });
    // 악기 이름: 첫 줄은 긴 이름 · 앙상블은 둘째 줄부터 짧은 이름 (줄마다 따로)
    if (sys.indent) {
      const first = sys.li === 0;
      staffGroups(s).forEach(gp => {
        const st0 = s.staves[gp.a];
        if (st0.grp === 'ens') {
          for (let si = gp.a; si <= gp.b; si++) {
            const name = first ? s.staves[si].name : lay.shorts[si]; if (!name) continue;
            out.push(`<text x="${f1(sys.x0 - 14)}" y="${f1(tops[si] + 2 * SP + 5)}" text-anchor="end" font-family="${font}" font-size="${first ? 14 : 13}" fill="#111">${esc(name)}</text>`);
          }
          return;
        }
        const name = first ? st0.name : lay.shorts[gp.a]; if (!name) return;
        const yy = (tops[gp.a] + tops[gp.b] + 4 * SP) / 2 + 5;
        out.push(`<text x="${f1(sys.x0 - (st0.grp && gp.b > gp.a ? 20 : 8))}" y="${f1(yy)}" text-anchor="end" font-family="${font}" font-size="14" fill="#111">${esc(name)}</text>`);
      });
    }
    // 머리: 음자리표, 조표, 박자표 (줄마다)
    const c0 = ctxs[sys.idxs[0]];
    tops.forEach((t, si) => {
      const clef = sys.clefs[si];
      out.push(svgClef(clef, sys.x0 + 4, t));
      let hx = sys.x0 + (sys.clefs.some(clefWide) ? 44 : 38);
      if (c0.key) { out.push(svgKey(c0.key, clef, hx, t)); hx += Math.abs(c0.key) * 9 + 6; }
      if (sys.showTime) out.push(svgTime(c0.num, c0.den, hx + 10, t));
    });
    // 마디 번호
    out.push(`<text x="${sys.x0}" y="${f1(top - 13)}" font-family="${font}" font-size="10" fill="#999">${sys.idxs[0] + numOffset}</text>`);

    sys.idxs.forEach((i, k) => drawMeasure(s, ctxs, lay, sys, i, k, out, { font, selSet, st }));

    // 괄호(volta)
    let run = null;
    const flushRun = () => {
      if (!run) return;
      const a = lay.meas[run.a], b = lay.meas[run.b];
      const yy = top - 34 - (sys.hasForm ? 0 : 0);
      const x1 = a.x + 3, x2 = b.x + b.w - 4;
      out.push(`<path d="M${f1(x1)} ${f1(yy + 12)} V${f1(yy)} H${f1(x2)}${run.v === 1 ? ` V${f1(yy + 12)}` : ''}" fill="none" stroke="#222" stroke-width="1.1"/>` +
        `<text x="${f1(x1 + 4)}" y="${f1(yy + 12)}" font-family="${font}" font-size="12" fill="#111">${run.v}.</text>`);
      run = null;
    };
    sys.idxs.forEach(i => {
      const v = s.measures[i].volta || 0;
      if (run && (v !== run.v)) flushRun();
      if (v) { if (!run) run = { v, a: i, b: i }; else run.b = i; }
    });
    flushRun();

    // 송폼
    sys.idxs.forEach(i => {
      const m = s.measures[i], g = lay.meas[i];
      if (m.form) {
        const w = Math.max(38, m.form.length * 8 + 14);
        const yy = sys.top + 2;
        out.push(`<g><rect x="${f1(g.x + 2)}" y="${f1(yy)}" width="${w}" height="19" rx="4" fill="#1e40af"/><text x="${f1(g.x + 2 + w / 2)}" y="${f1(yy + 14)}" text-anchor="middle" font-family="${font}" font-size="13" fill="#fff">${esc(m.form)}</text></g>`);
      }
    });
    // 코드 모드 점
    if (st.mode === 'chord') {
      sys.idxs.forEach(i => {
        const g = lay.meas[i], c = ctxs[i], m = s.measures[i];
        const beat = isCompound(c) ? 72 : c.beat;
        for (let t = 0; t < c.cap; t += beat) {
          if (m.chords.some(ch => ch.t === t)) continue;
          const active = st.chordEdit && st.chordEdit.mi === i && st.chordEdit.t === t;
          out.push(`<circle cx="${f1(tickX(g, t))}" cy="${f1(top - 22 - (sys.chordDy || 0))}" r="${active ? 4 : 2.6}" fill="${active ? '#2563eb' : '#9aa3b2'}"/>`);
        }
      });
    }
    // 송폼 모드 안내 영역
    if (st.mode === 'form') {
      sys.idxs.forEach(i => {
        const g = lay.meas[i];
        if (!s.measures[i].form) out.push(`<rect x="${f1(g.x + 2)}" y="${f1(sys.top + 2)}" width="44" height="19" rx="4" fill="none" stroke="#9aa3b2" stroke-dasharray="3 2"/><text x="${f1(g.x + 24)}" y="${f1(sys.top + 15)}" text-anchor="middle" font-size="11" font-family="${font}" fill="#9aa3b2">+</text>`);
      });
    }
  });

  // 이음줄·붙임줄
  lay.slurs = [];
  lay.slurEnds = {};     // 이음줄 양 끝 (끌어서 옮길 때 잡는 곳)
  (s.slurs || []).forEach(sl => {
    const a = lay.notes[sl.a], b = lay.notes[sl.b];
    if (!a || !b) return;
    const sel = st.selSlur === sl.id;
    const col = '#222';          // 이음줄·붙임줄은 항상 검정 (고른 것은 뒤에 연한 표시만)
    const segs = [];
    const isTie = sl.type === 'tie';
    // 어느 쪽에 그릴지:
    //  붙임줄 = 기둥 반대쪽(머리 쪽) · 화음 성부(아래 성부)끼리 = 아래 · 두 성부일 때 멜로디 = 위
    //  한 성부: 둘 다 기둥이 위면 아래, 그 밖에는 위
    let under;
    if (isTie) under = !!a.stemUp;
    else if (a.ov && b.ov && !a.merged && !b.merged) under = true;
    else if (a.forceUp === true || b.forceUp === true) under = false;
    else under = !!(a.stemUp && b.stemUp);
    const endY = (gg, isB) => {
      if (isTie) return gg.y + (under ? 7 : -7);
      const hasStem = gg.stemEnd !== undefined && !gg.rest;
      if (!under) return (hasStem && gg.stemUp ? Math.min(gg.yHigh, gg.stemEnd) : gg.yHigh) - 6;
      return (hasStem && gg.stemUp === false ? Math.max(gg.yLow, gg.stemEnd) : gg.yLow) + 6;
    };
    // 기둥 쪽에 붙으면 기둥 끝 근처(x)로
    const endX = (gg, isB) => {
      if (!isTie && gg.stemEnd !== undefined && !gg.rest && ((!under && gg.stemUp) || (under && gg.stemUp === false))) return gg.x + (gg.stemUp ? 5 : -5) + (isB ? -1 : 1);
      return gg.x + (isB ? -3 : 3);
    };
    const ya = endY(a, false), yb = endY(b, true), xa = endX(a, false), xb = endX(b, true);
    if (a.sysObj === b.sysObj) segs.push({ page: a.page, x1: xa, y1: ya, x2: xb, y2: yb });
    else {
      segs.push({ page: a.page, x1: xa, y1: ya, x2: a.sysObj.x1 - 2, y2: ya });
      segs.push({ page: b.page, x1: b.sysObj.x0 + b.sysObj.headerW - 6, y1: yb, x2: xb, y2: yb });
    }
    const ends = lay.slurEnds[sl.id] = { tie: isTie };
    segs.forEach((sg, si0) => {
      let { x1, y1, x2, y2 } = sg;
      if (!isTie) {
        // 끝이 너무 비스듬하지 않게
        if (!under) { const ext = Math.min(y1, y2); y1 = Math.min(y1, ext + 6); y2 = Math.min(y2, ext + 6); }
        else { const ext = Math.max(y1, y2); y1 = Math.max(y1, ext - 6); y2 = Math.max(y2, ext - 6); }
      }
      const dx = x2 - x1;
      const hgt = (isTie ? 5 : Math.min(18, 7 + dx * 0.07)) * (under ? 1 : -1);
      const mx1 = x1 + dx * 0.25, mx2 = x1 + dx * 0.75;
      const d = `M${f1(x1)} ${f1(y1)} C${f1(mx1)} ${f1(y1 + hgt)} ${f1(mx2)} ${f1(y2 + hgt)} ${f1(x2)} ${f1(y2)} C${f1(mx2)} ${f1(y2 + hgt * 0.75)} ${f1(mx1)} ${f1(y1 + hgt * 0.75)} ${f1(x1)} ${f1(y1)}Z`;
      if (sel) pages[sg.page].parts.push(`<path d="${d}" fill="none" stroke="rgba(37,99,235,.28)" stroke-width="7" stroke-linejoin="round"/>`);
      pages[sg.page].parts.push(`<path d="${d}" fill="${col}" stroke="${col}" stroke-width=".6"/>`);
      const pts = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12, u = 1 - t; pts.push([u * u * u * x1 + 3 * u * u * t * mx1 + 3 * u * t * t * mx2 + t * t * t * x2, u * u * u * y1 + 3 * u * u * t * (y1 + hgt) + 3 * u * t * t * (y2 + hgt) + t * t * t * y2]); }
      lay.slurs.push({ id: sl.id, page: sg.page, pts, seg: si0, nseg: segs.length });
      if (si0 === 0) ends.a = { page: sg.page, x: x1, y: y1 };
      if (si0 === segs.length - 1) ends.b = { page: sg.page, x: x2, y: y2 };
    });
    // 고른 이음줄: 양 끝 손잡이 (끌면 그 끝만 옮겨요 · 붙임줄은 통째로만)
    if (sel && !isTie) ['a', 'b'].forEach(k => { const e = ends[k]; if (e) pages[e.page].parts.push(`<circle cx="${f1(e.x)}" cy="${f1(e.y)}" r="${st.slurHandleR || 4}" fill="#fff" stroke="#2563eb" stroke-width="1.6"/>`); });
  });
  // 크레셴도 · 데크레셴도
  drawHairpins(s, lay, st, pages);
  return pages;
}

/** 스윙 표시 ♫ = ♩♪³ (x = 왼쪽, y = 음표 머리 높이) */
function svgSwing(x, y) {
  const head = (cx, cy) => `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="4.2" ry="3" transform="rotate(-20 ${f1(cx)} ${f1(cy)})" fill="#111"/>`;
  const stem = (cx, cy) => `<line x1="${f1(cx + 3.8)}" y1="${f1(cy - 1)}" x2="${f1(cx + 3.8)}" y2="${f1(cy - 19)}" stroke="#111" stroke-width="1.2"/>`;
  let o = '<g class="swing-mark">';
  // 왼쪽: 빔으로 묶은 8분음표 둘
  o += head(x + 4, y) + stem(x + 4, y) + head(x + 16, y) + stem(x + 16, y);
  o += `<rect x="${f1(x + 7.2)}" y="${f1(y - 20)}" width="12.6" height="3.6" fill="#111"/>`;
  // =
  o += `<rect x="${f1(x + 27)}" y="${f1(y - 7)}" width="9" height="1.5" fill="#111"/><rect x="${f1(x + 27)}" y="${f1(y - 3)}" width="9" height="1.5" fill="#111"/>`;
  // 오른쪽: 4분음표 + 8분음표 (셋잇단 3)
  const xa = x + 46, xb = x + 60;
  o += head(xa, y) + stem(xa, y) + head(xb, y) + stem(xb, y);
  o += `<path d="M${f1(xb + 3.8)} ${f1(y - 19)} q6 4 4 11" fill="none" stroke="#111" stroke-width="1.4"/>`;
  const bl = xa - 2, br = xb + 10, cm = (xa + xb) / 2 + 5;
  o += `<path d="M${f1(bl)} ${f1(y - 22)} v-4 H${f1(cm - 5)} M${f1(cm + 5)} ${f1(y - 26)} H${f1(br)} v4" fill="none" stroke="#111" stroke-width="0.9"/>`;
  o += `<text x="${f1(cm)}" y="${f1(y - 23)}" text-anchor="middle" font-family="'Times New Roman',serif" font-style="italic" font-size="11" fill="#111">3</text>`;
  return o + '</g>';
}
/** 줄 묶음: 피아노(같은 grp)는 하나로, 나머지는 따로 → [{a, b}] */
function staffGroups(s) {
  const n = staffCount(s), out = [];
  for (let si = 0; si < n; si++) {
    const grp = s.staves && s.staves[si] && s.staves[si].grp;
    const last = out[out.length - 1];
    if (grp && last && s.staves[last.a].grp === grp) last.b = si; else out.push({ a: si, b: si });
  }
  return out;
}
/** 꺾쇠괄호 (앙상블 묶음): 굵은 세로줄 + 위아래 끝이 오른쪽으로 휘어요 */
function svgBracket(x, y1, y2) {
  return `<rect x="${f1(x - 2)}" y="${f1(y1 - 2)}" width="3.6" height="${f1(y2 - y1 + 4)}" fill="#111"/>` +
    `<path d="M${f1(x - 2)} ${f1(y1 - 2)} C${f1(x + 4)} ${f1(y1 - 3)} ${f1(x + 8)} ${f1(y1 - 6)} ${f1(x + 10)} ${f1(y1 - 9)} C${f1(x + 9)} ${f1(y1 - 4)} ${f1(x + 5)} ${f1(y1)} ${f1(x + 1.6)} ${f1(y1 + 1)}Z" fill="#111"/>` +
    `<path d="M${f1(x - 2)} ${f1(y2 + 2)} C${f1(x + 4)} ${f1(y2 + 3)} ${f1(x + 8)} ${f1(y2 + 6)} ${f1(x + 10)} ${f1(y2 + 9)} C${f1(x + 9)} ${f1(y2 + 4)} ${f1(x + 5)} ${f1(y2)} ${f1(x + 1.6)} ${f1(y2 - 1)}Z" fill="#111"/>`;
}
function svgBrace(x, y1, y2) {
  const h = y2 - y1, m = (y1 + y2) / 2, w = Math.min(10, 4 + h * 0.05);
  return `<path d="M${f1(x)} ${f1(y1)} C${f1(x - w * 1.3)} ${f1(y1 + h * 0.06)} ${f1(x + w * 0.2)} ${f1(m - h * 0.22)} ${f1(x - w)} ${f1(m)} ` +
    `C${f1(x + w * 0.2)} ${f1(m + h * 0.22)} ${f1(x - w * 1.3)} ${f1(y2 - h * 0.06)} ${f1(x)} ${f1(y2)} ` +
    `C${f1(x - w * 0.8)} ${f1(y2 - h * 0.1)} ${f1(x + w * 0.65)} ${f1(m + h * 0.2)} ${f1(x - w * 0.55)} ${f1(m)} ` +
    `C${f1(x + w * 0.65)} ${f1(m - h * 0.2)} ${f1(x - w * 0.8)} ${f1(y1 + h * 0.1)} ${f1(x)} ${f1(y1)}Z" fill="#111"/>`;
}

function drawMeasure(s, ctxs, lay, sys, i, k, out, o) {
  const c = ctxs[i], g = lay.meas[i], SP = L.SP;
  // 여러 마디 쉼: 끝 세로줄은 묶음의 마지막 마디 것
  const m = g.mr ? Object.assign({}, s.measures[i], { end: s.measures[g.mrEnd].end }) : s.measures[i];
  const tops = sys.staffTops, nSt = tops.length;
  const top = tops[0], botAll = sys.staffBottom;
  const { font, st } = o;
  // 마디 중간 조/박자 바꿈 (줄마다)
  tops.forEach((t, si) => {
    let px = g.x + 2;
    if (m.start === 'repeatStart') px += 8;
    if (k > 0 && c.keyChanged) { out.push(svgKeyCancel(c.prevKey, c.key, sys.clefs[si], px, t)); const cancelN = (Math.sign(c.prevKey) !== Math.sign(c.key)) ? Math.abs(c.prevKey) : Math.max(0, Math.abs(c.prevKey) - Math.abs(c.key)); px += (cancelN + Math.abs(c.key)) * 9 + 8; }
    if (k > 0 && c.timeChanged) out.push(svgTime(c.num, c.den, px + 11, t));
  });
  // 세로줄 (피아노 두 줄은 이어서)
  const bx = g.x + g.w;
  const blCol = st.widthEdit ? '#2563eb' : '#222';
  const dots = (x, t) => `<circle cx="${f1(x)}" cy="${f1(t + 1.5 * SP)}" r="2" fill="#222"/><circle cx="${f1(x)}" cy="${f1(t + 2.5 * SP)}" r="2" fill="#222"/>`;
  staffGroups(s).forEach(gp => {
    const ya = tops[gp.a], yb = tops[gp.b] + 4 * SP;
    const allDots = x => { let d = ''; for (let si = gp.a; si <= gp.b; si++) d += dots(x, tops[si]); return d; };
    if (m.end === 'double') out.push(`<line x1="${f1(bx - 4)}" y1="${ya}" x2="${f1(bx - 4)}" y2="${yb}" stroke="${blCol}" stroke-width="1.1"/><line x1="${f1(bx)}" y1="${ya}" x2="${f1(bx)}" y2="${yb}" stroke="${blCol}" stroke-width="1.1"/>`);
    else if (m.end === 'final') out.push(`<line x1="${f1(bx - 7)}" y1="${ya}" x2="${f1(bx - 7)}" y2="${yb}" stroke="${blCol}" stroke-width="1.1"/><rect x="${f1(bx - 4)}" y="${ya}" width="4" height="${f1(yb - ya)}" fill="${blCol}"/>`);
    else if (m.end === 'repeatEnd') out.push(allDots(bx - 12) + `<line x1="${f1(bx - 7)}" y1="${ya}" x2="${f1(bx - 7)}" y2="${yb}" stroke="${blCol}" stroke-width="1.1"/><rect x="${f1(bx - 4)}" y="${ya}" width="4" height="${f1(yb - ya)}" fill="${blCol}"/>`);
    else out.push(`<line x1="${f1(bx)}" y1="${ya}" x2="${f1(bx)}" y2="${yb}" stroke="${blCol}" stroke-width="${st.widthEdit ? 2 : 1.1}"/>`);
    if (m.start === 'repeatStart') { const x = g.x; out.push(`<rect x="${f1(x)}" y="${ya}" width="4" height="${f1(yb - ya)}" fill="#222"/><line x1="${f1(x + 7)}" y1="${ya}" x2="${f1(x + 7)}" y2="${yb}" stroke="#222" stroke-width="1.1"/>` + allDots(x + 12)); }
  });
  if (st.selBar === i) out.push(`<rect x="${f1(bx - 3)}" y="${f1(top - 4)}" width="6" height="${f1(botAll - top + 8)}" fill="rgba(37,99,235,.35)"/>`);
  // 기호 (Segno, Coda, D.S. …) · 코드 — 맨 윗줄 위
  (m.marks || []).forEach(mk => {
    const yy = top - 24 - (sys.chordDy || 0) - (sys.hasChords ? 18 : 0);   // 코드 이름이 있으면 그 위 줄에
    if (mk === 'segno' || mk === 'coda') out.push(`<text x="${f1(g.x + 4)}" y="${f1(yy + 4)}" font-family="${MUSIC_FONT}" font-size="24" fill="#111">${MARK_LABEL[mk]}</text>`);
    else out.push(`<text x="${f1(bx - 4)}" y="${f1(yy)}" text-anchor="end" font-family="${font}" font-style="italic" font-size="14" fill="#111">${esc(MARK_LABEL[mk])}</text>`);
  });
  m.chords.forEach(ch => {
    const sel = st.chordEdit && st.chordEdit.mi === i && st.chordEdit.t === ch.t;
    out.push(`<text class="chd" x="${f1(tickX(g, ch.t) - 3)}" y="${f1(top - 15 - (sys.chordDy || 0))}" font-family="${font}" font-size="16" font-weight="700" fill="${sel ? '#2563eb' : '#111'}">${esc(prettyChord(ch.name))}</text>`);
  });

  // 음표 (줄마다)
  g.notesGeo = [];
  g.geoSt = [];
  if (g.mr) {
    // 여러 마디 쉼표: 마디 가운데 온쉼표 (넷째 줄에 매달린 네모) + 위에 쉬는 마디 수
    const cx = g.cx + g.cw / 2;
    tops.forEach(t => {
      out.push(`<g class="mrest"><rect x="${f1(cx - 6.5)}" y="${f1(t + SP)}" width="13" height="${f1(SP / 2 + 0.5)}" fill="#111"/>` +
        `<text x="${f1(cx)}" y="${f1(t - 7)}" text-anchor="middle" font-family="'Times New Roman',serif" font-size="19" font-weight="700" fill="#111">${g.mr}</text></g>`);
      g.geoSt.push([]);
    });
    return;
  }
  for (let si = 0; si < nSt; si++) {
    const geos = drawStaffNotes(s, c, g, sys, i, si, out, o, lay);
    g.geoSt.push(geos);
    g.notesGeo = g.notesGeo.concat(geos);
  }

  // 화음 탭: 화음 넣을 자리 표시
  if (st.mode === 'harm' && st.hc && st.hc.mi === i) {
    const t0 = sys.staffTops[st.hc.si] || top, x = tickX(g, st.hc.t) + 4;
    out.push(`<rect x="${f1(x - 9)}" y="${f1(t0 - 12)}" width="18" height="${f1(4 * SP + 24)}" rx="4" fill="rgba(37,99,235,.14)" stroke="#2563eb" stroke-width="1.4" stroke-dasharray="3 2"/>` +
      `<path d="M${f1(x - 5)} ${f1(t0 - 18)} l5 6 l5 -6 z" fill="#2563eb"/>`);
  }
  // 재생 시작점
  if (st.playStart && st.playStart.m === i && (st.playStart.t > 0 || i > 0)) {
    const x = tickX(g, st.playStart.t) - 2;
    out.push(`<path d="M${f1(x)} ${f1(top - 8)} l7 -4 l-7 -4 z" fill="#16a34a"/><line x1="${f1(x)}" y1="${f1(top - 16)}" x2="${f1(x)}" y2="${f1(botAll + 4)}" stroke="#16a34a" stroke-width="1.4" opacity=".7"/>`);
  }

  // 가사 (첫 줄 아래)
  const bot = top + 4 * SP;
  const sylTargets = g.geoSt[0].filter(gg => !gg.ov && lyrSlot(gg.n, lay.tied.noSyl));   // 쉼표도 한 자리
  sys.verses.forEach((v, row) => {
    const syl = parseLyrics(m.lyrics[v]);
    if (!syl.length) return;
    const yy = lyrRowY(sys, row);
    let lastX = null, lastW = 0;
    syl.forEach((sy, kk) => {
      const tg = sylTargets[kk];
      let x, red = false;
      if (tg) x = tg.x;
      else { red = true; x = (lastX !== null ? lastX + Math.max(18, lastW + 8) : g.cx + 6); }
      if (sy === '_') {
        if (lastX !== null) out.push(`<line x1="${f1(lastX + lastW / 2 + 2)}" y1="${f1(yy + 2)}" x2="${f1(x + 6)}" y2="${f1(yy + 2)}" stroke="#333" stroke-width="1"/>`);
        lastX = x; lastW = 0; return;
      }
      if (!sy) { lastX = x; lastW = 0; return; }   // 띄어쓰기로 비운 음
      const w = sy.length * (HANGUL.test(sy) ? 13 : 7.5);
      const prefix = (kk === 0 && (s.lyricLines > 1) && (i === 0 || !(s.measures[i - 1].lyrics[v] || '').trim())) ? `${v + 1}. ` : '';
      out.push(`<text x="${f1(x)}" y="${f1(yy)}" text-anchor="middle" font-family="${font}" font-size="14" fill="${red ? '#dc2626' : '#111'}" data-syl="${i}:${v}:${kk}">${esc(sy)}</text>`);
      // 가사 모드: 한 음에 묶은 여러 글자([크리스])는 아래에 파란 ⌣ 표시 (인쇄에는 안 나와요)
      if (st.mode === 'lyric' && sy.length > 1 && HANGUL.test(sy)) out.push(`<path d="M${f1(x - w / 2 + 1)} ${f1(yy + 4)} Q${f1(x)} ${f1(yy + 10)} ${f1(x + w / 2 - 1)} ${f1(yy + 4)}" fill="none" stroke="#2563eb" stroke-width="1.3" stroke-linecap="round"/>`);
      if (prefix) out.push(`<text x="${f1(x - w / 2 - 3)}" y="${f1(yy)}" text-anchor="end" font-family="${font}" font-size="13" fill="#111">${prefix}</text>`);
      lay.lyr.push({ mi: i, v, k: kk, x, y: yy, w, page: sys.page });
      lastX = x; lastW = w;
    });
  });
}

/** 한 줄(오선)의 음표 그리기 — 화음(여러 머리)까지 */
function drawStaffNotes(s, c, g, sys, i, si, out, o, lay) {
  const m = s.measures[i], SP = L.SP;
  const top = sys.staffTops[si], clef = sys.clefs[si];
  const notes = SNr(m, si), starts = g.startsSt[si];
  const { font, selSet, st } = o;
  const accState = {};
  const notesGeo = [];
  const full = notes.length === 1 && notes[0].rest && (notes[0].full || noteTicks(notes[0], c.cap) === c.cap);
  const ovs = OVr(m, si);
  const items = notes.map((n, ni) => ({ n, ni, t: starts[ni], ov: false })).concat(ovs.map((n, oi) => ({ n, ni: oi, t: n.t || 0, ov: true })));
  items.forEach(({ n, ni, t, ov }) => {
    let x = tickX(g, t) + 4;
    if (full && !ov) x = g.x + g.w / 2;
    const sel = selSet.has(n.id);
    const col = sel ? '#2563eb' : '#111';
    const geo = { id: n.id, x, mi: i, ni, si, page: sys.page, sysObj: sys, sel, col, n, t, staffTop: top, ov };
    if (n.rest || !n.p) {
      geo.y = top + 2 * SP; geo.pos = 4; geo.rest = true; geo.yLow = geo.yHigh = geo.y;
    } else {
      const heads = notePitches(n).map((p, k) => ({ p, k: k - 1, pos: posOf(p, clef) }));
      heads.forEach(h => {
        h.y = yOf(top, h.pos);
        const step = mod(h.p.d, 7);
        const expect = (h.p.d in accState) ? accState[h.p.d] : keyAlter(c.key, step);
        if (h.p.a !== expect && !lay.tied.into.has(n.id)) { h.acc = h.p.a; accState[h.p.d] = h.p.a; }
      });
      heads.sort((a, b) => a.pos - b.pos);
      geo.heads = heads;
      geo.pos = posOf(n.p, clef); geo.y = yOf(top, geo.pos);
      geo.minPos = heads[0].pos; geo.maxPos = heads[heads.length - 1].pos;
      geo.yLow = heads[0].y; geo.yHigh = heads[heads.length - 1].y;
      geo.midPos = (geo.minPos + geo.maxPos) / 2;
    }
    notesGeo.push(geo);
    lay.notes[n.id] = geo;
  });
  // ── 두 성부 (멜로디 + 화음 성부) ──
  // 화음 성부 음이 멜로디 음과 같은 박·같은 길이면 한 기둥 화음으로 합쳐 그려요
  notesGeo.filter(o => o.ov && !o.rest).forEach(o => {
    const mg = notesGeo.find(q => !q.ov && !q.rest && q.t === o.t && noteTicks(q.n, c.cap) === noteTicks(o.n, c.cap) && !q.n.ph && !o.n.ph);
    if (!mg) return;
    o.merged = true; o.mainGeo = mg; o.x = mg.x;
    o.heads.forEach(h => mg.heads.push(Object.assign({}, h, { ovId: o.id })));
    mg.heads.sort((p, q) => p.pos - q.pos);
    mg.minPos = mg.heads[0].pos; mg.maxPos = mg.heads[mg.heads.length - 1].pos;
    mg.yLow = mg.heads[0].y; mg.yHigh = mg.heads[mg.heads.length - 1].y; mg.midPos = (mg.minPos + mg.maxPos) / 2;
  });
  // 리듬이 다른 화음 성부가 있으면: 멜로디 기둥은 위로, 화음 성부 기둥은 아래로 (실제 악보처럼)
  const sep = notesGeo.filter(o => o.ov && !o.rest && !o.merged);
  // 화음 성부 쉼표만 있어도 두 성부로 (쉼표는 아래, 멜로디 기둥은 위)
  if (sep.length || notesGeo.some(o => o.ov && o.rest)) {
    notesGeo.forEach(q => { if (!q.rest) q.forceUp = !q.ov; });
    // 같은 박에서 머리가 붙으면(2도·같은 음) 화음 성부를 옆으로
    sep.forEach(o => {
      const mg = notesGeo.find(q => !q.ov && !q.rest && q.t === o.t);
      if (mg && mg.heads.some(h => o.heads.some(q => Math.abs(h.pos - q.pos) <= 1))) o.x += 11;
    });
  }
  // 빔 묶기 (성부마다 따로: 멜로디끼리, 화음 성부끼리)
  const groupLen = isCompound(c) ? 72 : 48;
  const groups = [];
  const beamVoice = list => {
    let cur = [];
    const flush = () => { if (cur.length >= 2) groups.push(cur); cur = []; };
    list.forEach(gg => {
      const n = gg.n;
      const beamable = !gg.rest && !n.ph && (n.dur === 'e' || n.dur === 's') && !n.full;
      const gi = Math.floor(gg.t / groupLen);
      // 쉼표·긴 음이 끼면 끊고, 박이 바뀌면 끊고, 사이가 떨어져 있으면(화음 성부 빈칸) 끊어요
      const contiguous = cur.length && (cur[cur.length - 1].t + noteTicks(cur[cur.length - 1].n, c.cap) === gg.t);
      if (beamable) {
        if (cur.length && Math.floor(cur[0].t / groupLen) === gi && contiguous) cur.push(gg);
        else { flush(); cur.push(gg); }
      } else flush();
    });
    flush();
  };
  beamVoice(notesGeo.filter(gg => !gg.ov));
  beamVoice(notesGeo.filter(gg => gg.ov && !gg.merged).sort((p, q) => p.t - q.t));
  groups.forEach(gr => gr.forEach(gg => gg.beam = gr));

  const ledger = (x0, x1, pos) => {
    let o2 = '';
    for (let p = -2; p >= pos; p -= 2) o2 += `<line x1="${f1(x0)}" y1="${f1(yOf(top, p))}" x2="${f1(x1)}" y2="${f1(yOf(top, p))}" stroke="#222" stroke-width="1.1"/>`;
    for (let p = 10; p <= pos; p += 2) o2 += `<line x1="${f1(x0)}" y1="${f1(yOf(top, p))}" x2="${f1(x1)}" y2="${f1(yOf(top, p))}" stroke="#222" stroke-width="1.1"/>`;
    return o2;
  };

  // 개별 음표 그리기
  notesGeo.forEach(gg => {
    if (gg.merged) return;          // 멜로디 화음 안에 같이 그려져요
    const n = gg.n, col = gg.col;
    const headCol = (k, h) => (h && h.ovId) ? (selSet.has(h.ovId) ? '#2563eb' : (gg.sel ? '#111' : '#111'))
      : (st.head && st.head.id === n.id) ? (k === st.head.k ? '#2563eb' : '#111') : col;
    let o2 = `<g data-id="${n.id}" class="note${gg.sel ? ' sel' : ''}">`;
    if (gg.rest && n.ph) {
      o2 += `<circle cx="${f1(gg.x)}" cy="${f1(top + 2 * SP)}" r="2.6" fill="${col}"/>`;
    } else if (gg.rest) {
      // 두 성부일 때: 멜로디 쉼표가 같은 때 울리는 화음 성부 음과 겹치면 겹치지 않는 높이까지 올려요
      let dy = 0;
      if (!gg.ov && sep.length) {
        const d = noteTicks(n, c.cap);
        const hi = Math.max(-99, ...notesGeo.filter(q => q.ov && !q.rest && q.heads && q.t < gg.t + d && q.t + noteTicks(q.n, c.cap) > gg.t).map(q => q.maxPos));
        const low = { w: 6, h: 4, q: 1, e: 2, s: 0 }[n.full ? 'w' : n.dur];
        if (hi > -99 && hi + 2 > low) dy = Math.ceil((hi + 2 - low) / 2) * SP;
      } else if (gg.ov) {
        // 화음 성부 쉼표: 같은 때 울리는 멜로디 음 아래로 내려요
        const d = noteTicks(n, c.cap);
        const lo = Math.min(99, ...notesGeo.filter(q => !q.ov && !q.rest && q.heads && q.t < gg.t + d && q.t + noteTicks(q.n, c.cap) > gg.t).map(q => q.minPos));
        const high = { w: 7, h: 5, q: 7, e: 6, s: 6 }[n.full ? 'w' : n.dur];
        if (lo < 99 && high + 2 > lo) dy = -Math.ceil((high + 2 - lo) / 2) * SP;
      }
      gg.restDy = dy;
      o2 += svgRest(n.full ? 'w' : n.dur, gg.x, top - dy, col);
      if (n.dots && !n.full) o2 += `<circle cx="${f1(gg.x + 9)}" cy="${f1(top - dy + 1.5 * SP)}" r="1.7" fill="${col}"/>`;
    } else {
      const x = gg.x;
      // 기둥 방향
      let up;
      if (gg.forceUp !== undefined) up = gg.forceUp;
      else if (gg.beam) up = gg.beam.reduce((a, b) => a + b.midPos, 0) / gg.beam.length < 4;
      else up = gg.midPos < 4;
      if (n.ph || n.dur === 'w') up = false;
      gg.stemUp = (n.ph || n.dur === 'w') ? false : up;
      // 2도 화음: 머리를 기둥 반대편으로
      const hs = gg.heads;
      hs.forEach(h => h.shift = 0);
      if (up) { for (let q = 1; q < hs.length; q++) if (hs[q].pos - hs[q - 1].pos === 1 && !hs[q - 1].shift) hs[q].shift = 1; }
      else { for (let q = hs.length - 2; q >= 0; q--) if (hs[q + 1].pos - hs[q].pos === 1 && !hs[q + 1].shift) hs[q].shift = -1; }
      const anyR = hs.some(h => h.shift > 0), anyL = hs.some(h => h.shift < 0);
      // 덧줄
      o2 += ledger(x - 9 - (anyL ? 10.6 : 0), x + 9 + (anyR ? 10.6 : 0), gg.minPos);
      if (gg.maxPos >= 10) o2 += ledger(x - 9 - (anyL ? 10.6 : 0), x + 9 + (anyR ? 10.6 : 0), gg.maxPos);
      // 머리
      const clap = isClap(n);
      hs.forEach(h => {
        const hx = x + h.shift * 10.6, y = h.y, hc = headCol(h.k, h);
        // 박자치기: X 머리 (2분·온음표는 X 둘레에 동그라미)
        if (clap && !n.ph) {
          o2 += `<path d="M${f1(hx - 4.6)} ${f1(y - 4)} L${f1(hx + 4.6)} ${f1(y + 4)} M${f1(hx - 4.6)} ${f1(y + 4)} L${f1(hx + 4.6)} ${f1(y - 4)}" stroke="${hc}" stroke-width="1.8" stroke-linecap="round"/>`;
          if (n.dur === 'w' || n.dur === 'h') o2 += `<circle cx="${f1(hx)}" cy="${f1(y)}" r="6.6" fill="none" stroke="${hc}" stroke-width="1.2"/>`;
        }
        else if (n.ph) o2 +=`<ellipse cx="${f1(hx)}" cy="${f1(y)}" rx="5.6" ry="3.9" transform="rotate(-22 ${f1(hx)} ${f1(y)})" fill="${hc}"/>`;
        else if (n.dur === 'w') o2 += `<ellipse cx="${f1(hx)}" cy="${f1(y)}" rx="6.4" ry="4.3" fill="none" stroke="${hc}" stroke-width="2.2"/>`;
        // 2분음표(점2분 포함) 머리는 속이 빈 테두리만 — 오선·덧줄이 머리 안을 지나가는 게 보이게 (흰색으로 메우면 줄이 끊겨 보여요)
        else if (n.dur === 'h') o2 += `<ellipse cx="${f1(hx)}" cy="${f1(y)}" rx="5.5" ry="3.7" transform="rotate(-22 ${f1(hx)} ${f1(y)})" fill="none" stroke="${hc}" stroke-width="1.7"/>`;
        else o2 += `<ellipse cx="${f1(hx)}" cy="${f1(y)}" rx="5.6" ry="3.9" transform="rotate(-22 ${f1(hx)} ${f1(y)})" fill="${hc}"/>`;
        if (n.dots && !n.ph) o2 += `<circle cx="${f1(x + 10 + (anyR ? 10.6 : 0))}" cy="${f1(h.pos % 2 === 0 ? y - SP / 2 : y)}" r="1.7" fill="${hc}"/>`;
      });
      // 임시표: 겹치면 왼쪽으로 한 칸씩
      const accs = hs.filter(h => h.acc !== undefined).sort((a, b) => b.pos - a.pos);
      const cols = [];
      accs.forEach(h => {
        let cIdx = 0;
        while (cols[cIdx] !== undefined && cols[cIdx] - h.pos < 6) cIdx++;
        cols[cIdx] = h.pos;
        o2 += svgAcc(h.acc, x - 14 - (anyL ? 10.6 : 0) - cIdx * 9, h.y, headCol(h.k, h));
      });
      // 꾸밈음 (앞꾸밈음): 원래 음표(임시표 포함) 왼쪽에 작은 8분음표 · 하나면 빗금 · 여럿이면 16분 빔
      if (n.gr && n.gr.length) {
        const gs = n.gr.map((p, g) => ({ p, k: -2 - g, pos: posOf(p, clef) }));
        let gx = x - 13 - (anyL ? 10.6 : 0) - (accs.length ? cols.length * 9 + 3 : 0);
        // 뒤 꾸밈음부터 왼쪽으로 놓아요
        const xs = [];
        for (let g = gs.length - 1; g >= 0; g--) {
          const gh = gs[g];
          const expect = keyAlter(c.key, mod(gh.p.d, 7));
          gh.acc = gh.p.a !== expect ? gh.p.a : undefined;
          xs[g] = gx; gx -= 9 + (gh.acc !== undefined ? 7 : 0);
        }
        const stemTop = Math.min(...gs.map(gh => yOf(top, gh.pos))) - 17;
        gg.graceHeads = [];
        gs.forEach((gh, g) => {
          const hx = xs[g], y = yOf(top, gh.pos), hc = (st.head && st.head.id === n.id && st.head.k === gh.k) ? '#2563eb' : col;
          gg.graceHeads.push({ x: hx, y, k: gh.k });
          // 덧줄 (짧게)
          for (let p = -2; p >= gh.pos; p -= 2) o2 += `<line x1="${f1(hx - 6)}" y1="${f1(yOf(top, p))}" x2="${f1(hx + 6)}" y2="${f1(yOf(top, p))}" stroke="#222" stroke-width="1"/>`;
          for (let p = 10; p <= gh.pos; p += 2) o2 += `<line x1="${f1(hx - 6)}" y1="${f1(yOf(top, p))}" x2="${f1(hx + 6)}" y2="${f1(yOf(top, p))}" stroke="#222" stroke-width="1"/>`;
          o2 += `<ellipse cx="${f1(hx)}" cy="${f1(y)}" rx="3.9" ry="2.8" transform="rotate(-22 ${f1(hx)} ${f1(y)})" fill="${hc}"/>`;
          if (gh.acc !== undefined) o2 += `<g transform="translate(${f1(hx - 8)} ${f1(y)}) scale(.68) translate(${f1(-(hx - 8))} ${f1(-y)})">${svgAcc(gh.acc, hx - 8, y, hc)}</g>`;
          const sx = hx + 3.6, sTop = gs.length > 1 ? stemTop : y - 17;
          o2 += `<line x1="${f1(sx)}" y1="${f1(y)}" x2="${f1(sx)}" y2="${f1(sTop)}" stroke="${col}" stroke-width="1"/>`;
          if (gs.length === 1) {
            o2 += `<g transform="translate(${f1(sx)} ${f1(sTop)}) scale(.62) translate(${f1(-sx)} ${f1(-sTop)})">${svgFlag(sx, sTop, true, col, 1)}</g>`;
            o2 += `<line x1="${f1(sx - 4)}" y1="${f1(sTop + 11)}" x2="${f1(sx + 5)}" y2="${f1(sTop + 4)}" stroke="${col}" stroke-width="1.1"/>`;   // 빗금
          }
        });
        if (gs.length > 1) {
          const xa = xs[0] + 3.6, xb = xs[gs.length - 1] + 3.6;
          o2 += `<rect x="${f1(xa)}" y="${f1(stemTop)}" width="${f1(xb - xa)}" height="2.6" fill="${col}"/><rect x="${f1(xa)}" y="${f1(stemTop + 4.6)}" width="${f1(xb - xa)}" height="2.6" fill="${col}"/>`;
        }
        // 꾸밈음에서 원래 음으로 작은 이음줄
        const g0 = gs[gs.length - 1], gy = yOf(top, g0.pos);
        const ya = Math.max(gy, gg.yLow) + 5, xa = xs[gs.length - 1] + 1, xb = x - 4;
        if (xb > xa + 2) o2 += `<path d="M${f1(xa)} ${f1(ya)} Q${f1((xa + xb) / 2)} ${f1(ya + 5)} ${f1(xb)} ${f1(ya)}" fill="none" stroke="${col}" stroke-width="1"/>`;
      }
      // 기둥 · 꼬리
      if (!n.ph && n.dur !== 'w' && !gg.beam) {
        const sx = up ? x + 5.1 : x - 5.1;
        const ey = up ? Math.min(gg.yHigh - 3.5 * SP, yOf(top, 4)) : Math.max(gg.yLow + 3.5 * SP, yOf(top, 4));
        o2 += `<line x1="${f1(sx)}" y1="${f1(up ? gg.yLow : gg.yHigh)}" x2="${f1(sx)}" y2="${f1(ey)}" stroke="${col}" stroke-width="1.2"/>`;
        gg.stemEnd = ey;
        if (n.dur === 'e' || n.dur === 's') o2 += svgFlag(sx, ey, up, col, n.dur === 's' ? 2 : 1);
      }
      // 꾸밈
      artMarks(n).forEach((a, ai) => {
        const yy = a === 'fermata' ? Math.min(top, gg.yHigh) - 10 - ai * 8 : (gg.stemUp ? gg.yLow + 11 + ai * 8 : gg.yHigh - 11 - ai * 8);
        if (a === 'staccato') o2 += `<circle cx="${f1(x)}" cy="${f1(yy)}" r="1.7" fill="${col}"/>`;
        else if (a === 'tenuto') o2 += `<line x1="${f1(x - 5)}" y1="${f1(yy)}" x2="${f1(x + 5)}" y2="${f1(yy)}" stroke="${col}" stroke-width="1.6"/>`;
        else if (a === 'accent') o2 += `<path d="M${f1(x - 5)} ${f1(yy - 3.5)} L${f1(x + 5)} ${f1(yy)} L${f1(x - 5)} ${f1(yy + 3.5)}" fill="none" stroke="${col}" stroke-width="1.3"/>`;
        else if (a === 'marcato') o2 += `<path d="M${f1(x - 4.5)} ${f1(yy + 3)} L${f1(x)} ${f1(yy - 5)} L${f1(x + 4.5)} ${f1(yy + 3)}" fill="none" stroke="${col}" stroke-width="1.8"/>`;
        else if (a === 'fermata') o2 += `<path d="M${f1(x - 8)} ${f1(yy)} A8 7 0 0 1 ${f1(x + 8)} ${f1(yy)}" fill="none" stroke="${col}" stroke-width="1.5"/><circle cx="${f1(x)}" cy="${f1(yy - 2)}" r="1.6" fill="${col}"/>`;
      });
    }
    const rowDy = si === 0 ? (sys.chordDy || 0) : 0;
    if (n.dyn) o2 += svgDyn(n.dyn, gg.x - 6, top - 26 - rowDy, col);
    if (n.text) o2 += `<text x="${f1(gg.x - 6 + (n.dyn ? dynW(n.dyn) + 6 : 0))}" y="${f1(top - 26 - rowDy)}" font-family="${font}" font-style="italic" font-size="14" fill="${col}">${esc(n.text)}</text>`;
    o2 += '</g>';
    out.push(o2);
  });

  // 빔 그리기
  groups.forEach(gr => {
    const up = gr[0].stemUp;
    const col = gr.some(x => x.sel) ? '#2563eb' : '#111';
    const sx = gr.map(gg => up ? gg.x + 5.1 : gg.x - 5.1);
    const nat = gr.map(gg => up ? gg.yHigh - 3.5 * SP : gg.yLow + 3.5 * SP);
    const x1 = sx[0], x2 = sx[sx.length - 1];
    let dy = nat[nat.length - 1] - nat[0];
    dy = Math.max(-SP, Math.min(SP, dy));
    const slope = (x2 - x1) ? dy / (x2 - x1) : 0;
    let b0 = up ? Math.min(...nat.map((v, q) => v - slope * (sx[q] - x1))) : Math.max(...nat.map((v, q) => v - slope * (sx[q] - x1)));
    const midY = yOf(top, 4);
    if (up && b0 > midY) b0 = midY; if (!up && b0 < midY) b0 = midY;
    const by = xx => b0 + slope * (xx - x1);
    let o3 = '';
    gr.forEach((gg, q) => { o3 += `<line x1="${f1(sx[q])}" y1="${f1(up ? gg.yLow : gg.yHigh)}" x2="${f1(sx[q])}" y2="${f1(by(sx[q]))}" stroke="${gg.col}" stroke-width="1.2"/>`; gg.stemEnd = by(sx[q]); });
    const th = 4.6, dir = up ? 1 : -1;
    const beamPoly = (xa, xb, off) => `<polygon points="${f1(xa)},${f1(by(xa) + off * dir)} ${f1(xb)},${f1(by(xb) + off * dir)} ${f1(xb)},${f1(by(xb) + (off + th) * dir)} ${f1(xa)},${f1(by(xa) + (off + th) * dir)}" fill="${col}"/>`;
    o3 += beamPoly(x1 - 0.6, x2 + 0.6, 0);
    gr.forEach((gg, q) => {
      if (gg.n.dur !== 's') return;
      const prev = gr[q - 1], next = gr[q + 1];
      if (next && next.n.dur === 's') o3 += beamPoly(sx[q] - 0.6, sx[q + 1] + 0.6, 7.5);
      else if (!(prev && prev.n.dur === 's')) {
        if (next) o3 += beamPoly(sx[q], sx[q] + 9, 7.5); else o3 += beamPoly(sx[q] - 9, sx[q], 7.5);
      }
    });
    out.push(o3);
  });
  // 계이름 (켠 줄만): 오선 아래에, 화음이면 높은 음부터 아래로 쌓아요
  if (sys.solH && sys.solH[si]) {
    const style = (s.solfa && s.solfa.style) || 'ko';
    const solFont = (o.font || 'sans-serif');
    const bot = top + 4 * SP;
    // 음표마다 가장 아래 끝(머리·덧줄·아래로 내린 기둥·빔) 밑에 적어요 · 빔으로 묶인 음표는 같은 높이로
    const lowOf = gg => {
      let y = Math.max(bot, gg.yLow + 5);
      if (gg.stemUp === false && gg.stemEnd !== undefined) y = Math.max(y, gg.stemEnd + (gg.n.dur === 's' ? 9 : 5));
      // 머리 아래 꾸밈(스타카토·테누토·악센트)과 겹치지 않게 그 밑으로
      const arts = artMarks(gg.n).filter(a => a !== 'fermata').length;
      if (gg.stemUp && arts) y =Math.max(y, gg.yLow + 11 + (arts - 1) * 8 + 5);
      return y;
    };
    // 한 마디 안에서는 같은 높이에 적어요 → 옆 음표의 아래 기둥·꼬리·꾸밈과 부딪치지 않아요
    let rowLow = bot;
    notesGeo.forEach(gg => { if (!gg.rest && !gg.merged && gg.heads) rowLow = Math.max(rowLow, lowOf(gg)); });
    // 같은 박에 시작하는 음(멜로디 + 리듬이 다른 화음 성부)은 한 덩어리로 높은 음부터 아래로 쌓아요
    const byT = new Map();
    notesGeo.forEach(gg => {
      if (gg.rest || gg.merged || !gg.heads) return;
      if (!byT.has(gg.t)) byT.set(gg.t, []);
      gg.heads.forEach(h => byT.get(gg.t).push({ gg, h }));
    });
    const y0 = rowLow + 13;
    byT.forEach(list => {
      list.sort((a, b) => b.h.pos - a.h.pos || (a.gg.ov ? 1 : 0) - (b.gg.ov ? 1 : 0));
      const x = Math.min(...list.map(it => it.gg.x));
      list.forEach(({ gg, h }, k) => {
        const sel = h.ovId ? selSet.has(h.ovId) : gg.sel;
        out.push(`<text class="sol" x="${f1(x)}" y="${f1(y0 + k * 14)}" text-anchor="middle" font-family="${solFont}" font-size="12.5" fill="${sel ? '#2563eb' : '#334155'}">${esc(solfaName(h.p, style))}</text>`);
      });
    });
  }
  // 합쳐 그린 화음 성부 음은 멜로디 음의 기둥 정보를 그대로 (이음줄 위치용)
  notesGeo.forEach(o => { if (o.merged) { o.stemUp = o.mainGeo.stemUp; o.stemEnd = o.mainGeo.stemEnd; o.yHigh = o.mainGeo.yHigh; o.yLow = o.mainGeo.yLow; } });
  // 셋잇단 표시
  let tri = [];
  const flushTri = () => {
    if (!tri.length) return;
    const xa = tri[0].x, xb = tri[tri.length - 1].x;
    const upT = tri[0].stemUp !== false;
    const yy = upT ? Math.min(...tri.map(gg => Math.min(gg.yHigh, gg.stemEnd !== undefined ? gg.stemEnd : gg.yHigh))) - 6
      : Math.max(...tri.map(gg => Math.max(gg.yLow, gg.stemEnd || gg.yLow))) + 14;
    out.push(`<text x="${f1((xa + xb) / 2 + (upT ? 3 : -3))}" y="${f1(yy)}" text-anchor="middle" font-family="'Times New Roman',serif" font-style="italic" font-weight="700" font-size="12" fill="#111">3</text>`);
    tri = [];
  };
  let triAcc = 0, triSpan = 0;
  notesGeo.filter(gg => !gg.ov).forEach(gg => {
    if (!gg.n.tri) { flushTri(); triAcc = 0; return; }
    if (!tri.length) { triSpan = DUR_T[gg.n.dur] * 2; triAcc = 0; }
    tri.push(gg); triAcc += noteTicks(gg.n, c.cap);
    if (triAcc >= triSpan) { flushTri(); triAcc = 0; }
  });
  flushTri();
  return notesGeo;
}
