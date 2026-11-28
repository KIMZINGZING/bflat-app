'use strict';
/* ===== BFlat Studio — 파일 (저장·열기·MusicXML·MIDI) ===== */

/** 파이썬 데스크톱 앱(pywebview) 안에서 돌고 있으면 그 API */
function Native() { return (window.pywebview && window.pywebview.api) || null; }
function blobToB64(blob) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
}
function b64ToFile(o) {
  const bin = atob(o.b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new File([u], o.name);
}
async function downloadBlob(blob, name, kind) {
  // 안드로이드 앱: 파일 저장 창(어디에 저장할지 고르기)으로 · 결과는 window.__bflatSaved 로 알려 줘요
  if (window.AndroidBridge) {
    const done = new Promise(res => { window.__bflatSaved = ok => { res(ok); window.__bflatSaved = null; }; });
    window.AndroidBridge.saveFile(name, blob.type || 'application/octet-stream', await blobToB64(blob));
    const ok = await done;
    if (ok && typeof toast === 'function') toast((typeof LG === 'function' ? LG('저장했어요 — ', 'Saved — ', '保存しました — ') : '저장했어요 — ') + name);
    return ok ? { name } : null;
  }
  const api = Native();
  if (api) {
    const res = await api.save_as(name, await blobToB64(blob), kind || 'any');
    if (res && typeof toast === 'function') toast(`저장했어요 — ${res.name}`);
    return res;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function safeName(s) { return (s.title || '악보').replace(/[\\/:*?"<>|]/g, '_'); }

/* ---------- MusicXML 내보내기 ---------- */
const XML_TYPE = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: '16th' };
const KIND_MAP = [
  [/^(maj7|M7|Δ7?)$/, 'major-seventh'], [/^(m7b5|m7♭5|ø)$/, 'half-diminished'], [/^(dim7|°7)$/, 'diminished-seventh'],
  [/^(m7|min7|-7)$/, 'minor-seventh'], [/^(m|min|-)$/, 'minor'], [/^(dim|°)$/, 'diminished'], [/^(aug|\+)$/, 'augmented'],
  [/^7$/, 'dominant'], [/^9$/, 'dominant-ninth'], [/^6$/, 'major-sixth'], [/^m6$/, 'minor-sixth'], [/^(sus4|sus)$/, 'suspended-fourth'],
  [/^sus2$/, 'suspended-second'], [/^(mM7|m\(maj7\))$/, 'major-minor'], [/^$/, 'major']];
function chordXml(name, offset) {
  const c = parseChord(name);
  if (!c) return '';
  const kind = (KIND_MAP.find(([re]) => re.test(c.q)) || [0, 'major'])[1];
  let x = `<harmony><root><root-step>${STEPS[c.step]}</root-step>${c.alt ? `<root-alter>${c.alt}</root-alter>` : ''}</root><kind text="${esc(c.q)}">${kind}</kind>`;
  if (c.bass) x += `<bass><bass-step>${STEPS[c.bass.step]}</bass-step>${c.bass.alt ? `<bass-alter>${c.bass.alt}</bass-alter>` : ''}</bass>`;
  if (offset) x += `<offset>${offset}</offset>`;
  return x + '</harmony>';
}
/* ----- 셈여림표 ↔ MusicXML ----- */
const XML_DYN_TAGS = new Set(['p', 'pp', 'ppp', 'pppp', 'f', 'ff', 'fff', 'ffff', 'mp', 'mf', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf', 'sfzp']);
// 말로 쓰는 셈여림 (악보 글자 → 셈여림표로 읽어요)
const DYN_WORDS = { 'cresc': 'cresc.', 'cresc.': 'cresc.', 'crescendo': 'cresc.', 'decresc': 'decresc.', 'decresc.': 'decresc.', 'decrescendo': 'decresc.', 'dim': 'dim.', 'dim.': 'dim.', 'diminuendo': 'dim.', 'morendo': 'morendo', 'smorzando': 'smorzando', 'smorz.': 'smorzando', 'subitop': 'subito p', 'sub.p': 'subito p', 'subitof': 'subito f', 'sub.f': 'subito f' };
function dynTag(el) { return el.tagName === 'other-dynamics' ? (dynFromWords(el.textContent) || el.textContent.trim()) : el.tagName; }
function dynFromWords(w) { return DYN_WORDS[(w || '').trim().toLowerCase().replace(/\s+/g, '')] || null; }
function dynXml(d, staffTag) {
  const inner = XML_DYN_TAGS.has(d) ? `<dynamics><${d}/></dynamics>` : /^subito\s/.test(d) ? `<dynamics><other-dynamics>${esc(d)}</other-dynamics></dynamics>` : `<words font-style="italic">${esc(d)}</words>`;
  return `<direction placement="below"><direction-type>${inner}</direction-type>${staffTag}</direction>`;
}
function wedgeXml(type, offset, staffTag) {
  return `<direction placement="below"><direction-type><wedge type="${type}"/></direction-type>${offset ? `<offset>${offset}</offset>` : ''}${staffTag}</direction>`;
}
function exportMusicXML(s) {
  const ctxs = computeContexts(s);
  // 크레셴도·데크레셴도: 마디 id → 그 마디에서 시작/끝나는 것
  const hpAt = new Map();
  (s.hairpins || []).forEach(hp => {
    const put = (mid, k, t) => { if (!hpAt.has(mid)) hpAt.set(mid, []); hpAt.get(mid).push({ k, t, hp }); };
    put(hp.a.m, 'start', hp.a.t); put(hp.b.m, 'stop', hp.b.t);
  });
  const tied = tieSets(s);
  const slurStart = new Map(), slurStop = new Map();
  let sn = 0;
  (s.slurs || []).filter(x => x.type !== 'tie').forEach(x => { sn = sn % 6 + 1; slurStart.set(x.a, (slurStart.get(x.a) || []).concat(sn)); slurStop.set(x.b, (slurStop.get(x.b) || []).concat(sn)); });
  const lineStart = new Set(); let acc = 0; s.lines.forEach(c => { lineStart.add(acc); acc += c; });
  // 파트: 피아노 두 줄은 한 파트 · 앙상블은 악기(줄)마다 한 파트 (꺾쇠괄호로 묶음)
  const groups = [];
  staffGroups(s).forEach(gp => { if (s.staves[gp.a] && s.staves[gp.a].grp === 'ens') { for (let si = gp.a; si <= gp.b; si++) groups.push({ a: si, b: si, ens: true }); } else groups.push(gp); });
  const pitchXml = p => `<pitch><step>${STEPS[mod(p.d, 7)]}</step>${p.a ? `<alter>${p.a}</alter>` : ''}<octave>${Math.floor(p.d / 7)}</octave></pitch>`;
  let x = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="3.1">\n`;
  x += `<work><work-title>${esc(s.title || '')}</work-title></work>\n<identification>${s.composer ? `<creator type="composer">${esc(s.composer)}</creator>` : ''}${s.lyricist ? `<creator type="lyricist">${esc(s.lyricist)}</creator>` : ''}<encoding><software>BFlat Studio</software></encoding></identification>\n`;
  const ensIdx = groups.map((g, k) => g.ens ? k : -1).filter(k => k >= 0);
  x += '<part-list>' + groups.map((gp, gi) => {
    const st = s.staves[gp.a]; const nm = st.name || (gp.b > gp.a ? 'Piano' : 'Melody');
    const open = gp.ens && gi === ensIdx[0] && ensIdx.length > 1 ? '<part-group type="start" number="1"><group-symbol>bracket</group-symbol><group-barline>yes</group-barline></part-group>' : '';
    const close = gp.ens && gi === ensIdx[ensIdx.length - 1] && ensIdx.length > 1 ? '<part-group type="stop" number="1"/>' : '';
    return `${open}<score-part id="P${gi + 1}"><part-name>${esc(nm)}</part-name>${gp.ens && st.short ? `<part-abbreviation>${esc(st.short)}</part-abbreviation>` : ''}</score-part>${close}`;
  }).join('') + '</part-list>\n';
  groups.forEach((gp, gi) => {
    const nStaff = gp.b - gp.a + 1;
    x += `<part id="P${gi + 1}">\n`;
    s.measures.forEach((m, i) => {
      const c = ctxs[i];
      x += `<measure number="${i + 1}"${m.pickup ? ' implicit="yes"' : ''}>`;
      if (i > 0 && lineStart.has(i)) x += '<print new-system="yes"/>';
      if (i === 0 || c.keyChanged || c.timeChanged) {
        x += '<attributes>';
        if (i === 0) x += `<divisions>${TPQ}</divisions>`;
        if (i === 0 || c.keyChanged) x += `<key><fifths>${c.key}</fifths></key>`;
        if (i === 0 || c.timeChanged) x += `<time><beats>${c.num}</beats><beat-type>${c.den}</beat-type></time>`;
        if (i === 0) {
          if (nStaff > 1) x += `<staves>${nStaff}</staves>`;
          for (let si = gp.a; si <= gp.b; si++) {
            const nb = nStaff > 1 ? ` number="${si - gp.a + 1}"` : '';
            const cl = staffClef(s, si);
            x += cl === 'bass' ? `<clef${nb}><sign>F</sign><line>4</line></clef>` : isCClef(cl) ? `<clef${nb}><sign>C</sign><line>${cLineOf(cl)}</line></clef>` : `<clef${nb}><sign>G</sign><line>2</line></clef>`;
          }
        }
        x += '</attributes>';
      }
      if (gi === 0 && i === 0 && (s.tempo || s.tempoText)) {
        x += '<direction placement="above">';
        if (s.tempoText) x += `<direction-type><words font-weight="bold">${esc(s.tempoText)}</words></direction-type>`;
        if (s.tempo) x += `<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${s.tempo}</per-minute></metronome></direction-type><sound tempo="${s.tempo}"/>`;
        x += '</direction>';
      }
      if (m.start === 'repeatStart' || m.volta) {
        x += '<barline location="left">';
        if (m.volta && (i === 0 || s.measures[i - 1].volta !== m.volta)) x += `<ending number="${m.volta}" type="start"/>`;
        if (m.start === 'repeatStart') x += '<repeat direction="forward"/>';
        x += '</barline>';
      }
      if (gi === 0) {
        if (m.form) x += `<direction placement="above"><direction-type><rehearsal>${esc(m.form)}</rehearsal></direction-type></direction>`;
        (m.marks || []).forEach(mk => {
          if (mk === 'segno') x += '<direction placement="above"><direction-type><segno/></direction-type><sound segno="segno"/></direction>';
          else if (mk === 'coda') x += '<direction placement="above"><direction-type><coda/></direction-type><sound coda="coda"/></direction>';
        });
      }
      // 줄마다 음표 (두 번째 줄부터는 <backup> 으로 마디 처음으로 돌아가서)
      let written = 0;
      for (let si = gp.a; si <= gp.b; si++) {
        const k = si - gp.a, voice = k * 4 + 1, staffTag = nStaff > 1 ? `<staff>${k + 1}</staff>` : '';
        if (k > 0 && written > 0) x += `<backup><duration>${written}</duration></backup>`;
        const notes = SNr(m, si);
        const withMeta = gi === 0 && k === 0;      // 코드 이름 · 가사는 맨 윗줄에만
        let t = 0;
        const chords = withMeta ? m.chords.slice().sort((a, b) => a.t - b.t) : [];
        let ci = 0;
        const syls = {};
        if (si === 0) for (let v = 0; v < s.lyricLines; v++) syls[v] = parseLyrics(m.lyrics[v]);
        let sylIdx = 0;
        const wedges = (hpAt.get(m.id) || []).filter(w => (w.hp.si || 0) === si).sort((a, b) => a.t - b.t || (a.k === 'stop' ? -1 : 1));
        let wi = 0;
        const flushWedges = (upTo, tNow) => { while (wi < wedges.length && wedges[wi].t < upTo) { const w = wedges[wi++]; x += wedgeXml(w.k === 'stop' ? 'stop' : w.hp.type === 'dim' ? 'diminuendo' : 'crescendo', Math.max(0, w.t - tNow), staffTag); } };
        if (!notes.length) { flushWedges(c.cap, 0); x += `<note><rest measure="yes"/><duration>${c.cap}</duration><voice>${voice}</voice>${staffTag}</note>`; t = c.cap; }
        notes.forEach(n => {
          const d = noteTicks(n, c.cap);
          while (ci < chords.length && chords[ci].t < t + d) { x += chordXml(chords[ci].name, Math.max(0, chords[ci].t - t)); ci++; }
          flushWedges(t + d, t);
          if (n.dyn) x += dynXml(n.dyn, staffTag);
          if (n.text) x += `<direction placement="above"><direction-type><words>${esc(n.text)}</words></direction-type>${staffTag}</direction>`;
          const common = (p) => {
            let y = `<duration>${d}</duration>`;
            if (p === n.p && tied.into.has(n.id)) y += '<tie type="stop"/>';
            if (p === n.p && tied.from.has(n.id)) y += '<tie type="start"/>';
            y += `<voice>${voice}</voice>`;
            if (!n.full) y += `<type>${XML_TYPE[n.dur]}</type>`;
            if (n.dots) y += '<dot/>';
            if (p && p.a) y += `<accidental>${p.a > 0 ? 'sharp' : 'flat'}</accidental>`;
            if (n.tri) y += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
            if (p && isClap(n)) y += '<notehead>x</notehead>';
            return y + staffTag;
          };
          // 꾸밈음: 원래 음표 앞에 <grace/> (길이 없음)
          if (!n.rest && n.p && n.gr) n.gr.forEach(p => {
            x += `<note><grace${n.gr.length === 1 ? ' slash="yes"' : ''}/>${pitchXml(p)}<voice>${voice}</voice><type>${n.gr.length === 1 ? 'eighth' : '16th'}</type>${p.a ? `<accidental>${p.a > 0 ? 'sharp' : 'flat'}</accidental>` : ''}${staffTag}</note>`;
          });
          x += '<note>';
          if (n.rest || !n.p) x += (n.full ? '<rest measure="yes"/>' : '<rest/>') + common(null);
          else x += pitchXml(n.p) + common(n.p);
          const nots = [];
          if (tied.into.has(n.id)) nots.push('<tied type="stop"/>');
          if (tied.from.has(n.id)) nots.push('<tied type="start"/>');
          (slurStop.get(n.id) || []).forEach(q2 => nots.push(`<slur type="stop" number="${q2}"/>`));
          (slurStart.get(n.id) || []).forEach(q2 => nots.push(`<slur type="start" number="${q2}"/>`));
          const arts = artMarks(n).filter(a => a !== 'fermata').map(a => ({ accent: '<accent/>', staccato: '<staccato/>', tenuto: '<tenuto/>', marcato: '<strong-accent/>' }[a]));
          if (arts.length) nots.push(`<articulations>${arts.join('')}</articulations>`);
          if ((n.art || []).includes('fermata')) nots.push('<fermata/>');
          if (nots.length) x += `<notations>${nots.join('')}</notations>`;
          if (si === 0 && lyrSlot(n)) {         // 음표 머리·쉼표 하나 = 가사 한 자리 (쉼표 글자는 내보내지 않아요)
            if (!n.rest) for (let v = 0; v < s.lyricLines; v++) {
              const sy = syls[v][sylIdx];
              // '-' = 붙임줄·이음줄로 이어진 음 (MusicXML 에는 가사 없음 → 다시 불러오면 '-' 로 돌아와요)
              if (sy && sy !== '_' && sy !== '-') x +=`<lyric number="${v + 1}"><syllabic>single</syllabic><text>${esc(sy)}</text></lyric>`;
            }
            sylIdx++;
          }
          x += '</note>';
          // 화음: 같은 때 함께 울리는 음 (<chord/>)
          if (!n.rest && n.p) (n.ps || []).forEach(p => { x += '<note><chord/>' + pitchXml(p) + common(p) + '</note>'; });
          t += d;
        });
        while (ci < chords.length) { x += chordXml(chords[ci].name, 0); ci++; }
        flushWedges(Infinity, t);   // 마디 끝에서 끝나는 크레셴도
        // 둘째 성부 (길이가 다른 화음 음) → voice+1
        const ovs = OVr(m, si).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
        // 겹치는 음은 성부를 하나씩 더 나눠서 (voice+1, voice+2 …)
        const lanes = [];
        ovs.forEach(n => { const nt = n.t || 0; let ln = lanes.find(l => l.cur <= nt); if (!ln) { ln = { cur: 0, notes: [] }; lanes.push(ln); } ln.notes.push(n); ln.cur = nt + noteTicks(n, c.cap); });
        lanes.slice(0, 3).forEach((ln, li) => {
          const vv = voice + 1 + li;
          x += `<backup><duration>${t}</duration></backup>`;
          let cur = 0;
          ln.notes.forEach(n => {
            const d = noteTicks(n, c.cap), nt = n.t || 0;
            if (nt > cur) x += `<forward><duration>${nt - cur}</duration><voice>${vv}</voice>${staffTag}</forward>`;
            const tail = p => `<duration>${d}</duration><voice>${vv}</voice><type>${XML_TYPE[n.dur]}</type>${n.dots ? '<dot/>' : ''}${p && p.a ? `<accidental>${p.a > 0 ? 'sharp' : 'flat'}</accidental>` : ''}${staffTag}`;
            if (n.rest || !n.p) { x += '<note><rest/>' + tail(null) + '</note>'; cur = nt + d; return; }
            x += '<note>' + pitchXml(n.p) + tail(n.p) + '</note>';
            (n.ps || []).forEach(p => { x += '<note><chord/>' + pitchXml(p) + tail(p) + '</note>'; });
            cur = nt + d;
          });
          t = cur;
        });
        written = t;
      }
      if (gi === 0) (m.marks || []).forEach(mk => {
        const words = { ds: 'D.S.', dsalcoda: 'D.S. al Coda', dsalfine: 'D.S. al Fine', dc: 'D.C.', dcalcoda: 'D.C. al Coda', dcalfine: 'D.C. al Fine', fine: 'Fine', tocoda: 'To Coda' }[mk];
        if (words) x += `<direction placement="above"><direction-type><words>${words}</words></direction-type></direction>`;
      });
      const endVolta = m.volta && (i === s.measures.length - 1 || s.measures[i + 1].volta !== m.volta);
      if (m.end || endVolta) {
        x += '<barline location="right">';
        const style = { double: 'light-light', final: 'light-heavy', repeatEnd: 'light-heavy' }[m.end];
        if (style) x += `<bar-style>${style}</bar-style>`;
        if (endVolta) x += `<ending number="${m.volta}" type="${m.volta === 1 ? 'stop' : 'discontinue'}"/>`;
        if (m.end === 'repeatEnd') x += '<repeat direction="backward"/>';
        x += '</barline>';
      }
      x += '</measure>\n';
    });
    x += '</part>\n';
  });
  x += '</score-partwise>\n';
  return x;
}

/* ---------- MusicXML 읽기 ---------- */
/** 글자 인식으로 읽은 파트 이름 다듬기: "C|.1" → "Cl. 1", "Clarinet in 8b:" → "Clarinet in B♭", 알아볼 수 없는 짧은 글자는 비워요 */
function cleanPartName(name) {
  let t = String(name || '').trim();
  if (!t) return '';
  t = t.replace(/\|/g, 'l').replace(/[:;]+$/, '').replace(/\bin\s*(?:8|B)\s*b\s*(\d?)$/i, (m0, d) => 'in B♭' + (d ? ' ' + d : '')).replace(/\.(\d)$/, '. $1').replace(/\s+/g, ' ').trim();
  // 낱말이 하나뿐이고 아주 짧은데 악기 줄임말도 아니면(예: "CH") 인식 실수로 보고 비워요
  if (/^[A-Z]{1,3}$/.test(t) && !/^(Vn|Va|Vc|Cb|Fl|Ob|Cl|Hn|Tb|Tp)$/i.test(t)) return '';
  if (/^cl\.?\s*(\d)$/i.test(t)) t = 'Clarinet ' + /(\d)$/.exec(t)[1];
  return t;
}
function importMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML을 읽을 수 없어요');
  const q = (el, sel) => el.querySelector(sel);
  const txt = (el, sel, d) => { const e = el && el.querySelector(sel); return e ? e.textContent.trim() : d; };
  const parts = [...doc.querySelectorAll('part')];
  if (!parts.length) throw new Error('파트가 없어요');
  const s = newScore({ lines: 0, mpl: 0 });
  s.lines = []; s.measures = [];
  s.title = txt(doc, 'work-title', '') || txt(doc, 'movement-title', '');
  s.composer = txt(doc, 'creator[type="composer"]', '');
  s.lyricist = txt(doc, 'creator[type="lyricist"]', '');
  // 줄(오선) 목록: 파트마다 staves 수만큼
  const partNames = {};
  doc.querySelectorAll('score-part').forEach(sp => partNames[sp.getAttribute('id')] = txt(sp, 'part-name', ''));
  const staves = [], base = [];
  parts.forEach((pt, pi) => {
    base.push(staves.length);
    const n = Math.max(1, ...[...pt.querySelectorAll('attributes > staves')].map(e => +e.textContent || 1));
    const clefs = {};
    pt.querySelectorAll('attributes > clef').forEach(c => {
      const num = +(c.getAttribute('number') || 1); if (clefs[num]) return;
      const sign = txt(c, 'sign', 'G');
      clefs[num] = sign === 'F' ? 'bass' : sign === 'C' ? 'c' + Math.max(1, Math.min(5, +txt(c, 'line', 3) || 3)) : 'treble';
    });
    for (let k = 1; k <= n; k++) {
      const st = { name: k === 1 ? (partNames[pt.getAttribute('id')] || '') : '', clef: clefs[k] || (k === 2 ? 'bass' : 'treble') };
      if (n > 1) st.grp = 'p' + pi;
      staves.push(st);
    }
  });
  if (staves.length === 1 || (staves.length === 2 && parts.length === 1)) staves[0].name = '';
  // 피아노로 보이는 악보 (높은음 + 낮은음 두 줄): 파트가 둘로 나뉘어 와도(예: 둘 다 "Voice") 큰보표로 묶고 이름은 비워요
  //  (단, 두 줄 이름이 모두 피아노가 아닌 악기면(예: Violin + Cello) 2중주예요)
  const instLike = nm => INST_SHORT.some(([re]) => re.test(cleanPartName(nm))) && !/piano|피아노|voice|노래/i.test(nm);
  if (staves.length === 2 && staves[1].clef === 'bass' && !(parts.length === 2 && staves.every(st => instLike(st.name)))) { staves.forEach(st => { st.name = ''; st.grp = 'piano'; }); }
  // 3줄 + 아래 두 줄이 높은음·낮은음이면 아래 두 줄을 피아노로
  if (staves.length === 3 && staves[1].clef !== 'bass' && staves[2].clef === 'bass') {
    staves[1].grp = staves[2].grp = 'piano'; staves[2].name = '';
    if (!staves[1].name || staves[1].name === staves[0].name || /^voice/i.test(staves[1].name)) staves[1].name = 'Piano';
  }
  s.staves = staves; s.clef = staves[0].clef;
  s.type = staves.length === 1 ? 'single' : (staves.length === 2 && staves[1].clef === 'bass' && staves[1].grp === 'piano') ? 'grand' : (staves.length === 3 && staves[2].clef === 'bass' && staves[2].grp === 'piano') ? (/voice|vocal|노래|보컬|sing/i.test(staves[0].name) ? 'voicePiano' : 'instPiano') : 'custom';
  // 악기마다 한 줄씩인 여러 파트(피아노 묶음 없음) = 앙상블 (2중주 · 3중주 …)
  if (s.type === 'custom' && staves.every(st => !st.grp)) {
    s.type = 'ensemble';
    staves.forEach((st, k) => { st.grp = 'ens'; st.name = cleanPartName(st.name) || `Part ${k + 1}`; st.short = shortInstName(st.name); });
    // 번호만 다른(또는 번호를 못 읽은) 같은 악기면 위에서부터 1, 2, 3 … (Clarinet in B♭ 1 + Clarinet in B♭ → … 1, … 2)
    const base = nm => nm.replace(/\s*\d$/, '');
    if (staves.length > 1 && staves.every(st => base(st.name) === base(staves[0].name)) && !/^Part$/.test(base(staves[0].name))) staves.forEach((st, k) => { st.name = base(st.name) + ' ' + (k + 1); st.short = shortInstName(st.name); });
    // 같은 이름이 여럿이면 번호 붙이기 (Clarinet → Clarinet 1, Clarinet 2)
    const cnt = {}; staves.forEach(st => cnt[st.name] = (cnt[st.name] || 0) + 1);
    const seen = {}; staves.forEach(st => { if (cnt[st.name] > 1 && !/\s\d$/.test(st.name)) { seen[st.name] = (seen[st.name] || 0) + 1; st.name += ' ' + seen[st.name]; st.short = shortInstName(st.name); } });
  }
  // 악기 줄들 + 큰보표(높은음 + 낮은음) 하나 = 피아노·하프가 들어간 앙상블 (피아노 3중주 · 피아노 5중주 …)
  if (s.type === 'custom') {
    const gs = staves.filter(st => st.grp), ids = [...new Set(gs.map(st => st.grp))];
    if (ids.length === 1 && gs.length === 2 && gs[1].clef === 'bass' && staves.some(st => !st.grp)) {
      s.type = 'ensemble';
      staves.forEach((st, k) => { if (st.grp) st.grp = 'piano'; else { st.grp = 'ens'; st.name = cleanPartName(st.name) || `Part ${k + 1}`; st.short = shortInstName(st.name); } });
      gs[0].name = cleanPartName(gs[0].name) || 'Piano'; gs[0].short = shortInstName(gs[0].name); gs[1].name = ''; gs[1].short = '';
    }
  }

  let key = 0, num = 4, den = 4, firstAttr = true, maxVerse = 1, gotTempo = false;
  const typeMap = { whole: 'w', half: 'h', quarter: 'q', eighth: 'e', '16th': 's', '32nd': 's' };
  const tieOpen = new Map(), slurOpen = new Map();
  const KR = /[가-힣]/;

  /** <note> 하나 → 그 줄 음표 배열에 넣기 (화음은 앞 음표에 얹기) */
  const handleNote = (el, m, si, div, st, tNow) => {
    const voice = txt(el, 'voice', '1');
    const isChord = !!q(el, 'chord');
    const durT = Math.round(+txt(el, 'duration', 0) * TPQ / div);
    const p = q(el, 'pitch');
    const pitch = p ? { d: +txt(p, 'octave', 4) * 7 + STEPS.indexOf(txt(p, 'step', 'C')), a: Math.round(+txt(p, 'alter', 0)) } : null;
    // 꾸밈음: 길이 없음 → 모아 뒀다가 같은 줄·같은 성부의 다음 음표에 붙여요 (꾸밈음 화음은 맨 아래 음 하나만)
    if (q(el, 'grace')) {
      if (pitch && !isChord && (st.voice[si] === undefined || voice === st.voice[si])) (st.grace[si] = st.grace[si] || []).push(pitch);
      return 0;
    }
    if (st.voice[si] === undefined) st.voice[si] = voice;
    if (voice !== st.voice[si]) {
      // 다른 성부 → 길이가 다른 화음 음 (쉼표는 빼요)
      if (!pitch || q(el, 'rest')) return isChord ? 0 : durT;
      st.lastOv = st.lastOv || {};
      const lk = si + ':' + voice;
      if (isChord) { const lo = st.lastOv[lk]; if (lo) (lo.ps = lo.ps || []).push(pitch); return 0; }
      const ty2 = txt(el, 'type', '');
      const o = newNote(typeMap[ty2] || guessDur(durT).dur, pitch);
      o.dots = el.querySelectorAll('dot').length ? 1 : 0; o.t = Math.max(0, tNow || 0); o.edited = true;
      OV(m, si).push(o); st.lastOv[lk] = o;
      return durT;
    }
    if (isChord) { const last = st.last[si]; if (last && pitch && last.p) (last.ps = last.ps || []).push(pitch); return 0; }
    const n = newNote('q');
    n.edited = true;
    const ty = txt(el, 'type', '');
    if (q(el, 'rest')) { n.rest = true; if (q(el, 'rest').getAttribute('measure') === 'yes' || !ty) n.full = true; }
    n.dur = typeMap[ty] || guessDur(durT).dur;
    n.dots = el.querySelectorAll('dot').length ? 1 : 0;
    if (q(el, 'time-modification')) n.tri = true;
    if (!ty && !n.rest) { const gd = guessDur(durT); n.dur = gd.dur; n.dots = gd.dots; }
    n.p = pitch;
    if (si === 0 && m._pendingText) { n.text = m._pendingText; delete m._pendingText; }
    if (m._pendingDyn) { n.dyn = m._pendingDyn; delete m._pendingDyn; }
    const nd = q(el, 'notations > dynamics > *'); if (nd) n.dyn = dynTag(nd);   // 음표에 붙은 셈여림 (sfz 등)
    const midi = n.p ? `${si}:${pitchMidi(n.p)}` : '';
    const ties = [...el.querySelectorAll('tie')].map(e => e.getAttribute('type'));
    if (tieOpen.has(midi) && ties.includes('stop')) { s.slurs.push({ id: uid(), a: tieOpen.get(midi), b: n.id, type: 'tie' }); tieOpen.delete(midi); }
    if (ties.includes('start')) tieOpen.set(midi, n.id);
    el.querySelectorAll('notations slur').forEach(sl => {
      const k = si + ':' + (sl.getAttribute('number') || '1');
      if (sl.getAttribute('type') === 'start') slurOpen.set(k, n.id);
      else if (sl.getAttribute('type') === 'stop' && slurOpen.has(k)) { s.slurs.push({ id: uid(), a: slurOpen.get(k), b: n.id, type: 'slur' }); slurOpen.delete(k); }
    });
    const arts = [];
    if (q(el, 'accent')) arts.push('accent'); if (q(el, 'staccato')) arts.push('staccato'); if (q(el, 'tenuto')) arts.push('tenuto'); if (q(el, 'strong-accent')) arts.push('marcato'); if (q(el, 'fermata')) arts.push('fermata');
    // X 머리 (박자치기 · 말하듯)
    if (/^(x|cross|circle-x)$/.test(txt(el, 'notehead', '').trim()) && !n.rest) arts.push('x');
    n.art = arts;
    // (사이에 쉼표가 끼면 다음 음표까지 기다려요 · 인식 고치기가 쉼표를 꾸밈음 뒤에 넣는 일이 있어요)
    if (st.grace[si] && st.grace[si].length && n.p && !n.rest) { n.gr = st.grace[si]; st.grace[si] = []; }
    if (si === 0) el.querySelectorAll('lyric').forEach(ly => {
      const v = (parseInt(ly.getAttribute('number')) || 1) - 1;
      if (v > 9) return;
      maxVerse = Math.max(maxVerse, v + 1);
      const tx = [...ly.querySelectorAll('text')].map(e => e.textContent).join('');
      (st.sylls[v] = st.sylls[v] || []).push({ tx, syl: txt(ly, 'syllabic', 'single'), idx: m.notes.length });
    });
    SN(m, si).push(n);
    st.last[si] = n;
    return durT;
  };

  /**
   * 한 오선에 성부가 둘 이상이면 "주 성부"(마디 박자를 세고 가사를 다는 성부) 고르기:
   * 처음 나온 성부가 아니라 음표 길이를 다 더한 값이 가장 긴 성부 (같으면 먼저 나온 것)
   * — 자동 인식이 아래 성부 하나를 짧게 읽으면, 그게 먼저 나왔다는 이유로 주 성부가 돼서 마디 전체가 박자 오류로 보였어요
   */
  const mainVoices = (me, pi) => {
    const tot = {}, order = [];
    [...me.children].forEach(el => {
      if (el.tagName !== 'note' || q(el, 'chord') || q(el, 'grace')) return;
      const si = base[pi] + Math.max(0, (+txt(el, 'staff', '1') || 1) - 1), v = txt(el, 'voice', '1'), k = si + '|' + v;
      if (!(k in tot)) { tot[k] = 0; order.push(k); }
      tot[k] += +txt(el, 'duration', 0) || 0;
    });
    const best = {};
    order.forEach(k => { const [si, v] = k.split('|'); if (!(si in best) || tot[k] > tot[si + '|' + best[si]]) best[si] = v; });
    return best;
  };

  // 크레셴도·데크레셴도 (<wedge>): 시작을 열어 뒀다가 stop 에서 닫아요 (마디를 넘어가도)
  const wedgeOpen = new Map();
  const readWedges = (el, m, si, t) => el.querySelectorAll('wedge').forEach(wg => {
    const ty = wg.getAttribute('type'), k = si + ':' + (wg.getAttribute('number') || '1');
    if (ty === 'crescendo' || ty === 'diminuendo') wedgeOpen.set(k, { type: ty === 'diminuendo' ? 'dim' : 'cresc', si, a: { m: m.id, t: Math.max(0, t) } });
    else if (ty === 'stop' && wedgeOpen.has(k)) {
      const o = wedgeOpen.get(k); wedgeOpen.delete(k);
      let bt = Math.max(0, t);
      if (o.a.m === m.id && bt <= o.a.t) bt = o.a.t + TPQ;   // 길이 0 이면 한 박만큼
      (s.hairpins = s.hairpins || []).push({ id: uid(), type: o.type, si: o.si, a: o.a, b: { m: m.id, t: bt } });
    }
  });
  const dirStaff = (el, pi) => base[pi] + Math.max(0, (+txt(el, 'staff', '1') || 1) - 1);
  const dirOffset = (el, dv) => Math.round(+txt(el, 'offset', 0) * TPQ / dv);
  // 1) 첫 파트: 마디 정보 + 음표
  let div = 1, lineCount = 0;
  [...parts[0].querySelectorAll(':scope > measure')].forEach((me, idx) => {
    const m = newMeasure();
    const pr = q(me, 'print');
    if (idx > 0 && pr && (pr.getAttribute('new-system') === 'yes' || pr.getAttribute('new-page') === 'yes')) { s.lines.push(lineCount); lineCount = 0; }
    lineCount++;
    if (me.getAttribute('implicit') === 'yes' && idx === 0) m.pickup = true;
    const st = { voice: mainVoices(me, 0), last: {}, sylls: {}, grace: {} };
    let t = 0;
    [...me.children].forEach(el => {
      const tag = el.tagName;
      if (tag === 'attributes') {
        div = +txt(el, 'divisions', div);
        const f = txt(el, 'key > fifths', null);
        if (f !== null) { if (firstAttr) { s.key = +f; key = +f; } else if (+f !== key) { m.key = +f; key = +f; } }
        const b = txt(el, 'time > beats', null);
        if (b !== null) { const bt = +txt(el, 'time > beat-type', 4); if (firstAttr) { s.time = { num: +b, den: bt }; } else if (+b !== num || bt !== den) m.time = { num: +b, den: bt }; num = +b; den = bt; }
        firstAttr = false;
      } else if (tag === 'direction') {
        const pm = txt(el, 'per-minute', null) || (q(el, 'sound[tempo]') && q(el, 'sound[tempo]').getAttribute('tempo'));
        if (pm && idx === 0 && !s.measures.length) { s.tempo = Math.round(+pm); gotTempo = true; }
        const reh = txt(el, 'rehearsal', null); if (reh) m.form = reh;
        if (q(el, 'segno')) m.marks.push('segno');
        if (q(el, 'coda')) m.marks.push('coda');
        const w = txt(el, 'words', '');
        const wl = w.toLowerCase().replace(/\s+/g, '');
        const mk = { 'd.s.': 'ds', 'd.s.alcoda': 'dsalcoda', 'd.s.alfine': 'dsalfine', 'd.c.': 'dc', 'd.c.alcoda': 'dcalcoda', 'd.c.alfine': 'dcalfine', 'fine': 'fine', 'tocoda': 'tocoda' }[wl];
        if (mk) m.marks.push(mk);
        else if (w && idx === 0 && !s.tempoText && TEMPO_TERMS.some(tt => tt[0].toLowerCase() === w.trim().toLowerCase())) s.tempoText = w.trim();
        else if (w && dynFromWords(w)) m._pendingDyn = dynFromWords(w);   // cresc. · dim. · subito p … = 셈여림
        else if (w) m._pendingText = w;
        const dyn = q(el, 'dynamics > *'); if (dyn) m._pendingDyn = dynTag(dyn);
        readWedges(el, m, dirStaff(el, 0), t + dirOffset(el, div));
      } else if (tag === 'harmony') {
        const rs = txt(el, 'root-step', 'C'), ra = +txt(el, 'root-alter', 0);
        const kindEl = q(el, 'kind');
        let qual = kindEl ? (kindEl.getAttribute('text') || '') : '';
        if (kindEl && !kindEl.getAttribute('text')) {
          const kv = kindEl.textContent.trim();
          qual = { minor: 'm', 'minor-seventh': 'm7', dominant: '7', 'major-seventh': 'maj7', diminished: 'dim', 'diminished-seventh': 'dim7', augmented: 'aug', 'half-diminished': 'm7b5', 'suspended-fourth': 'sus4', 'suspended-second': 'sus2', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9' }[kv] || '';
        }
        let name = rs + accStr(ra) + qual;
        const bs = txt(el, 'bass-step', null); if (bs) name += '/' + bs + accStr(+txt(el, 'bass-alter', 0));
        const off = Math.round(+txt(el, 'offset', 0) * TPQ / div);
        m.chords.push({ t: Math.max(0, t + off), name });
      } else if (tag === 'backup') { t -= Math.round(+txt(el, 'duration', 0) * TPQ / div); }
      else if (tag === 'forward') { t += Math.round(+txt(el, 'duration', 0) * TPQ / div); }
      else if (tag === 'barline') {
        const loc = el.getAttribute('location') || 'right';
        const rep = q(el, 'repeat');
        if (rep && rep.getAttribute('direction') === 'forward') m.start = 'repeatStart';
        if (rep && rep.getAttribute('direction') === 'backward') m.end = 'repeatEnd';
        const style = txt(el, 'bar-style', '');
        if (loc === 'right' && !rep) { if (style === 'light-light') m.end = 'double'; else if (style === 'light-heavy') m.end = 'final'; }
        const end = q(el, 'ending');
        if (end && end.getAttribute('type') === 'start') m.volta = parseInt(end.getAttribute('number')) || 1;
      } else if (tag === 'note') {
        const si = base[0] + Math.max(0, (+txt(el, 'staff', '1') || 1) - 1);
        t += handleNote(el, m, si, div, st, t);
      }
    });
    // 가사 → 마디 글자
    // 가사가 붙은 음은 붙임줄로 이어진 음일 수 없어요 (인식이 붙임줄을 잘못 읽은 것) → 그 붙임줄은 빼요
    Object.values(st.sylls).forEach(list => list.forEach(it => {
      const n = m.notes[it.idx]; if (!n) return;
      if ((it.tx || '').trim()) s.slurs = s.slurs.filter(x => !(x.type === 'tie' && x.b === n.id));
    }));
    const sylNoteIdx = [];
    m.notes.forEach((n, ni) => { if (n.rest || (n.p && !s.slurs.some(x => x.type === 'tie' && x.b === n.id))) sylNoteIdx.push(ni); });   // 쉼표도 가사 한 자리
    Object.keys(st.sylls).forEach(v => {
      let str = '', pos = 0;
      st.sylls[v].forEach(it => {
        const k = sylNoteIdx.indexOf(it.idx);
        if (k < 0 || k < pos || m.notes[it.idx].rest) return;          // 쉼표에 붙은 글자는 건너뛰어요 (뒤 가사가 밀리지 않게)
        // 건너뛴 자리: 음표 = '_' · 쉼표 = 빈 음절 (띄어쓰기 한 칸 더)
        while (pos < k) { str += m.notes[sylNoteIdx[pos]].rest ? (/\S$/.test(str) || !str ? '  ' : ' ') : '_ '; pos++; }
        let tok = it.tx;
        if (!(tok.length === 1 && KR.test(tok))) tok = (KR.test(tok) && tok.length > 1) ? `[${tok}]` : tok;
        if (!KR.test(tok) && !tok.startsWith('[')) tok = tok + ((it.syl === 'begin' || it.syl === 'middle') ? '-' : ' ');
        str += tok;
        pos = k + 1;
      });
      m.lyrics[v] = str.trimEnd();    // 앞 띄어쓰기 = 맨 앞 쉼표 자리라서 남겨요
    });
    delete m._pendingText; delete m._pendingDyn;
    s.measures.push(m);
  });
  // 2) 나머지 파트: 음표만 (마디 정보는 첫 파트 기준)
  parts.slice(1).forEach((pt, k) => {
    const pi = k + 1;
    let pdiv = 1;
    [...pt.querySelectorAll(':scope > measure')].forEach((me, idx) => {
      const m = s.measures[idx]; if (!m) return;
      const st = { voice: mainVoices(me, pi), last: {}, sylls: {}, grace: {} };
      let pt2 = 0;
      [...me.children].forEach(el => {
        if (el.tagName === 'attributes') pdiv = +txt(el, 'divisions', pdiv);
        else if (el.tagName === 'direction') {
          const dyn = q(el, 'dynamics > *'); if (dyn) m._pendingDyn = dynTag(dyn);
          else { const dw = dynFromWords(txt(el, 'words', '')); if (dw) m._pendingDyn = dw; }
          readWedges(el, m, dirStaff(el, pi), pt2 + dirOffset(el, pdiv));
        }
        else if (el.tagName === 'backup') pt2 -= Math.round(+txt(el, 'duration', 0) * TPQ / pdiv);
        else if (el.tagName === 'forward') pt2 += Math.round(+txt(el, 'duration', 0) * TPQ / pdiv);
        else if (el.tagName === 'note') pt2 += handleNote(el, m, base[pi] + Math.max(0, (+txt(el, 'staff', '1') || 1) - 1), pdiv, st, pt2);
      });
      delete m._pendingDyn;
    });
  });
  if (lineCount) s.lines.push(lineCount);
  if (s.lines.length === 1 && s.lines[0] > 6) { const n = s.lines[0]; s.lines = []; for (let k = 0; k < n; k += 4) s.lines.push(Math.min(4, n - k)); }
  s.lyricLines = Math.min(10, maxVerse);
  s.lyrSlur = false; s._fromXml = true;   // 이음줄 안 음의 빈 가사 자리 정리 (fixIds)
  s.lyrTie = false;                       // 붙임줄·이음줄로 이어진 음 = 가사 '-' 한 자리 (fixIds → migrateLyricTies)
  if (!gotTempo) s.tempo = null;          // 파일에 빠르기가 없으면 "♩=90"을 지어내지 않아요 (재생은 90으로)
  return fixIds(s);
}
/**
 * 인식 결과(MusicXML)의 쪽 배치 정보로 "원래 PDF 위 어디에 계이름을 쓸지" 계산
 * (Audiveris가 쪽 크기·여백·줄(시스템) 위치·마디 폭·음표 x 를 tenths 단위로 넣어 줘요)
 * → { pw, ph, staves:[{label}], items:[{page, x, y, staff, pitches:[{d,a}]}] }  (y = 첫 글자 줄 기준선)
 */
function omrLayout(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const q = (el, sel) => el && el.querySelector(sel);
  const num = (el, sel, d) => { const e = q(el, sel); const v = e ? parseFloat(e.textContent) : NaN; return isNaN(v) ? d : v; };
  const pw = num(doc, 'defaults page-layout page-width', 1199), ph = num(doc, 'defaults page-layout page-height', 1697);
  const lm = num(doc, 'defaults page-layout page-margins left-margin', 70), tm = num(doc, 'defaults page-layout page-margins top-margin', 70);
  const defStaffDist = num(doc, 'defaults staff-layout staff-distance', 65);
  const parts = [...doc.querySelectorAll('part')];
  const nStaff = parts.map(pt => Math.max(1, ...[...pt.querySelectorAll('attributes > staves')].map(e => +e.textContent || 1)));
  const base = []; let acc = 0; nStaff.forEach(n => { base.push(acc); acc += n; });
  const total = acc;
  const meas = parts.map(pt => [...pt.querySelectorAll(':scope > measure')]);
  const clefs = Array(total).fill('treble');
  const items = [], systems = [];
  const rm = num(doc, 'defaults page-layout page-margins right-margin', lm);
  let page = 0, sysTop = null, sysBottom = 0, sysLeftMargin = 0, sysRightMargin = 0, x0 = lm, staffTops = [], sys = null;
  const shown = Array(total).fill(true);   // 숨긴 오선 (staff-details print-object="no")
  for (let i = 0; i < meas[0].length; i++) {
    const me0 = meas[0][i], pr = q(me0, ':scope > print');
    parts.forEach((pt, pi) => { const me = meas[pi][i]; if (me) me.querySelectorAll(':scope > attributes > staff-details[print-object]').forEach(sd => { const k = sd.getAttribute('number'); for (let s = 1; s <= nStaff[pi]; s++) if (!k || +k === s) shown[base[pi] + s - 1] = sd.getAttribute('print-object') !== 'no'; }); });
    const newPage = pr && pr.getAttribute('new-page') === 'yes';
    const newSys = i === 0 || newPage || (pr && pr.getAttribute('new-system') === 'yes');
    if (newPage) { page++; sysTop = null; }
    if (newSys) {
      const sl = q(pr, 'system-layout');
      if (sl && q(sl, 'system-margins left-margin')) sysLeftMargin = num(sl, 'system-margins left-margin', sysLeftMargin);
      if (sl && q(sl, 'system-margins right-margin')) sysRightMargin = num(sl, 'system-margins right-margin', sysRightMargin);
      if (sysTop === null) sysTop = tm + num(sl, 'top-system-distance', 0);
      else sysTop = sysBottom + num(sl, 'system-distance', 80);
      // 이 줄의 오선마다 위치 (줄 사이 거리: 각 파트의 staff-layout)
      let y = sysTop, first = true; staffTops = [];
      const vis = [];
      parts.forEach((pt, pi) => {
        const prp = q(meas[pi][i], ':scope > print');
        for (let k = 1; k <= nStaff[pi]; k++) {
          const g = base[pi] + k - 1;
          if (!shown[g]) continue;
          if (!first) { const sd = prp && prp.querySelector(`staff-layout[number="${k}"] staff-distance`); y += 40 + (sd ? parseFloat(sd.textContent) : defStaffDist); }
          first = false;
          staffTops[g] = y; vis.push(g);
        }
      });
      sysBottom = y + 40;
      x0 = lm + sysLeftMargin;
      // 오선 길이 = 쪽 폭 − 쪽 여백 − 줄 여백 (마디 폭 합은 모자랄 때가 있어요)
      sys = { page, x0, w: 0, full: pw - lm - rm - sysLeftMargin - sysRightMargin, staffTops: staffTops.slice(), vis }; systems.push(sys);
    }
    const mx0 = x0;
    // 음표: 같은 오선·같은 x 는 화음으로 묶기
    parts.forEach((pt, pi) => {
      const me = meas[pi][i]; if (!me) return;
      const groups = [];
      [...me.children].forEach(el => {
        if (el.tagName === 'attributes') {
          el.querySelectorAll('clef').forEach(c => {
            const k = +(c.getAttribute('number') || 1), sign = (q(c, 'sign') || {}).textContent;
            clefs[base[pi] + k - 1] = sign === 'F' ? 'bass' : sign === 'C' ? 'c' + Math.max(1, Math.min(5, +((q(c, 'line') || {}).textContent) || 3)) : 'treble';
          });
        } else if (el.tagName === 'note') {
          if (q(el, 'rest') || q(el, 'grace')) return;
          const p = q(el, 'pitch'); if (!p) return;
          const dx = parseFloat(el.getAttribute('default-x')); if (isNaN(dx)) return;
          const g = base[pi] + Math.max(0, (+((q(el, 'staff') || {}).textContent) || 1) - 1);
          const pitch = { d: +((q(p, 'octave') || {}).textContent || 4) * 7 + STEPS.indexOf((q(p, 'step') || {}).textContent || 'C'), a: Math.round(+((q(p, 'alter') || {}).textContent || 0)) };
          const type = (q(el, 'type') || {}).textContent || '';
          let gp = groups.find(z => z.g === g && Math.abs(z.dx - dx) < 6);
          if (!gp) { gp = { g, dx, pitches: [], whole: type === 'whole' }; groups.push(gp); }
          gp.pitches.push(pitch);
          if (q(el, 'notations articulations')) gp.art = true;
        }
      });
      groups.forEach(gp => {
        const top = staffTops[gp.g]; if (top === undefined) return;
        const clef = clefs[gp.g];
        const ps = gp.pitches.map(pt2 => pt2.d - bottomD(clef));
        const lo = Math.min(...ps), hi = Math.max(...ps);
        const yLow = top + (8 - lo) * 5;
        const stemDown = !gp.whole && (lo + hi) / 2 >= 4;
        // 기둥이 위면 스타카토 같은 꾸밈이 머리 바로 아래에 있어요 → 그 밑으로
        const low = Math.max(top + 40, yLow + 6, stemDown ? yLow + 37 : 0, !stemDown && gp.art ? yLow + 22 : 0);
        // x: 음표 머리 가운데 (default-x 는 머리 왼쪽 끝) · xr/yr: 줄(시스템)·오선 기준 상대 위치
        const x = mx0 + gp.dx + 6;
        items.push({ page, x, y: low + 12, sys: systems.length - 1, xr: x - sys.x0, yr: low + 12 - top, hy: yLow - top, top, staff: gp.g, pitches: gp.pitches.slice().sort((a, b) => b.d - a.d) });
      });
    });
    x0 += parseFloat(me0.getAttribute('width')) || 0;
    sys.w = x0 - sys.x0;
  }
  // 줄 이름: 노래 / 오른손·왼손 / 파트 이름
  const pname = id => { const sp = [...doc.querySelectorAll('part-list > score-part')].find(e => e.getAttribute('id') === id); return sp ? ((q(sp, 'part-name') || {}).textContent || '').trim() : ''; };
  const names = [];
  parts.forEach((pt, pi) => {
    const nm = pname(pt.getAttribute('id'));
    for (let k = 0; k < nStaff[pi]; k++) {
      const g = base[pi] + k;
      if (nStaff[pi] === 2) names[g] = k === 0 ? '오른손' : '왼손';
      else if (nStaff[pi] > 2) names[g] = `${nm || '파트'} ${k + 1}`;
      else if (/voice|vocal|voc|sing|sop|alto|tenor|노래/i.test(nm)) names[g] = '노래';
      else names[g] = nm || `${g + 1}번째 줄`;
    }
  });
  const staves = clefs.map((c, g) => {
    let label = total === 1 ? '악보' : names[g];
    const same = names.filter(x => x === names[g]).length;
    if (total > 1 && same > 1) label += ' ' + (names.slice(0, g + 1).filter(x => x === names[g]).length);
    return { clef: c, label: `${label} (${c === 'bass' ? '낮은음자리표' : isCClef(c) ? '가온음자리표' : '높은음자리표'})` };
  });
  return { pw, ph, staves, items, systems, total, pages: page + 1 };
}
/**
 * 자동 인식(Audiveris) 결과 다듬기
 *  - 어떤 줄(시스템)에서 오선을 엉뚱한 파트에 붙이는 경우가 있어요 (예: 노래·피아노 3단이 Voice·Voice·Voice 로)
 *    → 가장 많이 나오는 "오선 차례"에 맞춰 그 줄의 내용을 제자리 파트로 옮겨요
 *  - 그러고 나서 한 번도 제자리에 안 나오는 파트(헛 파트)는 지워요
 */
function fixOmrXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return text;
  const kids = (el, tag) => el ? [...el.children].filter(c => c.tagName === tag) : [];
  const parts = kids(doc.documentElement, 'part');
  if (parts.length < 2) return text;
  const meas = parts.map(p => kids(p, 'measure'));
  const nM = Math.min(...meas.map(m => m.length));
  const nSt = parts.map(p => { const e = p.querySelector('attributes > staves'); return Math.max(1, e ? +e.textContent || 1 : 1); });
  // 마디마다 각 파트의 divisions, 줄(시스템)마다 보이는 오선 차례
  const vis = nSt.map(n => Array(n).fill(true)), div = parts.map(() => 1), divAt = parts.map(() => []);
  const systems = []; let cur = null;
  for (let i = 0; i < nM; i++) {
    parts.forEach((p, pi) => kids(meas[pi][i], 'attributes').forEach(a => {
      const dv = kids(a, 'divisions')[0]; if (dv && +dv.textContent > 0) div[pi] = +dv.textContent;
      kids(a, 'staff-details').forEach(sd => {
        const po = sd.getAttribute('print-object'); if (!po) return;
        const k = sd.getAttribute('number');
        for (let s = 0; s < nSt[pi]; s++) if (!k || +k === s + 1) vis[pi][s] = po !== 'no';
      });
    }));
    parts.forEach((p, pi) => { divAt[pi][i] = div[pi]; });
    const pr = kids(meas[0][i], 'print')[0];
    const ns = i === 0 || (pr && (pr.getAttribute('new-system') === 'yes' || pr.getAttribute('new-page') === 'yes'));
    if (ns) { cur = { from: i, to: i, slots: [] }; vis.forEach((vv, pi) => vv.forEach((v, s) => { if (v) cur.slots.push(pi + ':' + s); })); systems.push(cur); }
    else cur.to = i;
  }
  const cnt = {};
  systems.forEach(s => { const k = s.slots.join(','); cnt[k] = (cnt[k] || 0) + s.to - s.from + 1; });
  // 가장 많이 나오는 오선 차례 · 마디 수가 같으면 오선이 더 많은 쪽 (캡처처럼 첫 줄이 잘려 피아노만 보이는 경우에 노래 줄을 버리지 않게)
  const canonKey = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || b.split(',').length - a.split(',').length)[0];
  if (!canonKey) return text;
  const canon = canonKey.split(',');
  const slotOf = k => k.split(':').map(Number);
  let fixed = 0;
  systems.forEach(sys => {
    if (sys.slots.join(',') === canonKey || sys.slots.length !== canon.length) return;
    // 바꿀 파트: 오선 하나짜리 파트에서만 옮겨 와요 (안전하게)
    const touched = new Set();
    canon.forEach((dst, j) => { if (sys.slots[j] !== dst) touched.add(slotOf(dst)[0]); });
    const plan = {};   // 받는 파트 → [오선 차례대로 보내는 파트]
    for (const tp of touched) {
      const srcs = [];
      for (let k = 0; k < nSt[tp]; k++) {
        const j = canon.indexOf(tp + ':' + k); if (j < 0) return;
        const [sp, ss] = slotOf(sys.slots[j]);
        if (nSt[sp] !== 1 || ss !== 0) return;
        srcs.push(sp);
      }
      plan[tp] = srcs;
    }
    // 원본을 먼저 복사해 두고 (보내는 파트가 받는 파트이기도 해서)
    const snap = parts.map((p, pi) => { const a = []; for (let i = sys.from; i <= sys.to; i++) a.push(meas[pi][i].cloneNode(true)); return a; });
    for (const tp of Object.keys(plan).map(Number)) {
      const multi = nSt[tp] > 1;
      for (let i = sys.from; i <= sys.to; i++) {
        const orig = snap[tp][i - sys.from], tgt = meas[tp][i], td = divAt[tp][i];
        const out = [], clefs = [], left = [], right = [];
        plan[tp].forEach((sp, k) => {
          const src = snap[sp][i - sys.from], sc = td / (divAt[sp][i] || td);
          let pos = 0;
          [...src.children].forEach(el => {
            const t = el.tagName;
            if (t === 'print') return;
            if (t === 'barline') { if (k === 0 && !kids(orig, 'barline').length) (el.getAttribute('location') === 'left' ? left : right).push(el.cloneNode(true)); return; }
            if (t === 'attributes') { kids(el, 'clef').forEach(c => { const cc = c.cloneNode(true); if (multi) cc.setAttribute('number', k + 1); else cc.removeAttribute('number'); clefs.push(cc); }); return; }
            const e = el.cloneNode(true);
            const du = kids(e, 'duration')[0];
            if (du) du.textContent = Math.round(+du.textContent * sc);
            const d = du ? +du.textContent : 0;
            if (t === 'note') { if (!kids(e, 'chord').length) pos += d; }
            else if (t === 'backup') pos -= d;
            else if (t === 'forward') pos += d;
            if (multi && (t === 'note' || t === 'direction' || t === 'forward')) {
              let st = kids(e, 'staff')[0]; if (!st) { st = doc.createElement('staff'); e.appendChild(st); } st.textContent = k + 1;
              if (t === 'note') { let v = kids(e, 'voice')[0]; if (!v) { v = doc.createElement('voice'); e.appendChild(v); } v.textContent = k * 4 + (+v.textContent || 1); }
            }
            out.push(e);
          });
          if (k < plan[tp].length - 1 && pos > 0) { const b = doc.createElement('backup'), bd = doc.createElement('duration'); bd.textContent = pos; b.appendChild(bd); out.push(b); }
        });
        // 받는 마디 다시 만들기: print · attributes(원래 것 + 옮겨 온 음자리표) · 왼쪽 마디선 · 내용 · 오른쪽 마디선
        while (tgt.firstChild) tgt.removeChild(tgt.firstChild);
        kids(orig, 'print').forEach(e => tgt.appendChild(e.cloneNode(true)));
        let at = kids(orig, 'attributes')[0];
        at = at ? at.cloneNode(true) : doc.createElement('attributes');
        [...at.children].forEach(c => { if (c.tagName === 'clef' || c.tagName === 'staff-details') c.remove(); });
        clefs.forEach(c => at.appendChild(c));
        if (at.children.length) tgt.appendChild(at);
        kids(orig, 'barline').filter(b => b.getAttribute('location') === 'left').forEach(b => tgt.appendChild(b.cloneNode(true)));
        left.forEach(b => tgt.appendChild(b));
        out.forEach(e => tgt.appendChild(e));
        kids(orig, 'barline').filter(b => b.getAttribute('location') !== 'left').forEach(b => tgt.appendChild(b.cloneNode(true)));
        right.forEach(b => tgt.appendChild(b));
      }
    }
    // 이 줄에서 제자리 차례로 보이게
    parts.forEach((p, pi) => kids(meas[pi][sys.from], 'attributes').forEach(a => kids(a, 'staff-details').forEach(sd => sd.remove())));
    canon.forEach(k => { const [pi, s] = slotOf(k); const at = kids(meas[pi][sys.from], 'attributes')[0] || meas[pi][sys.from].insertBefore(doc.createElement('attributes'), kids(meas[pi][sys.from], 'print')[0] ? kids(meas[pi][sys.from], 'print')[0].nextSibling : meas[pi][sys.from].firstChild); const sd = doc.createElement('staff-details'); if (nSt[pi] > 1) sd.setAttribute('number', s + 1); sd.setAttribute('print-object', 'yes'); at.appendChild(sd); });
    parts.forEach((p, pi) => { if (!canon.some(k => slotOf(k)[0] === pi)) { const at = kids(meas[pi][sys.from], 'attributes')[0]; if (at) { const sd = doc.createElement('staff-details'); sd.setAttribute('print-object', 'no'); at.appendChild(sd); } } });
    fixed++;
  });
  // 파트 이름: 첫 줄(악보 맨 앞)에 적힌 긴 이름이 진짜 이름이에요 (둘째 줄부터는 "Cl. 1" 같은 줄임말을 읽어요)
  //  → 첫 줄에서 같은 차례에 있던 파트의 이름이 더 길면 그 이름을 써요
  const nameEl = pi => { const id = parts[pi].getAttribute('id'); const sp = [...doc.querySelectorAll('part-list > score-part')].find(e => e.getAttribute('id') === id); return sp ? sp.querySelector('part-name') : null; };
  const letters = s => (String(s || '').match(/[A-Za-z가-힣]/g) || []).length;
  if (systems[0] && systems[0].slots.length === canon.length) canon.forEach((k, j) => {
    const [pi] = slotOf(k), [fp] = slotOf(systems[0].slots[j]);
    if (fp === pi || nSt[pi] !== 1) return;
    const a = nameEl(pi), b = nameEl(fp);
    if (a && b && letters(b.textContent) > letters(a.textContent)) { a.textContent = b.textContent; fixed++; }
  });
  // 제자리 차례에 없는 파트 = 헛 파트 → 지우기
  const keep = new Set(canon.map(k => slotOf(k)[0]));
  let dropped = 0;
  parts.forEach((p, pi) => {
    if (keep.has(pi)) return;
    const id = p.getAttribute('id');
    const sp = [...doc.querySelectorAll('part-list > score-part')].find(e => e.getAttribute('id') === id);
    if (sp) sp.remove();
    p.remove(); dropped++;
  });
  if (!fixed && !dropped) return text;
  return new XMLSerializer().serializeToString(doc);
}
/**
 * Audiveris가 알아봤지만 MusicXML에는 안 넣은 세뇨·코다 표시를 넣어요
 * marks: [{m: 마디 번호(0부터), shape: 'SEGNO'|'CODA', rel: 마디 안 위치 0~1}]
 *  - 코다가 둘 이상이면: 첫 번째 = "To Coda"(그 마디 끝에서 코다로), 마지막 = 코다 시작
 *  - 세뇨와 To Coda·코다가 있는데 D.S. 글자를 못 읽었으면 → 코다 바로 앞 마디에 "D.S. al Coda"
 */
function omrAddMarks(text, marks) {
  if (!marks || !marks.length) return text;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return text;
  const kids = (el, tag) => el ? [...el.children].filter(c => c.tagName === tag) : [];
  const part = kids(doc.documentElement, 'part')[0]; if (!part) return text;
  const meas = kids(part, 'measure');
  const hasNotes = me => kids(me, 'note').some(n => kids(n, 'pitch').length || +((kids(n, 'duration')[0] || {}).textContent) > 0);
  const dir = (inner, atEnd, me) => {
    if (!me) return;
    const d = doc.createElement('direction'); d.setAttribute('placement', 'above');
    const dt = doc.createElement('direction-type'); d.appendChild(dt);
    const mm = /^<(\w+)\/>$/.exec(inner), ww = /^<words>(.*)<\/words>$/.exec(inner);
    if (mm) dt.appendChild(doc.createElement(mm[1]));
    else if (ww) { const w = doc.createElement('words'); w.textContent = ww[1]; dt.appendChild(w); }
    if (atEnd) { const bl = kids(me, 'barline').find(b => (b.getAttribute('location') || 'right') === 'right'); me.insertBefore(d, bl || null); }
    else { const first = [...me.children].find(c => c.tagName !== 'print' && c.tagName !== 'attributes' && !(c.tagName === 'barline' && c.getAttribute('location') === 'left')); me.insertBefore(d, first || null); }
  };
  const segnos = marks.filter(k => k.shape === 'SEGNO').sort((a, b) => a.m - b.m);
  const codas = marks.filter(k => k.shape === 'CODA').sort((a, b) => a.m - b.m);
  segnos.forEach(k => dir('<segno/>', false, meas[k.rel > 0.75 ? k.m + 1 : k.m]));
  let codaAt = -1;
  if (codas.length >= 2) {
    const a = codas[0], b = codas[codas.length - 1];
    dir('<words>To Coda</words>', true, meas[a.rel < 0.25 ? a.m - 1 : a.m]);
    codaAt = b.rel > 0.75 ? b.m + 1 : b.m;
  } else if (codas.length === 1) codaAt = codas[0].rel > 0.75 ? codas[0].m + 1 : codas[0].m;
  if (codaAt >= 0 && meas[codaAt]) dir('<coda/>', false, meas[codaAt]);
  const hasDS = [...doc.querySelectorAll('words')].some(w => /^\s*d\.?\s*s\.?/i.test(w.textContent));
  if (!hasDS && segnos.length && codas.length >= 2 && codaAt > 0) {
    let k = codaAt - 1; while (k > 0 && !hasNotes(meas[k])) k--;
    dir('<words>D.S. al Coda</words>', true, meas[k]);
  }
  return new XMLSerializer().serializeToString(doc);
}
/**
 * 자동 인식 결과(PDF 전체 = MusicXML 하나)를 곡마다 나누기 — 찬송가 책처럼 여러 곡이 든 PDF용
 *  곡 나눔 = 새 쪽의 첫 마디에 박자표·조표가 새로 적힌 곳 (한 곡이 여러 쪽이면 쪽 첫머리에 박자표를 다시 안 적어요.
 *            시험: 「더쇼」 6쪽 · 「왕벌의 비행」 7쪽은 0번 · 찬송가 3곡 PDF는 2번 = 정확히 곡 경계)
 *  곡 이름 = 그 곡 첫 쪽 위쪽에서 가장 큰 글자 (글자 인식이 읽은 것 · 못 읽었으면 '')
 *  돌려주는 값: [{xml, title, pages: [첫 쪽, 끝 쪽], measures}] (1곡이면 원래 xml 그대로 하나)
 */
function omrSplitSongs(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return [{ xml: text, title: '', pages: [1, 1], measures: 0 }];
  const root = doc.documentElement;
  const kids = (el, tag) => el ? [...el.children].filter(c => c.tagName === tag) : [];
  const parts = kids(root, 'part');
  if (!parts.length) return [{ xml: text, title: '', pages: [1, 1], measures: 0 }];
  const meas = parts.map(p => kids(p, 'measure'));
  const nM = Math.min(...meas.map(m => m.length));
  const pageOf = []; let pg = 1;
  for (let i = 0; i < nM; i++) {
    const pr = kids(meas[0][i], 'print')[0];
    if (i > 0 && pr && pr.getAttribute('new-page') === 'yes') pg++;
    pageOf.push(pg);
  }
  const starts = [0];
  for (let i = 1; i < nM; i++) {
    if (pageOf[i] === pageOf[i - 1]) continue;
    const fresh = meas.some(ms => kids(ms[i], 'attributes').some(a => kids(a, 'time').length || kids(a, 'key').length));
    if (fresh) starts.push(i);
  }
  // 쪽마다 제목 후보 (글자 인식 결과 · credit)
  const pageH = parseFloat((root.querySelector('defaults page-layout page-height') || {}).textContent) || 0;
  const CH = /^[A-G][#♯b♭]?(m|maj|min|dim|aug|sus)?\d*(\/[A-G][#♯b♭]?)?[,.]?$/;
  const titleOf = p => {
    const ws = [];
    kids(root, 'credit').filter(c => (+c.getAttribute('page') || 1) === p).forEach(c => kids(c, 'credit-words').forEach(w => {
      ws.push({ t: w.textContent.trim(), size: parseFloat(w.getAttribute('font-size')) || 0, y: parseFloat(w.getAttribute('default-y')) || 0 });
    }));
    if (!ws.length) return '';
    const sizes = ws.map(w => w.size).sort((a, b) => a - b), med = sizes[Math.floor(sizes.length / 2)] || 0;
    const cand = ws.filter(w => !CH.test(w.t) && (w.t.match(/[가-힣]/g) || []).length + (w.t.match(/[A-Za-z]/g) || []).length >= 3
      && (!pageH || w.y >= pageH * 0.7) && !/^[\[【(].*[\]】)]$/.test(w.t))
      .sort((a, b) => b.size - a.size)[0];
    if (!cand || cand.size < med * 1.5) return '';
    // 글자 인식 부스러기 정리: 한글 낱말에 붙은 영문·숫자 조각("x1주신책" → "주신책"), 이상한 기호
    let t = cand.t.replace(/[A-Za-z0-9]+(?=[가-힣])|(?<=[가-힣])[A-Za-z0-9]+/g, '').replace(/[^가-힣A-Za-z0-9 '’!?,.\-]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length >= 2 ? t : '';
  };
  const songs = starts.map((a, k) => {
    const b = k + 1 < starts.length ? starts[k + 1] : nM;
    return { a, b, pages: [pageOf[a], pageOf[b - 1]], measures: b - a, title: titleOf(pageOf[a]) };
  });
  if (songs.length < 2) return [{ xml: text, title: songs[0] ? songs[0].title : '', pages: [1, pg], measures: nM }];
  // 곡마다 MusicXML 만들기: 그 곡 마디만 남기고, 첫 마디에 그때까지의 박자·조·음자리표를 모두 적어요
  return songs.map(sg => {
    const d2 = doc.cloneNode(true), r2 = d2.documentElement;
    kids(r2, 'part').forEach(p => {
      const ms = kids(p, 'measure');
      const state = {};                       // divisions · key · time · staves · clef(번호마다)
      ms.slice(0, sg.a + 1).forEach(me => kids(me, 'attributes').forEach(at => [...at.children].forEach(ch => {
        const k = ch.tagName === 'clef' ? 'clef' + (ch.getAttribute('number') || '1') : ch.tagName;
        state[k] = ch;
      })));
      ms.forEach((me, i) => { if (i < sg.a || i >= sg.b) me.remove(); });
      const first = ms[sg.a]; if (!first) return;
      const at = d2.createElement('attributes');
      const order = ['divisions', 'key', 'time', 'staves'];
      order.forEach(k => { if (state[k]) at.appendChild(state[k].cloneNode(true)); });
      Object.keys(state).filter(k => /^clef/.test(k)).sort().forEach(k => at.appendChild(state[k].cloneNode(true)));
      kids(first, 'attributes').forEach((old, j) => { if (j === 0) old.replaceWith(at); });
      if (!kids(first, 'attributes').length && at.children.length) first.insertBefore(at, kids(first, 'print')[0] ? kids(first, 'print')[0].nextSibling : first.firstChild);
      const pr = kids(first, 'print')[0]; if (pr) pr.removeAttribute('new-page');
    });
    // 이 곡 쪽의 글자(credit)만 남기고 쪽 번호를 1부터
    kids(r2, 'credit').forEach(c => {
      const p = +c.getAttribute('page') || 1;
      if (p < sg.pages[0] || p > sg.pages[1]) c.remove(); else c.setAttribute('page', String(p - sg.pages[0] + 1));
    });
    // 작곡가·작사가(머리 정보)는 파일 전체에 하나뿐이라 그대로 두면 모든 곡에 첫 곡 것이 들어가요
    //  → 이 곡 쪽에 적힌 것(credit-type)으로 바꾸고, 없으면 지워요
    const ident = kids(r2, 'identification')[0];
    if (ident) ['composer', 'lyricist'].forEach(role => {
      kids(ident, 'creator').filter(c => c.getAttribute('type') === role).forEach(c => c.remove());
      const cr = kids(r2, 'credit').find(c => kids(c, 'credit-type').some(t => t.textContent.trim() === role));
      const tx = cr ? kids(cr, 'credit-words').map(w => w.textContent.trim()).join(' ').trim() : '';
      if (tx) { const c = d2.createElement('creator'); c.setAttribute('type', role); c.textContent = tx; ident.insertBefore(c, ident.firstChild); }
    });
    // 곡 이름
    kids(r2, 'work').forEach(w => w.remove()); kids(r2, 'movement-title').forEach(w => w.remove());
    if (sg.title) {
      const w = d2.createElement('work'), wt = d2.createElement('work-title'); wt.textContent = sg.title; w.appendChild(wt);
      r2.insertBefore(w, r2.firstElementChild);
    }
    return { xml: new XMLSerializer().serializeToString(d2), title: sg.title, pages: sg.pages, measures: sg.measures };
  });
}
/**
 * 자동 인식 결과를 "악보로" 열기 전에 한 번 더 다듬기 (PDF 위 계이름 자리 계산에는 안 써요)
 *  - 셈여림표(f, p …)는 빼요 (나중에 따로 넣을 거라서)
 *  - 가사를 안 가져오기로 했으면 가사도 빼요 · 글자 인식에서 나온 엉뚱한 글자(워터마크 등)도 빼요
 *  - 음표도 박자도 없는 가짜 마디(마디선 두 개가 붙어 있을 때 생겨요)는 지워요
 *  - 박자가 모자라거나 넘치는 마디는 음표의 가로 위치(같은 마디 다른 오선의 박자)를 보고 고쳐요
 *    · 모자라면: 빠진 쉼표(특히 마디 첫머리 쉼표)를 제자리에 넣어요
 *    · 넘치면: 길이를 잘못 읽은 음표를 찾아 줄여요
 */
/**
 * 글자 인식(OCR)으로 읽은 코드 이름 다듬기 — 자주 헷갈리는 것:
 *  - 7 → ?, 띄어쓰기 ("E m7")
 *  - 올림표 ♯ → i, I, l, |, !, 1, t, H 또는 "i-i" 처럼 두 줄로 (예: "Gi-im-S" = G♯m-5, "Fl" = F♯)
 *  - 내림표 ♭ → b 그대로 또는 6 (예: "B6" 는 B6 코드일 수도 있어서 그대로 둬요)
 *  - -5 / +5 의 5 → S, s
 */
function ocrChordText(raw) {
  let t = String(raw || '').trim().replace(/\s+/g, '').replace(/\?/g, '7').replace(/[‐‑–—−]/g, '-');
  const SH = '[iIl|!1tH]';
  const mm = new RegExp(`^([A-G])((?:${SH}-?${SH}?)|#|♯)(.*)$`).exec(t);
  if (mm && !/^[#♯]/.test(mm[2])) {
    // 올림표 다음은 코드 종류(m, maj, dim, sus, 숫자 …)나 / 이거나 끝이어야 해요 → 아니면 그대로
    if (/^(?:$|m|M|maj|min|dim|aug|sus|add|°|ø|\+|-|\(|\/|\d)/.test(mm[3])) t = mm[1] + '#' + mm[3];
  }
  t = t.replace(/([-+b#])[Ss](?=$|[^a-z])/g, '$15');
  return t;
}
function omrForImport(text, opts) {
  opts = opts || {};
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return text;
  const kids = (el, tag) => el ? [...el.children].filter(c => c.tagName === tag) : [];
  // 1) 셈여림표 · 글자
  const NAV = /^\s*(d\.?\s*s\.?|d\.?\s*c\.?|fine|to\s*coda|coda|segno)\b/i;
  // 글자로 읽힌 코드 이름(예: "C", "Am7", "G/B") → 코드로 (가사를 읽을 때만 글자 인식이 켜져요)
  const CH = /^([A-G])([#♯b♭]?)((?:maj|min|dim|aug|sus|m|M|\+|°|ø)?[0-9]*(?:\([^)]*\))?(?:[-+b#][0-9]+)*)(?:\/([A-G])([#♯b♭]?))?$/;
  if (opts.lyrics) [...doc.querySelectorAll('direction')].forEach(dir => {
    const ws = [...dir.querySelectorAll('direction-type > words')];
    if (ws.length !== 1 || dir.querySelector('dynamics')) return;
    const mm = CH.exec(ocrChordText(ws[0].textContent)); if (!mm) return;
    const alt = a => a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0;
    const h = doc.createElement('harmony');
    const root = doc.createElement('root'), rs = doc.createElement('root-step'); rs.textContent = mm[1]; root.appendChild(rs);
    if (alt(mm[2])) { const ra = doc.createElement('root-alter'); ra.textContent = alt(mm[2]); root.appendChild(ra); }
    h.appendChild(root);
    const kind = doc.createElement('kind'); kind.textContent = mm[3] ? 'other' : 'major'; if (mm[3]) kind.setAttribute('text', mm[3]); h.appendChild(kind);
    if (mm[4]) { const b = doc.createElement('bass'), bs = doc.createElement('bass-step'); bs.textContent = mm[4]; b.appendChild(bs); if (alt(mm[5])) { const ba = doc.createElement('bass-alter'); ba.textContent = alt(mm[5]); b.appendChild(ba); } h.appendChild(b); }
    dir.replaceWith(h);
  });
  // 셈여림(p·f·sfz …) · 크레셴도/데크레셴도(<wedge>) · cresc./dim. 같은 셈여림 말은 그대로 읽어요
  //  (그 밖의 글자는 인식 잡음이 많아서 빼요 · D.S./Fine 같은 길 표시와 빠르기말은 남겨요)
  [...doc.querySelectorAll('direction')].forEach(dir => {
    kids(dir, 'direction-type').forEach(dt => {
      kids(dt, 'dynamics').forEach(e => { if (!e.children.length) e.remove(); });
      kids(dt, 'words').forEach(w => { if (!NAV.test(w.textContent) && !dynFromWords(w.textContent) && !TEMPO_TERMS.some(tt => tt[0].toLowerCase() === w.textContent.trim().toLowerCase())) w.remove(); });
      if (!dt.children.length) dt.remove();
    });
    kids(dir, 'sound').forEach(snd => snd.removeAttribute('dynamics'));
    if (!kids(dir, 'direction-type').length) dir.remove();
  });
  doc.querySelectorAll('notations').forEach(e => { if (!e.children.length) e.remove(); });
  if (!opts.lyrics) doc.querySelectorAll('note > lyric').forEach(e => e.remove());
  const parts = kids(doc.documentElement, 'part');
  if (!parts.length) return text;
  if (opts.lyrics) omrTidyLyrics(doc, parts, kids);
  omrDropEmptyMeasures(doc, parts, kids);
  omrRepairRhythm(doc, parts, kids);
  if (opts.lyrics) omrFillLyricsFromRepeats(doc, parts, kids);
  return new XMLSerializer().serializeToString(doc);
}
/**
 * 글자 인식으로 읽은 가사 다듬기
 *  - 줄(시스템)마다 가사 줄 번호를 1절부터 다시 매겨요 (한 줄짜리 가사가 "2절"로 잡히는 일이 있어요)
 *  - 글자 한두 개뿐인 줄(악보 기호를 글자로 잘못 읽은 것)은 빼요
 *  - 자주 틀리는 글자 고치기: 낱말 중간의 I → l (li-ttIe → li-ttle), 낱말 중간 음절의 대문자 → 소문자, | → l/i, 0 → o
 */
function omrTidyLyrics(doc, parts, kids) {
  const meas = parts.map(p => kids(p, 'measure'));
  const nM = Math.min(...meas.map(m => m.length));
  // 줄(시스템) 나누기: 첫 파트의 줄바꿈 표시 기준
  const sys = []; let cur = null;
  for (let i = 0; i < nM; i++) {
    const pr = kids(meas[0][i], 'print')[0];
    if (!cur || (pr && (pr.getAttribute('new-system') === 'yes' || pr.getAttribute('new-page') === 'yes'))) { cur = []; sys.push(cur); }
    cur.push(i);
  }
  sys.forEach(idxs => parts.forEach((p, pi) => {
    const byStaff = {};
    idxs.forEach(i => kids(meas[pi][i], 'note').forEach(n => kids(n, 'lyric').forEach(ly => {
      const st = (kids(n, 'staff')[0] || {}).textContent || '1', no = ly.getAttribute('number') || '1';
      const lines = byStaff[st] || (byStaff[st] = {});
      (lines[no] || (lines[no] = [])).push(ly);
    })));
    Object.values(byStaff).forEach(lines => {
      const keys = Object.keys(lines).sort((a, b) => (parseInt(a) || 1) - (parseInt(b) || 1));
      const most = Math.max(...keys.map(k => lines[k].length));
      const keep = keys.filter(k => !(lines[k].length <= 2 && most >= 6));
      keys.filter(k => !keep.includes(k)).forEach(k => lines[k].forEach(ly => ly.remove()));
      keep.forEach((k, j) => lines[k].forEach(ly => ly.setAttribute('number', String(j + 1))));
    });
  }));
  // 글자 고치기 (영어 등 로마자 가사만)
  doc.querySelectorAll('note > lyric').forEach(ly => {
    const syl = (kids(ly, 'syllabic')[0] || {}).textContent || 'single';
    kids(ly, 'text').forEach(te => {
      let t = te.textContent;
      if (!/[A-Za-z]/.test(t) || /[가-힣]/.test(t)) return;
      t = t.replace(/\|(?=[A-Za-z])/g, 'l').replace(/\|/g, 'i');
      t = t.replace(/(?<=[a-z])0|0(?=[a-z])/g, 'o');
      t = t.replace(/^Ii(?![A-Z])/, 'li');
      t = t.replace(/(?<=[a-z])I/g, 'l');
      t = t.replace(/(?<=[a-z])1(?=[a-z])|^1(?=[a-z]{2})/g, 'l');
      if (syl === 'middle' || syl === 'end') { t = t.replace(/^I(?=[a-z])/, 'l'); t = t.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()); }
      // 낱말 첫 글자 I 다음에 모음(a e u y, o) → l (Iove → love, Iet → let) · Iowa, Ion 같은 건 그대로
      else t = t.replace(/^I(?=[aeuy]|o(?!wa|n\b))/, 'l');
      // 혼자 있는 l · 1 · i (+ 'm 've 'll 'd) → 나(I)
      t = t.replace(/^[l1|i](?=$|['’](?:m|ve|ll|d|s)?$)/, 'I');
      te.textContent = t;
    });
    if (!kids(ly, 'text').some(te => te.textContent.trim())) ly.remove();
  });
  // 낱말 끝 음절 "-ple, -tle, -dle, -ble …" 을 "pie, tie, die …"로 잘못 읽은 것 (peo-pie → peo-ple)
  //  같은 가사 줄에서 음절을 이어 붙여 낱말을 만든 뒤, 영어에 흔한 -ie 낱말(cookie, movie …)이 아니면 고쳐요
  const IE_OK = /^(?:cookie|rookie|movie|hippie|yuppie|birdie|goodie|hoodie|cutie|sweetie|selfie|zombie|veggie|doggie|bootie|beanie|genie|baddie|buddie|daddie|teddie|freddie|eddie|robbie|bobbie|debbie|maggie|lizzie|gracie|katie|abbie|hattie|mattie|kiddie|auntie|pinkie|newbie|groupie|hottie|cabbie|caddie|collie|indie|junkie|lassie|aussie|smoothie|bestie|sweetie|kittie|birdie|boogie|calorie|prairie|lingerie|eerie|reverie)$/i;
  const staffLy = new Map();
  doc.querySelectorAll('note > lyric').forEach(ly => {
    const n = ly.parentElement, pt = n.closest('part');
    const k = (pt ? pt.getAttribute('id') : '') + '|' + ((kids(n, 'staff')[0] || {}).textContent || '1') + '|' + (ly.getAttribute('number') || '1');
    if (!staffLy.has(k)) staffLy.set(k, []);
    staffLy.get(k).push(ly);
  });
  staffLy.forEach(list => {
    let word = [];
    list.forEach(ly => {
      const syl = (kids(ly, 'syllabic')[0] || {}).textContent || 'single';
      if (syl === 'begin' || syl === 'single') word = [];
      word.push(ly);
      if (syl !== 'end' || word.length < 2) return;
      const te = kids(ly, 'text')[0]; if (!te) return;
      const mm = /^([bcdgptz]{1,2})(ie|Ie)$/.exec(te.textContent.trim()); if (!mm) return;
      const whole = word.map(x => (kids(x, 'text')[0] || {}).textContent || '').join('');
      if (IE_OK.test(whole)) return;
      te.textContent = mm[1] + 'le';
    });
  });
  // 붙어 읽힌 낱말 나누기: "Ican't" → "I" + "can't"
  //  다음 음에 가사가 비어 있으면 뒤 낱말을 다음 음으로, 앞 음이 비어 있으면 "I"를 앞 음으로 (마디를 넘어서도)
  parts.forEach(p => {
    const seq = {};    // 오선·성부마다 차례대로 (붙임줄로 이어진 음은 빼요)
    kids(p, 'measure').forEach(me => kids(me, 'note').forEach(n => {
      if (kids(n, 'chord').length || kids(n, 'rest').length || kids(n, 'grace').length) return;
      if (kids(n, 'tie').some(t => t.getAttribute('type') === 'stop')) return;
      const k = ((kids(n, 'staff')[0] || {}).textContent || '1') + ':' + ((kids(n, 'voice')[0] || {}).textContent || '1');
      (seq[k] || (seq[k] = [])).push(n);
    }));
    const lyOf = (n, no) => n ? kids(n, 'lyric').find(l => (l.getAttribute('number') || '1') === no) : null;
    Object.values(seq).forEach(notes => notes.forEach((n, k) => kids(n, 'lyric').forEach(ly => {
      const te = kids(ly, 'text')[0]; if (!te) return;
      const mm = /^I([bcdfghjklmnpqrstvwxyz][a-z’']+)$/.exec(te.textContent.trim());
      if (!mm || /^ts|^tself/.test(mm[1])) return;
      const no = ly.getAttribute('number') || '1';
      const nx = notes[k + 1], pv = notes[k - 1];
      if (nx && !lyOf(nx, no)) {
        te.textContent = 'I';
        const sy = kids(ly, 'syllabic')[0]; if (sy) sy.textContent = 'single';
        const nl = ly.cloneNode(true); kids(nl, 'text')[0].textContent = mm[1];
        nx.appendChild(nl);
      } else if (pv && !lyOf(pv, no)) {
        const nl = ly.cloneNode(true); kids(nl, 'text')[0].textContent = 'I';
        const sy = kids(nl, 'syllabic')[0]; if (sy) sy.textContent = 'single';
        pv.appendChild(nl);
        te.textContent = mm[1];
      }
    })));
  });
  omrSplitHangul(parts, kids);
}
/**
 * 붙어 읽힌 한글 가사 나누기: 글자 인식은 붙어 쓴 음절을 한 낱말("주께서나")로 읽고,
 * Audiveris는 그 낱말을 가운데쯤 음표 하나에 붙여요. 한글 가사는 거의 한 음절에 한 음표라서
 * 그 음표를 가운데로 앞뒤의 빈 자리에 한 음절씩 나눠 붙여요.
 * 자리 = 같은 오선에서 왼쪽부터 음표가 놓인 가로 위치 하나 (Audiveris가 한 멜로디를 성부 여러 개로 나누거나
 * 박자를 틀리게 읽는 일이 많아서, 성부·박자가 아니라 악보 위 가로 위치(default-x) 차례로 봐요 ·
 * 붙임줄로 이어진 음·쉼표는 자리가 아니에요). 가로 위치가 없는 악보는 건드리지 않아요.
 * 이미 가사가 있는 자리는 건드리지 않고, 자리가 모자라면 그대로 둬요.
 */
function omrSplitHangul(parts, kids) {
  // 한글 가사 줄에 섞인 부스러기(얼룩·기호를 영어 글자로 읽은 "L", "J", "I", ":" 같은 것) 지우기:
  //  같은 파트·같은 절에서 가사 대부분이 한글이면, 한글이 없는 짧은(2글자 이하) 가사는 빼요
  parts.forEach(p => {
    const byNo = {};
    p.querySelectorAll('note > lyric').forEach(ly => { const no = ly.getAttribute('number') || '1'; (byNo[no] || (byNo[no] = [])).push(ly); });
    Object.values(byNo).forEach(list => {
      const txt = ly => kids(ly, 'text').map(t => t.textContent).join('').trim();
      const ko = list.filter(ly => /[가-힣]/.test(txt(ly))).length;
      if (ko < 3 || ko < list.length * 0.6) return;
      list.forEach(ly => { const t = txt(ly); if (!/[가-힣0-9]/.test(t) && t.length <= 2) ly.remove(); });
    });
  });
  parts.forEach(p => {
    const slots = {};          // 오선 → [[같은 자리 음표들], ...] (왼쪽부터)
    kids(p, 'measure').forEach(me => {
      const here = {};
      kids(me, 'note').forEach(el => {
        if (kids(el, 'rest').length || kids(el, 'grace').length) return;
        const x = parseFloat(el.getAttribute('default-x'));
        if (!isFinite(x)) return;
        const st = (kids(el, 'staff')[0] || {}).textContent || '1';
        const list = here[st] || (here[st] = []);
        const g = list.find(s => Math.abs(s.x - x) <= 8);     // 같은 세로줄(화음·다른 성부)
        if (g) g.notes.push(el); else list.push({ x, notes: [el] });
      });
      Object.entries(here).forEach(([st, list]) => list.sort((a, b) => a.x - b.x).forEach(s => {
        if (s.notes.every(n => kids(n, 'tie').some(t => t.getAttribute('type') === 'stop'))) return;
        s.notes.me = me;
        (slots[st] || (slots[st] = [])).push(s.notes);
      }));
    });
    const vno = n => parseInt((kids(n, 'voice')[0] || {}).textContent || '1', 10) || 1;
    const lyOf = (sl, no) => sl.some(n => kids(n, 'lyric').some(l => (l.getAttribute('number') || '1') === no));
    const head = sl => sl.filter(n => !kids(n, 'chord').length).sort((a, b) => vno(a) - vno(b))[0] || sl[0];
    Object.values(slots).forEach(list => list.forEach((sl, k) => sl.forEach(n => kids(n, 'lyric').forEach(ly => {
      const te = kids(ly, 'text')[0]; if (!te) return;
      const syl = [...te.textContent.trim()];
      if (syl.length < 2 || syl.length > 12 || !syl.every(c => /[가-힣]/.test(c))) return;
      const no = ly.getAttribute('number') || '1', L = syl.length;
      const notes = list;
      const free = j => j >= 0 && j < notes.length && (j === k || !lyOf(notes[j], no));
      // 고르는 기준: ① 원래 음표의 마디를 덜 벗어나는 자리 ② 낱말 가운데가 원래 음표에 가까운 자리 ③ 같으면 뒤쪽
      const spill = s => { let c = 0; for (let j = s; j < s + L; j++) if (notes[j].me !== notes[k].me) c++; return c; };
      const score = s => spill(s) * 100 + Math.abs(s - (k - (L - 1) / 2));
      let best = -1;
      for (let s = k - L + 1; s <= k; s++) {
        let ok = true; for (let j = s; j < s + L; j++) if (!free(j)) { ok = false; break; }
        if (ok && (best < 0 || score(s) <= score(best))) best = s;
      }
      if (best < 0) return;
      syl.forEach((c, i) => {
        const tgt = best + i === k ? n : head(notes[best + i]);
        const nl = tgt === n ? ly : ly.cloneNode(true);
        kids(nl, 'text')[0].textContent = c;
        const sy = kids(nl, 'syllabic')[0]; if (sy) sy.textContent = 'single';
        if (tgt !== n) tgt.appendChild(nl);
      });   // 원래 음표에는 제 차례 음절만 남아요 (같은 lyric 요소를 고쳐 써요)
    }))));
  });
}
/**
 * 글자 인식이 놓친 가사를 반복 구간에서 채우기 (예: 1절 "I _ know why" ← 반복된 곳 "I don't know why")
 *  - 가사가 빈 음표만 채우고, 이미 있는 가사는 절대 바꾸지 않아요
 *  - 다른 마디에서 같은 자리(같은 차례)의 음이 같은 높이·같은 길이이고, 바로 앞뒤 음도 같고,
 *    그 마디 다른 음의 가사가 2개 이상 똑같이 맞을 때만 (다른 절 가사를 잘못 가져오지 않게)
 *  - 후보가 여럿인데 글자가 서로 다르면 건드리지 않아요
 */
function omrFillLyricsFromRepeats(doc, parts, kids) {
  const p = parts[0]; if (!p) return 0;
  const norm = s => String(s || '').toLowerCase().replace(/[’'`]/g, "'").replace(/[^a-z0-9'가-힣]/g, '');
  const meas = kids(p, 'measure').map(me => {
    const all = kids(me, 'note').filter(n => !kids(n, 'chord').length && !kids(n, 'rest').length && !kids(n, 'grace').length && ((kids(n, 'staff')[0] || {}).textContent || '1') === '1');
    const voice = all.length ? ((kids(all[0], 'voice')[0] || {}).textContent || '1') : '1';
    return all.filter(n => ((kids(n, 'voice')[0] || {}).textContent || '1') === voice && !kids(n, 'tie').some(t => t.getAttribute('type') === 'stop')).map(n => {
      const pt = kids(n, 'pitch')[0], g = (el, tag) => (kids(el, tag)[0] || {}).textContent || '';
      const key = pt ? g(pt, 'step') + g(pt, 'alter') + g(pt, 'octave') + '/' + g(n, 'type') + (kids(n, 'dot').length ? '.' : '') : '?';
      const ly = {};
      kids(n, 'lyric').forEach(l => { const t = kids(l, 'text').map(e => e.textContent).join(''); if (t.trim()) ly[l.getAttribute('number') || '1'] = { el: l, t: norm(t) }; });
      return { n, key, ly };
    });
  });
  const nos = new Set(); meas.forEach(seq => seq.forEach(x => Object.keys(x.ly).forEach(k => nos.add(k))));
  let filled = 0;
  // 1) 글자는 똑같은데 음표에 나눠 붙인 게 다른 마디 (예: "Ican't"·do·it·a·lone ↔ I·can't·do·it·a·lone):
  //    멜로디가 똑같은 마디에서 이어 붙인 글자가 같으면, 그 마디처럼 음표마다 다시 나눠요 (글자는 안 바뀌어요)
  const joined = (seq, no) => seq.map(x => x.ly[no] ? x.ly[no].t : '').join('');
  const layout = (seq, no) => seq.map(x => x.ly[no] ? x.ly[no].t : '').join('|');
  meas.forEach((seq, i) => nos.forEach(no => {
    const txt = joined(seq, no); if (!txt) return;
    const src = meas.find((sj, j) => j !== i && sj.length === seq.length && sj.every((y, q) => y.key === seq[q].key) && joined(sj, no) === txt
      && sj.filter(y => y.ly[no]).length > seq.filter(y => y.ly[no]).length);
    if (!src || layout(src, no) === layout(seq, no)) return;
    seq.forEach((x, q) => {
      if (x.ly[no]) { x.ly[no].el.remove(); delete x.ly[no]; }
      if (src[q].ly[no]) { const nl = src[q].ly[no].el.cloneNode(true); nl.setAttribute('number', no); x.n.appendChild(nl); x.ly[no] = { el: nl, t: src[q].ly[no].t }; }
    });
    filled++;
    if (omrFillLyricsFromRepeats.log) omrFillLyricsFromRepeats.log.push({ m: i + 1, no, from: meas.indexOf(src) + 1, kind: 'resplit' });
  }));
  // 2) 빈 음표 채우기
  meas.forEach((seq, i) => nos.forEach(no => seq.forEach((x, k) => {
    if (x.ly[no] || !seq.some(q => q.ly[no])) return;          // 이미 가사가 있거나, 이 마디에 그 줄 가사가 아예 없으면 건너뛰기
    const picks = [];
    meas.forEach((sj, j) => {
      if (j === i || !sj[k] || sj[k].key !== x.key || !sj[k].ly[no]) return;
      if ((k > 0 && (!sj[k - 1] || sj[k - 1].key !== seq[k - 1].key)) || (seq[k + 1] && (!sj[k + 1] || sj[k + 1].key !== seq[k + 1].key))) return;
      let same = 0, diff = 0;
      seq.forEach((y, q) => {
        if (q === k || !sj[q] || !y.ly[no] || !sj[q].ly[no]) return;
        if (y.ly[no].t === sj[q].ly[no].t && y.key === sj[q].key) same++; else diff++;
      });
      if (same >= 2 && diff * 2 <= same) picks.push({ j, same, el: sj[k].ly[no].el, t: sj[k].ly[no].t });
    });
    if (!picks.length || picks.some(pk => pk.t !== picks[0].t)) return;
    picks.sort((a, b) => b.same - a.same);
    const nl = picks[0].el.cloneNode(true); nl.setAttribute('number', no);
    x.n.appendChild(nl);
    x.ly[no] = { el: nl, t: picks[0].t, filled: true };
    filled++;
    if (omrFillLyricsFromRepeats.log) omrFillLyricsFromRepeats.log.push({ m: i + 1, k, no, from: picks[0].j + 1, text: kids(nl, 'text').map(e => e.textContent).join('') });
  })));
  return filled;
}
/** 모든 파트에서 음표가 하나도 없고 길이도 0인 마디 → 지우기 (마디선·줄바꿈 표시는 옆 마디로 옮겨요) */
function omrDropEmptyMeasures(doc, parts, kids) {
  const meas = parts.map(p => kids(p, 'measure'));
  const nM = Math.min(...meas.map(m => m.length));
  const empty = i => meas.every(ms => kids(ms[i], 'note').every(n => !kids(n, 'pitch').length && !(+((kids(n, 'duration')[0] || {}).textContent) > 0)));
  for (let i = nM - 1; i >= 0; i--) {
    if (nM < 2 || !empty(i)) continue;
    parts.forEach((p, pi) => {
      const me = meas[pi][i], prev = meas[pi][i - 1], next = meas[pi][i + 1];
      if (next) {
        // 줄바꿈 · 마디 앞 정보(조표·박자표 바뀜, 왼쪽 마디선, 지시어)는 다음 마디 앞으로
        const pr = kids(me, 'print')[0];
        if (pr && !kids(next, 'print').length) next.insertBefore(pr, next.firstChild);
        const anchor = [...next.children].find(c => c.tagName !== 'print') || null;
        [...me.children].forEach(c => {
          if (c.tagName === 'attributes' || c.tagName === 'direction' || (c.tagName === 'barline' && c.getAttribute('location') === 'left')) next.insertBefore(c, anchor);
        });
      }
      if (prev) {
        // 오른쪽 마디선(겹세로줄·도돌이표)은 앞 마디 끝으로 · 가로 폭은 앞 마디에 더해서 뒤 마디 위치가 그대로이게
        kids(me, 'barline').forEach(b => { if ((b.getAttribute('location') || 'right') === 'right' && !kids(prev, 'barline').some(x => (x.getAttribute('location') || 'right') === 'right')) prev.appendChild(b); });
        const w = parseFloat(me.getAttribute('width')), pw = parseFloat(prev.getAttribute('width'));
        if (!kids(me, 'print').length && !isNaN(w) && !isNaN(pw)) prev.setAttribute('width', String(pw + w));
      }
      me.remove();
    });
    meas.forEach(ms => ms.splice(i, 1));
  }
}
/** 박자가 안 맞는 성부를 음표 가로 위치로 고치기 */
function omrRepairRhythm(doc, parts, kids) {
  const meas = parts.map(p => kids(p, 'measure'));
  const nM = Math.min(...meas.map(m => m.length));
  const div = parts.map(() => 1), beats = parts.map(() => 4), btype = parts.map(() => 4);
  const num = (el, tag) => { const e = kids(el, tag)[0]; return e ? parseFloat(e.textContent) : NaN; };
  // 길이(divisions 단위) → 음표 종류
  const TYPES = [[4, 'whole', 0], [3, 'half', 1], [2, 'half', 0], [1.5, 'quarter', 1], [1, 'quarter', 0], [0.75, 'eighth', 1], [0.5, 'eighth', 0], [0.375, '16th', 1], [0.25, '16th', 0], [0.125, '32nd', 0]];
  const typeOf = (du, dv) => TYPES.find(t => Math.abs(t[0] * dv - du) < 1e-6);
  let changed = 0;
  for (let i = 0; i < nM; i++) {
    parts.forEach((p, pi) => kids(meas[pi][i], 'attributes').forEach(a => {
      const dv = num(a, 'divisions'); if (dv > 0) div[pi] = dv;
      const tm = kids(a, 'time')[0];
      if (tm) { const b = parseInt(num(tm, 'beats')), bt = num(tm, 'beat-type'); if (b > 0 && bt > 0) { beats[pi] = b; btype[pi] = bt; } }
    }));
    if (meas[0][i].getAttribute('implicit') === 'yes' || i === 0 && meas.every(ms => ms[0].getAttribute('implicit') === 'yes')) continue;
    // 성부 덩어리 모으기: 같은 오선·같은 성부로 이어지는 음표들
    const segs = [];
    let width = NaN, minX = Infinity;
    parts.forEach((p, pi) => {
      const me = meas[pi][i];
      const w = parseFloat(me.getAttribute('width')); if (!isNaN(w)) width = isNaN(width) ? w : Math.max(width, w);
      const expected = Math.round(beats[pi] * 4 / btype[pi] * div[pi]);
      let pos = 0, cur = null;
      [...me.children].forEach(el => {
        const t = el.tagName;
        if (t === 'note') {
          if (kids(el, 'grace').length || kids(el, 'cue').length) return;
          if (kids(el, 'chord').length) { if (cur && cur.notes.length) cur.notes[cur.notes.length - 1].mates.push(el); return; }
          const du = num(el, 'duration') || 0;
          const voice = (kids(el, 'voice')[0] || {}).textContent || '1', staff = (kids(el, 'staff')[0] || {}).textContent || '1';
          if (!cur || cur.voice !== voice || cur.staff !== staff || cur.end !== pos) { cur = { pi, me, voice, staff, start: pos, end: pos, notes: [], expected, div: div[pi], beat: div[pi] * 4 / btype[pi], backup: null }; segs.push(cur); }
          const x = parseFloat(el.getAttribute('default-x'));
          if (!isNaN(x)) minX = Math.min(minX, x);
          const rest = kids(el, 'rest')[0];
          cur.notes.push({ el, mates: [], du, x, rest: !!rest, full: !!rest && (rest.getAttribute('measure') === 'yes' || !kids(el, 'type').length), tm: !!kids(el, 'time-modification').length });
          pos += du; cur.end = pos;
        } else if (t === 'backup') {
          if (cur && !cur.backup && cur.end === pos) cur.backup = el;
          pos -= num(el, 'duration') || 0;
        } else if (t === 'forward') pos += num(el, 'duration') || 0;
      });
    });
    const sum = sg => sg.notes.reduce((a, n) => a + n.du, 0);
    segs.forEach(sg => { sg.origSum = sum(sg); });
    const usable = sg => sg.start === 0 && sg.notes.length && sg.notes.every(n => !isNaN(n.x) && !n.tm) && !(sg.notes.length === 1 && sg.notes[0].full);
    // 기준 박자 지도: 박자가 딱 맞는 성부의 (가로 위치 → 박자)
    const pts = [];
    segs.forEach(sg => {
      if (!usable(sg) || sum(sg) !== sg.expected) return;
      let on = 0; sg.notes.forEach(n => { pts.push({ x: n.x, t: on / sg.div }); on += n.du; });
    });
    if (!pts.length && isFinite(minX)) pts.push({ x: minX, t: 0 });
    if (!pts.length || !segs.length) continue;
    const beatsQ = segs[0].expected / segs[0].div;   // 마디 길이 (4분음표 단위)
    if (!isNaN(width)) pts.push({ x: width, t: beatsQ });
    // 같은 박자는 x 평균 · x 순서대로 박자가 늘어나는 점만
    const byT = new Map(); pts.forEach(p0 => { const k = Math.round(p0.t * 1000); const a = byT.get(k) || []; a.push(p0.x); byT.set(k, a); });
    let map = [...byT.entries()].map(([k, xs]) => ({ t: k / 1000, x: xs.reduce((a, b) => a + b, 0) / xs.length })).sort((a, b) => a.x - b.x);
    map = map.filter((p0, k) => k === 0 || p0.t > map.slice(0, k).reduce((a, q) => Math.max(a, q.t), -1));
    const T = x => {
      if (map.length === 1) return map[0].t + (x - map[0].x) / ((isNaN(width) ? 300 : width) / Math.max(1, beatsQ));
      let k = 0; while (k < map.length - 2 && x > map[k + 1].x) k++;
      const a = map[k], b = map[k + 1];
      return a.t + (x - a.x) * (b.t - a.t) / ((b.x - a.x) || 1);
    };
    /** 격자 한 칸: 그 성부에서 가장 짧은 음 (16분 ~ 8분) */
    const unitOf = (dv, notes) => Math.max(dv / 4, Math.min(dv / 2, ...notes.map(n => n.du).filter(d => d > 0)));
    /** 쉼표 음표들 만들기 (t0부터 len 길이 · 박 경계에서 나눠요) */
    const restEls = (sg, t0, len) => {
      const dv = sg.div, out = [];
      let left = len;
      for (let g = 0; left > 0 && g < 16; g++) {
        const toBeat = sg.beat - (t0 % sg.beat);
        const cap = t0 % sg.beat === 0 ? left : Math.min(left, toBeat);
        const tp = TYPES.find(t => t[0] * dv <= cap + 1e-6 && Number.isInteger(t[0] * dv)) || null;
        const d = tp ? tp[0] * dv : left;
        const r = doc.createElement('note');
        r.appendChild(doc.createElement('rest'));
        const du = doc.createElement('duration'); du.textContent = d; r.appendChild(du);
        const vo = doc.createElement('voice'); vo.textContent = sg.voice; r.appendChild(vo);
        const ty = typeOf(d, dv) || [0, 'quarter', 0];
        const te = doc.createElement('type'); te.textContent = ty[1]; r.appendChild(te);
        if (ty[2]) r.appendChild(doc.createElement('dot'));
        const st = doc.createElement('staff'); st.textContent = sg.staff; r.appendChild(st);
        out.push(r); t0 += d; left -= d;
      }
      return out;
    };
    const setDur = (n, nd, dv) => {
      const ty = typeOf(nd, dv);
      [n.el, ...n.mates].forEach(el => {
        const du = kids(el, 'duration')[0]; if (du) du.textContent = nd;
        if (ty) {
          let te = kids(el, 'type')[0]; if (!te) { te = doc.createElement('type'); el.appendChild(te); } te.textContent = ty[1];
          kids(el, 'dot').forEach(dd => dd.remove());
          if (ty[2]) te.after(doc.createElement('dot'));
        }
      });
    };
    /**
     * 가로 위치로 박 맞추기: 음표마다 x → 박(격자에 맞춰) 을 정하고,
     *  - 음표 길이가 다음 음표까지보다 길면 줄이고 (꼬리를 잘못 읽은 것)
     *  - 짧으면 그 사이에 쉼표를 넣어요 (인식이 빠뜨린 쉼표)
     * 모든 음표가 제 위치(격자 ¾칸 안)에 오고 마디 길이가 딱 맞을 때만 → { dev, apply() } (안 되면 null)
     */
    const byPosition = (sg, want, mapN, unit) => {
      const dv = sg.div;
      if (mapN < 3 || want.some(w => w === null || isNaN(w))) return null;
      const on = want.map(w => Math.max(0, Math.round(w / unit) * unit));
      for (let k = 1; k < on.length; k++) if (on[k] <= on[k - 1]) on[k] = on[k - 1] + unit;
      const dev = Math.max(...on.map((o, k) => Math.abs(o - want[k])));
      if (dev > unit * 0.75 || on[on.length - 1] >= sg.expected) return null;
      const plan = sg.notes.map((n, k) => {
        const gap = (k + 1 < on.length ? on[k + 1] : sg.expected) - on[k];
        let d = Math.min(n.du, gap);
        if (!typeOf(d, dv)) { const tp = TYPES.find(t => t[0] * dv <= d + 1e-6 && Number.isInteger(t[0] * dv)); d = tp ? tp[0] * dv : 0; }
        return { d, rest: gap - d };
      });
      // 음표 길이를 반보다 더 줄여야 하면 위치를 믿기 어려워요
      if (plan.some((p, k) => p.d <= 0 || p.d * 2 < sg.notes[k].du)) return null;
      const changes = plan.filter((p, k) => p.d !== sg.notes[k].du || p.rest > 0).length + (on[0] > 0 ? 1 : 0);
      if (!changes) return null;
      return {
        dev, kind: 'pos',
        apply() {
          if (on[0] > 0) restEls(sg, 0, on[0]).forEach(r => sg.me.insertBefore(r, sg.notes[0].el));
          sg.notes.forEach((n, k) => {
            const p = plan[k];
            if (p.d !== n.du) setDur(n, p.d, dv);
            if (p.rest > 0) { let after = n.mates[n.mates.length - 1] || n.el; restEls(sg, on[k] + p.d, p.rest).forEach(r => { after.after(r); after = r; }); }
          });
        }
      };
    };
    /** 예전 방법: 모자라면 쉼표만 넣고, 넘치면 음표 길이만 줄여요 (음표 길이는 되도록 그대로) */
    const byDuration = (sg, want) => {
      const dv = sg.div;
      const durs = sg.notes.map(n => n.du);
      const err = ds => { let on = 0, e = 0; ds.forEach((d, k) => { if (want[k] !== null) e += Math.abs(on - want[k]); on += d; }); return e; };
      const devOf = (ds, ws) => { let on = 0, m = 0; ds.forEach((d, k) => { if (ws[k] !== null && !isNaN(ws[k])) m = Math.max(m, Math.abs(on - ws[k])); on += d; }); return m; };
      let D = sg.expected - sum(sg);
      if (D > 0) {
        // 모자람 → 쉼표 넣기 (가장 잘 맞는 자리에, 필요하면 여러 군데)
        const d2 = durs.slice(), w2 = want.slice(), ins = durs.map(() => false);   // ins[k] = d2[k] 가 넣을 쉼표인지
        for (let it = 0; D > 0 && it < 8; it++) {
          const sizes = [D, ...TYPES.map(t => t[0] * dv).filter(v => Number.isInteger(v) && v < D)];
          let best = null;
          for (let k = 0; k <= d2.length; k++) for (const c of sizes) {
            const d3 = d2.slice(0, k).concat([c], d2.slice(k));
            const w3 = w2.slice(0, k).concat([null], w2.slice(k));
            let on = 0, e = 0; d3.forEach((d, q) => { if (w3[q] !== null) e += Math.abs(on - w3[q]); on += d; });
            if (!best || e < best.e - 1e-6 || (Math.abs(e - best.e) < 1e-6 && c > best.c)) best = { k, c, e };
          }
          if (!best) break;
          d2.splice(best.k, 0, best.c); w2.splice(best.k, 0, null);
          ins.splice(best.k, 0, true);
          D -= best.c;
        }
        if (D !== 0) return null;
        return {
          dev: devOf(d2, w2), kind: 'rest',
          apply() {
            // sg.notes 에 쉼표 자리 끼워 넣고 → DOM에 쉼표 넣기 (박 경계에서 나눠서)
            const list = []; let q = 0;
            d2.forEach((d, k) => { if (ins[k]) list.push({ ins: true, du: d }); else list.push(sg.notes[q++]); });
            let on = 0;
            list.forEach((n, k) => {
              if (n.ins) {
                const ref = list.slice(k + 1).find(x => !x.ins);
                const before = ref ? ref.el : null;
                const last = list.slice(0, k).reverse().find(x => !x.ins);
                let after = last ? (last.mates[last.mates.length - 1] || last.el) : null;
                restEls(sg, on, n.du).forEach(r => {
                  if (before) sg.me.insertBefore(r, before);
                  else if (after) { after.after(r); after = r; }      // 순서가 뒤집히지 않게 방금 넣은 쉼표 뒤에
                  else sg.me.appendChild(r);
                });
              }
              on += n.du;
            });
          }
        };
      }
      // 넘침 → 길이를 잘못 읽은 음표 줄이기 (점 빼기 · 반으로) 또는 군더더기 쉼표 빼기
      let E = -D;
      const plan = durs.slice();
      for (let it = 0; E > 0 && it < 8; it++) {
        let best = null;
        plan.forEach((d, k) => {
          const n = sg.notes[k];
          const opts2 = [];
          const ty = typeOf(d, dv);
          if (ty && ty[2]) opts2.push(d * 2 / 3); else opts2.push(d / 2);
          if (n.rest) opts2.push(0);
          opts2.forEach(nd => {
            if (!Number.isInteger(nd) || (nd > 0 && nd < dv / 4) || d - nd > E) return;
            const d2 = plan.slice(); d2[k] = nd;
            const e = err(d2);
            if (!best || e < best.e - 1e-6 || (Math.abs(e - best.e) < 1e-6 && k > best.k)) best = { k, nd, e };
          });
        });
        if (!best) break;
        E -= plan[best.k] - best.nd; plan[best.k] = best.nd;
      }
      if (E !== 0) return null;     // 깔끔하게 못 맞추면 건드리지 않아요
      return {
        dev: devOf(plan, want), kind: 'shorten',
        apply() {
          plan.forEach((nd, k) => {
            const n = sg.notes[k]; if (nd === n.du) return;
            if (nd === 0) { n.el.remove(); n.mates.forEach(mm => mm.remove()); return; }
            setDur(n, nd, dv);
          });
        }
      };
    };
    // 둘째 성부로 잘못 읽힌 음 되돌리기:
    //  멜로디(첫 성부)가 모자라고, 같은 오선의 다른 성부가 마디를 다 못 채운 조각이면(음 한두 개)
    //  그 음들은 원래 멜로디 사이에 있던 음이에요 → 빈자리를 쉼표로 채우기 전에 가로 위치 순서대로 멜로디에 넣어요
    //  (넣으면 넘칠 때는 가로 위치로 박을 딱 맞출 수 있을 때만)
    const fragOf = (sg, og) => og !== sg && og.pi === sg.pi && og.staff === sg.staff && og.voice !== sg.voice && og.notes.length
      && og.notes.every(n => !n.rest && !isNaN(n.x) && !n.tm) && sum(og) < og.expected
      // 멜로디 음과 같은 자리(같은 때 울리는 진짜 둘째 성부)면 건드리지 않아요
      && og.notes.every(n => sg.notes.every(q => isNaN(q.x) || Math.abs(q.x - n.x) > 6));
    segs.filter(sg => usable(sg) && sum(sg) < sg.expected).forEach(sg => {
      segs.filter(og => fragOf(sg, og)).forEach(og => {
        if (sum(sg) >= sg.expected || !og.notes.length) return;
        const merged = sg.notes.concat(og.notes).sort((p, q) => p.x - q.x);
        let plan = null;
        if (sum(sg) + sum(og) > sg.expected) {
          const unit = unitOf(sg.div, merged);
          plan = Number.isInteger(unit) && unit > 0 ? byPosition(Object.assign({}, sg, { notes: merged }), merged.map(n => T(n.x) * sg.div), map.length, unit) : null;
          if (!plan) return;
        }
        og.notes.forEach(n => {
          const els = [n.el, ...n.mates];
          // 빠진 자리는 같은 길이의 "앞으로 가기"(forward)로 메워서 그 성부의 나머지 음 박자가 밀리지 않게
          const fw = doc.createElement('forward'), fd = doc.createElement('duration'); fd.textContent = n.du; fw.appendChild(fd);
          n.el.before(fw);
          els.forEach(el => { const v = kids(el, 'voice')[0]; if (v) v.textContent = sg.voice; });
          const nextQ = sg.notes.find(q => !isNaN(q.x) && q.x > n.x);
          if (nextQ) els.forEach(el => sg.me.insertBefore(el, nextQ.el));
          else { let after = sg.notes[sg.notes.length - 1]; after = after.mates[after.mates.length - 1] || after.el; els.reverse().forEach(el => after.after(el)); }
          const k = nextQ ? sg.notes.indexOf(nextQ) : sg.notes.length;
          sg.notes.splice(k, 0, n);
        });
        og.notes = [];
        if (plan) { plan.apply(); sg.fixed = true; }
        if (omrRepairRhythm.log) omrRepairRhythm.log.push({ i, kind: plan ? 'merge+pos' : 'merge' });
        // 다 채워졌으면 뒤따르는 되돌리기(backup) 길이만 맞추기 (모자라면 아래에서 쉼표를 넣으면서 맞춰요)
        if ((sg.fixed || sum(sg) === sg.expected) && sg.backup && num(sg.backup, 'duration') === sg.origSum) { kids(sg.backup, 'duration')[0].textContent = sg.expected; sg.fixed = true; }
      });
    });
    const bad = segs.filter(sg => usable(sg) && !sg.fixed && sum(sg) !== sg.expected);
    if (!bad.length) continue;
    bad.forEach(sg => {
      const dv = sg.div, want = sg.notes.map(n => T(n.x) * dv);
      const oldSum = sum(sg);
      const unit = unitOf(dv, sg.notes);
      const a = byDuration(sg, want);
      const b = Number.isInteger(unit) && unit > 0 ? byPosition(sg, want, map.length, unit) : null;
      // 음표 길이를 그대로 두는 예전 방법이 모든 음을 제자리(격자 ¾칸 안)에 두면 그걸 쓰고,
      // 어떤 음이 제자리에서 크게 벗어나면(쉼표를 빠뜨렸거나 꼬리를 잘못 읽은 것) 가로 위치 방법을 써요
      const pick = (a && a.dev <= unit * 0.75) ? a : (b || a);
      if (!pick) return;
      pick.apply();
      // 뒤따르는 되돌리기(backup) 길이도 맞추기
      if (sg.backup && (num(sg.backup, 'duration') === oldSum || num(sg.backup, 'duration') === sg.origSum)) kids(sg.backup, 'duration')[0].textContent = sg.expected;
      if (omrRepairRhythm.log) omrRepairRhythm.log.push({ i, kind: pick.kind, voice: sg.voice, staff: sg.staff });
      changed++;
    });
  }
  return changed;
}
function guessDur(t) { const d = STD_DURS.find(x => x.t <= t) || STD_DURS[STD_DURS.length - 1]; return { dur: d.dur, dots: d.dots }; }

/* .mxl (zip) 풀기 */
async function unzipMxl(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('mxl 파일이 아니에요');
  const cnt = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < cnt; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    files[name] = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  const read = async (name) => {
    const f = files[name];
    const lnl = dv.getUint16(f.off + 26, true), lel = dv.getUint16(f.off + 28, true);
    const data = new Uint8Array(buf, f.off + 30 + lnl + lel, f.csize);
    if (f.method === 0) return new TextDecoder().decode(data);
    const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(ds).text();
  };
  let root = null;
  if (files['META-INF/container.xml']) {
    const c = await read('META-INF/container.xml');
    const mm = /full-path="([^"]+)"/.exec(c); if (mm) root = mm[1];
  }
  if (!root) root = Object.keys(files).find(n => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  return await read(root);
}

/* ---------- MIDI 내보내기 ---------- */
function exportMidi(s, settings) {
  const ctxs = computeContexts(s);
  const perf = buildPerformance(s, ctxs, {});
  const DIV = 480;
  const tempo = s.tempo || 90;
  const secToTick = sec => Math.round(sec * tempo / 60 * DIV);
  const evs = [];
  // 박자치기 = 타악기 채널(10번)의 손뼉(39) · 시작 전으로 당긴 꾸밈음은 0 에서
  perf.ev.forEach(e => {
    const on = e.perc ? 0x99 : 0x90, off = e.perc ? 0x89 : 0x80, md = e.perc ? 39 : e.midi, t0 = Math.max(0, e.time);
    evs.push({ t: secToTick(t0), d: [on, md, Math.round(e.vel * 110) + 10] }); evs.push({ t: secToTick(t0 + e.dur), d: [off, md, 0], off: 1 });
  });
  if (settings.chordAccomp) perf.chords.forEach(c => {
    [c.tones.bass, ...c.tones.tones].forEach(m => { evs.push({ t: secToTick(c.time), d: [0x91, m, 60] }); evs.push({ t: secToTick(c.time + c.dur * .97), d: [0x81, m, 0], off: 1 }); });
  });
  evs.sort((a, b) => a.t - b.t || (b.off || 0) - (a.off || 0));
  const bytes = [];
  const vlq = n => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const mpq = Math.round(60000000 / tempo);
  bytes.push(0, 0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255);
  bytes.push(0, 0xff, 0x58, 4, s.time.num, Math.log2(s.time.den), 24, 8);
  bytes.push(0, 0xc0, 0, 0, 0xc1, 0);
  let last = 0;
  evs.forEach(e => { bytes.push(...vlq(Math.max(0, e.t - last)), ...e.d); last = e.t; });
  bytes.push(0, 0xff, 0x2f, 0);
  const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (DIV >> 8) & 255, DIV & 255];
  const len = bytes.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255];
  return new Blob([new Uint8Array(hdr.concat(trk, bytes))], { type: 'audio/midi' });
}

/* ---------- MIDI 읽기 → 16분음표 격자 ---------- */
function parseMidi(buf) {
  const d = new Uint8Array(buf);
  let p = 0;
  const u32 = () => (d[p++] << 24 | d[p++] << 16 | d[p++] << 8 | d[p++]) >>> 0;
  const u16 = () => d[p++] << 8 | d[p++];
  if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'MThd') throw new Error('MIDI 파일이 아니에요');
  p = 4; const hl = u32(); u16(); const ntr = u16(); const div = u16(); p = 8 + hl;
  const notes = [];
  for (let tr = 0; tr < ntr && p < d.length; tr++) {
    if (String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]) !== 'MTrk') break;
    p += 4; const len = u32(); const end = p + len;
    let t = 0, rs = 0;
    const open = {};
    while (p < end) {
      let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80);
      t += v;
      let st = d[p];
      if (st & 0x80) p++; else st = rs;
      if (st === 0xff) { p++; let l = 0; do { b = d[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80); p += l; continue; }
      if (st === 0xf0 || st === 0xf7) { let l = 0; do { b = d[p++]; l = (l << 7) | (b & 0x7f); } while (b & 0x80); p += l; continue; }
      rs = st;
      const type = st & 0xf0, ch = st & 15;
      if (type === 0xc0 || type === 0xd0) { p++; continue; }
      const a = d[p++], bb = d[p++];
      if (ch === 9) continue;
      if (type === 0x90 && bb > 0) open[a] = t;
      else if (type === 0x80 || (type === 0x90 && bb === 0)) { if (open[a] !== undefined) { notes.push({ s: open[a], e: t, m: a }); delete open[a]; } }
    }
    p = end;
  }
  // 16분 격자, 같은 때 여러 음이면 맨 위 음
  const q16 = div / 4;
  const byStart = new Map();
  notes.forEach(n => { const s = Math.round(n.s / q16); const e = Math.max(s + 1, Math.round(n.e / q16)); const c = byStart.get(s); if (!c || n.m > c.m) byStart.set(s, { s, e, m: n.m }); });
  const arr = [...byStart.values()].sort((a, b) => a.s - b.s);
  for (let k = 0; k < arr.length - 1; k++) arr[k].e = Math.min(arr[k].e, arr[k + 1].s);
  return arr;
}
