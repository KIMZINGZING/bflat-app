'use strict';
/* ===== BFlat Studio — 편집기 / 화면 ===== */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
const MODES = [['note', '음표', 'F1'], ['harm', '화음', 'H'], ['slur', '이음줄', 'F2'], ['bar', '마디선', 'F3'], ['chord', '코드', 'F4'], ['lyric', '가사', 'F5'], ['form', '송폼', 'F6'], ['measure', '마디 편집', 'F7']];
const FORMS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Interlude', 'Solo', 'Outro', 'Ending'];
const DYNS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
const ARTS = [['accent', '>', '악센트'], ['staccato', '·', '스타카토'], ['tenuto', '–', '테누토'], ['marcato', '^', '마르카토'], ['fermata', '𝄐', '늘임표']];
const DUR_GLYPH = { w: '𝅝', h: '𝅗𝅥', q: '♩', e: '♪', s: '𝅘𝅥𝅯' };

const App = {
  s: null, ctxs: [], lay: null, mode: 'note', write: false, sel: [], anchor: null,
  selMeasures: [], mAnchor: null, curDur: 'q', zoom: 1, verse: 0, playStart: { m: 0, t: 0 },
  selSlur: null, selBar: null, widthEdit: false, chordEdit: null, hoverMeasure: null, clipboard: null,
  fileHandle: null, drag: null,
  settings: { chordAccomp: false, timbre: 'piano', volume: .8, scoreFont: 'main', theme: 'dark', paper: 'cream', paperAlpha: 1, winAlpha: 1, lang: 'ko' }
};

/* ---------- 기본 ---------- */
function S() { return App.s; }
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms || 2200);
}
function commit(fn, keepRender) {
  History.push(App.s);
  const r = fn();
  changed(keepRender);
  return r;
}
let _saveT = 0;
function changed(noRender) {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { if (App.blank) return; try { localStorage.setItem('bflat.autosave', JSON.stringify(App.s)); $('#stSave').textContent = '자동 저장됨 (이 브라우저)'; } catch (e) { $('#stSave').textContent = '자동 저장 안 됨'; } }, 300);
  if (!noRender) render();
}
function saveSettings() { try { localStorage.setItem('bflat.settings', JSON.stringify(App.settings)); } catch (e) { } }

/* ---------- 찾기 도우미 ---------- */
function nStaves() { return staffCount(S()); }
/** 음표 찾기 (모든 줄) → { mi, ni, n, m, si, arr } */
function findNote(id) {
  const ms = S().measures, ns = nStaves();
  for (let mi = 0; mi < ms.length; mi++) for (let si = 0; si < ns; si++) {
    const arr = SNr(ms[mi], si), ni = arr.findIndex(n => n.id === id);
    if (ni >= 0) return { mi, ni, n: arr[ni], m: ms[mi], si, arr: SN(ms[mi], si) };
    const ov = OVr(ms[mi], si), oi = ov.findIndex(n => n.id === id);
    if (oi >= 0) return { mi, ni: oi, n: ov[oi], m: ms[mi], si, arr: OV(ms[mi], si), ov: true };
  }
  return null;
}
/** 음표 목록 (si를 주면 그 줄만, 아니면 줄 순서대로 전부) */
function allNotes(si) {
  const out = [];
  const list = si === undefined ? Array.from({ length: nStaves() }, (_, k) => k) : [si];
  list.forEach(s0 => S().measures.forEach((m, mi) => SNr(m, s0).forEach((n, ni) => out.push({ n, mi, ni, si: s0 }))));
  return out;
}
/** 그 줄 음표 배열 바꾸기 */
function setSN(m, si, arr) { if (!si) m.notes = arr; else { m.sn = m.sn || {}; m.sn[si] = arr; } }
/** 모든 줄에서 조건에 맞는 음표 빼기 */
function filterAllNotes(keep) { S().measures.forEach(m => { const ns = nStaves(); for (let si = 0; si < ns; si++) { setSN(m, si, SNr(m, si).filter(keep)); if (m.ov && m.ov[si]) m.ov[si] = m.ov[si].filter(keep); } }); }
function selNotes() { return App.sel.map(findNote).filter(Boolean); }
function lineOf(mi) { let acc = 0; const L = S().lines; for (let li = 0; li < L.length; li++) { if (mi < acc + L[li]) return { li, start: acc, count: L[li] }; acc += L[li]; } return { li: L.length - 1, start: acc - L[L.length - 1], count: L[L.length - 1] }; }
function curStaff() { return Math.min(App.staff || 0, nStaves() - 1); }
function defaultPitch(si) { return { d: clefMidD(staffClef(S(), si === undefined ? curStaff() : si)), a: 0 }; }
/** 개수만 정한 자리표 음: 높은음자리표 = 솔(G4) · 낮은음자리표 = 레(D3) · 가온음자리표 = 가운데 줄 */
function placeholderPitch(si) { const cl = staffClef(S(), si); return cl === 'bass' ? { d: 22, a: 0 } : isCClef(cl) ? { d: clefMidD(cl), a: 0 } : { d: 32, a: 0 }; }
function pitchAtPos(mi, pos, si) {
  const d = bottomD(staffClef(S(), si === undefined ? curStaff() : si)) + Math.max(-10, Math.min(18, pos));
  const c = App.ctxs[mi] || { key: S().key };
  // 같은 마디 앞쪽 임시표 이어받기
  return { d, a: keyAlter(c.key, mod(d, 7)) };
}
function setPlayStart(mi, t) { App.playStart = { m: mi, t: t || 0 }; }
function removeSlursFor(ids) { const set = new Set(ids); S().slurs = S().slurs.filter(x => !set.has(x.a) && !set.has(x.b)); }

/* ---------- 그리기 ---------- */
function render() {
  const s = App.s;
  App.ctxs = computeContexts(s);
  App.lay = computeLayout(s, App.ctxs, {});
  // 한 줄에 다 안 들어가면(마디 여백을 줄여도 음표·가사·계이름이 겹치면) 그 줄을 나눠요
  //  (조옮김으로 ♭·♯ 계이름이 넓어졌을 때, 계이름을 켰을 때, 음표를 많이 넣었을 때)
  if (!App.blank && App.lay.systems.some(sy => sy.overflow && sy.idxs.length > 1) && refitLines(s)) App.lay = computeLayout(s, App.ctxs, {});
  const st = { sel: App.sel, selMeasures: App.selMeasures, mode: App.mode, write: App.write, verse: App.verse, playStart: App.playStart, selSlur: App.selSlur, selBar: App.selBar, widthEdit: App.widthEdit, chordEdit: App.chordEdit, hoverMeasure: App.hoverMeasure, scoreFont: App.settings.scoreFont, staff: curStaff(), head: App.head, hc: App.hc };
  const pages = App.blank ? [] : renderScore(s, App.ctxs, App.lay, st);
  const z = App.zoom;
  $('#pages').innerHTML = pages.map(p => `<div class="page" data-page="${p.index}" style="width:${L.PW * z}px;height:${p.h * z}px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.PW} ${f1(p.h)}" width="${L.PW * z}" height="${f1(p.h * z)}">${p.parts.join('')}</svg></div>`).join('');
  document.body.dataset.mode = App.mode;
  document.body.classList.toggle('writing', App.write);
  updateStatus();
}
function updateStatus() {
  const s = S(), c = App.ctxs;
  const bad = c.filter(x => x.status === 'short' || x.status === 'over').length;
  const empty = c.filter(x => x.status === 'empty').length;
  const keyNm = s.key ? KEY_NAMES[s.key].split(' / ')[0] : '';
  $('#stInfo').textContent = LG(`${s.measures.length}마디 · ${s.time.num}/${s.time.den}${keyNm ? ' · ' + keyNm + '장조' : ''}`,
    `${s.measures.length} measures · ${s.time.num}/${s.time.den}${keyNm ? ' · ' + keyNm + ' major' : ''}`,
    `${s.measures.length}小節 · ${s.time.num}/${s.time.den}${keyNm ? ' · ' + keyNm + '長調' : ''}`);
  const ps = App.playStart;
  $('#stStart').innerHTML = (ps.m === 0 && ps.t === 0) ? LG('▶ 처음부터', '▶ From start', '▶ 最初から') : LG(`▶ ${ps.m + 1}마디부터`, `▶ From m.${ps.m + 1}`, `▶ ${ps.m + 1}小節から`);
  const order = playOrder(s);
  const simple = order.length === s.measures.length && order.every((v, k) => v === k);
  $('#stOrder').textContent = App.mode === 'bar' || !simple ? `${LG('재생 순서', 'Playback order', '再生順')} ${orderToText(order)}` : '';
  $$('.chk-beats').forEach(b => { b.className = 'btn chk-beats ' + (bad ? 'warn' : 'good'); b.textContent = bad ? LG(`박자 안 맞는 마디 ${bad}개 →`, `${bad} measures with wrong beats →`, `拍が合わない小節 ${bad}個 →`) : LG('박자 모두 맞음 ✓', 'All beats OK ✓', '拍はすべてOK ✓'); });
  $$('.chk-empty').forEach(b => { b.style.display = empty ? '' : 'none'; b.textContent = LG(`작업하지 않은 마디 ${empty}개 →`, `${empty} measures not worked on →`, `作業していない小節 ${empty}個 →`); });
  $('#zoomLbl').textContent = Math.round(App.zoom * 100) + '%';
  $('#btnPlay').innerHTML = Player.playing ? '■ 정지' : '▶ 재생';
  // 음표 모드 버튼 상태
  const has = App.sel.length > 0;
  $$('.need-sel').forEach(b => b.disabled = !has);
  const ns = selNotes();
  $$('[data-art]').forEach(b => b.classList.toggle('on', has && ns.every(x => (x.n.art || []).includes(b.dataset.art))));
  $$('[data-dur]').forEach(b => b.classList.toggle('on', has ? ns.some(x => x.n.dur === b.dataset.dur) : App.curDur === b.dataset.dur));
  const dotB = $('#bDot'); if (dotB) dotB.classList.toggle('on', has && ns.every(x => x.n.dots));
  const triB = $('#bTri'); if (triB) triB.classList.toggle('on', has && ns.every(x => x.n.tri));
  const dynS = $('#selDyn'); if (dynS) { dynS.disabled = !has; dynS.value = has && ns[0] && ns[0].n.dyn ? ns[0].n.dyn : ''; }
  const wb = $('#bWrite'); if (wb) { wb.classList.toggle('on', App.write); wb.innerHTML = `✎ 쓰기 모드 ${App.write ? '켬' : '끔'}`; }
  const tb = $('#bTieToggle'); if (tb) { const sl = S().slurs.find(x => x.id === App.selSlur); tb.disabled = !sl; tb.textContent = sl && sl.type === 'tie' ? '이음줄로 바꾸기' : '붙임줄로 바꾸기'; }
  const td = $('#bSlurDel'); if (td) td.disabled = !App.selSlur;
  $$('[data-verse]').forEach(b => b.classList.toggle('on', +b.dataset.verse === App.verse));
  const we = $('#bWidthEdit'); if (we) we.classList.toggle('on', App.widthEdit);
  $$('.need-msel').forEach(b => b.disabled = !App.selMeasures.length);
  $('[data-act="undo"]').disabled = !History.stack.length;
  $('[data-act="redo"]').disabled = !History.redoStack.length;
}

/* ---------- 모드 / 아래 막대 ---------- */
function statusButtons() { return `<span class="grow"></span><button class="btn chk-beats good" data-act="nextBad">박자 모두 맞음 ✓</button><button class="btn chk-empty" data-act="nextEmpty">작업하지 않은 마디 →</button>`; }
function setMode(m) {
  if (App.mode === m) return;
  closeEditors(); closePop();
  const from = App.mode;
  App.mode = m;
  App.selSlur = null; App.chordEdit = null;
  App.head = null; App.lastTone = null;
  if (m === 'harm') {
    App.write = false;
    // 화음 탭: 고른 음표의 박에서 화음 넣을 자리(커서) 시작
    const f = App.sel.length ? findNote(App.sel[0]) : null;
    if (f) App.hc = { mi: f.mi, si: f.si, t: f.ov ? (f.n.t || 0) : App.lay.meas[f.mi].startsSt[f.si][f.ni] };
    else App.hc = { mi: App.selMeasures.length ? App.selMeasures[0] : (App.playStart.m || 0), si: curStaff(), t: App.selMeasures.length ? 0 : (App.playStart.t || 0) };
    const h0 = harmAt(App.hc.mi, App.hc.si, App.hc.t);
    App.sel = h0 ? [h0.id] : [];
    toast('화음 탭 · 멜로디 잠김 · ←→ = 화음 넣을 자리 · 길이 키 = 그 자리에 화음 음 (멜로디와 리듬 달라도 돼요) · Esc/H = 끝', 4200);
  } else if (from === 'harm') toast('화음 쌓기 끝 · 이제 멜로디를 고칠 수 있어요');
  if (m !== 'measure') { App.widthEdit = false; App.selBar = null; }
  if (m !== 'measure' && m !== 'bar') App.selMeasures = [];
  $$('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  buildSubbar();
  render();
}
function buildSubbar() {
  const sb = $('#subbar');
  const m = App.mode;
  let h = '';
  if (m === 'note') {
    h = `<div class="hint">마디 클릭 / Caps Lock = 음표 개수 고르기 · 길이 = 3:16분음표 \`:8분음표 1:4분음표 2:2분음표 4:온음표 · ↑↓ = 음높이 · H = 화음 · Alt+↑↓ = 줄 바꾸기 · ←→/Enter = 다음 음표 · 빈 곳 끌기 = 여러 개 고르기 · 고른 음표 끌기 = 다른 마디로 · N = 쓰기 모드</div>
    <button class="btn" id="bWrite" data-act="toggleWrite">✎ 쓰기 모드 끔</button>
    <div class="seg">${['w', 'h', 'q', 'e', 's'].map(d => `<button class="btn mus" data-dur="${d}" title="${DUR_KO[d]} (${Object.keys(NUMKEY_DUR).find(k => NUMKEY_DUR[k] === d)})">${DUR_GLYPH[d]}</button>`).join('')}</div>
    <button class="btn" id="bDot" data-act="dot" title="점 붙이기 (.)">점 붙이기 •</button>
    <button class="btn need-sel" id="bTri" data-act="tri" title="셋잇단 (T)">셋잇단</button>
    <button class="btn" id="bChord" data-act="chordMode" title="화음 탭으로 (H) — 멜로디는 잠그고 화음만 쌓아요">화음 쌓기 → H</button>
    <span class="sep"></span>
    <div class="seg">${ARTS.map(([k, g, t]) => `<button class="btn need-sel art" data-art="${k}" title="${t}">${g}</button>`).join('')}</div>
    <select id="selDyn" class="btn need-sel" title="셈여림"><option value="">셈여림</option>${DYNS.map(d => `<option value="${d}">${d}</option>`).join('')}<option value="-">지우기</option></select>
    <button class="btn need-sel" data-act="text" title="템포·표현 글자 (rit., Swing, ♩=100 …)">글자…</button>
    <span class="sep"></span>
    <button class="btn primary" data-act="fillAll">모든 부족한 박자를 쉼표로 채움</button>
    <button class="btn outline" data-act="fillWorked">작업한 마디만 쉼표로 채움</button>
    <span class="sep"></span>
    <button class="btn" data-act="toMeasure">줄·마디 편집 →</button>`;
  } else if (m === 'harm') {
    h = `<div class="hint"><b class="lock">🔒 멜로디 잠김</b> · ←→/클릭 = 화음 넣을 자리 · 길이 키(3 \` 1 2 4) = 그 자리에 화음 음 (리듬 따로 · 마디당 16개까지) · . = 점 · ↑↓/A~G = 높이 · Insert = 한 음 더 · Delete = 지우기 · Esc/H = 끝</div>
    <div class="seg">${['w', 'h', 'q', 'e', 's'].map(d => `<button class="btn mus" data-dur="${d}" title="${DUR_KO[d]} 화음 음 얹기 (${Object.keys(NUMKEY_DUR).find(k => NUMKEY_DUR[k] === d)})">${DUR_GLYPH[d]}</button>`).join('')}</div>
    <button class="btn" id="bDot" data-act="dot" title="방금 얹은 화음 음에 점 (.)">점 붙이기 •</button>
    <span class="sep"></span>
    <button class="btn primary" data-act="harmDone">화음 쌓기 끝 → 음표</button>`;
  } else if (m === 'slur') {
    h = `<div class="hint one">음표를 누른 채 다른 음표로 끌어 놓기 = 이음줄 · 줄을 클릭해 고르고 "붙임줄로 바꾸기"(T) = 붙임줄 ↔ 이음줄 · Delete = 지우기</div>
    <button class="btn" id="bTieToggle" data-act="toggleTie" disabled>붙임줄로 바꾸기</button><button class="btn" id="bSlurDel" data-act="delSlur" disabled>지우기</button>`;
  } else if (m === 'bar') {
    h = `<div class="hint one">마디선 클릭 = 도돌이표·겹세로줄·끝세로줄 · 마디 클릭 = 1·2번 괄호, D.S., Coda, Fine · 끌기·Shift+클릭 = 여러 마디에 괄호를 한꺼번에</div>`;
  } else if (m === 'chord') {
    h = `<div class="hint one">마디 위 점(또는 점 사이 빈 곳 = 가장 가까운 반 박)을 클릭해 코드 입력 · Enter = 저장 · Space = 반 박씩 옮기기 · Tab = 다음 점 · 빈칸으로 저장 = 지우기</div>`;
  } else if (m === 'lyric') {
    const n = S().lyricLines || 1;
    h = `<div class="hint one">마디 클릭 → 그 마디 가사 ([두근]처럼 묶으면 한 음에 두 글자 · _ = 한 음 건너뛰기) · Enter = 다음 마디 · 가사 줄 수는 곡 정보에서</div>
    ${n > 1 ? `<div class="seg">${Array.from({ length: n }, (_, k) => `<button class="btn" data-verse="${k}">${k + 1}절</button>`).join('')}</div>` : ''}`;
  } else if (m === 'form') {
    h = `<div class="hint one">마디 위쪽 클릭 → Intro, Verse, Chorus … (직접 입력도 돼요)</div>`;
  } else if (m === 'measure') {
    h = `<div class="hint">마디 클릭 / Shift+클릭 / 끌기 = 마디 고르기 · 고른 마디 끌기 = 옮기기 · Ctrl+C/X/V · Delete · Insert</div>
    <button class="btn need-msel" data-act="mAdd">마디 추가하기</button>
    <button class="btn need-msel" data-act="mDel">마디 지우기</button>
    <span class="sep"></span>
    <button class="btn need-msel" data-act="lineBefore">앞에 줄 넣기</button>
    <button class="btn need-msel" data-act="lineAfter">뒤에 줄 넣기</button>
    <label class="mini">새 줄 <input id="newLineCount" type="number" min="1" max="12" value="${S().lines[0] || 4}"> 마디</label>
    <button class="btn need-msel" data-act="lineDel">줄 지우기</button>
    <span class="sep"></span>
    <span class="mini">마디 폭</span>
    <button class="btn" id="bWidthEdit" data-act="widthEdit">직접 수정</button>
    <button class="btn" data-act="widthSame">이 줄 똑같이</button>
    <button class="btn" data-act="widthAuto">자동 수정</button>`;
  }
  sb.innerHTML = h + statusButtons();
  updateStatus();
}

/* ---------- 음표 편집 ---------- */
function editNotes(fn) {
  const ns = selNotes();
  if (!ns.length) return false;
  commit(() => ns.forEach(x => { fn(x.n, x); x.n.edited = true; }));
  return true;
}
function setDur(d) {
  // 화음 탭: 길이 키 = 고른 멜로디 음 위에 그 길이로 음 하나 얹기 (멜로디는 그대로)
  if (App.mode === 'harm') return harmPlace(d);
  if (!App.sel.length) { App.curDur = d; updateStatus(); toast(`${DUR_KO[d]}로 쓰기`); return; }
  App.curDur = d;
  editNotes(n => { n.dur = d; n.full = false; n.ph = false; });
}
/** . = 고른 음표에 바로 점 붙이기/떼기 (화음 탭에서는 방금 얹은 화음 음에) */
function toggleDot() {
  if (App.mode === 'harm') return harmDot();
  if (!App.sel.length) return;
  const all = selNotes().every(x => x.n.dots);
  editNotes(n => { n.dots = all ? 0 : 1; n.full = false; n.ph = false; });
}
function toggleTri() { if (!App.sel.length) return; const all = selNotes().every(x => x.n.tri); editNotes(n => { n.tri = !all; n.ph = false; }); }
function toggleRest() {
  editNotes((n, x) => { n.rest = !n.rest; n.full = false; n.ph = false; if (!n.rest && !n.p) n.p = defaultPitch(x.si); if (n.rest) n.ps = []; });
  App.head = null;
}
function previewSel() {
  const x = selNotes()[0];
  if (!x || !x.n.p || x.n.rest) return;
  if (App.head && App.head.id === x.n.id) { const p = headPitch(x.n, App.head.k); if (p) Player.preview(pitchMidi(p), App.settings); return; }
  notePitches(x.n).forEach(p => Player.preview(pitchMidi(p), App.settings));
}
/* ----- 화음 ----- */
/** k = -1 이면 원래 음, 0.. 이면 얹은 음 */
function headPitch(n, k) { return k < 0 ? n.p : (n.ps || [])[k]; }
function setHeadPitch(n, k, p) { if (k < 0) n.p = p; else n.ps[k] = p; }
/** 박 위치 (원래 성부는 순서로, 화음 성부는 n.t) */
function noteStart(x) { return x.ov ? (x.n.t || 0) : App.lay.meas[x.mi].startsSt[x.si][x.ni]; }
/* ===== 화음 탭: 화음 성부 (멜로디와 리듬이 따로) =====
 * App.hc = { mi, si, t } : 화음 넣을 자리 (←→ 로 옮겨요)
 * 길이 키 = 그 자리에서 시작하는 화음 음 넣기 (이미 있으면 길이 바꾸기)
 * 화음 음이 멜로디와 같은 박·같은 길이면 한 기둥으로 합쳐 그려요
 */
const HARM_MAX = 16;
function harmAt(mi, si, t) { return OVr(S().measures[mi], si).find(n => (n.t || 0) === t); }
/** 그 자리에서 울리는 멜로디 음 */
function melodyAt(mi, si, t) {
  const g = App.lay.meas[mi], arr = SNr(S().measures[mi], si), c = App.ctxs[mi];
  return arr.find((n, q) => { const s0 = g.startsSt[si][q]; return s0 <= t && t < s0 + noteTicks(n, c.cap); });
}
/** ←→ 로 설 수 있는 자리: 멜로디 박 + 화음 음 시작·끝 */
function harmStops(mi, si) {
  const m = S().measures[mi], c = App.ctxs[mi], g = App.lay.meas[mi];
  const set = new Set([0]);
  (g.startsSt[si] || []).forEach(t => set.add(t));
  OVr(m, si).forEach(n => { const t = n.t || 0; set.add(t); set.add(t + noteTicks(n, c.cap)); });
  return [...set].filter(t => t < c.cap).sort((a, b) => a - b);
}
function setHC(mi, si, t, opts) {
  App.hc = { mi, si, t };
  App.staff = si;
  const h = harmAt(mi, si, t);
  App.sel = h ? [h.id] : [];
  if (!opts || !opts.keepHead) App.head = null;
  App.selMeasures = [];
  setPlayStart(mi, t);
  render();
  scrollToMeasureIfHidden(mi);
  if (h) previewSel();
}
function harmNav(dir, byMeasure) {
  const hc = App.hc || { mi: 0, si: curStaff(), t: 0 };
  const M = S().measures.length;
  if (byMeasure) { const mi = hc.mi + dir; if (mi < 0 || mi >= M) return; return setHC(mi, hc.si, 0); }
  const st = harmStops(hc.mi, hc.si);
  let k = st.indexOf(hc.t);
  if (k < 0) k = st.findIndex(t => t > hc.t) - (dir > 0 ? 1 : 0);
  const nk = k + dir;
  if (nk >= 0 && nk < st.length) return setHC(hc.mi, hc.si, st[nk]);
  const mi = hc.mi + dir;
  if (mi < 0 || mi >= M) return;
  const st2 = harmStops(mi, hc.si);
  setHC(mi, hc.si, dir > 0 ? st2[0] : st2[st2.length - 1]);
}
/** 화음 음이 [t, t+len) 에 들어갈 수 있는지 (다른 화음 음과 겹치지 않게) */
function harmFits(m, si, t, len, self, cap) {
  if (t + len > cap) return '그 길이는 마디를 넘어가요';
  const clash = OVr(m, si).some(o => o !== self && (o.t || 0) < t + len && t < (o.t || 0) + noteTicks(o, cap));
  return clash ? '뒤(또는 앞) 화음 음과 겹쳐요 · 짧은 길이로 하거나 그 음을 먼저 지우세요' : '';
}
/** 길이 키: 그 자리에 화음 음 넣기 / 이미 있으면 길이 바꾸기 */
function harmPlace(d) {
  if (!App.hc) { toast('화음 넣을 자리를 먼저 고르세요 (클릭 또는 ←→)'); return; }
  const { mi, si, t } = App.hc, m = S().measures[mi], c = App.ctxs[mi];
  const ex = harmAt(mi, si, t);
  const len = DUR_T[d];
  const err = harmFits(m, si, t, len, ex, c.cap);
  if (err) { toast(err); return; }
  if (ex) {
    commit(() => { ex.dur = d; ex.dots = 0; ex.ph = false; });
  } else {
    if (OVr(m, si).length >= HARM_MAX) { toast(`화음 음은 한 마디에 ${HARM_MAX}개까지예요`); return; }
    const mel = melodyAt(mi, si, t);
    let p;
    if (mel && !mel.rest && mel.p) { const low = notePitches(mel).reduce((a, q) => q.d < a.d ? q : a); const nd = Math.max(7, low.d - 2); p = { d: nd, a: keyAlter(c.key, mod(nd, 7)) }; }
    else p = defaultPitch(si);
    const n2 = newNote(d, p); n2.t = t; n2.edited = true;
    commit(() => OV(m, si).push(n2));
  }
  App.curDur = d;
  setHC(mi, si, t);
}
/** . : 그 자리 화음 음에 바로 점 */
function harmDot() {
  const hc = App.hc; const ex = hc && harmAt(hc.mi, hc.si, hc.t);
  if (!ex) { toast('이 자리에 화음 음이 없어요 · 먼저 길이 키로 넣으세요'); return; }
  const m = S().measures[hc.mi], c = App.ctxs[hc.mi];
  const nd = ex.dots ? 0 : 1, len = Math.round(DUR_T[ex.dur] * (nd ? 1.5 : 1));
  const err = harmFits(m, hc.si, hc.t, len, ex, c.cap);
  if (err) { toast(err); return; }
  commit(() => ex.dots = nd);
  setHC(hc.mi, hc.si, hc.t);
}
/** ↑↓ · A~G : 그 자리 화음 음 높이 (화음 음 안의 한 머리를 클릭해 골랐으면 그것만) */
function harmPitch(dir, kind, letter) {
  const hc = App.hc; const ex = hc && harmAt(hc.mi, hc.si, hc.t);
  if (!ex) { toast('멜로디는 잠겨 있어요 · 이 자리에 화음 음을 먼저 넣으세요'); return; }
  const key = App.ctxs[hc.mi].key;
  const shift = p => {
    p = { d: p.d, a: p.a };
    if (letter) { const step = STEPS.indexOf(letter); let best = null; for (let o = 1; o <= 7; o++) { const d = o * 7 + step; if (best === null || Math.abs(d - p.d) < Math.abs(best - p.d)) best = d; } return { d: best, a: keyAlter(key, step) }; }
    if (kind === 'oct') p.d += 7 * dir;
    else if (kind === 'semi') p = midiToPitch(pitchMidi(p) + dir, key, dir);
    else { p.d += dir; p.a = keyAlter(key, mod(p.d, 7)); }
    p.d = Math.max(7, Math.min(63, p.d));
    return p;
  };
  const hd = App.head && App.head.id === ex.id ? App.head.k : null;
  commit(() => {
    if (hd !== null && hd >= 0) ex.ps[hd] = shift(ex.ps[hd]);
    else if (hd === -1 || letter) ex.p = shift(ex.p);
    else { ex.p = shift(ex.p); ex.ps = (ex.ps || []).map(shift); }
  });
  setHC(hc.mi, hc.si, hc.t, { keepHead: true });
}
/** Insert : 그 자리 화음 음에 한 음 더 (3도 아래) */
function harmAddTone() {
  const hc = App.hc; const ex = hc && harmAt(hc.mi, hc.si, hc.t);
  if (!ex) { toast('이 자리에 화음 음이 없어요'); return; }
  const key = App.ctxs[hc.mi].key;
  const low = notePitches(ex).reduce((a, q) => q.d < a.d ? q : a);
  const nd = Math.max(7, low.d - 2);
  commit(() => ex.ps = (ex.ps || []).concat([{ d: nd, a: keyAlter(key, mod(nd, 7)) }]));
  App.head = { id: ex.id, k: ex.ps.length - 1 };
  setHC(hc.mi, hc.si, hc.t, { keepHead: true });
}
/** Delete : 그 자리 화음 음 지우기 (한 머리만 골랐으면 그 머리만) */
function harmDelete() {
  const hc = App.hc; const ex = hc && harmAt(hc.mi, hc.si, hc.t);
  if (!ex) { toast('멜로디는 잠겨 있어요 · 지울 화음 음이 이 자리에 없어요'); return; }
  const hd = App.head && App.head.id === ex.id ? App.head.k : null;
  if (hd !== null && hd >= 0) commit(() => ex.ps.splice(hd, 1));
  else commit(() => { const arr = OV(S().measures[hc.mi], hc.si); arr.splice(arr.indexOf(ex), 1); removeSlursFor([ex.id]); });
  App.head = null;
  setHC(hc.mi, hc.si, hc.t);
}

function moveStep(dir, kind) {
  const hd = App.head;
  const ok = editNotes((n, x) => {
    if (n.rest) { n.rest = false; if (!n.p) n.p = defaultPitch(x.si); return; }
    if (!n.p) n.p = defaultPitch(x.si);
    const key = App.ctxs[x.mi].key;
    // 화음의 한 음만 고른 상태면 그 음만, 아니면 화음 전체를 함께
    const ks = (hd && hd.id === n.id) ? [hd.k] : [-1].concat((n.ps || []).map((_, k) => k));
    ks.forEach(k => {
      let p = headPitch(n, k); if (!p) return;
      p = { d: p.d, a: p.a };
      if (kind === 'oct') p.d += 7 * dir;
      else if (kind === 'semi') p = midiToPitch(pitchMidi(p) + dir, key, dir);
      else { p.d += dir; p.a = keyAlter(key, mod(p.d, 7)); }
      p.d = Math.max(7, Math.min(63, p.d));
      setHeadPitch(n, k, p);
    });
  });
  if (ok) previewSel();
}
function setLetter(L) {
  const hd = App.head;
  const ok = editNotes((n, x) => {
    const step = STEPS.indexOf(L);
    const key = App.ctxs[x.mi].key;
    const k = (hd && hd.id === n.id) ? hd.k : -1;
    const cur = headPitch(n, k);
    let ref = cur ? cur.d : defaultPitch(x.si).d;
    if (!cur) { const prev = prevNote(x.n.id); if (prev && prev.n.p) ref = prev.n.p.d; }
    let best = null;
    for (let o = 1; o <= 7; o++) { const d = o * 7 + step; if (best === null || Math.abs(d - ref) < Math.abs(best - ref)) best = d; }
    if (k < 0) { n.p = { d: best, a: keyAlter(key, step) }; n.rest = false; } else setHeadPitch(n, k, { d: best, a: keyAlter(key, step) });
  });
  if (ok) previewSel();
}
function prevNote(id) { const f = findNote(id); if (!f) return null; const a = allNotes(f.si); const k = a.findIndex(x => x.n.id === id); return k > 0 ? a[k - 1] : null; }
/** 이동할 자리: 음표마다 한 칸, 빈 마디는 마디 자체가 한 칸 (지금 줄 안에서) */
function navStops(si) {
  const out = [];
  S().measures.forEach((m, mi) => { const arr = SNr(m, si); if (arr.length) arr.forEach(n => out.push({ mi, id: n.id })); else out.push({ mi, id: null }); });
  return out;
}
/** 빈 마디에 서 있는 커서 (음표 모드) */
function emptyCursor() {
  if (App.mode !== 'note' || App.sel.length || App.selMeasures.length !== 1) return null;
  const mi = App.selMeasures[0];
  return S().measures[mi] && !SNr(S().measures[mi], curStaff()).length ? mi : null;
}
/** 화음 성부 안에서 ←→ (Ctrl = 다음 마디의 첫 화음 음) */
function navOverlay(f, dir, byMeasure) {
  const list = [];
  S().measures.forEach((m, mi) => OVr(m, f.si).slice().sort((a, b) => ((a.t || 0) - (b.t || 0)) || ((a.p ? a.p.d : 0) - (b.p ? b.p.d : 0))).forEach(n => list.push({ mi, n })));
  const k = list.findIndex(x => x.n.id === f.n.id);
  let nk;
  if (byMeasure) {
    nk = dir > 0 ? list.findIndex(x => x.mi > f.mi) : (() => { const prev = [...list].reverse().find(x => x.mi < f.mi); return prev ? list.findIndex(x => x.mi === prev.mi) : -1; })();
  } else nk = k + dir;
  if (nk < 0 || nk >= list.length) return false;
  const it = list[nk];
  App.sel = [it.n.id]; App.anchor = it.n.id; App.selMeasures = []; App.lastTone = null;
  setPlayStart(it.mi, it.n.t || 0);
  render(); scrollToNote(it.n.id); previewSel();
  return true;
}
function navNote(dir, byMeasure) {
  App.head = null;
  if (App.sel.length) {
    const f = findNote(App.sel[App.sel.length - 1]);
    if (f) App.staff = f.si;
    // 음표 탭에서 화음 음을 골랐으면 화음 음끼리 (끝이면 멜로디로) · 화음 탭에서는 항상 멜로디 음표 사이로
    if (f && f.ov && App.mode !== 'harm' && navOverlay(f, dir, byMeasure)) return;
  }
  App.lastTone = null;
  const si = curStaff();
  const st = navStops(si);
  if (!st.length) return;
  let k = -1, curMi = null;
  if (App.sel.length) {
    let id = App.sel[App.sel.length - 1];
    // 화음으로 얹은(둘째 성부) 음이면 같은 박의 원래 음에서 출발
    const f = findNote(id);
    if (f && f.ov) { const g = App.lay.meas[f.mi]; const arr = SNr(f.m, f.si); let best = null; arr.forEach((n, q) => { if (g.startsSt[f.si][q] <= (f.n.t || 0)) best = n; }); id = best ? best.id : null; if (!id) { k = st.findIndex(x => x.mi === f.mi) - (dir > 0 ? 1 : 0); curMi = f.mi; } }
    if (id) { k = st.findIndex(x => x.id === id); if (k >= 0) curMi = st[k].mi; }
  }
  else if (App.selMeasures.length) {
    curMi = App.selMeasures[0];
    const first = st.findIndex(x => x.mi === curMi);
    k = (st[first].id === null || dir < 0) ? first : first - 1;
  }
  let nk;
  if (byMeasure) {
    const cur = curMi !== null ? curMi : (dir > 0 ? -1 : S().measures.length);
    const tMi = dir > 0 ? cur + 1 : cur - 1;
    if (tMi < 0 || tMi >= S().measures.length) return;
    nk = st.findIndex(x => x.mi === tMi);
  } else {
    nk = k < 0 ? (dir > 0 ? 0 : st.length - 1) : Math.max(0, Math.min(st.length - 1, k + dir));
  }
  goStop(st[nk]);
}
function goStop(stop) {
  if (stop.id) { App.sel = [stop.id]; App.selMeasures = []; }
  else { App.sel = []; App.selMeasures = [stop.mi]; }
  App.anchor = stop.id;
  if (stop.id) { const f = findNote(stop.id); setPlayStart(f.mi, App.lay.meas[f.mi].startsSt[f.si][f.ni]); }
  else setPlayStart(stop.mi, 0);
  render();
  if (stop.id) { scrollToNote(stop.id); previewSel(); } else scrollToMeasureIfHidden(stop.mi);
}
/** Alt+↑↓: 위/아래 줄로 (같은 마디 · 가까운 박) */
function switchStaff(dir) {
  const ns = nStaves();
  if (ns < 2) return;
  let mi = App.selMeasures[0], t = 0;
  if (App.sel.length) { const f = findNote(App.sel[0]); if (f) { App.staff = f.si; mi = f.mi; t = App.lay.meas[mi].startsSt[f.si][f.ni]; } }
  if (mi === undefined) mi = App.playStart.m;
  const si = Math.max(0, Math.min(ns - 1, curStaff() + dir));
  if (si === curStaff() && App.sel.length) return;
  App.staff = si; App.head = null;
  const arr = SNr(S().measures[mi], si);
  if (!arr.length) { goStop({ mi, id: null }); return; }
  const starts = App.lay.meas[mi].startsSt[si];
  let best = 0; starts.forEach((s0, q) => { if (Math.abs(s0 - t) < Math.abs(starts[best] - t)) best = q; });
  goStop({ mi, id: arr[best].id });
}
function scrollToMeasureIfHidden(mi) {
  const g = App.lay.meas[mi]; if (!g) return;
  const c = clientOf(g.page, g.x, g.staffTop), sr = $('#scroller').getBoundingClientRect();
  if (c.y < sr.top + 40 || c.y > sr.bottom - 80) scrollToMeasure(mi);
}
/** 빈 마디 커서에서 바로 음표/쉼표 넣기 */
function addToEmptyMeasure(mi, kind, letter) {
  const si = curStaff();
  const m = S().measures[mi];
  let n;
  if (kind === 'rest') n = newNote(App.curDur, null, true);
  else {
    let p = defaultPitch(si);
    if (letter) {
      const step = STEPS.indexOf(letter), key = App.ctxs[mi].key;
      const prevN = [...S().measures.slice(0, mi)].reverse().flatMap(x => [...SNr(x, si)].reverse()).find(x => x.p && !x.rest);
      const ref = prevN ? prevN.p.d : defaultPitch(si).d;
      let best = null;
      for (let o = 1; o <= 7; o++) { const d = o * 7 + step; if (best === null || Math.abs(d - ref) < Math.abs(best - ref)) best = d; }
      p = { d: best, a: keyAlter(key, step) };
    }
    n = newNote(App.curDur, p);
  }
  n.edited = true;
  commit(() => SN(m, si).push(n), true);
  App.sel = [n.id]; App.anchor = n.id; App.selMeasures = [];
  render(); previewSel();
}
function deleteSel() {
  const ns = selNotes();
  if (!ns.length) return;
  // 화음의 얹은 음만 고른 상태면 그 음만 지우기
  const hd = App.head;
  if (hd && ns.length === 1 && hd.id === ns[0].n.id && hd.k >= 0) {
    commit(() => ns[0].n.ps.splice(hd.k, 1));
    App.head = ns[0].n.ps.length ? { id: hd.id, k: ns[0].n.ps.length - 1 } : null;
    render(); return;
  }
  const first = ns[0];
  commit(() => {
    const ids = ns.map(x => x.n.id);
    removeSlursFor(ids);
    filterAllNotes(n => !ids.includes(n.id));
  });
  const arr = SNr(S().measures[first.mi], first.si);
  const nn = arr[Math.min(first.ni, arr.length - 1)] || arr[first.ni - 1];
  App.sel = nn ? [nn.id] : []; App.head = null;
  if (!nn) { App.selMeasures = [first.mi]; App.staff = first.si; }
  render();
}
function insertAfterSel() {
  const ns = selNotes();
  if (!ns.length) { toast('먼저 음표를 고르세요'); return; }
  const last = ns[ns.length - 1];
  if (last.ov) { toast('화음으로 얹은 음 뒤에는 새 음표를 넣을 수 없어요'); return; }
  const nn = newNote(last.n.dur, last.n.p || defaultPitch(last.si), last.n.rest);
  nn.edited = true;
  commit(() => last.arr.splice(last.ni + 1, 0, nn));
  App.sel = [nn.id]; App.head = null; render();
}
function swapSel(dir) {
  const ns = selNotes();
  if (ns.length !== 1) return;
  const a = allNotes(ns[0].si);
  const k = a.findIndex(x => x.n.id === ns[0].n.id), j = k + dir;
  if (k < 0 || j < 0 || j >= a.length) return;
  commit(() => {
    const A = a[k], B = a[j];
    SN(S().measures[A.mi], A.si)[A.ni] = B.n; SN(S().measures[B.mi], B.si)[B.ni] = A.n;
  });
  render();
}
function addSlurNext(type) {
  const ns = selNotes();
  if (!ns.length) return;
  const a = allNotes(ns[0].si);
  if (ns[0].ov) { toast('화음으로 얹은 음에는 이음줄을 바로 달 수 없어요 (F2에서 끌어서 연결)'); return; }
  const first = ns[0].n, lastSel = ns[ns.length - 1].n;
  let target;
  if (ns.length > 1) target = lastSel;
  else { const k = a.findIndex(x => x.n.id === first.id); target = a[k + 1] && a[k + 1].n; }
  if (!target) return;
  if (type === 'tie') {
    const k = a.findIndex(x => x.n.id === first.id); const nx = a[k + 1] && a[k + 1].n;
    if (!nx || first.rest || !first.p) { toast('붙임줄은 바로 옆 음끼리만 돼요'); return; }
    commit(() => {
      S().slurs = S().slurs.filter(x => !(x.a === first.id && x.type === 'tie'));
      nx.p = { d: first.p.d, a: first.p.a }; nx.ps = (first.ps || []).map(p => ({ d: p.d, a: p.a })); nx.rest = false;
      S().slurs.push({ id: uid(), a: first.id, b: nx.id, type: 'tie' });
    });
  } else commit(() => S().slurs.push({ id: uid(), a: first.id, b: target.id, type: 'slur' }));
}
function toggleArt(k) { if (!App.sel.length) return; const all = selNotes().every(x => (x.n.art || []).includes(k)); editNotes(n => { n.art = (n.art || []).filter(a => a !== k); if (!all) n.art.push(k); }); }
function setDyn(v) { editNotes(n => { n.dyn = v === '-' ? '' : v; }); }
function editText() {
  const ns = selNotes(); if (!ns.length) return;
  askText('템포·표현 글자', '예) rit., a tempo, Swing, ♩=100 (♩=숫자를 쓰면 재생 빠르기도 바뀌어요)', ns[0].n.text || '', v => editNotes(n => { n.text = v; }));
}
function fillRests(onlyWorked) {
  commit(() => {
    S().measures.forEach((m, i) => {
      const c = App.ctxs[i];
      for (let si = 0; si < nStaves(); si++) {
        const stt = c.st[si];
        if (stt.status === 'empty' && (!onlyWorked || c.status !== 'empty')) { if (onlyWorked && c.status === 'empty') continue; const r = newNote('w', null, true); r.full = true; SN(m, si).push(r); }
        else if (stt.status === 'short') restsFor(stt.sum, c.cap - stt.sum).forEach(d => { const r = newNote(d.dur, null, true); r.dots = d.dots; SN(m, si).push(r); });
      }
    });
  });
  toast(onlyWorked ? '작업한 마디를 쉼표로 채웠어요' : '부족한 박자를 모두 쉼표로 채웠어요');
}
/** 음표 개수 고르기 (그 줄) */
function setMeasureCount(mi, count, asRest, si) {
  si = si === undefined ? curStaff() : si;
  const m = S().measures[mi], c = App.ctxs[mi];
  const arr = SNr(m, si);
  let lastEdited = -1;
  arr.forEach((n, k) => { if (n.edited) lastEdited = k; });
  let keep = arr.slice(0, Math.min(count, lastEdited + 1));
  const used = keep.reduce((a, n) => a + noteTicks(n, c.full), 0);
  const rem = c.full - used;
  const need = count - keep.length;
  if (need > 0 && rem <= 0) { toast('남은 박자가 없어요'); return; }
  const parts = need > 0 ? splitFill(rem, need, isCompound(c)) : [];
  if (parts.length < need) { toast('그만큼 나눌 수 없어요'); return; }
  // 새로 채우는 음표는 "솔" 자리에 기둥 없는 머리만 (길이는 숫자키로 정하면 기둥이 생겨요)
  // 높은음자리표 = 솔(G4) · 낮은음자리표 = 레(D3, 가운데 줄)
  const pp = placeholderPitch(si);
  commit(() => {
    const removed = arr.slice(keep.length).map(n => n.id);
    removeSlursFor(removed);
    setSN(m, si, keep.concat(parts.map(p => { const n = asRest ? newNote(p.dur, null, true) : newNote(p.dur, pp); n.dots = p.dots; n.ph = true; return n; })));
  });
  const now = SNr(m, si);
  App.sel = now.length ? [now[keep.length] ? now[keep.length].id : now[0].id] : [];
  App.selMeasures = []; App.staff = si; App.head = null;
  render();
}

/* ---------- 마디 편집 ---------- */
function cloneMeasures(arr) {
  const idMap = {};
  const out = arr.map(m => { const c = clone(m); c.id = uid(); measureAllNotes(c).forEach(n => { const nid = uid(); idMap[n.id] = nid; n.id = nid; }); return c; });
  return { out, idMap };
}
function insertMeasures(at, list, li) {
  S().measures.splice(at, 0, ...list);
  S().lines[li] += list.length;
}
function deleteMeasures(idxs) {
  const s = S();
  idxs = [...new Set(idxs)].sort((a, b) => b - a);
  const lineCounts = idxs.map(i => lineOf(i).li);
  idxs.forEach((i, k) => {
    removeSlursFor(measureAllNotes(s.measures[i]).map(n => n.id));
    s.measures.splice(i, 1);
    s.lines[lineCounts[k]]--;
  });
  s.lines = s.lines.filter(c => c > 0);
  if (!s.measures.length) { s.measures.push(newMeasure()); s.lines = [1]; }
}
function addMeasureAfter(mi, before) {
  commit(() => { const ln = lineOf(mi); insertMeasures(before ? mi : mi + 1, [newMeasure()], ln.li); });
  App.selMeasures = [before ? mi : mi + 1]; render();
}
function copyMeasures(cut) {
  if (!App.selMeasures.length) return;
  const idx = [...App.selMeasures].sort((a, b) => a - b);
  const ms = idx.map(i => S().measures[i]);
  const ids = new Set(ms.flatMap(m => measureAllNotes(m).map(n => n.id)));
  App.clipboard = { measures: clone(ms), slurs: clone(S().slurs.filter(x => ids.has(x.a) && ids.has(x.b))) };
  if (cut) { commit(() => deleteMeasures(idx)); App.selMeasures = []; render(); toast(`${idx.length}마디 잘라냈어요`); }
  else toast(`${idx.length}마디 복사했어요`);
}
function pasteMeasures() {
  if (!App.clipboard) { toast('복사한 마디가 없어요'); return; }
  const at = App.selMeasures.length ? Math.max(...App.selMeasures) : S().measures.length - 1;
  const { out, idMap } = cloneMeasures(App.clipboard.measures);
  commit(() => {
    insertMeasures(at + 1, out, lineOf(at).li);
    App.clipboard.slurs.forEach(x => S().slurs.push({ id: uid(), a: idMap[x.a], b: idMap[x.b], type: x.type }));
  });
  App.selMeasures = out.map((_, k) => at + 1 + k); render();
}
function addLine(after) {
  if (!App.selMeasures.length) return;
  const n = Math.max(1, Math.min(16, +($('#newLineCount') || { value: 4 }).value || 4));
  const ln = lineOf(after ? Math.max(...App.selMeasures) : Math.min(...App.selMeasures));
  commit(() => {
    const ms = Array.from({ length: n }, () => newMeasure());
    const at = after ? ln.start + ln.count : ln.start;
    S().measures.splice(at, 0, ...ms);
    S().lines.splice(after ? ln.li + 1 : ln.li, 0, n);
  });
}
function deleteLine() {
  if (!App.selMeasures.length) return;
  const ln = lineOf(Math.min(...App.selMeasures));
  commit(() => deleteMeasures(Array.from({ length: ln.count }, (_, k) => ln.start + k)));
  App.selMeasures = []; render();
}
function moveMeasures(target) {
  const idx = [...App.selMeasures].sort((a, b) => a - b);
  if (idx.includes(target)) return;
  commit(() => {
    const s = S();
    const tId = s.measures[target].id;
    const moving = idx.map(i => s.measures[i]);
    const lines = idx.map(i => lineOf(i).li);
    for (let k = idx.length - 1; k >= 0; k--) { s.measures.splice(idx[k], 1); s.lines[lines[k]]--; }
    let t = s.measures.findIndex(m => m.id === tId);
    const after = target > idx[idx.length - 1];
    // 줄 수 계산 (빈 줄 자리를 유지한 채)
    let acc = 0, li = 0;
    for (; li < s.lines.length; li++) { if (t < acc + s.lines[li]) break; acc += s.lines[li]; }
    if (after) t++;
    s.measures.splice(t, 0, ...moving);
    s.lines[Math.min(li, s.lines.length - 1)] += moving.length;
    s.lines = s.lines.filter(c => c > 0);
    App.selMeasures = moving.map((_, k) => t + k);
  });
}
function freezeLineWidths(li) {
  const lay = App.lay;
  let st = 0; for (let k = 0; k < li; k++) st += S().lines[k];
  for (let k = 0; k < S().lines[li]; k++) { const m = S().measures[st + k]; m.width = lay.meas[st + k].w; }
}
function widthAuto() {
  commit(() => {
    let st = 0;
    S().lines.forEach(cnt => {
      const idx = Array.from({ length: cnt }, (_, k) => st + k);
      if (idx.every(i => App.ctxs[i].status === 'ok')) idx.forEach(i => { const m = S().measures[i]; m.width = 60 + Math.max(1, ...Array.from({ length: nStaves() }, (_, si) => SNr(m, si).length)) * 26; });
      st += cnt;
    });
  });
  toast('박자가 다 맞는 줄만 음표 수에 맞춰 폭을 나눴어요');
}
function widthSame() {
  const mi = App.selBar !== null ? App.selBar : (App.selMeasures[0] !== undefined ? App.selMeasures[0] : null);
  if (mi === null) { toast('마디(또는 마디선)를 먼저 고르세요'); return; }
  const ln = lineOf(mi);
  commit(() => { for (let k = 0; k < ln.count; k++) S().measures[ln.start + k].width = 0; });
}
function nudgeBar(dx) {
  const i = App.selBar; if (i === null) return;
  const ln = lineOf(i);
  if (i >= ln.start + ln.count - 1) { toast('줄 끝 마디선은 옮길 수 없어요'); return; }
  commit(() => {
    freezeLineWidths(ln.li);
    const a = S().measures[i], b = S().measures[i + 1];
    const d = Math.max(40 - a.width, Math.min(b.width - 40, dx));
    a.width += d; b.width -= d;
  });
}

/* ---------- 조옮김 ---------- */
function transposeMeasures(from, to, semis, dSteps) {
  const s = S();
  for (let i = from; i < to; i++) {
    const m = s.measures[i];
    const tr = p => {
      const target = pitchMidi(p) + semis;
      const nd = p.d + dSteps;
      const a = target - pitchMidi({ d: nd, a: 0 });
      return Math.abs(a) > 2 ? midiToPitch(target, 0) : { d: nd, a };
    };
    measureAllNotes(m).forEach(n => {
      if (!n.p) return;
      n.p = tr(n.p);
      if (n.ps) n.ps = n.ps.map(tr);
    });
    m.chords.forEach(c => c.name = transposeChordName(c.name, dSteps, semis));
  }
}
function keyInterval(f0, f1, dir) {
  let semis = mod(7 * (f1 - f0), 12), d = mod(4 * (f1 - f0), 7);
  if (dir === 'down' || (dir === 'near' && semis > 6)) { if (semis > 0) { semis -= 12; d -= 7; } }
  if (dir === 'down' && semis === 0) { semis = -12; d = -7; }
  if (dir === 'up' && semis === 0 && f0 === f1) { semis = 12; d = 7; }
  return { semis, d };
}

/* ---------- 재생 ---------- */
let _cursor = null, _playingIds = [];
function togglePlay() {
  if (Player.playing) { stopPlay(); return; }
  closeEditors();
  Player.start(S(), App.ctxs, { startM: App.playStart.m, startT: App.playStart.t }, App.settings, onPlayFrame, stopPlay);
  updateStatus();
}
function stopPlay() {
  Player.stop();
  if (_cursor) { _cursor.remove(); _cursor = null; }
  _playingIds.forEach(id => { const el = $(`g[data-id="${id}"]`); if (el) el.classList.remove('playing'); });
  _playingIds = [];
  updateStatus();
}
let _lastMi = -1;
function onPlayFrame(el, perf) {
  const mk = perf.marks.find(m => el >= m.time && el < m.time + m.dur) || perf.marks[perf.marks.length - 1];
  if (!mk) return;
  const g = App.lay.meas[mk.mi];
  if (!g) return;
  const tick = mk.skip + (mk.dur ? (el - mk.time) / mk.dur : 0) * (mk.len - mk.skip);
  const x = tickX(g, Math.min(tick, g.denom));
  const pageEl = $(`.page[data-page="${g.page}"]`);
  if (!_cursor) { _cursor = document.createElement('div'); _cursor.className = 'play-cursor'; }
  if (_cursor.parentNode !== pageEl) pageEl.appendChild(_cursor);
  const z = App.zoom;
  _cursor.style.left = (x * z) + 'px';
  _cursor.style.top = ((g.staffTop - 18) * z) + 'px';
  _cursor.style.height = (((g.sys.staffBottom || g.staffTop + 4 * L.SP) - g.staffTop + 36) * z) + 'px';
  if (mk.mi !== _lastMi) { _lastMi = mk.mi; const r = _cursor.getBoundingClientRect(), sr = $('#scroller').getBoundingClientRect(); if (r.top < sr.top + 20 || r.bottom > sr.bottom - 20) $('#scroller').scrollBy({ top: r.top - sr.top - sr.height / 3, behavior: 'smooth' }); }
  const now = perf.ev.filter(e => el >= e.time && el < e.time + e.dur).map(e => e.id);
  _playingIds.forEach(id => { if (!now.includes(id)) { const e2 = $(`g[data-id="${id}"]`); if (e2) e2.classList.remove('playing'); } });
  now.forEach(id => { const e2 = $(`g[data-id="${id}"]`); if (e2) e2.classList.add('playing'); });
  _playingIds = now;
}

/* ---------- 화면 좌표 / 맞히기 ---------- */
function pagePoint(e) {
  const pg = e.target.closest ? e.target.closest('.page') : null;
  if (!pg) return null;
  const r = pg.getBoundingClientRect();
  return { page: +pg.dataset.page, x: (e.clientX - r.left) / App.zoom, y: (e.clientY - r.top) / App.zoom, el: pg };
}
function pagePointAt(page, clientX, clientY) {
  const pg = $(`.page[data-page="${page}"]`); const r = pg.getBoundingClientRect();
  return { page, x: (clientX - r.left) / App.zoom, y: (clientY - r.top) / App.zoom, el: pg };
}
function hit(p) {
  const lay = App.lay, SP = L.SP;
  const out = { page: p.page, x: p.x, y: p.y, sys: null, g: null, mi: null, note: null, bar: null };
  const sys = lay.systems.find(s => s.page === p.page && p.y >= s.top && p.y < s.bottom);
  if (!sys) return out;
  out.sys = sys;
  for (const i of sys.idxs) { const m = lay.meas[i]; if (p.x >= m.x && p.x < m.x + m.w) { out.g = m; break; } }
  if (!out.g && p.x >= sys.x0 && p.x < sys.x0 + sys.headerW) { out.g = lay.meas[sys.idxs[0]]; out.header = true; }
  if (out.g) out.mi = out.g.mi;
  // 어느 줄(오선)인지: 줄 사이 가운데를 경계로
  const tops = sys.staffTops || [sys.staffTop];
  let si = 0;
  for (let q = 1; q < tops.length; q++) if (p.y > (tops[q - 1] + 4 * SP + tops[q]) / 2) si = q;
  out.si = si;
  let best = 1e9;
  for (const i of sys.idxs) (lay.meas[i].notesGeo || []).forEach(n => {
    if (n.si !== si) return;
    // 화음이면 가장 가까운 머리로
    const ys = n.heads ? n.heads.filter(h => !h.ovId).map(h => ({ y: h.y, k: h.k })) : [{ y: n.y, k: -1 }];
    ys.forEach(h => {
      const dx = Math.abs(n.x - p.x), dy = Math.abs(h.y - p.y);
      if (dx < 9 && dy < (n.rest ? 16 : 7)) { const d = dx + dy; if (d < best) { best = d; out.note = n; out.headK = h.k; } }
    });
  });
  const top = tops[si], bot = top + 4 * SP;
  if (p.y > tops[0] - 8 && p.y < (sys.staffBottom || bot) + 8) for (const i of sys.idxs) { const m = lay.meas[i]; if (Math.abs(p.x - (m.x + m.w)) < 6) out.bar = i; }
  out.pos = Math.round(8 - (p.y - top) / (SP / 2));
  out.zone = p.y < tops[0] - 6 ? 'above' : p.y > (sys.staffBottom || bot) + 6 ? 'below' : 'staff';
  if (out.g) out.t = Math.max(0, Math.min(out.g.denom, xTick(out.g, p.x)));
  return out;
}
function hitSlur(p) {
  let best = null, bd = 7;
  (App.lay.slurs || []).forEach(sl => { if (sl.page !== p.page) return; sl.pts.forEach(([x, y]) => { const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = sl.id; } }); });
  return best;
}
function clientOf(page, x, y) { const pg = $(`.page[data-page="${page}"]`); const r = pg.getBoundingClientRect(); return { x: r.left + x * App.zoom, y: r.top + y * App.zoom }; }
function scrollToNote(id) {
  const g = App.lay.notes[id]; if (!g) return;
  const c = clientOf(g.page, g.x, g.y), sr = $('#scroller').getBoundingClientRect();
  if (c.y < sr.top + 40 || c.y > sr.bottom - 40) $('#scroller').scrollBy({ top: c.y - sr.top - sr.height / 2, behavior: 'smooth' });
}
function scrollToMeasure(mi) {
  const g = App.lay.meas[mi]; if (!g) return;
  const c = clientOf(g.page, g.x, g.staffTop), sr = $('#scroller').getBoundingClientRect();
  $('#scroller').scrollBy({ top: c.y - sr.top - sr.height / 3, behavior: 'smooth' });
}

/* ---------- 마우스 ---------- */
function onMouseDown(e) {
  e.__bflat = true;
  if (e.button !== 0) return;
  const p = pagePoint(e);
  closePop();
  if (!p) { if (e.target.closest('#scroller') && !e.target.closest('.editor')) { closeEditors(); if (App.mode === 'note' && App.sel.length) { App.sel = []; render(); } } return; }
  if (e.target.closest('.editor')) return;
  e.preventDefault();
  closeEditors();
  const h = hit(p);
  // 줄 맨 앞 음자리표를 누르면 음자리표 바꾸기 (가온음자리표는 줄 위치 옮기기)
  if (h.sys && h.header && p.x < h.sys.x0 + 36 && h.zone === 'staff') { clefMenu(h.si || 0, e.clientX, e.clientY); return; }
  if (h.note) setPlayStart(h.note.mi, h.note.t);
  const m = App.mode;
  if (m === 'note') return downNote(e, p, h);
  if (m === 'harm') {
    // 화음 탭: 클릭한 곳으로 화음 넣을 자리 옮기기 (멜로디는 끌거나 바꿀 수 없어요)
    if (h.note) {
      const t = h.note.ov ? (h.note.n.t || 0) : h.note.t;
      App.head = (h.note.ov && h.note.n.ps && h.note.n.ps.length && h.headK !== undefined) ? { id: h.note.id, k: h.headK } : null;
      setHC(h.note.mi, h.note.si, t, { keepHead: true });
    } else if (h.g && !h.header) {
      const st = harmStops(h.mi, h.si || 0); let best = st[0];
      st.forEach(t => { if (Math.abs(t - h.t) < Math.abs(best - h.t)) best = t; });
      setHC(h.mi, h.si || 0, best);
    }
    return;
  }
  if (m === 'slur') {
    if (h.note) { App.drag = { type: 'slur', from: h.note, p0: p }; return; }
    App.selSlur = hitSlur(p); render(); return;
  }
  if (m === 'bar') {
    if (h.bar !== null) { App.selMeasures = [h.bar]; render(); barMenu(h.bar, e.clientX, e.clientY); return; }
    if (h.g) { selectMeasureClick(h.mi, e); App.drag = { type: 'msel', from: h.mi, menuAt: { x: e.clientX, y: e.clientY } }; render(); }
    return;
  }
  if (m === 'chord') { if (h.g) { const c = App.ctxs[h.mi]; const half = (isCompound(c) ? 72 : c.beat) / 2; let t = Math.round(h.t / half) * half; if (t >= c.cap) t = c.cap - half; openChordEditor(h.mi, Math.max(0, t)); } return; }
  if (m === 'lyric') { if (h.g) openLyricEditor(h.mi); return; }
  if (m === 'form') { if (h.g) formMenu(h.mi, e.clientX, e.clientY); return; }
  if (m === 'measure') {
    if (App.widthEdit && h.bar !== null) {
      const ln = lineOf(h.bar);
      App.selBar = h.bar;
      if (h.bar < ln.start + ln.count - 1) { History.push(S()); freezeLineWidths(ln.li); App.drag = { type: 'width', bar: h.bar, x0: p.x, wa: S().measures[h.bar].width, wb: S().measures[h.bar + 1].width }; }
      render(); return;
    }
    if (h.g) {
      if (App.selMeasures.includes(h.mi) && !e.shiftKey && !e.ctrlKey) { App.drag = { type: 'mmove', from: h.mi, p0: p, moved: false }; return; }
      selectMeasureClick(h.mi, e);
      App.drag = { type: 'msel', from: h.mi };
      render();
    } else { App.selMeasures = []; render(); }
  }
}
function selectMeasureClick(mi, e) {
  if (e.shiftKey && App.mAnchor !== null) { const a = Math.min(App.mAnchor, mi), b = Math.max(App.mAnchor, mi); App.selMeasures = Array.from({ length: b - a + 1 }, (_, k) => a + k); }
  else if (e.ctrlKey) { App.selMeasures = App.selMeasures.includes(mi) ? App.selMeasures.filter(x => x !== mi) : App.selMeasures.concat(mi); App.mAnchor = mi; }
  else { App.selMeasures = [mi]; App.mAnchor = mi; }
}
function downNote(e, p, h) {
  if (h.note) {
    const id = h.note.id;
    App.selMeasures = []; App.staff = h.note.si;
    // 화음의 한 머리를 누르면 그 음만 고른 상태 (↑↓·Delete가 그 음에만)
    App.head = (h.note.n.ps && h.note.n.ps.length && h.headK !== undefined) ? { id, k: h.headK } : null;
    if (e.ctrlKey) App.sel = App.sel.includes(id) ? App.sel.filter(x => x !== id) : App.sel.concat(id);
    else if (e.shiftKey && App.anchor) {
      const a = allNotes(h.note.si); const i1 = a.findIndex(x => x.n.id === App.anchor), i2 = a.findIndex(x => x.n.id === id);
      const [lo, hi] = [Math.min(i1, i2), Math.max(i1, i2)];
      App.sel = a.slice(lo, hi + 1).map(x => x.n.id);
    } else if (!App.sel.includes(id)) App.sel = [id];
    if (!e.shiftKey) App.anchor = id;
    render(); previewSel();
    const orig = selNotes().map(x => ({ id: x.n.id, p: x.n.p ? clone(x.n.p) : null, ps: clone(x.n.ps || []) }));
    App.drag = { type: App.write ? 'pitch' : 'nmove', p0: p, orig, moved: false, pushed: false, head: App.head };
    return;
  }
  if (h.g && !h.header) {
    if (App.write && h.zone !== 'below' || (App.write && h.pos >= -8)) {
      const si = h.si || 0;
      App.staff = si; App.head = null;
      const arr = SN(S().measures[h.mi], si);
      const geos = (h.g.geoSt && h.g.geoSt[si]) || [];
      const near = geos.find(n => Math.abs(n.x - p.x) < 7);
      const pitch = pitchAtPos(h.mi, h.pos, si);
      let id;
      if (near && e.shiftKey && !near.rest) {
        // Shift+클릭 = 그 음표에 화음 얹기
        const n = arr[near.ni];
        commit(() => { n.ps = (n.ps || []).concat([pitch]); n.edited = true; }, true);
        id = near.id; App.head = { id, k: n.ps.length - 1 };
      } else if (near) {
        commit(() => { const n = arr[near.ni]; n.p = pitch; n.rest = false; n.full = false; n.edited = true; }, true);
        id = near.id;
      } else {
        const idx = geos.filter(n => n.x < p.x).length;
        const n = newNote(App.curDur, pitch); n.edited = true;
        commit(() => arr.splice(idx, 0, n), true);
        id = n.id;
      }
      App.sel = [id]; App.anchor = id; render(); previewSel();
      const f = findNote(id);
      App.drag = { type: 'pitch', p0: p, orig: [{ id, p: clone(f.n.p) }], moved: false, pushed: true };
      return;
    }
    App.staff = h.si || 0;
    App.drag = { type: 'rubber', p0: p, mi: h.mi, moved: false, add: e.ctrlKey || e.shiftKey, client: { x: e.clientX, y: e.clientY } };
    return;
  }
  App.drag = { type: 'rubber', p0: p, mi: null, moved: false, add: e.ctrlKey || e.shiftKey, client: { x: e.clientX, y: e.clientY } };
}
function onMouseMove(e) {
  const d = App.drag;
  if (!d) {
    const p = pagePoint(e);
    const h = p ? hit(p) : null;
    const hm = h && h.g ? h.mi : null;
    if (hm !== App.hoverMeasure && (App.mode === 'lyric' || App.mode === 'bar' || App.mode === 'measure' || (App.mode === 'note' && !App.write))) { App.hoverMeasure = hm; render(); }
    $('#pages').style.cursor = h && h.bar !== null && (App.mode === 'bar' || App.widthEdit) ? 'col-resize' : (h && h.note ? 'pointer' : (App.mode === 'note' && App.write && h && h.g ? 'crosshair' : ''));
    return;
  }
  const p = d.p0 ? pagePointAt(d.p0.page, e.clientX, e.clientY) : null;
  if (d.type === 'pitch') {
    const steps = Math.round((d.p0.y - p.y) / (L.SP / 2));
    if (!steps && !d.moved) return;
    if (!d.pushed) { History.push(S()); d.pushed = true; }
    d.moved = true;
    d.orig.forEach(o => {
      const f = findNote(o.id); if (!f || !o.p) return;
      const key = App.ctxs[f.mi].key;
      const mv = q => { const nd = Math.max(7, Math.min(63, q.d + steps)); return { d: nd, a: keyAlter(key, mod(nd, 7)) }; };
      if (d.head && d.head.id === o.id && d.head.k >= 0) { f.n.ps[d.head.k] = mv(o.ps[d.head.k]); }
      else if (d.head && d.head.id === o.id) { f.n.p = mv(o.p); }
      else { f.n.p = mv(o.p); f.n.ps = o.ps.map(mv); }
      f.n.rest = false; f.n.edited = true;
    });
    if (steps !== d.lastSteps) { d.lastSteps = steps; render(); previewSel(); }
  } else if (d.type === 'nmove') {
    if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) > 6) d.moved = true;
    if (d.moved) { const pp = pagePoint(e); const h = pp ? hit(pp) : null; showDropHint(h && h.g ? h : null); }
  } else if (d.type === 'rubber') {
    if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) > 5) d.moved = true;
    if (d.moved) showRubber(d.p0, p);
  } else if (d.type === 'slur') {
    showSlurLine(d.from, p);
  } else if (d.type === 'msel' || d.type === 'mmove') {
    const pp = pagePoint(e); const h = pp ? hit(pp) : null;
    if (d.type === 'msel' && h && h.g) { const a = Math.min(d.from, h.mi), b = Math.max(d.from, h.mi); const ns = Array.from({ length: b - a + 1 }, (_, k) => a + k); if (ns.length !== App.selMeasures.length || ns[0] !== App.selMeasures[0]) { App.selMeasures = ns; d.moved = true; render(); } }
    if (d.type === 'mmove') { if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) > 6) d.moved = true; if (d.moved) showDropHint(h && h.g ? h : null, true); }
  } else if (d.type === 'width') {
    const dx = p.x - d.x0;
    const a = S().measures[d.bar], b = S().measures[d.bar + 1];
    const dd = Math.max(40 - d.wa, Math.min(d.wb - 40, dx));
    a.width = d.wa + dd; b.width = d.wb - dd; d.moved = true;
    render();
  }
}
function onMouseUp(e) {
  const d = App.drag;
  App.drag = null;
  // 드래그 표시(점선 등)를 지우기 전에 마우스를 놓은 곳을 먼저 알아내요
  const hitEl = document.elementFromPoint(e.clientX, e.clientY);
  hideOverlays();
  if (hitEl && hitEl.closest && hitEl.closest('.page')) e = { clientX: e.clientX, clientY: e.clientY, target: hitEl.closest('.page'), button: e.button, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey };
  if (!d) return;
  if (d.type === 'pitch') { if (d.moved) changed(); return; }
  if (d.type === 'nmove') {
    if (!d.moved) return;
    const pp = pagePoint(e); const h = pp ? hit(pp) : null;
    if (!h || !h.g) return;
    const ns = selNotes();
    const tsi = h.si || 0;
    if (ns.every(x => x.mi === h.mi && x.si === tsi)) return;
    commit(() => {
      const ids = ns.map(x => x.n.id);
      const moving = ns.map(x => x.n);
      filterAllNotes(n => !ids.includes(n.id));
      const geo = ((h.g.geoSt && h.g.geoSt[tsi]) || []).filter(n => !ids.includes(n.id) && n.x < pp.x).length;
      SN(S().measures[h.mi], tsi).splice(geo, 0, ...moving);
    });
    App.staff = tsi;
    toast(`${ns.length}개 음표를 ${h.mi + 1}마디로 옮겼어요`);
    return;
  }
  if (d.type === 'rubber') {
    if (!d.moved) {
      if (d.mi !== null && !App.write) countMenu(d.mi, d.client.x, d.client.y);
      else if (!d.add) { App.sel = []; render(); }
      return;
    }
    const p = pagePointAt(d.p0.page, e.clientX, e.clientY);
    const x1 = Math.min(p.x, d.p0.x), x2 = Math.max(p.x, d.p0.x), y1 = Math.min(p.y, d.p0.y), y2 = Math.max(p.y, d.p0.y);
    const got = Object.values(App.lay.notes).filter(n => n.page === d.p0.page && n.x >= x1 && n.x <= x2 && n.y >= y1 - 4 && n.y <= y2 + 4).map(n => n.id);
    const order = allNotes().map(x => x.n.id);
    App.sel = [...new Set((d.add ? App.sel : []).concat(got))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    App.anchor = App.sel[0] || null;
    render(); return;
  }
  if (d.type === 'slur') {
    const pp = pagePoint(e); const h = pp ? hit(pp) : null;
    if (h && h.note && h.note.id !== d.from.id) {
      const order = allNotes().map(x => x.n.id);
      let a = d.from.id, b = h.note.id;
      if (order.indexOf(a) > order.indexOf(b)) [a, b] = [b, a];
      const sl = { id: uid(), a, b, type: 'slur' };
      commit(() => S().slurs.push(sl));
      App.selSlur = null; render();
    }
    return;
  }
  if (d.type === 'msel') { if (App.mode === 'bar' && d.menuAt) measureMenu(App.selMeasures, d.menuAt.x, d.menuAt.y); return; }
  if (d.type === 'mmove') {
    if (!d.moved) { App.selMeasures = [d.from]; App.mAnchor = d.from; render(); return; }
    const pp = pagePoint(e); const h = pp ? hit(pp) : null;
    if (h && h.g) { moveMeasures(h.mi); render(); }
    return;
  }
  if (d.type === 'width') { if (d.moved) changed(); }
}
function onDblClick(e) {
  const p = pagePoint(e); if (!p) return;
  const firstSys = App.lay.systems[0];
  if (p.page === 0 && firstSys && p.y < firstSys.top && p.y > App.lay.headH - 10 && p.x < 320) { infoDialog(); return; }
  if (p.page === 0 && firstSys && p.y < App.lay.headH) { infoDialog(); return; }
  const h = hit(p);
  if (App.mode === 'note' && h.g && !h.note && !App.write) { App.write = true; render(); toast('쓰기 모드 켬 — 빈 곳 클릭 = 음표 추가'); }
}
function onContext(e) {
  const p = pagePoint(e); if (!p) return;
  e.preventDefault();
  const h = hit(p);
  if (!h.g) return;
  contextMenu(h.mi, e.clientX, e.clientY);
}

/* 드래그 표시 */
function overlayEl(id, page) {
  let el = $('#' + id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'ovl ' + id; }
  const pg = $(`.page[data-page="${page}"]`);
  if (el.parentNode !== pg) pg.appendChild(el);
  return el;
}
function showRubber(a, b) {
  const el = overlayEl('rubber', a.page), z = App.zoom;
  Object.assign(el.style, { left: Math.min(a.x, b.x) * z + 'px', top: Math.min(a.y, b.y) * z + 'px', width: Math.abs(a.x - b.x) * z + 'px', height: Math.abs(a.y - b.y) * z + 'px', display: 'block' });
}
function showDropHint(h, measure) {
  if (!h) { const el = $('#dropHint'); if (el) el.style.display = 'none'; return; }
  const el = overlayEl('dropHint', h.g.page), z = App.zoom;
  if (measure) Object.assign(el.style, { left: h.g.x * z + 'px', top: (h.g.staffTop - 12) * z + 'px', width: '4px', height: (4 * L.SP + 24) * z + 'px', display: 'block' });
  else Object.assign(el.style, { left: h.g.x * z + 'px', top: (h.g.staffTop - 8) * z + 'px', width: h.g.w * z + 'px', height: (4 * L.SP + 16) * z + 'px', display: 'block' });
}
function showSlurLine(from, p) {
  let el = $('#slurLine');
  const pg = $(`.page[data-page="${from.page}"]`);
  if (!el) { el = document.createElementNS('http://www.w3.org/2000/svg', 'line'); el.id = 'slurLine'; el.setAttribute('stroke', '#2563eb'); el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-dasharray', '4 3'); el.setAttribute('pointer-events', 'none'); }
  const svg = pg.querySelector('svg'); if (el.parentNode !== svg) svg.appendChild(el);
  el.setAttribute('x1', from.x); el.setAttribute('y1', from.y); el.setAttribute('x2', p.x); el.setAttribute('y2', p.y);
}
function hideOverlays() { ['rubber', 'dropHint'].forEach(id => { const el = $('#' + id); if (el) el.style.display = 'none'; }); const sl = $('#slurLine'); if (sl) sl.remove(); }

/* ---------- 팝업 메뉴 ---------- */
function closePop() { $('#popRoot').innerHTML = ''; }
function popMenu(x, y, items, onPick, title) {
  const root = $('#popRoot');
  root.innerHTML = `<div class="pop" style="left:${x}px;top:${y}px">${title ? `<div class="pop-title">${title}</div>` : ''}${items.map(it => it === '-' ? '<div class="pop-sep"></div>' : `<button class="pop-item${it.on ? ' on' : ''}" data-v="${esc(it.v)}"${it.disabled ? ' disabled' : ''}>${it.html || esc(it.label)}</button>`).join('')}</div>`;
  const pop = root.firstChild;
  const r = pop.getBoundingClientRect();
  if (r.right > innerWidth - 8) pop.style.left = (innerWidth - r.width - 8) + 'px';
  if (r.bottom > innerHeight - 8) pop.style.top = Math.max(8, y - r.height) + 'px';
  pop.addEventListener('mousedown', e => e.stopPropagation());
  pop.addEventListener('click', e => { const b = e.target.closest('.pop-item'); if (!b) return; closePop(); onPick(b.dataset.v); });
  return pop;
}
/** 마디 클릭 → 개수 정하기 창 */
let _countKind = 'note';
function countMenu(mi, x, y) {
  const si = curStaff();
  const c = App.ctxs[mi], arr = SNr(S().measures[mi], si);
  const m = { notes: arr };                       // 아래 코드는 이 줄의 음표만 봐요
  const maxN = Math.floor(c.full / 12);          // 16분음표까지
  const nNotes = m.notes.filter(n => !n.rest).length, nRests = m.notes.filter(n => n.rest).length;
  const stName = nStaves() > 1 ? ` · ${staffLabel(si)}` : '';
  const root = $('#popRoot');
  root.innerHTML = `<div class="pop count-pop2" style="left:${x + 6}px;top:${y + 6}px">
    <div class="cp-title">${mi + 1}마디${stName} 개수 정하기</div>
    <div class="cp-kind">
      <button data-kind="note" class="${_countKind === 'note' ? 'on' : ''}"><i class="cp-head"></i>음표 ${nNotes}개</button>
      <button data-kind="rest" class="${_countKind === 'rest' ? 'on' : ''}"><i class="cp-dot"></i>쉼표 ${nRests}개</button>
    </div>
    <div class="cp-grid">${Array.from({ length: 16 }, (_, k) => k + 1).map(n => `<button data-n="${n}"${n > maxN ? ' disabled' : ''}${m.notes.length === n ? ' class="cur"' : ''}>${n}</button>`).join('')}</div>
    <div class="cp-row"><button class="cp-fill" data-fill="1">쉼표로 채움</button><span class="cp-note">이 마디 빈칸만</span></div>
  </div>`;
  const pop = root.firstChild;
  const r = pop.getBoundingClientRect();
  if (r.right > innerWidth - 8) pop.style.left = (innerWidth - r.width - 8) + 'px';
  if (r.bottom > innerHeight - 8) pop.style.top = Math.max(8, y - r.height) + 'px';
  pop.addEventListener('mousedown', e => e.stopPropagation());
  const apply = n => {
    n = parseInt(n, 10);
    if (!n || n < 1) return;
    if (n > maxN) { toast(`이 마디에는 ${maxN}개까지 넣을 수 있어요 (16분음표 기준)`); return; }
    closePop();
    setMeasureCount(mi, n, _countKind === 'rest', si);
  };
  pop.addEventListener('click', e => {
    const k = e.target.closest('[data-kind]');
    if (k) { _countKind = k.dataset.kind; $$('[data-kind]', pop).forEach(b => b.classList.toggle('on', b === k)); return; }
    const nb = e.target.closest('[data-n]'); if (nb && !nb.disabled) return apply(nb.dataset.n);
    if (e.target.closest('[data-fill]')) { closePop(); fillMeasureRests(mi, si); return; }
  });
  // 키보드로 고르기: 처음엔 지금 개수(없으면 1)에 표시
  const start = $(`[data-n="${m.notes.length}"]:not(:disabled)`, pop) || $('[data-n="1"]', pop);
  if (start) start.classList.add('kfocus');
  pop.addEventListener('mouseover', e => {
    const b = e.target.closest('.cp-kind button, .cp-grid button:not(:disabled), .cp-fill');
    if (b) { $$('.kfocus', pop).forEach(x => x.classList.remove('kfocus')); b.classList.add('kfocus'); }
  });
}
/** 개수 창이 떠 있을 때: 방향키 = 창 안에서 이동, Enter = 고르기, Esc/Caps Lock = 닫기 */
function countPopKey(e) {
  const pop = $('.count-pop2');
  if (!pop) return false;
  const k = e.key;
  if (k === 'Escape' || e.code === 'CapsLock') { e.preventDefault(); closePop(); return true; }
  const items = $$('.cp-kind button, .cp-grid button:not(:disabled), .cp-fill:not(:disabled)', pop);
  let cur = $('.kfocus', pop) || items[0];
  if (k === 'Enter' || k === ' ') { e.preventDefault(); if (cur) cur.click(); return true; }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (!dir) { e.preventDefault(); return true; }   // 창이 떠 있는 동안 다른 단축키는 쉬어요
  e.preventDefault();
  const rc = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const c = rc(cur);
  let best = null, bestScore = Infinity;
  items.forEach(el => {
    if (el === cur) return;
    const p = rc(el), dx = p.x - c.x, dy = p.y - c.y;
    const along = dir[0] ? dx * dir[0] : dy * dir[1];
    const side = dir[0] ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) return;
    if (dir[0] && side > 12) return;              // 좌우는 같은 줄 안에서만
    const score = along + side * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (!best && dir[0]) {                           // 줄 끝이면 다음/이전 줄로 이어서
    const i = items.indexOf(cur), j = i + dir[0];
    if (j >= 0 && j < items.length) best = items[j];
  }
  if (best) { cur.classList.remove('kfocus'); best.classList.add('kfocus'); }
  return true;
}
/** Caps Lock: 지금 마디의 개수 창 열기 (마우스 좌클릭과 같은 창) */
function countMenuForCurrent() {
  const f = App.sel.length ? findNote(App.sel[0]) : null;
  if (f) App.staff = f.si;
  let mi = App.selMeasures.length ? App.selMeasures[0] : (f ? f.mi : App.playStart.m);
  mi = Math.max(0, Math.min(S().measures.length - 1, mi || 0));
  if (!App.sel.length) App.selMeasures = [mi];
  render();
  scrollToMeasureIfHidden(mi);
  // 스크롤이 끝난 뒤 그 마디·그 줄 아래에 창 띄우기
  setTimeout(() => { const g = App.lay.meas[mi]; const t = (g.staffTops || [g.staffTop])[curStaff()]; const c = clientOf(g.page, g.x + 8, t + 4 * L.SP + 6); countMenu(mi, c.x, c.y); }, 220);
}
const C_CLEF_NAMES = { 1: '소프라노', 2: '메조소프라노', 3: '알토 (가운데)', 4: '테너', 5: '바리톤' };
/** 음자리표 바꾸기 메뉴 (악보에서 음자리표 클릭) — 음 높이는 그대로, 그리는 자리만 바뀌어요 */
function clefMenu(si, x, y) {
  const cur = staffClef(S(), si);
  const items = [{ v: 'treble', html: '<span class="mus">𝄞</span> 높은음자리표', on: cur === 'treble' }, { v: 'bass', html: '<span class="mus">𝄢</span> 낮은음자리표', on: cur === 'bass' }, '-'];
  for (let n = 1; n <= 5; n++) items.push({ v: 'c' + n, html: `<span class="mus">𝄡</span> 가온음자리표 · 아래에서 ${n}번째 줄 <span class="muted">${C_CLEF_NAMES[n]}</span>`, on: cur === 'c' + n });
  popMenu(x, y, items, v => {
    commit(() => { S().staves[si].clef = v; if (si === 0) S().clef = v; });
    toast(isCClef(v) ? `가온음자리표를 ${v[1]}번째 줄로 옮겼어요 (음 높이는 그대로)` : '음자리표를 바꿨어요 (음 높이는 그대로)');
  }, `${nStaves() > 1 ? staffLabel(si) + ' · ' : ''}음자리표`);
}
function staffLabel(si) {
  const st = S().staves[si] || {};
  if (st.name) return st.name;
  if (isPianoStaff(st)) return st.clef === 'bass' ? '피아노 왼손' : '피아노 오른손';
  return `${si + 1}번째 줄`;
}
/** 이 마디(그 줄) 빈칸만 쉼표로 */
function fillMeasureRests(mi, si) {
  si = si === undefined ? curStaff() : si;
  const m = S().measures[mi], c = App.ctxs[mi], stt = c.st[si];
  if (stt.status === 'ok' || stt.status === 'over') { toast('이 마디는 빈칸이 없어요'); return; }
  commit(() => {
    if (stt.status === 'empty') { const r = newNote('w', null, true); r.full = true; SN(m, si).push(r); }
    else restsFor(stt.sum, c.cap - stt.sum).forEach(d => { const r = newNote(d.dur, null, true); r.dots = d.dots; SN(m, si).push(r); });
  });
}
function barMenu(i, x, y) {
  const m = S().measures[i], nx = S().measures[i + 1];
  const items = [
    { v: 'single', label: '│  보통 세로줄', on: !m.end },
    { v: 'double', label: '‖  겹세로줄', on: m.end === 'double' },
    { v: 'final', label: '‖▌ 끝세로줄', on: m.end === 'final' },
    { v: 'repeatEnd', label: ':‖  도돌이표 (여기까지 돌아가기)', on: m.end === 'repeatEnd' }];
  if (nx) items.push({ v: 'repeatStart', label: '‖:  다음 마디부터 도돌이 시작', on: nx.start === 'repeatStart' });
  items.push({ v: 'repeatStartHere', label: '‖:  이 마디부터 도돌이 시작', on: m.start === 'repeatStart' });
  if (nx) items.push('-', { v: 'key', label: '여기서 조 바꾸기…' }, { v: 'time', label: '여기서 박자 바꾸기…' });
  popMenu(x, y + 8, items, v => {
    if (v === 'key') return keyChangeDialog(i + 1);
    if (v === 'time') return timeChangeDialog(i + 1);
    commit(() => {
      if (v === 'repeatStart') nx.start = nx.start === 'repeatStart' ? '' : 'repeatStart';
      else if (v === 'repeatStartHere') m.start = m.start === 'repeatStart' ? '' : 'repeatStart';
      else m.end = v === 'single' ? '' : v;
    });
  }, `${i + 1}마디 끝 마디선`);
}
function measureMenu(idxs, x, y) {
  if (!idxs.length) return;
  const m0 = S().measures[idxs[0]];
  const has = k => (m0.marks || []).includes(k);
  const items = [
    { v: 'v1', label: '1번 괄호 (1.)', on: m0.volta === 1 }, { v: 'v2', label: '2번 괄호 (2.)', on: m0.volta === 2 }, { v: 'v3', label: '3번 괄호 (3.)', on: m0.volta === 3 }, { v: 'v0', label: '괄호 없음' }, '-',
    { v: 'segno', html: `<span class="mus">𝄋</span> Segno (D.S.가 돌아올 곳)`, on: has('segno') },
    { v: 'coda', html: `<span class="mus">𝄌</span> Coda (여기로 건너뛰기)`, on: has('coda') },
    { v: 'tocoda', label: 'To Coda (여기서 Coda로)', on: has('tocoda') },
    { v: 'dsalcoda', label: 'D.S. al Coda', on: has('dsalcoda') }, { v: 'dsalfine', label: 'D.S. al Fine', on: has('dsalfine') }, { v: 'ds', label: 'D.S.', on: has('ds') },
    { v: 'dc', label: 'D.C.', on: has('dc') }, { v: 'dcalfine', label: 'D.C. al Fine', on: has('dcalfine') }, { v: 'dcalcoda', label: 'D.C. al Coda', on: has('dcalcoda') },
    { v: 'fine', label: 'Fine (끝)', on: has('fine') }, { v: 'clearMarks', label: '기호 지우기' }];
  popMenu(x, y + 8, items, v => {
    commit(() => idxs.forEach(i => {
      const m = S().measures[i];
      if (v[0] === 'v' && v.length === 2) m.volta = +v[1];
      else if (v === 'clearMarks') m.marks = [];
      else { m.marks = m.marks || []; if (m.marks.includes(v)) m.marks = m.marks.filter(k => k !== v); else { if (/^d[sc]/.test(v)) m.marks = m.marks.filter(k => !/^d[sc]/.test(k)); m.marks.push(v); } }
    }));
  }, idxs.length > 1 ? `${idxs[0] + 1}–${idxs[idxs.length - 1] + 1}마디` : `${idxs[0] + 1}마디`);
}
function formMenu(mi, x, y) {
  const cur = S().measures[mi].form;
  popMenu(x, y + 8, FORMS.map(f => ({ v: f, label: f, on: cur === f })).concat(['-', { v: '__custom', label: '직접 입력…' }, { v: '__clear', label: '지우기' }]), v => {
    if (v === '__custom') return askText('송폼 이름', '예) Verse 2, 후렴, 간주', cur, t => commit(() => S().measures[mi].form = t.trim()));
    commit(() => S().measures[mi].form = v === '__clear' ? '' : v);
  }, `${mi + 1}마디 송폼`);
}
function contextMenu(mi, x, y) {
  const m = S().measures[mi];
  popMenu(x, y, [
    { v: 'before', label: '앞에 마디 넣기' }, { v: 'after', label: '뒤에 마디 넣기' }, { v: 'del', label: '이 마디 지우기' }, '-',
    { v: 'time', label: '박자 바꾸기 (여기부터)…' }, { v: 'key', label: '여기서 조 바꾸기…' },
    { v: 'pickup', label: m.pickup ? '못갖춘마디 해제' : '못갖춘마디로 (모자란 박자 그대로)', on: m.pickup }, '-',
    { v: 'clear', label: '마디 비우기' }], v => {
      if (v === 'before') addMeasureAfter(mi, true);
      else if (v === 'after') addMeasureAfter(mi, false);
      else if (v === 'del') { commit(() => deleteMeasures([mi])); App.selMeasures = []; render(); }
      else if (v === 'time') timeChangeDialog(mi);
      else if (v === 'key') keyChangeDialog(mi);
      else if (v === 'pickup') commit(() => m.pickup = !m.pickup);
      else if (v === 'clear') commit(() => { removeSlursFor(measureAllNotes(m).map(n => n.id)); m.notes = []; m.sn = {}; m.ov = {}; });
    }, `${mi + 1}마디`);
}

/* ---------- 코드 / 가사 입력칸 ---------- */
function closeEditors() {
  const ed = $('.editor');
  if (ed && ed._save) ed._save();
  $$('.editor').forEach(e => e.remove());
  if (App.chordEdit) { App.chordEdit = null; }
}
function beatLabel(mi, t) {
  const c = App.ctxs[mi];
  const beat = isCompound(c) ? 72 : c.beat;
  const b = Math.floor(t / beat) + 1, half = (t % beat) >= beat / 2;
  return `${mi + 1}마디 · ${b}박${half ? ' 반' : ''}`;
}
function openChordEditor(mi, t) {
  closeEditors();
  App.chordEdit = { mi, t };
  render();
  const g = App.lay.meas[mi];
  const m = S().measures[mi];
  const ex = m.chords.find(c => c.t === t);
  const pg = $(`.page[data-page="${g.page}"]`);
  const z = App.zoom;
  const box = document.createElement('div');
  box.className = 'editor chord-ed';
  box.style.left = (tickX(g, t) - 8) * z + 'px';
  box.style.top = (g.staffTop - 64) * z + 'px';
  box.innerHTML = `<div class="ed-label">${beatLabel(mi, t)}</div><div class="ed-row"><button class="ed-nav" data-d="-1">◀</button><input value="${esc(ex ? ex.name : '')}" placeholder="C, Am7, G/B" spellcheck="false"><button class="ed-nav" data-d="1">▶</button></div>`;
  pg.appendChild(box);
  const inp = box.querySelector('input');
  inp.focus(); inp.select();
  let saved = false;
  const save = () => {
    if (saved) return; saved = true;
    const v = inp.value.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    const old = m.chords.find(c => c.t === t);
    if ((old ? old.name : '') === v) return;
    if (v && !parseChord(v)) toast('코드 이름을 확인하세요 (예: C, Am7, F#m7b5, G/B)');
    History.push(S());
    m.chords = m.chords.filter(c => c.t !== t);
    if (v) m.chords.push({ t, name: v });
    m.chords.sort((a, b) => a.t - b.t);
    changed(true);
  };
  box._save = save;
  const c = App.ctxs[mi];
  const beat = isCompound(c) ? 72 : c.beat;
  const move = (dt) => {
    save();
    let nmi = mi, nt = t + dt;
    if (nt >= c.cap) { nmi = mi + 1; nt = 0; }
    if (nt < 0) { nmi = mi - 1; if (nmi < 0) { nmi = 0; nt = 0; } else { const pc = App.ctxs[nmi]; nt = pc.cap - (dt === -beat ? (isCompound(pc) ? 72 : pc.beat) : (isCompound(pc) ? 36 : pc.beat / 2)); } }
    if (nmi >= S().measures.length) { box.remove(); App.chordEdit = null; render(); return; }
    box._save = null; box.remove();
    openChordEditor(nmi, Math.max(0, nt));
    scrollToMeasure(nmi);
  };
  box.querySelectorAll('.ed-nav').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); move(+b.dataset.d * beat / 2); }));
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { save(); box._save = null; box.remove(); App.chordEdit = null; render(); }
    else if (e.key === 'Escape') { saved = true; box.remove(); App.chordEdit = null; render(); }
    else if (e.key === ' ') { e.preventDefault(); move(e.shiftKey ? -beat / 2 : beat / 2); }
    else if (e.key === 'Tab') { e.preventDefault(); const next = e.shiftKey ? (t % beat ? -(t % beat) : -beat) : (beat - (t % beat)); move(next); }
  });
}
function openLyricEditor(mi) {
  closeEditors();
  const g = App.lay.meas[mi];
  const m = S().measures[mi];
  const v = App.verse;
  const pg = $(`.page[data-page="${g.page}"]`);
  const z = App.zoom;
  const box = document.createElement('div');
  box.className = 'editor lyric-ed';
  const rowIdx = Math.max(0, g.sys.verses.indexOf(v));
  box.style.left = (g.x + 2) * z + 'px';
  box.style.top = (g.staffTop + 4 * L.SP + 10 + rowIdx * 21) * z + 'px';
  box.style.width = Math.max(180, (g.w - 4) * z) + 'px';
  const notes = m.notes.filter(n => !n.rest && n.p && !App.lay.tied.into.has(n.id)).length;
  box.innerHTML = `<div class="ed-label">${mi + 1}마디 · ${v + 1}절 · 음표 ${notes}개 <span class="cnt"></span></div><input value="${esc(m.lyrics[v] || '')}" placeholder="가사 (예: 참 반 가 운)" spellcheck="false">`;
  pg.appendChild(box);
  const inp = box.querySelector('input'), cnt = box.querySelector('.cnt');
  const upd = () => { const k = parseLyrics(inp.value).length; cnt.textContent = `· 음절 ${k}개`; cnt.style.color = k > notes ? '#dc2626' : ''; };
  upd(); inp.addEventListener('input', upd);
  inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  let saved = false;
  const save = () => {
    if (saved) return; saved = true;
    const val = inp.value.trim();
    if ((m.lyrics[v] || '') === val) return;
    History.push(S());
    m.lyrics[v] = val;
    changed(true);
  };
  box._save = save;
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); save(); box._save = null; box.remove(); render(); if (mi + 1 < S().measures.length) { openLyricEditor(mi + 1); scrollToMeasure(mi + 1); } }
    else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); save(); box._save = null; box.remove(); render(); if (mi > 0) openLyricEditor(mi - 1); }
    else if (e.key === 'Escape') { saved = true; box.remove(); render(); }
  });
}

/* ---------- 대화상자 ---------- */
function modal(html, onReady, cls, locked) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-back"><div class="modal ${cls || ''}">${html}</div></div>`;
  const md = root.querySelector('.modal');
  root.querySelector('.modal-back').addEventListener('mousedown', e => { if (!locked && e.target.classList.contains('modal-back')) closeModal(); });
  md.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' && !locked) closeModal(); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const ok = md.querySelector('[data-ok]'); if (ok) ok.click(); } });
  $$('[data-close]', md).forEach(b => b.addEventListener('click', closeModal));
  onReady && onReady(md);
  const f = md.querySelector('input,select'); if (f) f.focus();
  return md;
}
function closeModal() {
  $('#modalRoot').innerHTML = '';
  if (App.onModalClose) { const f = App.onModalClose; App.onModalClose = null; f(); }
  // 첫 화면(백지)에서 사용법 등을 닫으면 다시 새 악보 창으로
  setTimeout(() => { if (App.blank && !App.pdfOnly && !$('#modalRoot').innerHTML) scoreTypeDialog(true); }, 0);
}
/** 첫 화면(백지)에서 벗어나기 */
function leaveBlank() { App.blank = false; document.body.classList.remove('blank'); }
function askText(title, hint, value, cb) {
  modal(`<h2>${esc(title)}</h2><p class="muted">${esc(hint)}</p><input class="inp wide" id="askInp" value="${esc(value || '')}"><div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>확인</button></div>`, md => {
    md.querySelector('[data-ok]').addEventListener('click', () => { const v = md.querySelector('#askInp').value; closeModal(); cb(v); });
    const i = md.querySelector('#askInp'); setTimeout(() => i.select(), 0);
  });
}
function keyOptions(sel) { return Object.keys(KEY_NAMES).map(Number).sort((a, b) => a - b).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${KEY_NAMES[k]}${k === 0 ? ' (조표 없음)' : ` (${k > 0 ? '♯' : '♭'}${Math.abs(k)})`}</option>`).join(''); }
/** 빠르기말 칸: BPM을 바꾸면 자동으로 채움 (직접 고친 글자는 그대로 둠) */
function tempoTermField(id, value) {
  return `<label class="fld">빠르기말 <span class="muted small">BPM을 넣으면 자동으로 채워져요 · 직접 고쳐 써도 돼요</span><input class="inp" id="${id}" list="tempoTermList" value="${esc(value || '')}" placeholder="(선택) 예: Moderato">` +
    `<datalist id="tempoTermList">${TEMPO_TERMS.map(t => `<option value="${t[0]}">${tempoRangeText(t)}</option>`).join('')}</datalist></label>`;
}
/** 템포 칸 → 숫자 (빈칸이면 null = 미정) */
function tempoInput(v) { const n = parseInt(v, 10); return n ? Math.max(10, Math.min(400, n)) : null; }
function wireTempoTerm(md, bpmSel, termSel) {
  const bpm = $(bpmSel, md), term = $(termSel, md);
  let lastAuto = tempoTerm(bpm.value);
  bpm.addEventListener('input', () => {
    const next = tempoTerm(bpm.value);
    if (!term.value.trim() || term.value === lastAuto) term.value = next;
    lastAuto = next;
  });
}
/** 악보 종류 미리보기 그림 */
function typePreview(type) {
  const staff = (y, clef) => { let o = ''; for (let k = 0; k < 5; k++) o += `<line x1="14" x2="150" y1="${y + k * 4}" y2="${y + k * 4}" stroke="currentColor" stroke-width=".8"/>`; return o + `<text x="16" y="${y + (clef === 'bass' ? 12 : 17)}" font-size="${clef === 'bass' ? 15 : 22}" font-family="${MUSIC_FONT}" fill="currentColor">${clef === 'bass' ? '𝄢' : '𝄞'}</text>`; };
  const brace = (y1, y2) => `<path d="M10 ${y1} q-5 ${(y2 - y1) / 4} 0 ${(y2 - y1) / 2} q-5 ${(y2 - y1) / 4} 0 ${(y2 - y1) / 2}" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
  let o = '';
  if (type === 'single') o = staff(30, 'treble') + '<line x1="14" x2="14" y1="30" y2="46" stroke="currentColor"/>';
  else if (type === 'grand') o = staff(16, 'treble') + staff(48, 'bass') + brace(16, 64) + '<line x1="14" x2="14" y1="16" y2="64" stroke="currentColor"/>';
  else if (type === 'ensemble') {
    // 앙상블: 오선 넷 + 꺾쇠괄호 (높은음 · 높은음 · 가온음 · 낮은음)
    const st2 = (y, g) => { let s2 = ''; for (let k = 0; k < 5; k++) s2 += `<line x1="14" x2="150" y1="${y + k * 3}" y2="${y + k * 3}" stroke="currentColor" stroke-width=".7"/>`; return s2 + `<text x="16" y="${y + 11}" font-size="${g === '𝄞' ? 16 : 12}" font-family="${MUSIC_FONT}" fill="currentColor">${g}</text>`; };
    o = st2(4, '𝄞') + st2(23, '𝄞') + st2(42, '𝄡') + st2(61, '𝄢') + '<rect x="8" y="3" width="2.6" height="72" fill="currentColor"/><path d="M8 3 q5 -1 8 -3 M8 75 q5 1 8 3" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="14" x2="14" y1="4" y2="73" stroke="currentColor"/>';
  }
  else o = staff(6, 'treble') + staff(34, 'treble') + staff(60, 'bass') + brace(34, 76) + '<line x1="14" x2="14" y1="6" y2="76" stroke="currentColor"/>';
  return `<svg viewBox="0 0 160 82" width="160" height="82">${o}</svg>`;
}
/** 지금 악보의 종류 (불러온 악보는 줄 수로 짐작) */
function curType(s) {
  if (SCORE_TYPES[s.type]) return s.type;
  const n = staffCount(s);
  // 악기마다 한 줄씩(피아노 묶음 없음)인 여러 줄 악보 = 앙상블
  if (n >= 2 && (s.staves || []).every(st => !isPianoStaff(st))) return 'ensemble';
  return n === 1 ? 'single' : n === 2 ? 'grand' : 'voicePiano';
}
/** 종류마다 줄의 역할: 멜로디 · 오른손 · 왼손 (앙상블 = 첫 줄 멜로디 + 악기 줄들) */
function typeRoles(t, n) { return t === 'single' ? ['mel'] : t === 'grand' ? ['rh', 'lh'] : t === 'ensemble' ? Array.from({ length: n || 2 }, (_, k) => k ? 'e' + k : 'mel') : ['mel', 'rh', 'lh']; }
/** 새 종류의 줄마다, 옛 악보의 어느 줄 음표를 가져올지 (앙상블이 끼면 위에서부터 차례대로) */
function typeMapping(oldT, newT, oldN, newN) {
  if (oldT === 'ensemble' || newT === 'ensemble') return Array.from({ length: newN }, (_, k) => k < oldN ? k : -1);
  const o = typeRoles(oldT), n = typeRoles(newT);
  return n.map(r => {
    let k = o.indexOf(r);
    if (k < 0 && r === 'rh' && !n.includes('mel')) k = o.indexOf('mel');   // 오선 → 큰보표: 멜로디를 오른손으로
    if (k < 0 && r === 'mel' && !n.includes('rh')) k = o.indexOf('rh');    // 큰보표 → 오선: 오른손을 멜로디로
    return k;
  });
}
/** 종류를 바꾸면 사라지는 음표 수 */
function typeLoss(s, newT, newN) {
  const map = typeMapping(curType(s), newT, staffCount(s), newN || typeRoles(newT).length), used = new Set(map.filter(k => k >= 0));
  let n = 0;
  for (let si = 0; si < staffCount(s); si++) if (!used.has(si)) s.measures.forEach(m => n += SNr(m, si).length + OVr(m, si).length);
  return n;
}
function convertType(s, newT, staves) {
  const map = typeMapping(curType(s), newT, staffCount(s), staves.length), used = new Set(map.filter(k => k >= 0));
  const lost = [];
  s.measures.forEach(m => {
    const old = [], oldOv = [];
    for (let si = 0; si < staffCount(s); si++) { old[si] = SNr(m, si).slice(); oldOv[si] = OVr(m, si).slice(); if (!used.has(si)) lost.push(...old[si], ...oldOv[si]); }
    m.notes = map[0] >= 0 ? old[map[0]] : [];
    m.sn = {}; m.ov = {};
    map.forEach((k, ni) => { if (ni > 0) m.sn[ni] = k >= 0 ? old[k] : []; if (k >= 0 && oldOv[k].length) m.ov[ni] = oldOv[k]; });
  });
  removeSlursFor(lost.map(n => n.id));
  s.type = newT; s.staves = staves; s.clef = staves[0].clef;
  // 줄마다 켠 계이름도 새 줄 차례로
  if (s.solfa && s.solfa.staves) { const old = s.solfa.staves; s.solfa.staves = map.map(k => k >= 0 ? !!old[k] : false); }
}
const TYPE_LIST = [['single', '오선', '한 줄 악보 · 멜로디·리드시트'], ['grand', '큰보표', '피아노 악보 (높은음 + 낮은음)'], ['voicePiano', '피아노 + 노래', '3단: 노래 한 줄 + 피아노 큰보표'], ['instPiano', '피아노 + 악기', '3단: 악기 한 줄 + 피아노 큰보표'], ['ensemble', '앙상블 (2~5중주)', '듀오 · 트리오 · 콰르텟 · 퀸텟 — 악기마다 한 줄']];
/** 1단계: 악보 종류 고르기 (오선 / 큰보표 / 피아노+노래 / 피아노+악기) · edit = 곡 정보 */
function scoreTypeDialog(startup, edit) {
  const cur = edit ? curType(S()) : null;
  const btns = startup
    ? `<button class="btn" id="tOpen">열기…</button>${App.saved ? '<button class="btn" id="tCont">이전 작업 이어서</button>' : ''}<span class="grow"></span>`
    : `<span class="grow"></span>${edit ? `<button class="btn primary" id="tKeep">이 종류 그대로 →</button>` : ''}<button class="btn" data-close>취소</button>`;
  modal(`<h2>${edit ? '곡 정보 · 악보 종류' : '어떤 악보를 만들까요?'}</h2>
  ${edit ? '<p class="muted small">지금 종류(파란 테두리)를 그대로 고르거나, 다른 종류로 바꿀 수 있어요. 써 둔 음표는 맞는 줄로 옮겨져요.</p>' : ''}
  <div class="type-grid">${TYPE_LIST.map(([k, t, d]) => `<button class="type-card${k === cur ? ' cur' : ''}${k === 'ensemble' ? ' wide' : ''}" data-type="${k}">${typePreview(k)}<b>${t}${k === cur ? ' <small>· 지금</small>' : ''}</b><span>${d}</span></button>`).join('')}</div>
  <div class="modal-btns">${btns}</div>`, md => {
    // 앙상블은 먼저 편성(악기·음자리표)을 고르는 창으로
    $$('[data-type]', md).forEach(b => b.addEventListener('click', () => b.dataset.type === 'ensemble' ? ensembleDialog(startup, edit) : newScoreDialog(startup, b.dataset.type, edit)));
    const keep = $('#tKeep', md); if (keep) keep.addEventListener('click', () => cur === 'ensemble' ? ensembleDialog(false, true) : newScoreDialog(false, cur, true));
    if (startup) {
      $('#tOpen', md).addEventListener('click', () => openDialog());
      const cont = $('#tCont', md);
      if (cont) cont.addEventListener('click', () => {
        App.s = App.saved; App.saved = null; leaveBlank(); closeModal();
        if (Native()) Native().set_title(App.s.title);
        buildSubbar(); render();
      });
    }
  }, 'type-modal', startup);
}
/**
 * 앙상블 편성 창 (2중주 ~ 5중주): 몇 중주 · 미리 정한 편성 · 악기마다 이름과 음자리표(높은음 · 낮은음 · 가온음 1~5줄)
 * → 다음 단계(제목·박자·조 …)는 다른 악보와 같은 창
 * edit = 곡 정보에서 편성 바꾸기 (써 둔 음표는 위에서부터 차례대로 옮겨요)
 */
function ensembleDialog(startup, edit, keepParts) {
  const s0 = edit ? S() : null;
  const fromScore = edit && curType(s0) === 'ensemble' ? ensembleParts(s0.staves) : null;
  let parts = clone(keepParts || fromScore || ENSEMBLE_PRESETS[0].parts);
  const clefBtns = (k, clef) => {
    const base = isCClef(clef) ? 'c' : clef;
    return `<div class="seg ens-clefs">${[['treble', '𝄞', '높은음', '높은음자리표'], ['bass', '𝄢', '낮은음', '낮은음자리표'], ['c', '𝄡', '가온음', '가온음자리표'], ['grand', '𝄞𝄢', '큰보표', '피아노·하프: 높은음 + 낮은음 두 줄']].map(([v, g, t, tip]) => `<button type="button" class="chip${base === v ? ' on' : ''}" data-eclef="${k}:${v}" title="${tip}"><span class="mus">${g}</span> ${t}</button>`).join('')}` +
      `<select class="inp ens-cline" data-ecline="${k}" title="가온음자리표가 놓이는 줄 (아래에서부터)"${base === 'c' ? '' : ' hidden'}>${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${isCClef(clef) && cLineOf(clef) === n ? ' selected' : (!isCClef(clef) && n === 3 ? ' selected' : '')}>${n}번째 줄 · ${C_CLEF_NAMES[n].replace(' (가운데)', '')}</option>`).join('')}</select></div>`;
  };
  const rowsHtml = () => parts.map((p, k) => `<div class="ens-row"><span class="ens-no">${k + 1}</span>
      <input class="inp ens-name" data-ename="${k}" value="${esc(p.name)}" placeholder="악기 이름 (예: Violin, 클라리넷)">
      ${clefBtns(k, p.clef)}</div>`).join('');
  const sizeOf = () => parts.length;
  const presetOpts = () => `<option value="">미리 정한 편성 고르기…</option>` + ENSEMBLE_PRESETS.filter(p => p.n === sizeOf()).map(p => `<option value="${ENSEMBLE_PRESETS.indexOf(p)}">${esc(p.label)}</option>`).join('');
  const loss = () => edit ? typeLoss(s0, 'ensemble', ensembleStaffN(parts)) : 0;
  modal(`<h2>앙상블 편성 <span class="type-tag">2중주 ~ 5중주</span></h2>
  <p class="muted small">악기마다 한 줄씩 만들어요. 줄마다 높은음자리표 · 낮은음자리표 · 가온음자리표(비올라 = 3번째 줄, 첼로·바순 높은 음역 = 4번째 줄)를 고를 수 있어요. 피아노·하프는 큰보표(높은음 + 낮은음 두 줄)로 들어가요.</p>
  <div class="fld">몇 중주인가요?</div>
  <div class="chips ens-size">${ENSEMBLE_SIZES.map(([n, a, b]) => `<button type="button" class="chip${n === parts.length ? ' on' : ''}" data-esize="${n}"><b>${a}</b> ${b}</button>`).join('')}</div>
  <label class="fld">편성<select class="inp" id="ePreset">${presetOpts()}</select></label>
  <div class="ens-list" id="eRows">${rowsHtml()}</div>
  <p class="warn" id="eLoss" hidden></p>
  <div class="modal-btns"><button class="btn" id="eBack">← 종류 다시 고르기</button><span class="grow"></span>${startup ? '' : '<button class="btn" data-close>취소</button>'}<button class="btn primary" id="eNext">다음 → ${edit ? '곡 정보' : '제목·박자·조'}</button></div>`, md => {
    const redraw = () => {
      $('#eRows', md).innerHTML = rowsHtml();
      $('#ePreset', md).innerHTML = presetOpts();
      $$('[data-esize]', md).forEach(b => b.classList.toggle('on', +b.dataset.esize === parts.length));
      const l = loss(); const w = $('#eLoss', md); w.hidden = !l; w.textContent = l ? `줄이 줄어서 아래쪽 줄의 음표 ${l}개가 사라져요.` : '';
      wire();
    };
    const wire = () => {
      $$('[data-ename]', md).forEach(inp => inp.addEventListener('input', () => { parts[+inp.dataset.ename].name = inp.value; }));
      $$('[data-eclef]', md).forEach(b => b.addEventListener('click', () => {
        const [k, v] = b.dataset.eclef.split(':');
        const sel = $(`[data-ecline="${k}"]`, md);
        parts[+k].clef = v === 'c' ? 'c' + (sel ? sel.value : 3) : v;
        $$(`[data-eclef^="${k}:"]`, md).forEach(x => x.classList.toggle('on', x === b));
        if (sel) sel.hidden = v !== 'c';
      }));
      $$('[data-ecline]', md).forEach(sel => sel.addEventListener('change', () => { parts[+sel.dataset.ecline].clef = 'c' + sel.value; }));
    };
    wire();
    $$('[data-esize]', md).forEach(b => b.addEventListener('click', () => {
      const n = +b.dataset.esize;
      if (n === parts.length) return;
      // 늘리면 아래에 같은 계열 악기를 더하고, 줄이면 아래 줄부터 빼요 · 그 인원의 첫 편성이 있으면 그걸로
      const pre = ENSEMBLE_PRESETS.find(p => p.n === n);
      if (!edit && pre) parts = clone(pre.parts);
      else if (n < parts.length) parts = parts.slice(0, n);
      else while (parts.length < n) parts.push({ name: `Part ${parts.length + 1}`, clef: 'treble' });
      redraw();
    }));
    $('#ePreset', md).addEventListener('change', e => { const p = ENSEMBLE_PRESETS[+e.target.value]; if (p) { parts = clone(p.parts); redraw(); } });
    $('#eBack', md).addEventListener('click', () => scoreTypeDialog(startup, edit));
    $('#eNext', md).addEventListener('click', () => {
      parts = parts.map((p, k) => ({ name: (p.name || '').trim() || `Part ${k + 1}`, clef: p.clef || 'treble' }));
      newScoreDialog(startup, 'ensemble', edit, parts);
    });
  }, 'ens-modal', startup);
}
/** 윗줄 음자리표 고르기 (노래 = 높은/낮은 · 악기·오선 = 높은/낮은/가온) */
function clefChooser(type, clef) {
  const withC = type === 'instPiano' || type === 'single';
  const base = isCClef(clef) ? 'c' : clef;
  const line = isCClef(clef) ? cLineOf(clef) : 3;
  const opt = (v, g, t) => `<button type="button" class="clef-opt${base === v ? ' on' : ''}" data-clef="${v}"><span class="mus">${g}</span><span>${t}</span></button>`;
  return `<div class="fld">${type === 'single' ? '음자리표' : type === 'voicePiano' ? '노래 줄 음자리표' : '악기 줄 음자리표'}</div>
    <div class="clef-row">${opt('treble', '𝄞', '높은음자리표')}${opt('bass', '𝄢', '낮은음자리표')}${withC ? opt('c', '𝄡', '가온음자리표') : ''}</div>
    ${withC ? `<div class="cline-row"${base === 'c' ? '' : ' hidden'}><span class="muted small">가온음자리표 위치 (처음엔 가운데 · 나중에 악보의 음자리표를 눌러 옮길 수 있어요)</span>
      <div class="seg cline">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="chip${n === line ? ' on' : ''}" data-cline="${n}">${n}번째 줄<small> ${C_CLEF_NAMES[n].replace(' (가운데)', '')}</small></button>`).join('')}</div></div>` : ''}`;
}
/** 2단계: 악보 설정 (새 악보 / 곡 정보 고치기 같은 화면) */
function newScoreDialog(startup, type, edit, parts) {
  type = type || 'single';
  const ens = type === 'ensemble';
  if (ens && !parts) return ensembleDialog(startup, edit);
  const s0 = edit ? S() : null, cur = edit ? curType(s0) : null;
  const v = edit ? {
    title: s0.title, comp: s0.composer, lyr: s0.lyricist, num: s0.time.num, den: s0.time.den, mpl: s0.lines[0] || 4, lines: s0.lines.length,
    key: s0.key, tempo: s0.tempo || '', term: s0.tempoText || '', swing: !!s0.swing, ll: s0.lyricLines || 1,
    clef: (cur !== 'grand' && type !== 'grand') ? (cur === 'grand' ? 'treble' : staffClef(s0, 0)) : 'treble',
    inst: (s0.staves[0] && s0.staves[0].name && cur !== 'grand') ? s0.staves[0].name : (type === 'voicePiano' ? 'Voice' : 'Instrument')
  } : { title: '', comp: '', lyr: '', num: 4, den: 4, mpl: 4, lines: 4, key: 0, tempo: 90, term: tempoTerm(90), ll: 1, clef: 'treble', inst: type === 'voicePiano' ? 'Voice' : 'Instrument' };
  if (type === 'voicePiano' && isCClef(v.clef)) v.clef = 'treble';
  const loss = edit && (type !== cur || (ens && ensembleStaffN(parts) < staffCount(s0))) ? typeLoss(s0, type, ens ? ensembleStaffN(parts) : undefined) : 0;
  const okLabel = edit ? (loss ? `바꾸기 (음표 ${loss}개 사라져요)` : '저장') : '악보 만들기';
  const btns = `<button class="btn" id="nBack">${ens ? '← 편성 바꾸기' : '← 종류 다시 고르기'}</button><span class="grow"></span>${startup ? '' : '<button class="btn" data-close>취소</button>'}<button class="btn primary${loss ? ' danger' : ''}" data-ok>${okLabel}</button>`;
  const clefName = c => c === 'grand' ? '𝄞𝄢 큰보표' : c === 'bass' ? '𝄢 낮은음' : isCClef(c) ? `𝄡 가온음 ${cLineOf(c)}줄` : '𝄞 높은음';
  const nameField = (type === 'voicePiano' || type === 'instPiano') ? `<label class="fld">윗줄 이름 (악보 왼쪽)<input class="inp" id="nInst" value="${esc(v.inst)}" placeholder="예: Voice, 노래, Violin, Viola, Flute"></label>`
    : ens ? `<div class="fld">편성 · ${parts.length}중주</div><div class="ens-sum">${parts.map((p, k) => `<span><b>${k + 1}</b> ${esc(p.name)} <small class="mus">${clefName(p.clef)}</small></span>`).join('')}</div>` : '';
  const head = edit ? `곡 정보` : `새 악보`;
  modal(`<h2>${head} <span class="type-tag">${SCORE_TYPES[type].label}</span>${edit && type !== cur ? ' <span class="type-tag warn-tag">종류 바꿈</span>' : ''}</h2>
  <label class="fld">제목<input class="inp" id="nTitle" placeholder="곡 제목" value="${esc(v.title)}"></label>
  <div class="row2"><label class="fld">아티스트 · 작곡<input class="inp" id="nComp" placeholder="(선택) 악보 오른쪽 위" value="${esc(v.comp)}"></label><label class="fld">작사<input class="inp" id="nLyr" placeholder="(선택) 악보 왼쪽 위" value="${esc(v.lyr)}"></label></div>
  <div class="row3"><label class="fld">박자<span class="tsig"><input class="inp" id="nNum" type="number" min="1" max="16" value="${v.num}"> / <select class="inp" id="nDen">${[2, 4, 8, 16].map(d => `<option${d === v.den ? ' selected' : ''}>${d}</option>`).join('')}</select></span></label>
  <label class="fld">한 줄 마디 수<input class="inp" id="nMpl" type="number" min="1" max="12" value="${v.mpl}"></label>
  ${edit ? `<div class="fld"><span>줄 수</span><span class="muted small" style="padding-top:8px">${v.lines}줄 · ${s0.measures.length}마디 (늘리고 줄이기는 F7 마디 편집)</span></div>` : `<label class="fld">줄 수<input class="inp" id="nLines" type="number" min="1" max="60" value="${v.lines}"></label>`}</div>
  <div class="chips ts-row">${['4/4', '3/4', '6/8', '2/4', '12/8', '2/2'].map(t => `<button class="chip${t === v.num + '/' + v.den ? ' on' : ''}" data-ts="${t}">${t}</button>`).join('')}
    <label class="swing-chip" title="8분음표 둘을 &quot;한 박 + 반 박&quot;(셋잇단)처럼 연주해요"><input type="checkbox" id="nSwing"${v.swing ? ' checked' : ''}><svg width="66" height="24" viewBox="0 3 76 28">${svgSwing(2, 25)}</svg><b>스윙</b></label></div>
  ${nameField}
  ${type === 'grand' || ens ? '' : clefChooser(type, v.clef)}
  <div class="row4">
  <label class="fld">${edit ? '조표 <span class="muted small">(음 높이는 그대로)</span>' : '조표'}<select class="inp" id="nKey">${keyOptions(v.key)}</select></label>
  <label class="fld">템포 (♩=)<input class="inp" id="nTempo" type="number" min="10" max="400" value="${v.tempo}" placeholder="미정"></label>
  <label class="fld">가사 줄 수<select class="inp" id="nLL">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${n === v.ll ? ' selected' : ''}>${n}줄</option>`).join('')}</select></label></div>
  ${tempoTermField('nTerm', v.term)}
  ${loss ? `<p class="warn">이 종류에는 없는 줄의 음표 ${loss}개가 사라져요. 남기려면 먼저 저장하세요.</p>` : ''}
  ${!startup && !edit ? '<p class="warn">지금 악보 대신 새 악보를 열어요. 남기려면 먼저 저장하세요.</p>' : ''}
  ${edit ? '<p class="muted small">조와 음표를 함께 옮기려면 위 "조옮김"을 써요. 음자리표를 바꾸면 음 높이는 그대로, 그리는 자리만 바뀌어요.</p>' : '<p class="muted">처음이라면 <a href="#" id="nHelp">사진과 함께 보는 사용법 ↗</a></p>'}
  <div class="modal-btns">${btns}</div>`, md => {
    $$('.chip[data-ts]', md).forEach(c => c.addEventListener('click', () => { const [a, b] = c.dataset.ts.split('/'); $('#nNum', md).value = a; $('#nDen', md).value = b; $$('.chip[data-ts]', md).forEach(x => x.classList.toggle('on', x === c)); }));
    const help = $('#nHelp', md); if (help) help.addEventListener('click', e => { e.preventDefault(); closeModal(); helpDialog(); });
    wireTempoTerm(md, '#nTempo', '#nTerm');
    // 음자리표 고르기
    let clefBase = isCClef(v.clef) ? 'c' : v.clef, cLine = isCClef(v.clef) ? cLineOf(v.clef) : 3;
    $$('[data-clef]', md).forEach(b => b.addEventListener('click', () => {
      clefBase = b.dataset.clef;
      $$('[data-clef]', md).forEach(x => x.classList.toggle('on', x === b));
      const row = $('.cline-row', md); if (row) row.hidden = clefBase !== 'c';
    }));
    $$('[data-cline]', md).forEach(b => b.addEventListener('click', () => { cLine = +b.dataset.cline; $$('[data-cline]', md).forEach(x => x.classList.toggle('on', x === b)); }));
    $('#nBack', md).addEventListener('click', () => ens ? ensembleDialog(startup, edit, parts) : scoreTypeDialog(startup, edit));
    md.querySelector('[data-ok]').addEventListener('click', () => {
      const clef = type === 'grand' ? 'treble' : ens ? ensembleStaves(parts)[0].clef : (clefBase === 'c' ? 'c' + cLine : clefBase);
      const inst = $('#nInst', md) ? $('#nInst', md).value.trim() : '';
      const vals = { title: $('#nTitle', md).value.trim(), composer: $('#nComp', md).value.trim(), lyricist: $('#nLyr', md).value.trim(), num: +$('#nNum', md).value || 4, den: +$('#nDen', md).value, mpl: Math.max(1, +$('#nMpl', md).value || 4), key: +$('#nKey', md).value, tempo: tempoInput($('#nTempo', md).value), tempoText: $('#nTerm', md).value.trim(), swing: $('#nSwing', md).checked, lyricLines: +$('#nLL', md).value };
      if (edit) { applyScoreEdit(type, vals, clef, inst, parts); closeModal(); return; }
      stopPlay();
      App.s = newScore(Object.assign({ type, instName: inst, clef, parts, lines: Math.max(1, +$('#nLines', md).value || 4) }, vals));
      if (type !== 'grand' && !ens) { App.s.staves[0].clef = clef; App.s.clef = clef; }
      History.clear(); App.sel = []; App.selMeasures = []; App.playStart = { m: 0, t: 0 }; App.verse = 0; App.fileHandle = null; App.nativePath = null; App.staff = 0; App.head = null; App.libId = null;
      if (Native()) Native().set_title(App.s.title);
      leaveBlank(); closeModal(); buildSubbar(); changed();
    });
  }, '', startup);
}
/** 곡 정보 저장 (종류 바꾸기 포함) */
function applyScoreEdit(type, vals, clef, inst, parts) {
  const s = S(), cur = curType(s);
  commit(() => {
    if (type === 'ensemble') {
      const st = SCORE_TYPES.ensemble.staves({ parts });
      if (cur !== 'ensemble' || st.length !== staffCount(s)) convertType(s, 'ensemble', st);
      else { s.type = 'ensemble'; s.staves = st; s.clef = st[0].clef; }   // 같은 수: 이름·음자리표만 (음표 그대로)
    } else if (type !== cur) {
      const st = SCORE_TYPES[type].staves({ clef: type === 'grand' ? 'treble' : clef, instName: inst });
      convertType(s, type, st);
    } else if (type !== 'grand') {
      s.staves[0].clef = clef; s.clef = clef;
      if (type === 'voicePiano' || type === 'instPiano') s.staves[0].name = inst || s.staves[0].name;
    }
    s.title = vals.title; s.composer = vals.composer; s.lyricist = vals.lyricist;
    s.time = { num: vals.num, den: vals.den }; s.key = vals.key;
    s.tempo = vals.tempo; s.tempoText = vals.tempoText; s.swing = !!vals.swing; s.lyricLines = vals.lyricLines;
    // 한 줄 마디 수를 바꾸면 줄을 다시 나눠요
    if (vals.mpl !== (s.lines[0] || 4) || s.lines.some(c => c !== vals.mpl)) {
      if (vals.mpl !== (s.lines[0] || 4)) { const total = s.measures.length; s.lines = []; for (let k = 0; k < total; k += vals.mpl) s.lines.push(Math.min(vals.mpl, total - k)); }
    }
  });
  if (App.verse >= s.lyricLines) App.verse = 0;
  App.staff = 0; App.sel = []; App.head = null;
  if (Native()) Native().set_title(s.title);
  buildSubbar(); render();
  toast(type !== cur ? `${SCORE_TYPES[type].label}(으)로 바꿨어요` : '곡 정보를 저장했어요');
}
/** 곡 정보 = 처음 창(악보 종류)부터 */
function infoDialog() { scoreTypeDialog(false, true); }
function transposeDialog() {
  const s = S();
  modal(`<h2>조옮김 (곡 전체)</h2><p class="muted">음표 · 코드 · 조표를 함께 옮겨요. 지금 조: <b>${KEY_NAMES[s.key]}</b></p>
  <div class="row2"><label class="fld">새 조<select class="inp" id="tKey">${keyOptions(s.key)}</select></label>
  <label class="fld">방향<select class="inp" id="tDir"><option value="near">가까운 쪽</option><option value="up">위로</option><option value="down">아래로</option></select></label></div>
  <p class="muted" id="tInfo"></p>
  <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>옮기기</button></div>`, md => {
    const info = () => { const iv = keyInterval(s.key, +$('#tKey', md).value, $('#tDir', md).value); $('#tInfo', md).textContent = `반음 ${iv.semis > 0 ? '+' : ''}${iv.semis}개 옮겨요`; };
    $('#tKey', md).addEventListener('change', info); $('#tDir', md).addEventListener('change', info); info();
    md.querySelector('[data-ok]').addEventListener('click', () => {
      const nk = +$('#tKey', md).value, iv = keyInterval(s.key, nk, $('#tDir', md).value);
      const delta = nk - s.key;
      commit(() => {
        transposeMeasures(0, s.measures.length, iv.semis, iv.d);
        s.key = nk;
        s.measures.forEach(m => { if (m.key !== null && m.key !== undefined) { let k = m.key + delta; while (k > 7) k -= 12; while (k < -7) k += 12; m.key = k; } });
      });
      closeModal(); toast('조옮김 했어요');
    });
  });
}
function keyChangeDialog(mi) {
  const c = App.ctxs[mi];
  modal(`<h2>${mi + 1}마디부터 조 바꾸기</h2><p class="muted">지금 조: <b>${KEY_NAMES[c.key]}</b> — 마지막 후렴 키 올리기는 "음표·코드도 옮기기"를 켜세요.</p>
  <label class="fld">새 조<select class="inp" id="kKey">${keyOptions(c.key)}</select></label>
  <label class="chk"><input type="checkbox" id="kMove" checked> 음표·코드도 옮기기 (다음 조 바뀜 전까지)</label>
  <label class="fld">방향<select class="inp" id="kDir"><option value="near">가까운 쪽</option><option value="up">위로</option><option value="down">아래로</option></select></label>
  <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>바꾸기</button></div>`, md => {
    md.querySelector('[data-ok]').addEventListener('click', () => {
      const nk = +$('#kKey', md).value;
      commit(() => {
        const s = S();
        let end = s.measures.findIndex((m, k) => k > mi && m.key !== null && m.key !== undefined);
        if (end < 0) end = s.measures.length;
        if ($('#kMove', md).checked) { const iv = keyInterval(c.key, nk, $('#kDir', md).value); transposeMeasures(mi, end, iv.semis, iv.d); }
        if (mi === 0) s.key = nk; else s.measures[mi].key = nk;
      });
      closeModal();
    });
  });
}
function timeChangeDialog(mi) {
  const c = App.ctxs[mi];
  modal(`<h2>${mi + 1}마디부터 박자 바꾸기</h2>
  <label class="fld">박자<span class="tsig"><input class="inp" id="cNum" type="number" min="1" max="16" value="${c.num}"> / <select class="inp" id="cDen">${[2, 4, 8, 16].map(d => `<option${d === c.den ? ' selected' : ''}>${d}</option>`).join('')}</select></span></label>
  <div class="chips">${['4/4', '3/4', '6/8', '2/4', '12/8', '2/2'].map(t => `<button class="chip" data-ts="${t}">${t}</button>`).join('')}</div>
  <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>바꾸기</button></div>`, md => {
    $$('.chip', md).forEach(ch => ch.addEventListener('click', () => { const [a, b] = ch.dataset.ts.split('/'); $('#cNum', md).value = a; $('#cDen', md).value = b; }));
    md.querySelector('[data-ok]').addEventListener('click', () => {
      const t = { num: +$('#cNum', md).value || 4, den: +$('#cDen', md).value };
      commit(() => { if (mi === 0) S().time = t; else S().measures[mi].time = t; });
      closeModal();
    });
  });
}
/** 화면 언어 적용 (설정의 언어) — 글자는 i18n.js 가 바꾸고, 다시 그려야 하는 것(계이름·상태줄·아래 막대)은 다시 그려요 */
function applyLang() {
  I18N.set(App.settings.lang || 'ko');
  if (!App.blank) { buildSubbar(); render(); } else updateStatus();
}
/* ---------- 화면 (다크 모드 · 종이 · 투명도) ---------- */
const PAPER_RGB = { white: [255, 255, 255], cream: [250, 245, 229], dark: [52, 55, 61] };
const _darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(st) {
  st = st || App.settings;
  const dark = st.theme === 'dark' || (st.theme === 'system' && _darkMQ && _darkMQ.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const paper = PAPER_RGB[st.paper] ? st.paper : 'white';
  const a = Math.max(0.3, Math.min(1, +st.paperAlpha || 1));
  const [r, g, b] = PAPER_RGB[paper];
  document.documentElement.style.setProperty('--paper', `rgba(${r},${g},${b},${a})`);
  document.body.classList.toggle('paper-dark', paper === 'dark');
  // 창 투명도: 바탕화면 프로그램(파이썬 창)에서만
  const api = Native();
  if (api && api.set_opacity) api.set_opacity(Math.max(0.5, Math.min(1, +st.winAlpha || 1)));
}
if (_darkMQ) _darkMQ.addEventListener('change', () => { if (App.settings.theme === 'system') applyTheme(); });

function settingsDialog(tab) {
  const st = App.settings;
  const before = { theme: st.theme, paper: st.paper, paperAlpha: st.paperAlpha, winAlpha: st.winAlpha, lang: st.lang || 'ko' };
  const winPct = Math.round((st.winAlpha || 1) * 100);
  const opt = (name, v, label, swatch) => `<button class="opt${st[name] === v ? ' on' : ''}" data-opt="${name}" data-v="${v}">${swatch}<span>${label}</span></button>`;
  modal(`<h2>설정</h2>
  <div class="tabs"><button data-tab="screen">화면 · 언어</button><button data-tab="general">소리 · 글꼴</button><button data-tab="phone">휴대폰 앱</button>${typeof Auth !== 'undefined' && Auth.on() ? `<button data-tab="account">${LG('계정', 'Account', 'アカウント')}</button>` : ''}</div>
  <div class="tab-pane" data-pane="phone" id="phonePane"></div>
  <div class="tab-pane" data-pane="account" id="accountPane"></div>
  <div class="tab-pane" data-pane="general">
    <label class="chk"><input type="checkbox" id="sAcc"${st.chordAccomp ? ' checked' : ''}> 코드 반주 — 재생할 때 코드 이름으로 화음·베이스도 울려요</label>
    <div class="row2"><label class="fld">음색<select class="inp" id="sTim"><option value="piano">피아노</option><option value="organ">오르간</option><option value="sine">부드러운 소리</option></select></label>
    <label class="fld">소리 크기<input type="range" id="sVol" min="0" max="1" step=".05" value="${st.volume}"></label></div>
    <label class="fld">악보 글꼴 (제목·코드·가사)<select class="inp" id="sFont"><option value="main">그리운 예은체</option><option value="basic">기본 고딕</option></select></label>
  </div>
  <div class="tab-pane" data-pane="screen">
    <div class="fld">언어 · Language · 言語</div>
    <div class="opt-row lang-row">${LANGS.map(([k, nm]) => `<button class="opt${(st.lang || 'ko') === k ? ' on' : ''}" data-opt="lang" data-v="${k}" data-notr><span class="swatch lang-sw">${{ ko: '가', en: 'A', ja: 'あ' }[k]}</span><span>${nm}</span></button>`).join('')}</div>
    <p class="muted small" style="margin-top:-4px">언어를 바꾸면 화면 글자가 바로 바뀌어요. 악보에 쓴 제목·가사는 그대로예요. 계이름 글자는 언어에 맞춰 적어요 (도레미 · Do Re Mi · ドレミ).</p>
    <div class="fld">화면 모드</div>
    <div class="opt-row">
      ${opt('theme', 'light', '밝게', '<span class="swatch" style="background:#e7ebf1;color:#1f2937">☀</span>')}
      ${opt('theme', 'dark', '어둡게 (다크 모드)', '<span class="swatch" style="background:#2e3136;color:#eceef2">☾</span>')}
      ${opt('theme', 'system', '윈도우 설정 따라', '<span class="swatch" style="background:linear-gradient(90deg,#e7ebf1 50%,#2e3136 50%);color:#888">◐</span>')}
    </div>
    <div class="fld">악보 종이</div>
    <div class="opt-row">
      ${opt('paper', 'white', '흰 종이', '<span class="swatch" style="background:#fff;color:#111">♩♪</span>')}
      ${opt('paper', 'cream', '미색 종이 (눈 편함)', '<span class="swatch" style="background:#faf5e5;color:#111">♩♪</span>')}
      ${opt('paper', 'dark', '어두운 종이 (밝은 음표)', '<span class="swatch" style="background:#34373d;color:#eceef2">♩♪</span>')}
    </div>
    <div class="fld">종이 투명도 <span class="muted small">낮출수록 종이가 배경에 비쳐 덜 눈부셔요 · 음표·글씨는 그대로 진해요</span></div>
    <div class="range-row"><span class="muted small">흐리게</span><input type="range" id="sAlpha" min="30" max="100" step="5" value="${Math.round((st.paperAlpha || 1) * 100)}"><span class="muted small">선명하게</span><output id="sAlphaOut">${Math.round((st.paperAlpha || 1) * 100)}%</output></div>
    <div class="fld">화면(창) 투명도 <span class="muted small">프로그램 창 전체가 뒤 화면에 살짝 비쳐 보여요${Native() ? '' : ' · 바탕화면 프로그램에서만 적용돼요'}</span></div>
    <div class="range-row"><span class="muted small">투명하게</span><input type="range" id="sWin" min="50" max="100" step="5" value="${winPct}"${Native() ? '' : ' disabled'}><span class="muted small">불투명하게</span><output id="sWinOut">${winPct}%</output></div>
    <p class="muted small">인쇄·PDF는 항상 흰 종이로 나와요.</p>
  </div>
  <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>저장</button></div>`, md => {
    $('#sTim', md).value = st.timbre; $('#sFont', md).value = st.scoreFont;
    const show = name => { $$('[data-tab]', md).forEach(b => b.classList.toggle('on', b.dataset.tab === name)); $$('[data-pane]', md).forEach(p => p.hidden = p.dataset.pane !== name); if (name === 'phone') phonePane($('#phonePane', md)); if (name === 'account') Auth.pane($('#accountPane', md)); };
    $$('[data-tab]', md).forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    show(tab || 'screen');
    // 고르면 바로 미리 보기
    $$('[data-opt]', md).forEach(b => b.addEventListener('click', () => {
      st[b.dataset.opt] = b.dataset.v;
      $$(`[data-opt="${b.dataset.opt}"]`, md).forEach(x => x.classList.toggle('on', x === b));
      if (b.dataset.opt === 'lang') applyLang(); else applyTheme();
    }));
    $('#sAlpha', md).addEventListener('input', e => { st.paperAlpha = +e.target.value / 100; $('#sAlphaOut', md).textContent = e.target.value + '%'; applyTheme(); });
    $('#sWin', md).addEventListener('input', e => { st.winAlpha = +e.target.value / 100; $('#sWinOut', md).textContent = e.target.value + '%'; applyTheme(); });
    App.onModalClose = () => { const langCh = st.lang !== before.lang; Object.assign(st, before); applyTheme(); if (langCh) applyLang(); };   // 취소하면 되돌리기
    md.querySelector('[data-ok]').addEventListener('click', () => {
      App.onModalClose = null;
      st.chordAccomp = $('#sAcc', md).checked; st.timbre = $('#sTim', md).value; st.volume = +$('#sVol', md).value; st.scoreFont = $('#sFont', md).value;
      saveSettings(); closeModal(); render();
    });
  });
}
/**
 * 설정 → 휴대폰 앱: PC 프로그램을 업데이트하면 휴대폰 앱도 자동으로 최신이 되게 (GitHub 저장소에 올리기)
 *  - 휴대폰 앱은 켤 때마다 저장소의 update.json 을 보고, 바뀐 화면 파일만 받아서 바꿔요
 *  - PC 프로그램은 켤 때 새 버전이면 자동으로 올려요 (아래 "자동으로 올리기")
 */
async function phonePane(el) {
  const api = Native();
  if (!api || !api.publish_status) {
    mobileOmrPane(el); return;     // 휴대폰(앱·웹): 밖에서 자동 인식(클라우드) · 집 PC와 연결
  }
  const st = await api.publish_status();
  const link = (url, text) => `<a href="#" data-link="${url}">${text}</a>`;
  el.innerHTML = `<div id="plBox"></div><div id="cloudBox" style="margin-top:12px"></div>
  <h3 style="margin:14px 0 4px">${LG('휴대폰 앱 자동 업데이트', 'Phone app auto-update', 'スマホアプリの自動更新')}</h3>
  <p class="muted small" style="margin-top:0">PC 프로그램을 업데이트하면 휴대폰 앱도 켤 때 자동으로 최신 버전이 돼요. 무료 GitHub 저장소 하나에 업데이트 파일을 올려 두고, 휴대폰 앱이 거기서 받아요. <b>처음 한 번만</b> 설정해요.</p>
  <ol class="pub-steps small">
    <li>${link('https://github.com/signup', 'GitHub 가입')} (이미 있으면 건너뛰기)</li>
    <li>${link('https://github.com/new', '새 저장소 만들기')} — 이름 예: <b>bflat-app</b> · <b>Public</b>(공개)로</li>
    <li>${link('https://github.com/settings/personal-access-tokens/new', '토큰 만들기')} — Repository access: <b>Only select repositories</b> → 그 저장소 · Permissions: <b>Contents → Read and write</b> → 만든 토큰을 아래에 붙여 넣기</li>
  </ol>
  <div class="row3"><label class="fld">GitHub 계정 이름<input class="inp" id="pOwner" value="${esc(st.owner)}" placeholder="예: myname" spellcheck="false"></label>
  <label class="fld">저장소 이름<input class="inp" id="pRepo" value="${esc(st.repo || 'bflat-app')}" spellcheck="false"></label>
  <label class="fld">토큰<input class="inp" id="pToken" type="password" autocomplete="off" placeholder="${st.hasToken ? '저장돼 있어요 · 바꿀 때만 입력' : 'github_pat_…'}"></label></div>
  <label class="chk"><input type="checkbox" id="pAuto"${st.auto ? ' checked' : ''}> PC 프로그램을 켤 때 새 버전이면 자동으로 올리기</label>
  <div class="row2" style="margin-top:8px"><button class="btn" id="pSave">저장 · 연결 확인</button><button class="btn primary" id="pPub">지금 올리기</button></div>
  <p class="small" id="pMsg"></p>
  <div class="pub-status small muted">
    <div>지금 PC 버전: <b data-notr>${esc(st.current)}</b>${st.published ? ` · 올린 버전: <b data-notr>${esc(st.published)}</b> <span data-notr>(${esc(st.publishedAt)})</span>` : ' · 아직 안 올렸어요'}</div>
    ${st.apk ? `<div>휴대폰 앱(APK): <b data-notr>${esc(st.apk.versionName)}</b> — 새 APK도 같이 올려요</div>` : ''}
    ${st.pages ? `<div>휴대폰에서 받는 주소 (카톡으로 보내기): <b data-notr>${esc(st.pages)}</b> <button class="btn" id="pCopy" style="min-height:0;padding:1px 8px">복사</button></div>` : ''}
    ${st.url ? `<div>휴대폰 앱이 보는 주소: <span data-notr>${esc(st.url)}/update.json</span></div>` : ''}
  </div>
  <p class="muted small">토큰은 이 PC에만, 윈도우 계정으로 암호화해서 저장해요. 설정을 마친 다음 만든 APK부터 자동 업데이트가 켜져요 (APK 만들기.bat).</p>`;
  phoneLinkBox($('#plBox', el));
  cloudPcBox($('#cloudBox', el));
  $$('[data-link]', el).forEach(a => a.addEventListener('click', e => { e.preventDefault(); api.open_url(a.dataset.link); }));
  const cp = $('#pCopy', el); if (cp) cp.addEventListener('click', async () => { try { await navigator.clipboard.writeText(st.pages); cp.textContent = '✓'; } catch (e) { prompt('', st.pages); } });
  const msg = (t, bad) => { const m = $('#pMsg', el); m.textContent = t; m.style.color = bad ? '#dc2626' : ''; };
  const errText = r => ({ config: LG('계정 이름·저장소 이름·토큰을 모두 넣어 주세요', 'Fill in account, repository and token', 'アカウント名・リポジトリ名・トークンをすべて入れてください'),
    private: LG('저장소가 비공개(Private)예요 · 휴대폰 앱이 받을 수 있게 Public으로 바꿔 주세요', 'The repository is private · make it Public so the phone app can download', 'リポジトリが非公開です · Publicにしてください'),
    push: LG('토큰에 올리기 권한이 없어요 · Contents → Read and write 로 다시 만들어 주세요', 'The token cannot write · recreate it with Contents → Read and write', 'トークンに書き込み権限がありません · Contents → Read and write で作り直してください'),
    http: (r.status === 401 ? LG('토큰이 맞지 않아요', 'The token is not valid', 'トークンが正しくありません') : r.status === 404 ? LG('저장소를 찾지 못했어요 (계정 이름·저장소 이름·토큰 권한 확인)', 'Repository not found (check names and token access)', 'リポジトリが見つかりません (名前・トークンの権限を確認)') : `GitHub ${r.status}: ${r.message || ''}`),
    net: LG('인터넷에 연결할 수 없어요', 'Cannot reach the internet', 'インターネットに接続できません') + (r.message ? ` (${r.message})` : '') }[r.error] || LG('실패했어요', 'Failed', '失敗しました'));
  const save = async () => {
    msg(LG('확인하는 중…', 'Checking…', '確認中…'));
    const r = await api.publish_save($('#pOwner', el).value, $('#pRepo', el).value, 'main', $('#pToken', el).value, $('#pAuto', el).checked);
    $('#pToken', el).value = '';
    if (r.ok) msg(LG('연결됐어요 ✓', 'Connected ✓', '接続しました ✓')); else msg(errText(r), true);
    return r.ok;
  };
  $('#pSave', el).addEventListener('click', save);
  $('#pPub', el).addEventListener('click', async () => {
    if ($('#pToken', el).value || $('#pOwner', el).value !== st.owner || $('#pRepo', el).value !== st.repo) { if (!(await save())) return; }
    msg(LG('올리는 중… (처음엔 1~2분 걸려요)', 'Uploading… (the first time takes a minute or two)', 'アップロード中… (初回は1〜2分かかります)'));
    const r = await api.publish_update();
    if (r.ok) { msg(LG(`올렸어요 ✓ 버전 ${r.version} · 바뀐 파일 ${r.uploaded.length}개`, `Uploaded ✓ version ${r.version} · ${r.uploaded.length} files changed`, `アップロードしました ✓ バージョン ${r.version} · 変更 ${r.uploaded.length}ファイル`)); phonePane(el).then(() => msg(LG(`올렸어요 ✓ 버전 ${r.version}`, `Uploaded ✓ version ${r.version}`, `アップロードしました ✓ バージョン ${r.version}`))); }
    else msg(errText(r), true);
  });
}
const SHORTCUTS = [
  ['F1 음표', [['N', '쓰기 모드 켜기/끄기'], ['마디 클릭 (쓰기 모드 끔)', '음표/쉼표 개수 고르기 — 고친 것은 두고 뒤쪽에서 늘리거나 줄임'], ['Caps Lock', '지금 마디(고른 음표·빈 마디 커서가 있는 마디)의 개수 창 열기 — 마디 클릭과 같은 창'], ['H', '화음 탭으로 (멜로디를 다 쓴 다음에)'],['Shift + 클릭 (쓰기 모드)', '그 높이의 음을 화음으로 얹기 · 화음의 머리를 클릭하면 그 음만 고르기'], ['Alt + ↑ ↓', '큰보표·3단 악보에서 위/아래 줄로 옮기기'], ['개수 창이 떠 있을 때', '방향키 = 창 안에서 칸 옮기기 (음표/쉼표 · 숫자 · 쉼표로 채움) · Enter = 고르기 · Esc / Caps Lock = 닫기 — 개수가 정해지면 방향키는 다시 음표 이동'], ['빈 곳 클릭 (쓰기 모드 켬)', '그 높이에 음표 머리 추가'], ['음표 클릭', '고르기 (Shift = 범위, Ctrl = 하나씩 더하기)'], ['3 / ` / 1 / 2 / 4 (숫자열·넘패드)', '길이: 3=16분음표 `=8분음표 1=4분음표 2=2분음표 4=온음표'], ['. / 0', '점 붙이기 / 쉼표로 바꾸기'], ['쉼표 채움 버튼 두 개', '모든 부족한 박자 = 빈 마디까지 전부 · 작업한 마디만 = 음표를 넣어 빨갛게 된 마디만'], ['T', '셋잇단 켜고 끄기'], ['↑ ↓', '오선 한 칸 (Shift = 반음, Ctrl = 옥타브)'], ['A ~ G', '음 이름으로 바로'], ['← → / Enter', '이전·다음 음표 (Ctrl = 다음 마디)'], ['Alt + ← →', '고른 음표를 옆 음표와 자리 바꾸기'], ['끌기', '빈 곳에서 = 여러 개 고르기, 고른 음표 = 다른 마디로 옮기기 (쓰기 모드에선 위아래 = 음높이)'], ['Insert', '고른 음표 뒤에 새 음표'], ['꾸밈·셈여림·글자…', '악센트·스타카토·테누토·마르카토·늘임표 · 셈여림 · 템포·표현 글자 (♩=100 → 재생 빠르기도)'], ['Delete', '지우기']]],
  ['H 화음 (멜로디 잠김)', [['← → / Enter · 클릭', '화음 넣을 자리 옮기기 — 멜로디 박마다, 넣은 화음 음의 시작·끝마다 멈춰요 (Ctrl = 다음 마디)'], ['3 / ` / 1 / 2 / 4', '그 자리에서 시작하는 화음 음 넣기 (멜로디 음 3도 아래) · 이미 있으면 길이 바꾸기 · 멜로디와 리듬이 달라도 돼요 · 마디당 16개까지'], ['.', '그 자리 화음 음에 바로 점 붙이기/떼기'], ['↑ ↓ / A ~ G', '화음 음 높이 (Shift = 반음, Ctrl = 옥타브)'], ['Insert', '그 화음 음에 한 음 더 (3도 아래)'], ['Delete', '그 자리 화음 음 지우기 (멜로디는 안 지워져요)'], ['보이는 모양', '멜로디와 같은 박·같은 길이면 한 기둥 화음 · 리듬이 다르면 멜로디 기둥은 위, 화음 기둥은 아래 · 8분음표끼리는 빔으로 이어요'], ['Alt + ↑ ↓', '위/아래 줄로'], ['Esc / H', '화음 쌓기 끝 → 음표 탭 (멜로디를 다시 고칠 수 있어요)']]],
  ['F2 이음줄', [['음표를 끌어 다른 음표에 놓기', '이음줄 만들기'], ['줄 클릭 → "붙임줄로 바꾸기" / T', '붙임줄 ↔ 이음줄 (붙임줄은 바로 옆 음끼리, 뒤 음 높이를 맞춰요)'], ['+ / S (음표 모드)', '다음 음과 붙임줄 / 이음줄']]],
  ['F3 ~ F6', [['마디선', '마디선 클릭 = 도돌이·겹세로줄 · 마디 클릭 = 1·2번 괄호, D.S., Coda · 끌기·Shift+클릭 = 여러 마디에 괄호 · 아래 상태줄에 재생 순서'], ['코드', '마디 위 점 클릭 → 입력 · Space / Shift+Space 또는 ◀▶ = 반 박씩 · Tab = 다음 점'], ['가사', '마디 클릭 → 그 마디 가사 ([두근]처럼 묶으면 한 음에 두 글자 · _ = 건너뛰기) · 가사 줄(1절·2절…)은 곡 정보의 "가사 줄 수"로'], ['송폼', '마디 위쪽 클릭 → Intro, Verse, Chorus …']]],
  ['F7 마디 편집', [['마디 클릭 / Shift+클릭 / 끌기', '마디 고르기'], ['고른 마디 끌기', '다른 자리로 옮기기 (음표·코드·가사 그대로)'], ['Ctrl+C / Ctrl+X / Ctrl+V', '복사 / 잘라내기 / 고른 마디 뒤에 붙여넣기'], ['Delete', '고른 마디 지우기 — 그 줄만 마디가 줄어요'], ['Insert / "마디 추가하기"', '고른 마디 바로 뒤에 빈 마디'], ['"앞에·뒤에 줄 넣기"', '고른 마디가 놓인 줄 앞·뒤에 새 줄'], ['"줄 지우기"', '고른 마디가 놓인 줄 전체 지우기'], ['마디 폭 "직접 수정"', '파란 마디선을 끌어 폭 바꾸기 · 고른 마디선은 ←→ (Shift = 크게) · "이 줄 똑같이" · Esc = 끝'], ['마디 폭 "자동 수정"', '박자가 다 맞는 줄만 음표 수에 맞춰 폭 나누기']]],
  ['어디서나', [['F1 ~ F7', '모드 바로 가기 (새로고침은 Ctrl+R)'], ['Tab / Shift+Tab', '다음 / 이전 모드'], ['Space', '재생 / 정지 — 초록 표시부터 · 도돌이표·괄호·D.S./D.C.·Coda·Fine을 따라가요'], ['파란 마디', '아직 작업하지 않은 빈 마디'], ['음표 누르기', '그 음을 재생 시작점으로 · ⏮ = 처음부터'], ['Ctrl+Z / Ctrl+Y', '되돌리기 / 다시'], ['Ctrl+S / Ctrl+O / Ctrl+P', '저장 / 열기 (MusicXML도) / 인쇄·PDF'], ['내보내기', 'MusicXML · MIDI · 오디오 WAV · PDF'], ['오른쪽 클릭', '마디 넣기·지우기, 박자 바꾸기, 못갖춘마디, 조 바꾸기'], ['.mid 파일을 마디에 끌어 놓기', '놓은 마디·박부터 악보로 (16분음표 단위, 맨 위 음)'], ['Ctrl + 휠', '확대 / 축소']]]];
function shortcutsDialog() {
  modal(`<h2>단축키</h2><div class="sc">${SHORTCUTS.map(([t, rows]) => `<h3>${t}</h3><table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`).join('')}</div><div class="modal-btns"><button class="btn primary" data-close>닫기</button></div>`, null, 'wide');
}
/** 사용법 (언어마다 따로 쓴 글) */
const HELP_HTML = {
  ko: `<h2>BFlat Studio 사용법</h2><div class="sc help">
  <h3>1. 새 악보</h3><p>왼쪽 위 <b>파일 ▾ → 새 악보</b>에서 악보 종류(오선 · 큰보표 · 피아노+노래 · 피아노+악기 · 앙상블 2~5중주)를 고르고 제목·박자·조표·줄 수를 정해요. 아직 작업 안 한 마디는 <span class="pill blue">파란색</span>으로 보여요.</p>
  <h3>2. 음표 넣기 (F1)</h3><p>마디를 클릭하거나 <b>Caps Lock</b>을 누르면 음표 개수를 고를 수 있어요 (예: 4 → 솔 자리에 음표 머리 넷). 음표를 고르고 <b>↑↓</b> 또는 <b>A~G</b>로 높이를, <b>3</b>(16분음표) · <b>\`</b>(8분음표) · <b>1</b>(4분음표) · <b>2</b>(2분음표) · <b>4</b>(온음표)로 길이를 바꿔요. 박자가 안 맞는 마디는 <span class="pill red">빨간색</span>.</p>
  <p><b>N</b>으로 쓰기 모드를 켜면 오선 빈 곳을 클릭해 바로 음표를 그릴 수 있어요. 끌면 음높이가 바뀌어요.</p>
  <h3>줄 · 화음</h3><p>줄을 클릭하면 그 줄에 쓰고, <b>Alt+↑↓</b>로 위아래 줄을 오가요. 멜로디를 다 쓴 다음 <b>H</b>(또는 위 "화음" 탭)를 누르면 화음 탭이 열려요. 이때 멜로디는 잠기고, 음표를 고르고 길이 키를 누를 때마다 그 위에 화음이 얹혀요 (길이가 달라도 돼요 · ↑↓로 높이). <b>Esc</b>로 끝내면 다시 멜로디를 고칠 수 있어요.</p>
  <h3>3. 이음줄·붙임줄 (F2)</h3><p>음표를 끌어 다른 음표에 놓으면 이음줄. 줄을 클릭하고 T를 누르면 붙임줄로.</p>
  <h3>4. 마디선·도돌이 (F3)</h3><p>마디선을 클릭해 도돌이표, 마디를 클릭해 1·2번 괄호와 D.S./Coda. 아래 상태줄에 실제 재생 순서가 보여요.</p>
  <h3>5. 코드 (F4) · 가사 (F5) · 송폼 (F6)</h3><p>코드: 마디 위 점을 클릭해 입력, Space로 반 박씩 이동. 가사: 마디를 클릭해 한 마디씩 입력 (한글은 한 글자 = 한 음). 송폼: 마디 위쪽 클릭.</p>
  <h3>6. 마디 편집 (F7)</h3><p>마디를 골라 복사·붙여넣기·지우기·옮기기, 줄 넣기, 마디 폭 조절.</p>
  <h3>7. 도구 ▾</h3><p>곡 정보 · 조옮김 · 계이름 · <b>악보 인식</b>(PDF · 사진 JPG/PNG · 한글 HWP 파일을 읽어 고칠 수 있는 악보로) · MIDI 넣기.</p>
  <h3>8. 저장 · 내 악보함</h3><p><b>Ctrl+S</b>로 .bflat 파일로 저장하거나, <b>파일 ▾ → 내 악보함에 저장</b>으로 프로그램 안에 모아 둬요 (작게 줄여서 보관). MusicXML로 내보내면 MuseScore·Sibelius에서 이어서 작업할 수 있어요. 인쇄·PDF는 Ctrl+P.</p>
  <h3>9. 설정 ⚙</h3><p>화면(어둡게·밝게) · 악보 종이 · 언어(한국어 · English · 日本語) · 소리 · 글꼴.</p></div>`,
  en: `<h2>How to use BFlat Studio</h2><div class="sc help">
  <h3>1. New score</h3><p>Open <b>File ▾ → New score</b> at the top left, choose a score type (single staff · grand staff · piano+voice · piano+instrument · ensemble of 2–5) and set the title, time, key and number of lines. Measures you have not worked on yet are <span class="pill blue">blue</span>.</p>
  <h3>2. Entering notes (F1)</h3><p>Click a measure or press <b>Caps Lock</b> to choose how many notes it gets (e.g. 4 → four note heads on G). Select a note and use <b>↑↓</b> or <b>A–G</b> for pitch, and <b>3</b> (16th note) · <b>\`</b> (8th note) · <b>1</b> (quarter note) · <b>2</b> (half note) · <b>4</b> (whole note) for length. Measures with the wrong number of beats turn <span class="pill red">red</span>.</p>
  <p>Press <b>N</b> for write mode: click empty staff space to draw a note right away. Drag to change its pitch.</p>
  <h3>Staves · harmony</h3><p>Click a staff to write on it; <b>Alt+↑↓</b> moves between staves. When the melody is done press <b>H</b> (or the "Harmony" tab) — the melody is locked and every length key adds a harmony note on the selected beat (lengths may differ · ↑↓ for pitch). Press <b>Esc</b> to finish and edit the melody again.</p>
  <h3>3. Slurs · ties (F2)</h3><p>Drag a note onto another note for a slur. Click the curve and press T to turn it into a tie.</p>
  <h3>4. Barlines · repeats (F3)</h3><p>Click a barline for repeats, click a measure for 1st/2nd endings and D.S./Coda. The status bar shows the actual playback order.</p>
  <h3>5. Chords (F4) · lyrics (F5) · form (F6)</h3><p>Chords: click a dot above a measure and type; Space moves half a beat. Lyrics: click a measure and type one measure at a time. Form: click above a measure.</p>
  <h3>6. Measures (F7)</h3><p>Select measures to copy, paste, delete or move them, insert lines and adjust widths.</p>
  <h3>7. Tools ▾</h3><p>Score info · transpose · solfège · <b>score recognition</b> (reads a PDF, a photo (JPG/PNG) or a Hangul HWP file into an editable score) · insert MIDI.</p>
  <h3>8. Saving · My scores</h3><p><b>Ctrl+S</b> saves a .bflat file; <b>File ▾ → Save to My scores</b> keeps it inside the app (stored compressed). Export MusicXML to continue in MuseScore or Sibelius. Print / PDF is Ctrl+P.</p>
  <h3>9. Settings ⚙</h3><p>Display (dark · light) · paper · language (한국어 · English · 日本語) · sound · font.</p></div>`,
  ja: `<h2>BFlat Studioの使い方</h2><div class="sc help">
  <h3>1. 新しい楽譜</h3><p>左上の <b>ファイル ▾ → 新しい楽譜</b> で楽譜の種類(五線 · 大譜表 · ピアノ+歌 · ピアノ+楽器 · アンサンブル2〜5重奏)を選び、タイトル・拍子・調号・段数を決めます。まだ作業していない小節は <span class="pill blue">青</span> で表示されます。</p>
  <h3>2. 音符の入力 (F1)</h3><p>小節をクリックするか <b>Caps Lock</b> を押すと音符の数を選べます (例: 4 → ソの位置に符頭4つ)。音符を選んで <b>↑↓</b> または <b>A〜G</b> で高さを、<b>3</b>(16分音符) · <b>\`</b>(8分音符) · <b>1</b>(4分音符) · <b>2</b>(2分音符) · <b>4</b>(全音符) で長さを変えます。拍が合わない小節は <span class="pill red">赤</span> になります。</p>
  <p><b>N</b> で書き込みモードをオンにすると、五線の空白をクリックしてすぐ音符を書けます。ドラッグで音の高さが変わります。</p>
  <h3>段 · 和音</h3><p>段をクリックするとその段に書き、<b>Alt+↑↓</b> で上下の段を移動します。メロディを書き終えたら <b>H</b>(または上の「和音」タブ)を押すと和音タブが開きます。メロディはロックされ、長さキーを押すたびに選んだ拍に和音が重なります (長さが違ってもOK · ↑↓で高さ)。<b>Esc</b> で終えるとまたメロディを直せます。</p>
  <h3>3. スラー・タイ (F2)</h3><p>音符をドラッグして別の音符に置くとスラー。線をクリックしてTを押すとタイになります。</p>
  <h3>4. 小節線・反復 (F3)</h3><p>小節線をクリックで反復記号、小節をクリックで1・2番カッコとD.S./Coda。下のステータスバーに実際の再生順が表示されます。</p>
  <h3>5. コード (F4) · 歌詞 (F5) · 構成 (F6)</h3><p>コード: 小節上の点をクリックして入力、Spaceで半拍ずつ移動。歌詞: 小節をクリックして1小節ずつ入力。構成: 小節の上をクリック。</p>
  <h3>6. 小節編集 (F7)</h3><p>小節を選んでコピー・貼り付け・削除・移動、段の挿入、小節幅の調整。</p>
  <h3>7. ツール ▾</h3><p>曲情報 · 移調 · 階名 · <b>楽譜認識</b>(PDF · 写真 JPG/PNG · ハングルHWPファイルを読み取り、編集できる楽譜に) · MIDIを入れる。</p>
  <h3>8. 保存 · マイ楽譜</h3><p><b>Ctrl+S</b> で.bflatファイルに保存、または <b>ファイル ▾ → マイ楽譜に保存</b> でアプリ内に保管します (圧縮して保存)。MusicXMLに書き出すとMuseScore・Sibeliusで続きを作業できます。印刷・PDFは Ctrl+P。</p>
  <h3>9. 設定 ⚙</h3><p>画面(ダーク・ライト) · 紙 · 言語(한국어 · English · 日本語) · 音 · フォント。</p></div>`,
};
function helpDialog() {
  modal(`<div data-notr>${HELP_HTML[I18N.lang] || HELP_HTML.ko}</div><div class="modal-btns"><button class="btn" id="hSc">단축키 전체 보기</button><button class="btn primary" data-close>닫기</button></div>`, md => $('#hSc', md).addEventListener('click', () => { closeModal(); shortcutsDialog(); }), 'wide');
}

/* ---------- 파일 ---------- */
async function saveFile(saveAs) {
  const data = JSON.stringify(App.s, null, 1);
  const name = safeName(S()) + '.bflat';
  const api = Native();
  if (api) {
    const b64 = await blobToB64(new Blob([data], { type: 'application/json' }));
    const res = (App.nativePath && !saveAs) ? await api.write_file(App.nativePath, b64) : await api.save_as(name, b64, 'score');
    if (res) { App.nativePath = res.path; toast(`저장했어요 — ${res.name}`); api.set_title(S().title || res.name); }
    return;
  }
  if (window.AndroidBridge) { await downloadBlob(new Blob([data], { type: 'application/json' }), name); return; }   // 안드로이드: 저장 위치 고르는 창
  try {
    if (window.showSaveFilePicker) {
      if (!App.fileHandle || saveAs) App.fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'BFlat Studio 악보', accept: { 'application/json': ['.bflat'] } }] });
      const w = await App.fileHandle.createWritable(); await w.write(data); await w.close();
      toast(`저장했어요 — ${App.fileHandle.name}`); return;
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  downloadBlob(new Blob([data], { type: 'application/json' }), name);
  toast('저장했어요 (다운로드 폴더)');
}
/* ---------- 내 악보함 (프로그램 안 저장공간) ----------
 * 악보(JSON)를 gzip으로 줄여서 보관해요 (악보 하나 보통 수십 KB · 전체 200MB까지)
 * 바탕화면 프로그램: %APPDATA%\BFlat Studio\library 폴더 · 브라우저: 이 브라우저 저장공간(IndexedDB)
 */
const LIB_LIMIT = 200 * 1024 * 1024;
async function gzipText(text) { return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzipBytes(bytes) { return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
const bytesToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const Lib = {
  native() { const a = Native(); return a && a.lib_list ? a : null; },
  _db: null,
  db() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => { const r = indexedDB.open('bflat-lib', 1); r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this._db;
  },
  async idb(mode, fn) { const db = await this.db(); return new Promise((res, rej) => { const tx = db.transaction('items', mode); const st = tx.objectStore('items'); const r = fn(st); tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined); tx.onerror = () => rej(tx.error); }); },
  async list() {
    const api = this.native(); if (api) return await api.lib_list();
    const all = await this.idb('readonly', st => st.getAll());
    const items = (all || []).map(({ data, ...m }) => m).sort((a, b) => b.updated - a.updated);
    return { items, used: items.reduce((a, it) => a + (it.size || 0), 0), limit: LIB_LIMIT };
  },
  async save(s, id) {
    const gz = await gzipText(JSON.stringify(s));
    const meta = { name: s.title || LG('제목 없음', 'Untitled', '無題'), measures: s.measures.length };
    const api = this.native(); if (api) return await api.lib_save(meta, bytesToB64(gz), id || null);
    const cur = await this.list();
    const old = id ? cur.items.find(it => it.id === id) : null;
    if (cur.used - (old ? old.size : 0) + gz.length > LIB_LIMIT) return { error: 'full', used: cur.used, limit: LIB_LIMIT };
    const it = { id: old ? old.id : Math.random().toString(16).slice(2, 14), name: meta.name, measures: meta.measures, updated: Date.now(), size: gz.length, data: gz };
    await this.idb('readwrite', st => st.put(it));
    const { data, ...m } = it; return m;
  },
  async load(id) {
    const api = this.native();
    const bytes = api ? b64ToBytes(await api.lib_load(id)) : (await this.idb('readonly', st => st.get(id))).data;
    return JSON.parse(await gunzipBytes(bytes));
  },
  async del(id) { const api = this.native(); if (api) return api.lib_delete(id); return this.idb('readwrite', st => st.delete(id)); },
  async rename(id, name) {
    const api = this.native(); if (api) return api.lib_rename(id, name);
    const it = await this.idb('readonly', st => st.get(id)); if (!it) return; it.name = name; return this.idb('readwrite', st => st.put(it));
  },
};
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
/** 지금 악보를 내 악보함에 (내 악보함에서 연 악보면 그 자리에 덮어써요 · asNew = 새로 하나 더) */
async function libSave(asNew) {
  if (App.blank) { toast(LG('먼저 악보를 만들거나 여세요', 'Create or open a score first', '先に楽譜を作るか開いてください')); return; }
  try {
    const r = await Lib.save(S(), asNew ? null : App.libId);
    if (!r || r.error) { toast(r && r.error === 'full' ? LG(`내 악보함이 꽉 찼어요 (${fmtSize(r.used)} / ${fmtSize(r.limit)}) · 안 쓰는 악보를 지워 주세요`, `My scores is full (${fmtSize(r.used)} / ${fmtSize(r.limit)}) · delete unused scores`, `マイ楽譜がいっぱいです (${fmtSize(r.used)} / ${fmtSize(r.limit)}) · 使わない楽譜を削除してください`) : LG('저장하지 못했어요', 'Could not save', '保存できませんでした'), 4200); return; }
    App.libId = r.id;
    toast(LG(`내 악보함에 저장했어요 — ${r.name} (${fmtSize(r.size)})`, `Saved to My scores — ${r.name} (${fmtSize(r.size)})`, `マイ楽譜に保存しました — ${r.name} (${fmtSize(r.size)})`));
  } catch (e) { console.error(e); toast(LG('저장하지 못했어요: ', 'Could not save: ', '保存できませんでした: ') + e.message, 4000); }
}
async function libraryDialog() {
  let data;
  try { data = await Lib.list(); } catch (e) { console.error(e); toast(LG('내 악보함을 열 수 없어요', 'Cannot open My scores', 'マイ楽譜を開けません')); return; }
  const pct = Math.min(100, data.used / data.limit * 100);
  const when = ms => new Date(ms).toLocaleString(I18N.lang === 'ko' ? 'ko-KR' : I18N.lang === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  modal(`<h2>내 악보함</h2>
  <div class="lib-usage"><div class="lib-bar"><i style="width:${pct.toFixed(1)}%"></i></div><span data-notr>${fmtSize(data.used)} / ${fmtSize(data.limit)}</span></div>
  <div class="lib-actions">${App.blank ? '' : `<button class="btn primary" id="lSave">${App.libId ? '지금 악보 저장 (덮어쓰기)' : '지금 악보 저장'}</button>${App.libId ? '<button class="btn" id="lSaveNew">새로 하나 더 저장</button>' : ''}`}</div>
  <div class="lib-list">${data.items.length ? data.items.map(it => `<div class="lib-item${it.id === App.libId ? ' cur' : ''}" data-id="${esc(it.id)}">
      <div class="lib-main"><b data-notr>${esc(it.name)}</b><span class="muted small" data-notr>${esc(when(it.updated))} · ${LG(`${it.measures}마디`, `${it.measures} measures`, `${it.measures}小節`)} · ${fmtSize(it.size)}</span></div>
      <button class="btn" data-lopen>열기</button><button class="btn icon" data-lren title="이름 바꾸기">✎</button><button class="btn icon" data-ldel title="지우기">🗑</button></div>`).join('') : '<p class="muted">아직 저장한 악보가 없어요. 악보를 만든 다음 "지금 악보 저장"을 눌러요.</p>'}</div>
  <p class="muted small">악보는 작게 줄여서 보관해요 (악보 하나 보통 수십 KB · 전체 200MB까지).${Lib.native() ? '' : ' 브라우저에서는 이 브라우저에만 저장돼요.'}</p>
  <div class="modal-btns"><span class="grow"></span><button class="btn primary" data-close>닫기</button></div>`, md => {
    const s1 = $('#lSave', md), s2 = $('#lSaveNew', md);
    if (s1) s1.addEventListener('click', async () => { await libSave(false); libraryDialog(); });
    if (s2) s2.addEventListener('click', async () => { await libSave(true); libraryDialog(); });
    $$('.lib-item', md).forEach(row => {
      const id = row.dataset.id, it = data.items.find(x => x.id === id);
      $('[data-lopen]', row).addEventListener('click', async () => {
        try {
          const s = fixIds(await Lib.load(id));
          stopPlay(); if (!App.blank) History.push(App.s);
          App.s = s; App.sel = []; App.selMeasures = []; App.playStart = { m: 0, t: 0 }; App.verse = 0; App.fileHandle = null; App.nativePath = null; App.libId = id;
          leavePdfOnly(); if (App.blank) leaveBlank(); closeModal();
          if (Native()) Native().set_title(s.title || it.name);
          buildSubbar(); changed();
          toast(LG(`열었어요 — ${it.name}`, `Opened — ${it.name}`, `開きました — ${it.name}`));
        } catch (e) { console.error(e); toast(LG('열 수 없어요: ', 'Cannot open: ', '開けません: ') + e.message, 4000); }
      });
      $('[data-lren]', row).addEventListener('click', () => askText(LG('악보 이름', 'Score name', '楽譜の名前'), '', it.name, async v => { v = v.trim(); if (!v) return; await Lib.rename(id, v); libraryDialog(); }));
      $('[data-ldel]', row).addEventListener('click', async () => {
        if (!confirm(LG(`"${it.name}"을(를) 내 악보함에서 지울까요? 지우면 되돌릴 수 없어요.`, `Delete "${it.name}" from My scores? This cannot be undone.`, `「${it.name}」をマイ楽譜から削除しますか? 元に戻せません。`))) return;
        await Lib.del(id); if (App.libId === id) App.libId = null; libraryDialog();
      });
    });
  }, 'lib-modal');
}
/* ---------- 계이름 (악보 잘 못 보는 학생용) ---------- */
function solfaDialog() {
  const s = S(), n = nStaves();
  const sol = s.solfa || { staves: [], style: 'ko' };
  const clefGlyph = c => c === 'bass' ? '𝄢' : isCClef(c) ? '𝄡' : '𝄞';
  const rowLabel = si => {
    const st = s.staves[si] || {};
    const cl = st.clef === 'bass' ? '낮은음자리표' : isCClef(st.clef) ? '가온음자리표' : '높은음자리표';
    if (n === 1) return `악보 (${cl})`;
    if (isPianoStaff(st)) return `${st.clef === 'bass' ? '피아노 왼손' : '피아노 오른손'} (${cl})`;
    return `${st.name || '윗줄'} (${cl})`;
  };
  modal(`<h2>계이름 적기</h2>
  <p class="muted small">음표 아래에 계이름을 적어요. 줄마다 따로 켜고 끌 수 있어요. PDF 악보는 "PDF 악보 → 자동 인식 → 악보로"로 바꾼 다음 켜면 돼요.</p>
  <div class="sol-list">${Array.from({ length: n }, (_, si) => `<label class="sol-row"><input type="checkbox" data-sol="${si}"${sol.staves && sol.staves[si] ? ' checked' : ''}><span class="mus">${clefGlyph(staffClef(s, si))}</span><span>${esc(rowLabel(si))}</span></label>`).join('')}</div>
  <div class="row2" style="margin-top:6px"><button class="btn" id="solAll">모두 켜기</button><button class="btn" id="solNone">모두 끄기</button></div>
  <div class="fld" style="margin-top:14px">글자</div>
  <div class="clef-row"><button type="button" class="clef-opt${sol.style !== 'abc' ? ' on' : ''}" data-solstyle="ko"><b>도 레 미</b><span class="muted small">한글 · 파# 시♭</span></button><button type="button" class="clef-opt${sol.style === 'abc' ? ' on' : ''}" data-solstyle="abc"><b>C D E</b><span class="muted small">음이름 · F# B♭</span></button></div>
  <p class="muted small">C = 도로 적어요 (고정도). 조표나 임시표로 올리거나 내린 음은 #·♭을 붙여요. 화음은 높은 음부터 아래로 쌓아요.</p>
  <div class="modal-btns"><button class="btn primary" data-close>닫기</button></div>`, md => {
    const apply = fn => { commit(() => { s.solfa = s.solfa || { staves: [], style: 'ko' }; fn(s.solfa); }); };
    $$('[data-sol]', md).forEach(cb => cb.addEventListener('change', () => apply(sf => { sf.staves[+cb.dataset.sol] = cb.checked; })));
    $('#solAll', md).addEventListener('click', () => { $$('[data-sol]', md).forEach(cb => cb.checked = true); apply(sf => { for (let k = 0; k < n; k++) sf.staves[k] = true; }); });
    $('#solNone', md).addEventListener('click', () => { $$('[data-sol]', md).forEach(cb => cb.checked = false); apply(sf => { sf.staves = []; }); });
    $$('[data-solstyle]', md).forEach(b => b.addEventListener('click', () => { $$('[data-solstyle]', md).forEach(x => x.classList.toggle('on', x === b)); apply(sf => { sf.style = b.dataset.solstyle; }); }));
  });
}
/* ---------- PDF 악보: 옆 창에 띄워 보면서 쓰기 · 자동 인식 ---------- */
const Pdf = { file: null, url: null, name: '' };
async function pdfDialog() {
  const api = Native();
  if (!api) { $('#filePdf').click(); return; }
  const res = await api.open_file('pdf');
  if (res) openScoreSource(b64ToFile(res));
}
/**
 * 악보 그림 파일 열기: PDF는 그대로, 사진(JPG·PNG …)·한글(HWP·HWPX)은 PDF로 바꿔서 옆에 띄워요
 * → 그다음은 PDF와 똑같이 "자동 인식 → 악보로" · "계이름 넣기"
 */
async function openScoreSource(file) {
  file = await withProperName(file);
  if (/\.pdf$/i.test(file.name)) { showPdf(file); return; }
  toast(LG('악보 그림을 준비하는 중…', 'Preparing the score image…', '楽譜の画像を準備中…'), 8000);
  let r;
  try { r = await scoreSourceToPdf(file); } catch (e) { console.error(e); r = { error: 'image' }; }
  if (r.error) {
    const msg = {
      hwpRead: LG('한글 파일을 읽지 못했어요. 한글 프로그램에서 PDF로 저장(인쇄 → PDF)한 다음 열어 주세요.', 'Could not read the HWP file. Save it as PDF in Hangul (Print → PDF) and open that.', 'HWPファイルを読めませんでした。ハングルでPDFに保存(印刷 → PDF)してから開いてください。'),
      hwpNoImage: LG('이 한글 파일에서 악보 그림을 찾지 못했어요. 악보가 그림이 아니라 글·표로 그려져 있으면 한글에서 PDF로 저장한 다음 열어 주세요.', 'No score image was found in this HWP file. If the score is drawn with text/tables, save it as PDF in Hangul and open that.', 'このHWPファイルに楽譜の画像が見つかりません。楽譜が文字・表で描かれている場合は、ハングルでPDFに保存してから開いてください。'),
      image: LG('그림을 읽지 못했어요 (너무 작거나 지원하지 않는 형식이에요).', 'Could not read the image (too small or unsupported format).', '画像を読めませんでした (小さすぎるか対応していない形式です)。'),
      type: LG('PDF · 사진(JPG·PNG) · 한글(HWP) 파일만 열 수 있어요.', 'Only PDF, photos (JPG·PNG) and HWP files can be opened.', 'PDF · 写真(JPG・PNG) · HWPファイルだけ開けます。'),
    }[r.error] || LG('열 수 없어요', 'Cannot open', '開けません');
    toast(msg, 5200); return;
  }
  showPdf(r.file);
  Pdf.srcName = r.srcName;
  $('#pdfName').textContent = r.srcName;
  toast(r.kind === 'hwp'
    ? LG(`한글 파일에서 악보 그림 ${r.pages}장을 찾았어요 · "자동 인식 → 악보로"를 눌러요`, `Found ${r.pages} score image(s) in the HWP file · press "Recognize → score"`, `HWPファイルから楽譜の画像を${r.pages}枚見つけました · 「自動認識 → 楽譜へ」を押してください`)
    : LG('사진을 열었어요 · "자동 인식 → 악보로"를 눌러요 (반듯하고 밝게 찍은 사진일수록 잘 읽어요)', 'Photo opened · press "Recognize → score" (straight, well-lit photos work best)', '写真を開きました · 「自動認識 → 楽譜へ」を押してください (まっすぐ明るく撮った写真ほどよく読めます)'), 5200);
}
/**
 * 브라우저에 PDF 보기 기능이 없으면(휴대폰 크롬·안드로이드 앱·아이폰 Safari는 iframe에 PDF를 제대로 못 띄워요)
 * pdf.js 로 쪽마다 직접 그려요
 */
function ownPdfViewer() {
  return !!window.AndroidBridge || navigator.pdfViewerEnabled === false || document.body.classList.contains('touch') || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
/** PDF 기본 화면 (계이름 보기가 아닐 때): iframe 또는 pdf.js 그림 */
function showPdfBase() {
  const own = ownPdfViewer();
  $('#pdfFrame').hidden = own; $('#pdfView').hidden = !own;
  if (own) renderPdfView();
}
async function renderPdfView() {
  const view = $('#pdfView'), file = Pdf.file;
  if (!file || view.dataset.for === Pdf.url) return;
  view.dataset.for = Pdf.url; view.innerHTML = `<div class="pv-msg">${LG('PDF를 여는 중…', 'Opening the PDF…', 'PDFを開いています…')}</div>`;
  try {
    if (!window.pdfjsLib) throw new Error('pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
    const doc = Pdf.doc || await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    if (Pdf.file !== file) return;                 // 그 사이 다른 파일을 열었으면 그만
    Pdf.doc = doc;
    view.innerHTML = '';
    const cssW = Math.min(1100, Math.max(280, view.clientWidth - 16));
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      // 화면 폭 × 화면 배율만큼 선명하게 (휴대폰 메모리를 생각해 가로 2000px까지)
      const scale = Math.min(2000 / vp1.width, cssW * Math.min(3, window.devicePixelRatio || 1) / vp1.width);
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      view.appendChild(cv);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (Pdf.file !== file) return;
    }
  } catch (e) {
    console.error(e);
    view.dataset.for = '';
    view.innerHTML = `<div class="pv-msg">${LG('PDF를 열 수 없어요. 파일이 손상됐거나 암호가 걸린 PDF일 수 있어요.', 'Cannot open the PDF. It may be damaged or password-protected.', 'PDFを開けません。破損しているかパスワード付きの可能性があります。')}</div>`;
  }
}
function showPdf(file) {
  if (Pdf.url) URL.revokeObjectURL(Pdf.url);
  Pdf.file = file; Pdf.name = file.name; Pdf.omrXml = null; Pdf.omrLyr = null; Pdf.doc = null; Pdf.lay = null; Pdf.solOn = false; Pdf.canvases = null; Pdf.warned = false;
  Pdf.url = URL.createObjectURL(new Blob([file], { type: 'application/pdf' }));
  $('#pdfName').textContent = file.name;
  // 휴대폰처럼 자동 인식이 안 되는 곳에서는 "자동 인식 · 계이름 넣기" 버튼을 숨겨요
  document.body.classList.toggle('no-omr', !OmrApi() && ownPdfViewer());
  if (ownPdfViewer()) { $('#pdfFrame').src = 'about:blank'; } else $('#pdfFrame').src = Pdf.url + '#view=FitH';
  $('#pdfView').innerHTML = ''; $('#pdfView').dataset.for = '';
  $('#pdfSolView').hidden = true; $('#pdfSolView').innerHTML = ''; $('#pdfSolBar').hidden = true;
  $('#btnPdfSol').textContent = '계이름 넣기';
  $('#pdfPanel').hidden = false;
  try { const w = localStorage.getItem('bflat.pdfw'); if (w) $('#pdfPanel').style.setProperty('--pdfw', w); } catch (e) { }
  const noOmr = document.body.classList.contains('no-omr');
  if (App.blank) {
    // 첫 화면에서 연 PDF: "어떤 악보를 만들까요?" 창은 닫고 PDF만 크게 보여요
    App.pdfOnly = true; document.body.classList.add('pdf-only');
    App.onModalClose = null; $('#modalRoot').innerHTML = '';
    toast(noOmr ? LG('PDF 악보를 열었어요 · 자동 인식(악보로 바꾸기)은 PC 프로그램에서 돼요', 'PDF opened · recognition into a score works in the PC program', 'PDF楽譜を開きました · 自動認識はPCのプログラムで使えます')
      : 'PDF 악보를 열었어요 · "계이름 넣기" = PDF 위에 계이름 · "자동 인식 → 악보로" = 고칠 수 있는 악보로', 4200);
  } else toast(noOmr ? LG('PDF를 띄웠어요 · 보면서 악보를 쓸 수 있어요 (✕ = 닫기)', 'PDF shown · copy it into your score (✕ = close)', 'PDFを表示しました · 見ながら楽譜を書けます (✕ = 閉じる)')
    : 'PDF를 옆에 띄웠어요 · 보면서 쓰거나, "계이름 넣기" / "자동 인식 → 악보로"를 눌러요', 3600);
  // 패널이 보인 다음에 그려야 폭이 맞아요
  showPdfBase();
}
function leavePdfOnly() { App.pdfOnly = false; document.body.classList.remove('pdf-only'); }
function closePdf() {
  $('#pdfPanel').hidden = true; $('#pdfFrame').src = 'about:blank';
  $('#pdfView').innerHTML = ''; $('#pdfView').dataset.for = ''; $('#pdfView').hidden = true;
  if (Pdf.url) URL.revokeObjectURL(Pdf.url);
  Pdf.file = null; Pdf.url = null; Pdf.doc = null; Pdf.omrXml = null; Pdf.omrLyr = null; Pdf.solOn = false;
  $('#pdfSolView').innerHTML = ''; $('#pdfSolBar').hidden = true;
  if (App.pdfOnly) { leavePdfOnly(); if (App.blank) scoreTypeDialog(true); }
}
/** 인식 결과 (한 번 인식하면 다시 안 돌려요 · 가사까지 읽은 결과는 따로 남겨요)
 *  want.lyrics = true → 가사까지 읽은 결과가 필요해요 / 없으면 아무 결과나 */
async function getOmrXml(want) {
  want = want || {};
  if (!Pdf.file) { toast('먼저 PDF 악보를 여세요'); return null; }
  if (want.lyrics ? Pdf.omrLyr : Pdf.omrXml) return want.lyrics ? Pdf.omrLyr : Pdf.omrXml;
  if (!want.lyrics && Pdf.omrLyr) return Pdf.omrLyr;
  const api = OmrApi();
  if (!api || !api.omr_status) { modal(`<h2>자동 인식</h2><p>자동 인식은 <b>바탕화면 프로그램</b>(BFlat Studio)에서만 돼요. 브라우저에서는 PDF를 옆에 띄워 보면서 쓸 수 있어요.</p><div class="modal-btns"><button class="btn primary" data-close>확인</button></div>`); return null; }
  const st = await api.omr_status();
  if (st && st.cancel) return null;           // 휴대폰: PC 연결을 취소했어요
  if (!st || !st.ok) { omrInstallHelp(); return null; }
  const remote = api === MobileOmr, busy = $('#pdfBusy');
  if (remote) {
    const cloud = MobileOmr.mode === 'cloud';
    busy.querySelector('b').textContent = cloud ? LG('☁ 클라우드에서 악보 인식 중…', '☁ Recognizing in the cloud…', '☁ クラウドで楽譜を認識中…') : LG('PC에서 악보 인식 중…', 'Recognizing on the PC…', 'PCで楽譜を認識中…');
    busy.querySelector('span').textContent = cloud ? LG('보내는 중…', 'Sending…', '送信中…') : LG('페이지 수에 따라 몇 분 걸릴 수 있어요 · 앱을 닫지 말고 기다려 주세요', 'This can take a few minutes depending on pages · keep the app open', 'ページ数によって数分かかります · アプリを閉じずにお待ちください');
  }
  busy.hidden = false;
  try {
    const res = await api.omr_pdf(await blobToB64(Pdf.file), Pdf.name, !!want.lyrics);
    if (remote && res && (['net', 'timeout', 'http', 'lost', 'code', 'blocked'].includes(res.error) || /^cloud/.test(res.error || ''))) {
      if (res.error !== 'timeout') PcLink.okAt = 0;
      const cloud = /^cloud/.test(res.error);
      modal(`<h2>${cloud ? LG('클라우드 인식이 안 됐어요', 'Cloud recognition failed', 'クラウド認識に失敗しました') : LG('PC와 연결이 안 됐어요', 'Lost the PC link', 'PCとの接続に失敗しました')}</h2><p>${esc(MobileOmr.errText(res))}</p><div class="modal-btns"><button class="btn primary" data-close>${LG('확인', 'OK', 'OK')}</button></div>`);
      return null;
    }
    if (!res || res.error) {
      modal(`<h2>자동 인식이 안 됐어요</h2><p>${res && res.error === 'notfound' ? 'Audiveris를 찾지 못했어요.' : '이 PDF에서 악보를 읽지 못했어요. 스캔이 흐리거나 손글씨면 잘 안 될 수 있어요.'}</p>${res && res.log ? `<pre class="omr-log">${esc(res.log)}</pre>` : ''}<div class="modal-btns"><button class="btn primary" data-close>확인</button></div>`, null, 'wide');
      return null;
    }
    const f = b64ToFile(res);
    const raw = /\.mxl$/i.test(res.name) ? await unzipMxl(await f.arrayBuffer()) : await f.text();
    let xml;
    try { xml = fixOmrXml(raw); } catch (e) { console.error(e); xml = raw; }
    try { xml = omrAddMarks(xml, res.marks); } catch (e) { console.error(e); }
    if (res.lyrics) Pdf.omrLyr = xml; else Pdf.omrXml = xml;
    Pdf.omrCount = res.count || 1;
    return xml;
  } finally {
    busy.hidden = true;
    if (remote) { busy.querySelector('b').textContent = '악보 인식 중…'; busy.querySelector('span').textContent = '페이지 수에 따라 몇 분 걸릴 수 있어요'; }
  }
}
/**
 * PDF 첫 쪽 첫 오선 위에 스윙 표시(♫ = ♩♪³)가 있는지 그림으로 찾기
 * (Audiveris는 이 표시를 못 읽어요) — "=" 기호 왼쪽에 빔으로 묶인 기둥 두 개가 있으면 스윙
 */
async function detectSwing(file) {
  try {
    if (!window.pdfjsLib) return false;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
    const doc = Pdf.doc || await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    Pdf.doc = doc;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 2.5 });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const st = detectStaves(cv)[0]; if (!st) return false;
    const sp = st.space, W = cv.width;
    const x0 = Math.max(0, Math.round(st.left - 2 * sp)), x1 = Math.min(W, Math.round(st.left + (st.right - st.left) * 0.45));
    const y0 = Math.max(0, Math.round(st.top - 32 * sp)), y1 = Math.round(st.top - 2.5 * sp);
    if (y1 - y0 < 4 * sp) return false;
    const w = x1 - x0, h = y1 - y0;
    const d = ctx.getImageData(x0, y0, w, h).data;
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; ink[i] = (r + g + b) / 3 < 110 && Math.max(r, g, b) - Math.min(r, g, b) < 60 ? 1 : 0; }
    // 덩어리(이어진 검은 부분) 나누기
    const lab = new Int32Array(w * h), comps = [];
    for (let i = 0; i < w * h; i++) {
      if (!ink[i] || lab[i]) continue;
      const c = { x0: w, y0: h, x1: 0, y1: 0, n: 0, id: comps.length + 1 }, stack = [i]; lab[i] = c.id;
      while (stack.length) {
        const p = stack.pop(), px = p % w, py = (p - px) / w;
        c.n++; if (px < c.x0) c.x0 = px; if (px > c.x1) c.x1 = px; if (py < c.y0) c.y0 = py; if (py > c.y1) c.y1 = py;
        for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && ink[q] && !lab[q] && Math.abs((q % w) - px) <= 1) { lab[q] = c.id; stack.push(q); }
      }
      comps.push(c);
    }
    // "=": 가늘고 짧은 가로 막대 두 개가 위아래로
    const bars = comps.filter(c => { const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1; return cw >= 0.6 * sp && cw <= 2.2 * sp && ch <= 0.45 * sp && c.n >= cw * 0.7; });
    for (const a of bars) for (const b of bars) {
      if (b === a || b.y0 <= a.y1) continue;
      const gap = b.y0 - a.y1, ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      if (gap < 0.15 * sp || gap > 1.1 * sp || ov < 0.6 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) continue;
      // 왼쪽 음표 덩어리: 기둥(세로로 긴 검은 줄)이 두 개 + 위쪽을 잇는 빔
      const left = comps.filter(c => c.x1 < a.x0 && c.x1 > a.x0 - 6 * sp && c.y1 > a.y0 - 4 * sp && c.y0 < b.y1 + 3 * sp && (c.y1 - c.y0) >= 2 * sp);
      for (const c of left) {
        const stems = [];
        for (let x = c.x0; x <= c.x1; x++) {
          let run = 0, best = 0;
          for (let y = c.y0; y <= c.y1; y++) { if (lab[y * w + x] === c.id) { run++; if (run > best) best = run; } else run = 0; }
          if (best >= 1.8 * sp) { const last = stems[stems.length - 1]; if (last && x - last.x1 <= 1) last.x1 = x; else stems.push({ x0: x, x1: x }); }
        }
        if (stems.length < 2) continue;
        const s1 = stems[0], s2 = stems[stems.length - 1];
        if (s2.x0 - s1.x1 < 0.8 * sp) continue;
        // 빔: 기둥 사이 위쪽에 가로로 이어진 검은 띠
        let beam = false;
        for (let y = c.y0; y <= c.y0 + 0.8 * sp && !beam; y++) {
          let cnt = 0; for (let x = s1.x1; x <= s2.x0; x++) if (lab[y * w + x] === c.id) cnt++;
          if (cnt >= 0.85 * (s2.x0 - s1.x1 + 1)) beam = true;
        }
        if (beam) return true;
      }
    }
    return false;
  } catch (e) { console.error(e); return false; }
}
/** 가사 읽기에 필요한 글자 인식 데이터 (처음 한 번만 받아요) */
async function ensureOcr() {
  const api = OmrApi();
  const st = await api.omr_status();
  if (st && st.cancel) return null;            // 휴대폰: PC 연결을 취소했어요 → 인식도 그만
  if (st && st.ocr && st.ocr.length) return true;
  const remote = api === MobileOmr;
  const go = await new Promise(res => modal(`<h2>가사 인식 준비</h2>
    <p>가사(글자)를 읽으려면 <b>글자 인식 데이터</b>(영어·한글, 약 40MB)가 필요해요. 처음 한 번만 받으면 다음부터는 바로 돼요.</p>
    <p class="muted small">${remote ? LG('받는 곳: Tesseract OCR 공식 저장소 (github.com/tesseract-ocr/tessdata) · 휴대폰이 아니라 <b>연결한 PC</b>의 BFlat Studio 폴더에 받아요.', 'Source: the official Tesseract OCR repository (github.com/tesseract-ocr/tessdata) · it is saved on the <b>connected PC</b>, not the phone.', '取得元: Tesseract OCR 公式リポジトリ (github.com/tesseract-ocr/tessdata) · スマホではなく<b>接続したPC</b>に保存します。') : '받는 곳: Tesseract OCR 공식 저장소 (github.com/tesseract-ocr/tessdata) · 이 PC의 BFlat Studio 폴더에만 저장해요.'}</p>
    <div class="modal-btns"><button class="btn" data-close>가사 없이 인식</button><button class="btn primary" data-ok>받고 시작</button></div>`, md => {
      md.querySelector('[data-ok]').addEventListener('click', () => { App.onModalClose = null; closeModal(); res(true); });
      App.onModalClose = () => res(false);
    }));
  if (!go) return false;
  $('#pdfBusy').hidden = false;
  try {
    const r = await api.ocr_install();
    if (r && r.langs && r.langs.length) return true;
    toast('글자 인식 데이터를 받지 못했어요 (인터넷 연결을 확인해 주세요) · 가사 없이 인식할게요', 4200);
    return false;
  } finally { $('#pdfBusy').hidden = true; }
}
/** PDF 자동 인식 → 고칠 수 있는 BFlat 악보로 열기 */
async function pdfRecognize() {
  if (!Pdf.file) { toast('먼저 PDF 악보를 여세요'); return; }
  let lyrics = false;
  try { lyrics = localStorage.getItem('bflat.omrLyrics') === '1'; } catch (e) { }
  const ok = await new Promise(res => modal(`<h2>자동 인식 → 악보로</h2><p>PDF 속 음표를 읽어 <b>새 악보</b>로 열어요.${App.blank ? '' : ' 지금 악보는 되돌리기(Ctrl+Z)할 수 있지만, 따로 남기려면 먼저 저장하세요.'}</p>
    <label class="omr-lyr"><input type="checkbox" id="omrLyr"${lyrics ? ' checked' : ''}> <b>가사도 함께 가져올까요?</b></label>
    <p class="muted small" style="margin-top:4px">가사가 있는 악보면 체크하세요. 가사를 읽어 음표 하나하나에 맞춰 넣어요 (시간이 조금 더 걸려요).</p>
    <p class="muted small">인쇄된 깨끗한 악보일수록 잘 읽어요. 셈여림표(f, p …)는 넣지 않아요. 틀린 음·박자는 옆의 PDF를 보면서 고쳐 주세요.</p>
    <div class="modal-btns"><button class="btn" data-close>취소</button><button class="btn primary" data-ok>인식 시작</button></div>`, md => {
      md.querySelector('[data-ok]').addEventListener('click', () => {
        lyrics = $('#omrLyr', md).checked;
        App.onModalClose = null; closeModal(); res(true);
      });
      App.onModalClose = () => res(false);
    }));
  if (!ok) return;
  try { localStorage.setItem('bflat.omrLyrics', lyrics ? '1' : '0'); } catch (e) { }
  const api = OmrApi();
  if (lyrics && api && api.ocr_install) { const o = await ensureOcr(); if (o === null) return; if (!o) lyrics = false; }
  const raw = await getOmrXml({ lyrics }); if (!raw) return;
  let xml = raw;
  try { xml = omrForImport(raw, { lyrics }); } catch (e) { console.error(e); }
  const swing = await detectSwing(Pdf.file);
  leavePdfOnly();
  if (Pdf.solOn) pdfSolOff();
  await openFile(new File([xml], Pdf.name.replace(/\.pdf$/i, '') + '.musicxml'));
  // 원래 악보 줄 나눔 그대로면 빽빽한 줄에서 음표가 겹칠 수 있어요 → 그런 줄만 나눠요 · 스윙 표시
  const sNow = S();
  const fit = refitLines(sNow);
  if (swing) sNow.swing = true;
  if (fit || swing) changed();
  const gotLyr = lyrics && App.s.measures.some(m => Object.values(m.lyrics || {}).some(Boolean));
  const msg = Pdf.omrCount > 1 ? `인식했어요 (악장 ${Pdf.omrCount}개 중 첫 번째)` : '인식했어요';
  toast(msg + (lyrics ? (gotLyr ? ' · 가사도 넣었어요' : ' · 가사는 찾지 못했어요') : '') + ' · 틀린 곳은 옆의 PDF를 보며 고쳐 주세요', 4600);
}
/* ----- PDF 위에 바로 계이름 ----- */
async function pdfSolfa() {
  if (Pdf.solOn) return pdfSolOff();
  const xml = await getOmrXml(); if (!xml) return;
  Pdf.lay = omrLayout(xml);
  if (!Pdf.lay.items.length) { toast('계이름을 적을 음표를 찾지 못했어요'); return; }
  Pdf.solStaves = Pdf.lay.staves.map(() => true);
  Pdf.solStyle = Pdf.solStyle || 'ko';
  Pdf.solOn = true;
  $('#btnPdfSol').textContent = '원래 PDF 보기';
  $('#pdfFrame').hidden = true; $('#pdfView').hidden = true;
  $('#pdfSolView').hidden = false;
  buildPdfSolBar();
  await renderPdfPages();
  drawPdfSol();
}
function pdfSolOff() {
  Pdf.solOn = false;
  $('#btnPdfSol').textContent = '계이름 넣기';
  $('#pdfSolView').hidden = true; $('#pdfSolBar').hidden = true;
  showPdfBase();
}
function buildPdfSolBar() {
  const bar = $('#pdfSolBar');
  bar.innerHTML = `<b>계이름</b>${Pdf.lay.staves.map((st, g) => `<button class="chip${Pdf.solStaves[g] ? ' on' : ''}" data-psol="${g}">${esc(st.label)}</button>`).join('')}
    <span class="sep"></span><button class="chip${Pdf.solStyle !== 'abc' ? ' on' : ''}" data-pstyle="ko">도레미</button><button class="chip${Pdf.solStyle === 'abc' ? ' on' : ''}" data-pstyle="abc">CDE</button>
    <span class="grow"></span><button class="btn" data-act="pdfSolPrint">인쇄 · PDF로 저장</button>`;
  bar.hidden = false;
  $$('[data-psol]', bar).forEach(b => b.addEventListener('click', () => { const g = +b.dataset.psol; Pdf.solStaves[g] = !Pdf.solStaves[g]; b.classList.toggle('on', Pdf.solStaves[g]); drawPdfSol(); }));
  $$('[data-pstyle]', bar).forEach(b => b.addEventListener('click', () => { Pdf.solStyle = b.dataset.pstyle; $$('[data-pstyle]', bar).forEach(x => x.classList.toggle('on', x === b)); drawPdfSol(); }));
}
/** pdf.js 로 PDF 쪽을 그림으로 (한 번만) */
async function renderPdfPages() {
  const view = $('#pdfSolView');
  if (Pdf.canvases && Pdf.canvases.length) return;
  if (!window.pdfjsLib) { toast('PDF 그리기 도구를 불러오지 못했어요'); return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
  $('#pdfBusy').hidden = false;
  try {
    Pdf.doc = Pdf.doc || await pdfjsLib.getDocument({ data: new Uint8Array(await Pdf.file.arrayBuffer()) }).promise;
    view.innerHTML = '';
    Pdf.canvases = [];
    const cw = Math.min(1100, Math.max(400, view.clientWidth - 28));
    for (let n = 1; n <= Pdf.doc.numPages; n++) {
      const page = await Pdf.doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = cw / vp1.width * (window.devicePixelRatio || 1) * 1.5;
      const vp = page.getViewport({ scale });
      const box = document.createElement('div'); box.className = 'sol-page'; box.style.width = cw + 'px';
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      box.appendChild(cv); view.appendChild(box);
      await page.render({ canvasContext: cv.getContext('2d', { willReadFrequently: true }), viewport: vp }).promise;
      box.staves = detectStaves(cv);
      Pdf.canvases.push(box);
    }
  } finally { $('#pdfBusy').hidden = true; }
}
/** 그려진 PDF 쪽에서 오선(5줄) 찾기 → [{top, space, left, right}] (캔버스 픽셀) */
function detectStaves(cv) {
  const W = cv.width, H = cv.height;
  let d; try { d = cv.getContext('2d').getImageData(0, 0, W, H).data; } catch (e) { return []; }
  const lines = [];
  for (let y = 0; y < H; y++) {
    // 이 가로줄에서 가장 긴 검은 줄 (작은 틈은 이어서)
    let best = 0, bs = 0, be = 0, start = -1, gap = 0;
    for (let x = 0, i = y * W * 4; x < W; x++, i += 4) {
      if (d[i + 3] > 128 && d[i] + d[i + 1] + d[i + 2] < 400) {
        if (start < 0) start = x;
        gap = 0;
        if (x - start + 1 > best) { best = x - start + 1; bs = start; be = x; }
      } else if (start >= 0 && ++gap > 3) { start = -1; gap = 0; }
    }
    if (best < W * 0.2) continue;
    const last = lines[lines.length - 1];
    if (last && y - last.y1 <= 1) { last.y1 = y; last.l = Math.min(last.l, bs); last.r = Math.max(last.r, be); }
    else lines.push({ y0: y, y1: y, l: bs, r: be });
  }
  const ys = lines.map(l => (l.y0 + l.y1) / 2);
  const staves = [];
  for (let i = 0; i + 4 < lines.length;) {
    const sp = [1, 2, 3, 4].map(k => ys[i + k] - ys[i + k - 1]);
    const mn = Math.min(...sp), mx = Math.max(...sp);
    if (mn > 3 && mx / mn < 1.3) {
      const five = lines.slice(i, i + 5), med = a => a.slice().sort((p, q) => p - q)[2];
      staves.push({ top: ys[i], space: (ys[i + 4] - ys[i]) / 4, left: med(five.map(l => l.l)), right: med(five.map(l => l.r)) });
      i += 5;
    } else i++;
  }
  return staves;
}
/** 예상 자리 근처에서 실제 음표 머리(가장 진한 곳)의 가운데 x 찾기 */
function snapHead(box, x, y, sp) {
  const cv = box.querySelector('canvas');
  if (!box.pix) { try { box.pix = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (e) { return x; } }
  const d = box.pix, W = cv.width, H = cv.height;
  const hw = Math.max(2, Math.round(sp * 0.6)), hh = Math.max(1, Math.round(sp * 0.35));
  const y0 = Math.max(0, Math.round(y - hh)), y1 = Math.min(H - 1, Math.round(y + hh));
  const xa = Math.max(0, Math.round(x - sp * 1.5)), xb = Math.min(W - 1, Math.round(x + sp * 1.5));
  const col = [];
  for (let cx = xa - hw; cx <= xb + hw; cx++) {
    let c = 0;
    if (cx >= 0 && cx < W) for (let yy = y0; yy <= y1; yy++) { const i = (yy * W + cx) * 4; if (d[i + 3] > 128 && d[i] + d[i + 1] + d[i + 2] < 400) c++; }
    col.push(c);
  }
  // 머리 폭만큼 더한 값이 가장 큰 곳 (가는 기둥·오선보다 머리가 훨씬 진해요)
  let best = -1, bx = x, base = Infinity;
  for (let cx = xa; cx <= xb; cx++) {
    let s = 0; for (let k = -hw; k <= hw; k++) s += col[cx - xa + hw + k];
    if (s > best) { best = s; bx = cx; }
    base = Math.min(base, s);
  }
  return best > base + (2 * hw + 1) * (y1 - y0 + 1) * 0.25 ? bx : x;
}
/** 인식한 음표 자리마다 계이름 (원래 PDF 위에 겹쳐서) */
function drawPdfSol() {
  const lay = Pdf.lay; if (!lay || !Pdf.canvases) return;
  const font = App.settings.scoreFont === 'basic' ? "'Malgun Gothic',sans-serif" : "'Yeeun','Malgun Gothic',sans-serif";
  let missed = 0;
  Pdf.canvases.forEach((box, pi) => {
    let svg = box.querySelector('svg'); if (svg) svg.remove();
    const cv = box.querySelector('canvas'), W = cv.width, H = cv.height;
    const found = box.staves || [];
    const { map, exact } = matchStaves(lay, pi, found);
    if (!exact && lay.systems.some(s => s.page === pi)) missed++;
    const parts = [];
    lay.items.forEach(it => {
      if (it.page !== pi || !Pdf.solStaves[it.staff]) return;
      const st = map[it.sys + ':' + it.staff]; if (!st) return;   // 어느 오선인지 모르면 안 적어요 (엉뚱한 곳에 적히지 않게)
      const sys = lay.systems[it.sys], u = st.space / 10;          // u = tenths → 픽셀
      const sw = sys.full > sys.w * 0.9 ? sys.full : sys.w;
      const x = snapHead(box, st.left + it.xr / (sw || 1) * (st.right - st.left), st.top + it.hy * u, st.space);
      const fs = 13 * u, rowH = 13.5 * u;
      const labels = it.pitches.map(p => solfaName(p, Pdf.solStyle));
      const y = placeSol(box, found, st, x, it, labels, fs, rowH);
      labels.forEach((t, k) => parts.push(`<text x="${f1(x)}" y="${f1(y + k * rowH)}" text-anchor="middle" font-family="${font}" font-size="${f1(fs)}" font-weight="700" fill="#1d4ed8" stroke-width="${f1(fs * 0.24)}">${esc(t)}</text>`));
    });
    box.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${parts.join('')}</svg>`);
  });
  if (missed && !Pdf.warned) { Pdf.warned = true; toast('일부 쪽은 오선을 정확히 못 맞춰서, 그 쪽은 계이름이 빠진 음표가 있을 수 있어요', 4000); }
}
/** 인식 결과의 오선(줄·오선 번호) ↔ 쪽 그림에서 찾은 오선 */
function matchStaves(lay, pi, found) {
  const want = [];
  lay.systems.forEach((s, k) => { if (s.page === pi) s.vis.forEach(g => want.push({ key: k + ':' + g, t: s.staffTops[g] })); });
  const map = {};
  if (!want.length || !found.length) return { map, exact: false };
  if (found.length === want.length) { want.forEach((w, j) => { map[w.key] = found[j]; }); return { map, exact: true }; }
  // 개수가 다르면: 오선 간격으로 크기를 맞추고, 가장 많이 겹치는 위치로 맞춘 다음 가까운 오선끼리 짝
  const sps = found.map(f => f.space).sort((a, b) => a - b), u = sps[sps.length >> 1] / 10, tol = 20 * u;
  let bestB = 0, bestN = -1;
  found.forEach(f => want.forEach(w => {
    const b = f.top - w.t * u;
    const n = want.filter(w2 => found.some(f2 => Math.abs(f2.top - (w2.t * u + b)) < tol)).length;
    if (n > bestN) { bestN = n; bestB = b; }
  }));
  want.forEach(w => {
    let best = null, bd = tol;
    found.forEach(f => { const d = Math.abs(f.top - (w.t * u + bestB)); if (d < bd) { bd = d; best = f; } });
    if (best) map[w.key] = best;
  });
  return { map, exact: false };
}
/** 계이름 높이: 음표 아래 빈 곳 (꼬리 연결선·기둥·가사 같은 검은 부분을 피해서) */
function placeSol(box, found, st, x, it, labels, fs, rowH) {
  const u = st.space / 10, cv = box.querySelector('canvas'), W = cv.width, H = cv.height;
  if (!box.pix) { try { box.pix = cv.getContext('2d').getImageData(0, 0, W, H).data; } catch (e) { return st.top + it.yr * u + 2 * u; } }
  const d = box.pix;
  const want = st.top + it.yr * u + 2 * u;                                  // 기둥·꼬리 아래 (계산 자리)
  const minY = st.top + (Math.max(40, it.hy + 6) + 13) * u;                  // 머리·오선 바로 아래
  const dot = (u * 1.2) * (u * 1.2);                                        // 스타카토 점 하나쯤의 검은 칸 수
  const below = found.filter(f => f.top > st.top + st.space * 4.5).map(f => f.top);
  const nextTop = below.length ? Math.min(...below) : H;
  const tall = (labels.length - 1) * rowH;
  const maxY = Math.min(want + 30 * u, nextTop - fs * 0.25 - tall);
  if (maxY <= minY) return Math.max(minY, Math.min(want, maxY));
  const hw = Math.max(...labels.map(t => [...t].reduce((a, ch) => a + (/[#♭A-G]/.test(ch) ? 0.62 : 1), 0))) * fs / 2 + u;
  const x0 = Math.max(0, Math.round(x - hw)), x1 = Math.min(W - 1, Math.round(x + hw));
  const ink = y => {
    const y0 = Math.max(0, Math.round(y - fs * 0.85)), y1 = Math.min(H - 1, Math.round(y + tall + fs * 0.15));
    let c = 0, n = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0, i = (yy * W + x0) * 4; xx <= x1; xx++, i += 4) { n++; if (d[i + 3] > 128 && d[i] + d[i + 1] + d[i + 2] < 400) c++; }
    return { f: n ? c / n : 0, c };
  };
  let best = want, bc = Infinity;
  for (let y = minY; y <= maxY; y += 1.5 * u) {
    // 작은 점(스타카토)이라도 글자와 겹치면 크게 벌점 → 점 아래 빈 곳으로
    const k = ink(y);
    const c = k.f * 100 + (k.c > dot * 0.3 ? 40 : 0) + Math.abs(y - want) / u * 0.6;
    if (c < bc) { bc = c; best = y; }
  }
  return best;
}
/** 인쇄 창 열기 — 안드로이드 앱은 window.print()가 안 돼서 앱의 인쇄(PDF 저장 포함)로, 끝나면 after() */
function printNow(after) {
  if (window.AndroidBridge && window.AndroidBridge.print) { window.__bflatPrintDone = () => { window.__bflatPrintDone = null; after(); }; window.AndroidBridge.print(); }
  else { window.print(); after(); }
}
function pdfSolPrint() {
  document.body.classList.add('print-pdfsol');
  setTimeout(() => printNow(() => document.body.classList.remove('print-pdfsol')), 50);
}
function omrInstallHelp() {
  if (!Native() && window.AndroidBridge) {   // 휴대폰: 연결한 PC에 Audiveris가 없어요
    const pc = PcLink.get() || {};
    modal(`<h2>${LG('PC에 자동 인식 프로그램이 필요해요', 'The PC needs the recognition program', 'PCに自動認識プログラムが必要です')}</h2>
    <p>${LG(`연결한 PC(<b data-notr>${esc(pc.name || pc.host || '')}</b>)에 무료 악보 인식 프로그램 <b>Audiveris</b>가 없어요.`, `The connected PC (<b data-notr>${esc(pc.name || pc.host || '')}</b>) does not have the free recognition program <b>Audiveris</b>.`, `接続したPC(<b data-notr>${esc(pc.name || pc.host || '')}</b>)に無料の楽譜認識プログラム <b>Audiveris</b> がありません。`)}</p>
    <ul class="help-list"><li>${LG('PC에서 BFlat Studio의 "자동 인식"을 한 번 눌러 보면 설치 안내가 나와요 (github.com/Audiveris/audiveris → Windows .msi).', 'On the PC, press "Recognize" in BFlat Studio once to see the install guide (github.com/Audiveris/audiveris → Windows .msi).', 'PCのBFlat Studioで「自動認識」を一度押すとインストール案内が出ます (github.com/Audiveris/audiveris → Windows .msi)。')}</li>
    <li>${LG('설치한 다음 PC의 BFlat Studio를 다시 켜고, 휴대폰에서 다시 눌러 주세요.', 'After installing, restart BFlat Studio on the PC and try again on the phone.', 'インストール後、PCのBFlat Studioを再起動してからスマホでもう一度押してください。')}</li></ul>
    <div class="modal-btns"><button class="btn primary" data-close>${LG('확인', 'OK', 'OK')}</button></div>`);
    return;
  }
  modal(`<h2>자동 인식 프로그램이 필요해요</h2>
  <p>PDF 속 음표를 읽으려면 무료 악보 인식 프로그램 <b>Audiveris</b>가 이 PC에 설치돼 있어야 해요.</p>
  <ul class="help-list"><li>공식 페이지에서 Windows 설치 파일(.msi, 약 85MB)을 받아 설치해요. Java는 함께 들어 있어요.</li><li>설치한 다음 BFlat Studio를 다시 켜면 "자동 인식"이 돼요.</li></ul>
  <div class="modal-btns"><button class="btn" data-close>닫기</button><button class="btn primary" id="omrPage">공식 다운로드 페이지 열기</button></div>`, md => {
    $('#omrPage', md).addEventListener('click', () => { const api = Native(); if (api && api.open_url) api.open_url('https://github.com/Audiveris/audiveris/releases/latest'); else window.open('https://github.com/Audiveris/audiveris/releases/latest', '_blank'); });
  });
}
/* ---------- 안드로이드 앱 → 같은 와이파이의 PC로 자동 인식 맡기기 ----------
 * 휴대폰에서는 Audiveris(자바 데스크톱 프로그램)가 돌아가지 않아요 → PC에서 켜 둔 BFlat Studio가 대신 인식해요.
 * PC: phonelink.py · 앱: PcLink.java (AndroidBridge.pcFind / pcCall / pcTake)
 * 아래 MobileOmr 는 PC 프로그램의 omr_status · omr_pdf · ocr_install 과 똑같이 생겨서, 인식 다음 과정(가사·세뇨/코다·스윙·계이름)은 PC와 똑같이 돌아요. */
function OmrApi() {
  const n = Native(); if (n && n.omr_status) return n;
  return window.AndroidBridge || CloudOmr.get() ? MobileOmr : null;
}
const PcLink = {
  n: 0, wait: {}, okAt: 0,
  ready() { return !!(window.AndroidBridge && AndroidBridge.pcCall && AndroidBridge.pcFind && AndroidBridge.pcTake); },
  get() { try { const p = JSON.parse(localStorage.getItem('bflat.pcLink') || 'null'); return p && p.host && p.code ? p : null; } catch (e) { return null; } },
  set(p) { this.okAt = 0; try { if (p) localStorage.setItem('bflat.pcLink', JSON.stringify(p)); else localStorage.removeItem('bflat.pcLink'); } catch (e) { } },
  bridge(start) {
    const id = 'pc' + Date.now().toString(36) + '_' + (++this.n);
    return new Promise(res => { this.wait[id] = res; try { start(id); } catch (e) { delete this.wait[id]; res({ error: 'net', message: String(e) }); } });
  },
  find() { return this.bridge(id => AndroidBridge.pcFind(id)).then(r => Array.isArray(r) ? r : []); },
  call(pc, m, args) { return this.bridge(id => AndroidBridge.pcCall(id, pc.host, pc.port || 47390, pc.code || '', m, JSON.stringify(args || []))); },
  awake(on) { try { if (AndroidBridge.keepAwake) AndroidBridge.keepAwake(!!on); } catch (e) { } },
  errText(r) {
    const e = r && r.error;
    if (e === 'code') return LG('연결 번호가 맞지 않아요 · PC 화면의 ⚙ 설정 → 휴대폰 앱 에 나오는 6자리를 넣어 주세요', 'The link code is wrong · enter the 6 digits shown on the PC under ⚙ Settings → Phone app', '接続番号が違います · PCの ⚙ 設定 → スマホアプリ に出る6桁を入れてください');
    if (e === 'blocked') return LG(`번호를 여러 번 틀려서 잠시 막혔어요 · ${Math.ceil((r.wait || 600) / 60)}분 뒤에 다시 해 주세요`, `Too many wrong codes · try again in ${Math.ceil((r.wait || 600) / 60)} min`, `番号を何度も間違えたため一時的にブロックされました · ${Math.ceil((r.wait || 600) / 60)}分後に再度お試しください`);
    if (e === 'timeout') return LG('PC가 너무 오래 대답하지 않아요 · PC가 잠자기로 들어갔거나 와이파이가 끊겼을 수 있어요', 'The PC took too long to answer · it may have gone to sleep or Wi-Fi dropped', 'PCの応答が長すぎます · スリープしたかWi-Fiが切れた可能性があります');
    if (e === 'net' || e === 'http' || e === 'lost') return LG('PC에 연결하지 못했어요 · ① PC에서 BFlat Studio가 켜져 있는지 ② 휴대폰과 PC가 같은 와이파이(공유기)인지 ③ PC의 Windows 방화벽에서 BFlat Studio를 "허용"했는지 확인해 주세요', 'Could not reach the PC · check that ① BFlat Studio is running on the PC ② the phone and PC are on the same Wi-Fi ③ Windows Firewall on the PC allows BFlat Studio', 'PCに接続できません · ① PCでBFlat Studioが起動しているか ② スマホとPCが同じWi-Fiか ③ PCのWindowsファイアウォールでBFlat Studioを「許可」したか確認してください');
    return LG('PC에서 처리하지 못했어요', 'The PC could not do it', 'PCで処理できませんでした') + (e ? ` (${e})` : '');
  },
  /** 쓸 수 있는 PC (저장해 둔 PC가 대답하면 그대로 · 주소가 바뀌었으면 같은 이름의 PC를 다시 찾아요 · 안 되면 연결 창) */
  async ensure() {
    if (!this.ready()) { pcAppTooOld(); return null; }
    const pc = this.get();
    if (!pc) return pcConnectDialog();
    if (Date.now() - this.okAt < 60000) return pc;
    let r = await this.call(pc, 'ping');
    if (r && r.ok) { this.okAt = Date.now(); return pc; }
    if (r && (r.error === 'net' || r.error === 'timeout')) {
      toast(LG('PC를 찾는 중…', 'Looking for the PC…', 'PCを探しています…'), 8000);
      const same = (await this.find()).find(x => x.name && x.name === pc.name);
      if (same) {
        const p2 = Object.assign({}, pc, { host: same.host, port: same.port });
        r = await this.call(p2, 'ping');
        if (r && r.ok) { this.set(p2); this.okAt = Date.now(); toast(LG('PC와 다시 연결했어요', 'Reconnected to the PC', 'PCに再接続しました')); return p2; }
      }
    }
    return pcConnectDialog(this.errText(r));
  },
  /** 저장해 둔 PC가 지금 대답하나 (밖이면 금방 실패해요) */
  async alive(pc) { if (Date.now() - this.okAt < 60000) return true; const r = await this.call(pc, 'ping'); if (r && r.ok) { this.okAt = Date.now(); return true; } return false; },
};
/* ---------- 밖에서 자동 인식: 클라우드 (내 비공개 GitHub 저장소 + GitHub Actions 무료 서버 · PC가 꺼져 있어도 돼요) ----------
 * inbox/<id>.pdf 올리기 → GitHub 서버가 PC와 같은 Audiveris로 인식 (omr/omrjob.py) → outbox/<id>.json 가져오기 → 치우기
 * 연결 코드는 PC 프로그램 설정 → 휴대폰 앱 → 밖에서 자동 인식 에서 만들어요. 휴대폰 데이터·와이파이만 있으면 어디서나 돼요. */
const CloudOmr = {
  get() { try { const c = JSON.parse(localStorage.getItem('bflat.cloudOmr') || 'null'); return c && c.o && c.r && c.t ? c : null; } catch (e) { return null; } },
  set(c) { try { if (c) localStorage.setItem('bflat.cloudOmr', JSON.stringify(c)); else localStorage.removeItem('bflat.cloudOmr'); } catch (e) { } },
  parse(code) {
    const m = /BFLAT1:([A-Za-z0-9_-]+)/.exec(String(code || '').replace(/\s+/g, ''));
    if (!m) return null;
    try {
      const s = atob(m[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((m[1].length + 3) % 4));
      const c = JSON.parse(decodeURIComponent(escape(s)));
      return c && c.o && c.r && c.t ? { o: c.o, r: c.r, t: c.t } : null;
    } catch (e) { return null; }
  },
  async gh(c, method, path, body, raw) {
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.o)}/${encodeURIComponent(c.r)}${path}`, {
        method, cache: 'no-store',
        headers: { Authorization: 'Bearer ' + c.t, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: body ? JSON.stringify(body) : undefined });
    } catch (e) { return { status: 0 }; }
    let data = null; try { data = raw ? await res.text() : await res.json(); } catch (e) { }
    return { status: res.status, data };
  },
  err(status) { return status === 0 ? 'cloudnet' : status === 401 ? 'cloud401' : status === 403 || status === 404 ? 'cloud404' : 'cloudhttp'; },
  /** 연결 확인: 저장소가 있고 비공개이고 올릴 수 있는지 */
  async check(c) {
    const r = await this.gh(c, 'GET', '');
    if (r.status !== 200) return { error: this.err(r.status) };
    if (!r.data.private) return { error: 'cloudpublic' };
    if (!(r.data.permissions || {}).push) return { error: 'cloud404' };
    const w = await this.gh(c, 'GET', '/contents/.github/workflows/bflat-omr.yml');
    if (w.status === 404) return { error: 'cloudsetup' };
    return { ok: true };
  },
  async omr(b64, lyrics, onTick) {
    const c = this.get(); if (!c) return { error: 'cloudsetup' };
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const up = await this.gh(c, 'PUT', `/contents/inbox/${id}${lyrics ? '.lyrics' : ''}.pdf`, { message: '인식 요청', content: b64 });
    if (up.status !== 201 && up.status !== 200) return { error: this.err(up.status) };
    const t0 = Date.now();
    let fails = 0;
    while (Date.now() - t0 < 25 * 60000) {
      onTick && onTick(Math.round((Date.now() - t0) / 1000));
      await new Promise(r => setTimeout(r, 5000));
      const r = await this.gh(c, 'GET', `/contents/outbox/${id}.json`);
      if (r.status === 404) { fails = 0; continue; }
      if (r.status !== 200) { if (++fails >= 6) return { error: this.err(r.status) }; continue; }
      let txt = '';
      try { txt = r.data.content ? decodeURIComponent(escape(atob(r.data.content.replace(/\s/g, '')))) : ''; } catch (e) { }
      if (!txt) { const raw = await this.gh(c, 'GET', `/contents/outbox/${id}.json`, null, true); txt = raw.status === 200 ? raw.data : ''; }   // 1MB가 넘으면 따로
      let res; try { res = JSON.parse(txt); } catch (e) { return { error: 'failed', log: 'result' }; }
      this.gh(c, 'DELETE', `/contents/outbox/${id}.json`, { message: '결과 가져감', sha: r.data.sha });   // 치우기 (기다리지 않아요)
      return res;
    }
    return { error: 'cloudtimeout' };
  },
};
/** 휴대폰의 자동 인식: 집 PC가 대답하면 PC(빠름) · 아니면 클라우드 · 둘 다 없으면 고르는 창
 *  PC 프로그램의 omr_status · omr_pdf · ocr_install 과 똑같이 생겨서 인식 다음 과정은 PC와 똑같이 돌아요 */
const MobileOmr = {
  mode: null,
  errText(r) {
    const e = r && r.error;
    const cloud = {
      cloudnet: LG('인터넷에 연결할 수 없어요 · 휴대폰 데이터나 와이파이를 확인해 주세요', 'No internet · check mobile data or Wi-Fi', 'インターネットに接続できません · モバイルデータかWi-Fiを確認してください'),
      cloud401: LG('연결 코드의 토큰이 맞지 않거나 기한이 지났어요 · PC 설정 → 휴대폰 앱 → 밖에서 자동 인식 에서 토큰을 새로 넣고 코드를 다시 받아 주세요', 'The token in the link code is invalid or expired · enter a new token on the PC (Settings → Phone app → Recognize outside) and get a new code', 'リンクコードのトークンが無効か期限切れです · PCで新しいトークンを入れてコードを取り直してください'),
      cloud404: LG('인식 저장소를 찾지 못했어요 (저장소 이름이나 토큰 권한을 확인해 주세요)', 'Recognition repository not found (check the name or token permissions)', '認識用リポジトリが見つかりません (名前かトークンの権限を確認してください)'),
      cloudpublic: LG('인식 저장소가 공개(Public)예요 · 악보가 남에게 보일 수 있어서 비공개(Private)로 바꿔야 써요', 'The recognition repository is Public · make it Private so your scores stay private', '認識用リポジトリが公開(Public)です · 非公開(Private)にしてください'),
      cloudsetup: LG('PC에서 클라우드 준비를 아직 안 했어요 · PC 설정 → 휴대폰 앱 → 밖에서 자동 인식 → "준비하기"', 'Cloud setup is not done yet · on the PC: Settings → Phone app → Recognize outside → "Set up"', 'クラウドの準備がまだです · PCの 設定 → スマホアプリ → 外で自動認識 →「準備する」'),
      cloudtimeout: LG('클라우드가 25분 안에 끝내지 못했어요 · GitHub 서버가 바쁠 수 있어요. 조금 뒤 다시 해 주세요', 'The cloud did not finish in 25 minutes · GitHub may be busy. Try again later', 'クラウドが25分以内に終わりませんでした · 少し後でもう一度お試しください'),
      cloudhttp: LG('GitHub에서 오류가 났어요 · 잠시 뒤 다시 해 주세요', 'GitHub returned an error · try again shortly', 'GitHubでエラーが出ました · 少し後でもう一度お試しください'),
    }[e];
    return cloud || PcLink.errText(r);
  },
  async omr_status() {
    const pc = PcLink.ready() && PcLink.get();
    if (pc) {
      if (await PcLink.alive(pc)) {
        const r = await PcLink.call(pc, 'omr_status');
        if (r && !r.error) { this.mode = 'pc'; return r; }
      }
    }
    if (CloudOmr.get()) { this.mode = 'cloud'; return { ok: true, ocr: ['eng', 'kor'], cloud: true }; }
    const how = await omrSetupDialog(pc ? PcLink.errText({ error: 'net' }) : '');
    if (!how) return { cancel: true };
    return this.omr_status();
  },
  async omr_pdf(b64, name, lyrics) {
    PcLink.awake(true);
    try {
      if (this.mode === 'pc') {
        const pc = PcLink.get(); if (!pc) return { error: 'net' };
        return await PcLink.call(pc, 'omr_pdf', [b64, name, !!lyrics]);
      }
      const span = $('#pdfBusy span');
      return await CloudOmr.omr(b64, lyrics, s => {
        if (span) span.textContent = LG(`${Math.floor(s / 60)}분 ${s % 60}초 지남 · 보통 1~3분 걸려요 (처음 한 번은 조금 더) · 앱을 닫지 말고 기다려 주세요`, `${Math.floor(s / 60)}m ${s % 60}s · usually 1–3 min (a bit longer the first time) · keep the app open`, `${Math.floor(s / 60)}分${s % 60}秒経過 · 通常1〜3分 (初回は少し長め) · アプリを閉じずにお待ちください`);
      });
    } finally { PcLink.awake(false); }
  },
  async ocr_install() {
    if (this.mode !== 'pc') return { langs: ['eng', 'kor'] };   // 클라우드는 서버가 알아서 받아요
    const pc = PcLink.get(); if (!pc) return { error: 'net' };
    PcLink.awake(true);
    try { return await PcLink.call(pc, 'ocr_install'); } finally { PcLink.awake(false); }
  },
};
/** 연결 코드 넣는 칸 (설정 화면 · 고르는 창에서 같이 써요) · 연결되면 onDone() */
function cloudCodeForm(box, onDone) {
  box.innerHTML = `<label class="fld">${LG('연결 코드 (PC에서 복사해서 카톡 등으로 보낸 것)', 'Link code (copied from the PC, e.g. sent via chat)', 'リンクコード (PCからコピーしてチャット等で送ったもの)')}
    <textarea class="inp" id="ccCode" rows="2" spellcheck="false" autocomplete="off" placeholder="BFLAT1:…" style="font-family:monospace;font-size:12px"></textarea></label>
  <p class="small" id="ccMsg"></p>
  <button class="btn primary" id="ccGo">${LG('클라우드 연결', 'Connect cloud', 'クラウド接続')}</button>`;
  const msg = (t, bad) => { const m = $('#ccMsg', box); m.textContent = t; m.style.color = bad ? '#dc2626' : ''; };
  $('#ccCode', box).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); $('#ccGo', box).click(); } });
  $('#ccGo', box).addEventListener('click', async () => {
    const c = CloudOmr.parse($('#ccCode', box).value);
    if (!c) { msg(LG('코드가 올바르지 않아요 · "BFLAT1:"로 시작하는 글자 전체를 붙여 넣어 주세요', 'Invalid code · paste the whole text starting with "BFLAT1:"', 'コードが正しくありません · 「BFLAT1:」で始まる全体を貼り付けてください'), true); return; }
    msg(LG('확인하는 중…', 'Checking…', '確認中…'));
    const r = await CloudOmr.check(c);
    if (!box.isConnected) return;
    if (r.ok) { CloudOmr.set(c); msg(LG('연결됐어요 ✓ 이제 밖에서도 자동 인식이 돼요', 'Connected ✓ recognition now works anywhere', '接続しました ✓ 外でも自動認識できます')); onDone && onDone(); }
    else msg(MobileOmr.errText(r), true);
  });
}
/** 자동 인식 방법이 아직 없을 때: 클라우드(어디서나) 또는 집 PC(같은 와이파이) → 연결되면 true */
function omrSetupDialog(why) {
  return new Promise(res => {
    modal(`<h2>${LG('자동 인식 연결', 'Set up recognition', '自動認識の接続')}</h2>
    <p class="small">${LG('휴대폰 안에서는 악보 인식 프로그램(Audiveris)이 돌아가지 않아서, 아래 둘 중 하나가 대신 인식해요.', 'Phones cannot run the recognition program (Audiveris), so one of these does it for you.', 'スマホでは楽譜認識プログラム(Audiveris)が動かないため、次のどちらかが代わりに認識します。')}</p>
    ${why ? `<p class="small" style="color:#dc2626">${esc(why)}</p>` : ''}
    <h3 style="margin:10px 0 4px">☁ ${LG('밖에서도 (클라우드 · 추천)', 'Anywhere (cloud · recommended)', 'どこでも (クラウド · おすすめ)')}</h3>
    <p class="muted small" style="margin:0 0 6px">${LG('PC가 꺼져 있어도 휴대폰 데이터만 있으면 돼요. 한 번에 1~3분. PC 프로그램 <b>⚙ 설정 → 휴대폰 앱 → 밖에서 자동 인식</b>에서 처음 한 번 준비하고 나오는 <b>연결 코드</b>를 붙여 넣어요.', 'Works even when the PC is off, with just mobile data. 1–3 min each. Set it up once on the PC (<b>⚙ Settings → Phone app → Recognize outside</b>) and paste the <b>link code</b> it shows.', 'PCが消えていてもモバイルデータだけで使えます。1回1〜3分。PCの<b>⚙ 設定 → スマホアプリ → 外で自動認識</b>で一度準備し、出てくる<b>リンクコード</b>を貼り付けます。')}</p>
    <div id="osCloud"></div>
    <h3 style="margin:14px 0 4px">🏠 ${LG('집에서 (같은 와이파이의 PC · 빠름)', 'At home (PC on the same Wi-Fi · fast)', '家で (同じWi-FiのPC · 速い)')}</h3>
    <button class="btn" id="osPc">${LG('PC와 연결하기', 'Connect to PC', 'PCと接続')}</button>
    <div class="modal-btns"><button class="btn" data-close>${LG('취소', 'Cancel', 'キャンセル')}</button></div>`, md => {
      App.onModalClose = () => res(false);
      cloudCodeForm($('#osCloud', md), () => setTimeout(() => { App.onModalClose = null; closeModal(); res(true); }, 700));
      $('#osPc', md).addEventListener('click', async () => {
        App.onModalClose = null;
        if (!PcLink.ready()) { pcAppTooOld(); res(false); return; }
        res(!!(await pcConnectDialog()));
      });
    }, 'wide');
  });
}
/** 앱(자바)이 일을 마치면 부르는 곳 → 결과를 가져가요 */
window.__bflatPc = id => {
  let v; try { v = JSON.parse(AndroidBridge.pcTake(id)); } catch (e) { v = { error: 'lost' }; }
  const f = PcLink.wait[id]; delete PcLink.wait[id]; if (f) f(v);
};
/** 예전 APK(이 기능이 없는 앱)일 때 */
function pcAppTooOld() {
  modal(`<h2>${LG('앱을 새로 설치해 주세요', 'Please update the app', 'アプリを更新してください')}</h2>
  <p>${LG('PC와 연결해서 자동 인식하려면 새 앱(APK)이 필요해요. PC에서 받는 주소(설정 → 휴대폰 앱)로 들어가 새 APK를 받아 설치해 주세요. 지금 악보·내 악보함은 그대로 남아요.', 'Recognition through the PC needs the new app (APK). Download the new APK from the download page (PC: Settings → Phone app) and install it. Your scores stay.', 'PC経由の自動認識には新しいアプリ(APK)が必要です。ダウンロードページ(PC: 設定 → スマホアプリ)から新しいAPKを入れてください。楽譜はそのまま残ります。')}</p>
  <div class="modal-btns"><button class="btn primary" data-close>${LG('확인', 'OK', 'OK')}</button></div>`);
}
/** PC 찾기 · 주소 · 연결 번호 칸 (연결 창과 설정 → 휴대폰 앱 에서 같이 써요) · 연결되면 onDone(pc) */
function pcLinkForm(box, onDone) {
  const pc = PcLink.get() || {};
  box.innerHTML = `
  <div class="pc-found" id="pcFound"></div>
  <div class="row2"><label class="fld">${LG('PC 주소', 'PC address', 'PCアドレス')}<input class="inp" id="pcHost" value="${esc(pc.host || '')}" placeholder="${LG('예: 192.168.0.5', 'e.g. 192.168.0.5', '例: 192.168.0.5')}" inputmode="decimal" spellcheck="false" autocomplete="off"></label>
  <label class="fld">${LG('연결 번호 (6자리)', 'Link code (6 digits)', '接続番号 (6桁)')}<input class="inp" id="pcCode" value="${esc(pc.code || '')}" placeholder="000000" inputmode="numeric" maxlength="6" autocomplete="off"></label></div>
  <p class="small" id="pcMsg"></p>
  <div class="row2"><button class="btn" id="pcAgain">${LG('PC 다시 찾기', 'Search again', '再検索')}</button><button class="btn primary" id="pcGo">${LG('연결', 'Connect', '接続')}</button></div>`;
  const msg = (t, bad) => { const m = $('#pcMsg', box); m.textContent = t; m.style.color = bad ? '#dc2626' : ''; };
  let name = pc.name || '';
  const search = async () => {
    const f = $('#pcFound', box);
    f.innerHTML = `<span class="muted small">${LG('같은 와이파이에서 PC 찾는 중… (최대 15초)', 'Looking for PCs on this Wi-Fi… (up to 15 s)', '同じWi-FiでPCを探しています… (最大15秒)')}</span>`;
    const list = await PcLink.find();
    if (!box.isConnected) return;
    if (!list.length) { f.innerHTML = `<span class="muted small">${LG('PC를 찾지 못했어요 · PC에서 BFlat Studio를 켜 두고 "다시 찾기"를 누르거나, PC 화면에 나온 주소를 직접 넣어 주세요', 'No PC found · keep BFlat Studio open on the PC and search again, or type the address shown on the PC', 'PCが見つかりません · PCでBFlat Studioを開いたまま再検索するか、PCに表示されたアドレスを入力してください')}</span>`; return; }
    f.innerHTML = list.map(p => `<button class="btn pc-item" data-host="${esc(p.host)}" data-port="${p.port | 0}" data-name="${esc(p.name || '')}">🖥 <b data-notr>${esc(p.name || p.host)}</b> <span class="muted small" data-notr>${esc(p.host)}</span></button>`).join('');
    const pick = b => { $$('.pc-item', f).forEach(x => x.classList.toggle('on', x === b)); $('#pcHost', box).value = b.dataset.host + (+b.dataset.port && +b.dataset.port !== 47390 ? ':' + b.dataset.port : ''); name = b.dataset.name; $('#pcCode', box).focus(); };
    $$('.pc-item', f).forEach(b => b.addEventListener('click', () => pick(b)));
    if (list.length === 1 && !$('#pcHost', box).value) pick($('.pc-item', f));
  };
  const go = async () => {
    const hv = $('#pcHost', box).value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const code = $('#pcCode', box).value.replace(/\D/g, '');
    const m = /^(.+?)(?::(\d+))?$/.exec(hv);
    if (!m) { msg(LG('PC 주소를 넣어 주세요', 'Enter the PC address', 'PCアドレスを入れてください'), true); return; }
    if (code.length !== 6) { msg(LG('연결 번호 6자리를 넣어 주세요', 'Enter the 6-digit link code', '6桁の接続番号を入れてください'), true); return; }
    const p = { host: m[1], port: m[2] ? +m[2] : 47390, code, name: name || m[1] };
    msg(LG('연결하는 중…', 'Connecting…', '接続中…'));
    const r = await PcLink.call(p, 'ping');
    if (!box.isConnected) return;
    if (r && r.ok) { p.name = r.name || p.name; PcLink.set(p); PcLink.okAt = Date.now(); msg(LG('연결됐어요 ✓', 'Connected ✓', '接続しました ✓')); onDone && onDone(p); }
    else msg(PcLink.errText(r), true);
  };
  $('#pcAgain', box).addEventListener('click', search);
  $('#pcGo', box).addEventListener('click', go);
  ['#pcHost', '#pcCode'].forEach(s => $(s, box).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } }));
  search();
}
const PC_LINK_INTRO = () => LG('휴대폰에서는 악보 인식 프로그램(Audiveris)이 돌아가지 않아서, <b>같은 와이파이의 PC</b>에 켜 둔 BFlat Studio가 대신 읽어 줘요. 결과는 바로 이 휴대폰으로 와요.',
  'Phones cannot run the recognition program (Audiveris), so BFlat Studio running on a <b>PC on the same Wi-Fi</b> reads the score for you. The result comes straight back to this phone.',
  'スマホでは楽譜認識プログラム(Audiveris)が動かないため、<b>同じWi-FiのPC</b>で起動しているBFlat Studioが代わりに読み取ります。結果はすぐこのスマホに届きます。');
const PC_LINK_STEPS = () => `<ol class="pub-steps small">
  <li>${LG('PC에서 <b>BFlat Studio</b>를 켜 두세요 (Audiveris가 설치된 PC)', 'Keep <b>BFlat Studio</b> open on the PC (with Audiveris installed)', 'PCで<b>BFlat Studio</b>を開いておいてください (Audiveris入りのPC)')}</li>
  <li>${LG('휴대폰과 PC가 <b>같은 공유기(와이파이)</b>에 연결돼 있어야 해요', 'The phone and PC must be on the <b>same router (Wi-Fi)</b>', 'スマホとPCが<b>同じルーター(Wi-Fi)</b>につながっている必要があります')}</li>
  <li>${LG('PC 화면 <b>⚙ 설정 → 휴대폰 앱</b>에 나오는 <b>연결 번호 6자리</b>를 넣어요', 'Enter the <b>6-digit link code</b> shown on the PC under <b>⚙ Settings → Phone app</b>', 'PCの<b>⚙ 設定 → スマホアプリ</b>に出る<b>6桁の接続番号</b>を入れます')}</li></ol>`;
/** 연결 창 → 연결되면 그 PC, 취소하면 null */
function pcConnectDialog(why) {
  return new Promise(res => {
    modal(`<h2>${LG('PC와 연결해서 자동 인식', 'Recognize through your PC', 'PCと接続して自動認識')}</h2>
    <p class="small">${PC_LINK_INTRO()}</p>${PC_LINK_STEPS()}
    ${why ? `<p class="small" style="color:#dc2626">${esc(why)}</p>` : ''}
    <div id="pcForm"></div>
    <div class="modal-btns"><button class="btn" data-close>${LG('취소', 'Cancel', 'キャンセル')}</button></div>`, md => {
      App.onModalClose = () => res(null);
      pcLinkForm($('#pcForm', md), pc => setTimeout(() => { App.onModalClose = null; closeModal(); res(pc); }, 500));
    }, 'wide');
  });
}
/** 설정 → 휴대폰 앱 (안드로이드 앱에서): 연결한 PC 보기 · 바꾸기 · 끊기 */
function mobileOmrPane(el) {
  const c = CloudOmr.get();
  el.innerHTML = `<div class="pl-box"><h3 style="margin:0 0 4px">☁ ${LG('밖에서 자동 인식 (클라우드)', 'Recognize anywhere (cloud)', '外で自動認識 (クラウド)')}</h3>
    <p class="muted small" style="margin:0 0 6px">${LG('PC가 꺼져 있어도 휴대폰 데이터만 있으면 GitHub 무료 서버가 PC와 같은 Audiveris로 인식해요 (한 번에 1~3분). PC 프로그램 <b>⚙ 설정 → 휴대폰 앱 → 밖에서 자동 인식</b>에서 나온 <b>연결 코드</b>를 붙여 넣어요.', 'Even with the PC off, a free GitHub server recognizes with the same Audiveris as the PC, using just mobile data (1–3 min each). Paste the <b>link code</b> from the PC program (<b>⚙ Settings → Phone app → Recognize outside</b>).', 'PCが消えていても、モバイルデータだけでGitHubの無料サーバーがPCと同じAudiverisで認識します (1回1〜3分)。PCの<b>⚙ 設定 → スマホアプリ → 外で自動認識</b>で出た<b>リンクコード</b>を貼り付けます。')}</p>
    ${c ? `<div class="small">${LG('연결됨', 'Connected', '接続済み')} ✓ <span data-notr>${esc(c.o)}/${esc(c.r)}</span> <button class="btn" id="ccOff" style="min-height:0;padding:1px 8px">${LG('연결 끊기', 'Disconnect', '接続解除')}</button></div>` : '<div id="ccForm"></div>'}
  </div>
  ${window.AndroidBridge ? '<div id="pcPart" style="margin-top:12px"></div>' : ''}`;
  const off = $('#ccOff', el); if (off) off.addEventListener('click', () => { CloudOmr.set(null); mobileOmrPane(el); });
  if (!c) cloudCodeForm($('#ccForm', el), () => setTimeout(() => { if (el.isConnected) mobileOmrPane(el); }, 900));
  if (window.AndroidBridge) pcLinkPane($('#pcPart', el));
}
function pcLinkPane(el) {
  const pc = PcLink.get();
  el.innerHTML = `<h3 style="margin-top:0">🏠 ${LG('집 PC와 연결 (같은 와이파이)', 'Home PC link (same Wi-Fi)', '家のPCと接続 (同じWi-Fi)')}</h3>
  <p class="muted small">${PC_LINK_INTRO()}</p>${PC_LINK_STEPS()}
  <div class="small" style="margin:6px 0">${pc ? LG(`연결한 PC: <b data-notr>${esc(pc.name || pc.host)}</b> <span data-notr>(${esc(pc.host)})</span>`, `Connected PC: <b data-notr>${esc(pc.name || pc.host)}</b> <span data-notr>(${esc(pc.host)})</span>`, `接続したPC: <b data-notr>${esc(pc.name || pc.host)}</b> <span data-notr>(${esc(pc.host)})</span>`) : LG('아직 연결한 PC가 없어요', 'No PC connected yet', 'まだPCが接続されていません')}
  ${pc ? ` <button class="btn" id="plOff" style="min-height:0;padding:1px 8px">${LG('연결 끊기', 'Disconnect', '接続解除')}</button>` : ''}</div>
  <div id="plForm"></div>
  <p class="muted small" data-notr>${esc(window.AndroidBridge && AndroidBridge.version ? LG('앱 화면 버전: ', 'App screen version: ', '画面バージョン: ') + AndroidBridge.version() : '')}</p>`;
  const off = $('#plOff', el); if (off) off.addEventListener('click', () => { PcLink.set(null); pcLinkPane(el); });
  if (!PcLink.ready()) { $('#plForm', el).innerHTML = `<p class="small" style="color:#dc2626">${LG('이 앱은 예전 버전이라 PC 연결이 안 돼요 · 새 APK를 설치해 주세요', 'This app version is too old for the PC link · install the new APK', 'このアプリは古いためPC接続できません · 新しいAPKを入れてください')}</p>`; return; }
  pcLinkForm($('#plForm', el), () => setTimeout(() => { if (el.isConnected) pcLinkPane(el); }, 700));
}
/** 설정 → 휴대폰 앱 (PC 프로그램에서): 휴대폰이 이 PC로 자동 인식을 맡길 수 있게 */
async function phoneLinkBox(box) {
  const api = Native();
  if (!api || !api.phone_status) { box.remove(); return; }
  const st = await api.phone_status();
  const omr = api.omr_status ? await api.omr_status() : { ok: true };
  const code = String(st.code || '').replace(/(\d{3})(\d{3})/, '$1 $2');
  box.innerHTML = `<div class="pl-box">
    <h3 style="margin:0 0 4px">${LG('📱 휴대폰에서 자동 인식', '📱 Recognition from the phone', '📱 スマホから自動認識')}</h3>
    <p class="muted small" style="margin:0 0 6px">${LG('안드로이드 앱에서 "자동 인식"을 누르면 PDF가 이 PC로 와서 여기서 인식하고, 결과를 휴대폰으로 돌려보내요. 휴대폰과 이 PC가 같은 와이파이(공유기)에 있어야 해요.', 'When you press "Recognize" in the Android app, the PDF comes to this PC, is recognized here, and the result goes back to the phone. The phone and this PC must be on the same Wi-Fi (router).', 'Androidアプリで「自動認識」を押すとPDFがこのPCに届き、ここで認識して結果をスマホに返します。スマホとこのPCが同じWi-Fi(ルーター)にある必要があります。')}</p>
    <label class="chk"><input type="checkbox" id="plOn"${st.enabled ? ' checked' : ''}> ${LG('휴대폰의 자동 인식 요청 받기', 'Accept recognition requests from the phone', 'スマホからの自動認識を受け付ける')}</label>
    ${st.enabled && st.running ? `<div class="pl-code">${LG('연결 번호', 'Link code', '接続番号')} <b data-notr>${esc(code)}</b> <button class="btn" id="plNew" style="min-height:0;padding:1px 8px">${LG('번호 바꾸기', 'New code', '番号を変更')}</button></div>
    <div class="small">${LG('이 PC 주소', 'This PC', 'このPCのアドレス')}: <b data-notr>${esc((st.addrs || []).join(' · ') || '?')}</b> <span class="muted" data-notr>(${esc(st.name || '')})</span></div>` : ''}
    ${st.enabled && !st.running ? `<p class="small" style="color:#dc2626">${LG('연결을 켜지 못했어요 (다른 프로그램이 같은 번호의 통로를 쓰고 있을 수 있어요)', 'Could not start the link (another program may be using the port)', '接続を開始できませんでした (他のプログラムが同じポートを使っている可能性があります)')}: <span data-notr>${esc(st.error || '')}</span></p>` : ''}
    ${st.enabled && !omr.ok ? `<p class="small" style="color:#dc2626">${LG('이 PC에 Audiveris가 없어서 휴대폰이 보내도 인식할 수 없어요 · PDF 열기 → "자동 인식"에서 설치 안내를 보세요', 'Audiveris is not installed on this PC, so phone requests cannot be recognized · see the install guide via Open PDF → "Recognize"', 'このPCにAudiverisがないため認識できません · PDFを開く →「自動認識」でインストール案内を見てください')}</p>` : ''}
    <p class="muted small" style="margin:6px 0 0">${LG('처음 켤 때 <b>Windows 방화벽</b> 창이 뜨면 <b>개인·공용 네트워크 둘 다 체크 → 액세스 허용</b>을 눌러 주세요. 실수로 취소했으면: Windows 보안 → 방화벽 및 네트워크 보호 → 방화벽에서 앱 허용 → BFlat Studio 체크.', 'If a <b>Windows Firewall</b> window appears, tick <b>both Private and Public networks → Allow access</b>. If you cancelled it: Windows Security → Firewall & network protection → Allow an app through firewall → tick BFlat Studio.', '<b>Windowsファイアウォール</b>の画面が出たら<b>プライベート・パブリック両方にチェック → アクセスを許可</b>を押してください。キャンセルした場合: Windows セキュリティ → ファイアウォールとネットワーク保護 → ファイアウォールによるアプリケーションの許可 → BFlat Studioにチェック。')}</p>
  </div>`;
  $('#plOn', box).addEventListener('change', async e => { await api.phone_enable(e.target.checked); phoneLinkBox(box); });
  const nb = $('#plNew', box); if (nb) nb.addEventListener('click', async () => { await api.phone_new_code(); phoneLinkBox(box); });
}
/** 설정 → 휴대폰 앱 (PC 프로그램에서): 밖에서 자동 인식 준비 (비공개 GitHub 저장소 + GitHub Actions) → 휴대폰 연결 코드 */
async function cloudPcBox(box) {
  const api = Native();
  if (!api || !api.cloud_status) { box.remove(); return; }
  const st = await api.cloud_status();
  const link = (url, text) => `<a href="#" data-link="${url}">${text}</a>`;
  box.innerHTML = `<div class="pl-box">
    <h3 style="margin:0 0 4px">☁ ${LG('밖에서 자동 인식 (클라우드 · PC가 꺼져 있어도)', 'Recognize outside (cloud · even with the PC off)', '外で自動認識 (クラウド · PCが消えていても)')}</h3>
    <p class="muted small" style="margin:0 0 6px">${LG('휴대폰이 PDF를 <b>내 비공개 GitHub 저장소</b>에 올리면, GitHub 무료 서버가 이 PC와 같은 Audiveris로 인식해서 결과를 돌려줘요. 휴대폰 데이터만 있으면 어디서나 돼요 (한 번에 1~3분 · 비공개 저장소는 한 달 2,000분 무료 → 수백 번). <b>처음 한 번만</b> 준비해요.', 'The phone uploads the PDF to <b>your private GitHub repository</b>, a free GitHub server recognizes it with the same Audiveris as this PC, and sends the result back. Works anywhere with mobile data (1–3 min each · private repos get 2,000 free minutes a month → hundreds of scores). Set up <b>once</b>.', 'スマホがPDFを<b>自分の非公開GitHubリポジトリ</b>に上げると、GitHubの無料サーバーがこのPCと同じAudiverisで認識して結果を返します。モバイルデータだけでどこでも使えます (1回1〜3分 · 非公開リポジトリは月2,000分無料 → 数百回)。<b>最初に一度だけ</b>準備します。')}</p>
    <ol class="pub-steps small">
      <li>${link('https://github.com/new', LG('새 저장소 만들기', 'Create a new repository', '新しいリポジトリを作成'))} — ${LG('이름 예: <b>bflat-omr</b> · 반드시 <b>Private</b>(비공개) · <b>Add a README file</b> 체크', 'name e.g. <b>bflat-omr</b> · must be <b>Private</b> · tick <b>Add a README file</b>', '名前例: <b>bflat-omr</b> · 必ず<b>Private</b>(非公開) · <b>Add a README file</b>にチェック')}</li>
      <li>${link('https://github.com/settings/personal-access-tokens/new', LG('토큰 만들기', 'Create a token', 'トークンを作成'))} — Repository access: <b>Only select repositories</b> → ${LG('그 저장소', 'that repository', 'そのリポジトリ')} · Permissions: <b>Contents → Read and write</b>, <b>Workflows → Read and write</b> · ${LG('기한(Expiration)은 길게(예: 1년)', 'Expiration: long (e.g. 1 year)', '有効期限は長めに(例: 1年)')}</li>
      <li>${LG('아래에 넣고 <b>준비하기</b> → <b>클라우드 시험</b> → 나온 <b>연결 코드</b>를 휴대폰으로 보내서(카톡 나에게 보내기 등) 앱의 설정 → 휴대폰 앱 에 붙여 넣기', 'Fill in below, press <b>Set up</b> → <b>Test cloud</b> → send the <b>link code</b> to your phone (e.g. chat to yourself) and paste it in the app under Settings → Phone app', '下に入力して<b>準備する</b> → <b>クラウドテスト</b> → 出た<b>リンクコード</b>をスマホに送り(自分宛てチャット等)、アプリの 設定 → スマホアプリ に貼り付け')}</li>
    </ol>
    <div class="row3"><label class="fld">${LG('GitHub 계정 이름', 'GitHub account', 'GitHubアカウント名')}<input class="inp" id="cOwner" value="${esc(st.owner)}" spellcheck="false"></label>
    <label class="fld">${LG('비공개 저장소 이름', 'Private repository', '非公開リポジトリ名')}<input class="inp" id="cRepo" value="${esc(st.repo || 'bflat-omr')}" spellcheck="false"></label>
    <label class="fld">${LG('토큰', 'Token', 'トークン')}<input class="inp" id="cToken" type="password" autocomplete="off" placeholder="${st.hasToken ? LG('저장돼 있어요 · 바꿀 때만 입력', 'Saved · enter only to change', '保存済み · 変更時のみ入力') : 'github_pat_…'}"></label></div>
    <div class="row2" style="margin-top:8px"><button class="btn primary" id="cSave">${LG('준비하기', 'Set up', '準備する')}</button><button class="btn" id="cTest"${st.ready ? '' : ' disabled'}>${LG('클라우드 시험', 'Test cloud', 'クラウドテスト')}</button></div>
    <p class="small" id="cMsg">${st.ready ? LG(`준비됐어요 ✓ (${esc(st.installedAt)})`, `Ready ✓ (${esc(st.installedAt)})`, `準備完了 ✓ (${esc(st.installedAt)})`) + (st.test ? ' · ' + (st.test.ok ? LG(`시험 통과 ✓ ${st.test.sec}초`, `Test passed ✓ ${st.test.sec}s`, `テスト合格 ✓ ${st.test.sec}秒`) : LG('시험 실패', 'Test failed', 'テスト失敗')) : '') : ''}</p>
    ${st.ready ? `<div class="fld">${LG('휴대폰 연결 코드 — 남에게 보여 주지 마세요 (내 저장소 열쇠가 들어 있어요)', 'Phone link code — keep it private (it contains your repository key)', 'スマホ用リンクコード — 他人に見せないでください (リポジトリの鍵が入っています)')}
      <div class="row2"><input class="inp" id="cCode" type="password" readonly data-notr style="font-family:monospace;font-size:12px"><button class="btn" id="cShow">${LG('보기', 'Show', '表示')}</button><button class="btn primary" id="cCopy">${LG('복사', 'Copy', 'コピー')}</button></div></div>` : ''}
  </div>`;
  $$('[data-link]', box).forEach(a => a.addEventListener('click', e => { e.preventDefault(); api.open_url(a.dataset.link); }));
  const msg = (t, bad) => { const m = $('#cMsg', box); m.textContent = t; m.style.color = bad ? '#dc2626' : ''; };
  const errText = r => ({ config: LG('계정 이름·저장소 이름·토큰을 모두 넣어 주세요', 'Fill in account, repository and token', 'アカウント名・リポジトリ名・トークンをすべて入れてください'),
    public: LG('이 저장소는 공개(Public)예요 · 악보가 남에게 보일 수 있어서 비공개(Private) 저장소만 써요 (저장소 Settings → Change visibility)', 'This repository is Public · only a Private repository is allowed so your scores stay private (repo Settings → Change visibility)', 'このリポジトリは公開です · 非公開リポジトリのみ使えます (Settings → Change visibility)'),
    push: LG('토큰에 쓰기 권한이 없어요 · Contents → Read and write 로 다시 만들어 주세요', 'The token cannot write · recreate it with Contents → Read and write', 'トークンに書き込み権限がありません · Contents → Read and write で作り直してください'),
    workflow: LG('토큰에 Workflows 권한이 없어요 · Permissions에서 Workflows → Read and write 를 더해 주세요', 'The token lacks Workflows permission · add Workflows → Read and write', 'トークンにWorkflows権限がありません · Workflows → Read and write を追加してください'),
    timeout: LG('10분 안에 결과가 안 왔어요 · 저장소의 Actions 탭에서 "BFlat 악보 인식"이 돌고 있는지 확인해 주세요 (Actions가 꺼져 있으면 켜기)', 'No result within 10 minutes · check the Actions tab of the repository ("BFlat 악보 인식"; enable Actions if disabled)', '10分以内に結果が来ませんでした · リポジトリのActionsタブを確認してください'),
    http: (r.status === 401 ? LG('토큰이 맞지 않아요', 'The token is not valid', 'トークンが正しくありません') : r.status === 404 ? LG('저장소를 찾지 못했어요 (계정 이름·저장소 이름·토큰의 저장소 선택 확인)', 'Repository not found (check names and the token’s repository access)', 'リポジトリが見つかりません (名前・トークンの対象リポジトリを確認)') : `GitHub ${r.status}: ${r.message || ''}`),
    net: LG('인터넷에 연결할 수 없어요', 'Cannot reach the internet', 'インターネットに接続できません') }[r.error] || LG('실패했어요', 'Failed', '失敗しました'));
  $('#cSave', box).addEventListener('click', async () => {
    msg(LG('확인하고 인식 작업 파일을 올리는 중…', 'Checking and uploading the recognition job…', '確認して認識ジョブをアップロード中…'));
    const r = await api.cloud_save($('#cOwner', box).value, $('#cRepo', box).value, $('#cToken', box).value);
    $('#cToken', box).value = '';
    if (r.ok) { await cloudPcBox(box); msg(LG('준비됐어요 ✓ 이제 "클라우드 시험"을 눌러 보세요', 'Ready ✓ now press "Test cloud"', '準備完了 ✓「クラウドテスト」を押してください')); }
    else msg(errText(r), true);
  });
  $('#cTest', box).addEventListener('click', async () => {
    const t0 = Date.now();
    const tick = setInterval(() => { if (!box.isConnected) return clearInterval(tick); const s = Math.round((Date.now() - t0) / 1000); msg(LG(`GitHub 서버에서 인식 프로그램을 준비하는 중… ${s}초 (처음엔 2~4분)`, `Preparing the recognizer on the GitHub server… ${s}s (2–4 min the first time)`, `GitHubサーバーで認識プログラムを準備中… ${s}秒 (初回は2〜4分)`)); }, 1000);
    const r = await api.cloud_test();
    clearInterval(tick);
    if (!box.isConnected) return;
    if (r.ok) msg(LG(`시험 통과 ✓ ${r.sec}초 · 가사 인식: ${(r.ocr || []).join('+') || '없음'} · 이제 연결 코드를 휴대폰으로 보내세요`, `Test passed ✓ ${r.sec}s · lyrics OCR: ${(r.ocr || []).join('+') || 'none'} · now send the link code to your phone`, `テスト合格 ✓ ${r.sec}秒 · 歌詞認識: ${(r.ocr || []).join('+') || 'なし'} · リンクコードをスマホに送ってください`));
    else msg(r.error ? errText(r) : LG('서버에 Audiveris를 설치하지 못했어요 · 저장소 Actions 탭의 기록을 확인해 주세요', 'Could not install Audiveris on the server · check the Actions tab log', 'サーバーにAudiverisを入れられませんでした · Actionsタブの記録を確認してください'), true);
  });
  const code = $('#cCode', box);
  if (code) {
    code.value = await api.cloud_code();
    $('#cShow', box).addEventListener('click', () => { code.type = code.type === 'password' ? 'text' : 'password'; });
    $('#cCopy', box).addEventListener('click', async () => { try { await navigator.clipboard.writeText(code.value); } catch (e) { code.type = 'text'; code.select(); document.execCommand('copy'); } $('#cCopy', box).textContent = '✓'; });
  }
}
/** PC 프로그램: 휴대폰이 맡긴 일을 화면에 알려요 (phonelink.py → main.py) */
function phoneLinkNotice(kind) {
  if (kind === 'phoneOmr') toast(LG('📱 휴대폰이 보낸 악보를 이 PC에서 인식하는 중… (프로그램을 끄지 마세요)', '📱 Recognizing a score sent from the phone… (keep this program open)', '📱 スマホから届いた楽譜をこのPCで認識中… (プログラムを閉じないでください)'), 600000);
  else if (kind === 'phoneDone') toast(LG('📱 인식 결과를 휴대폰으로 보냈어요', '📱 Sent the result to the phone', '📱 認識結果をスマホに送りました'), 3600);
  else if (kind === 'phoneOcr') toast(LG('📱 휴대폰 요청: 가사 인식 데이터를 받는 중…', '📱 Phone request: downloading lyrics recognition data…', '📱 スマホの依頼: 歌詞認識データをダウンロード中…'), 120000);
}
function initPdfResizer() {
  const rz = $('.pdf-resizer'), panel = $('#pdfPanel');
  rz.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation(); rz.classList.add('drag'); document.body.classList.add('dragging-pdf');
    const wa = $('#workArea').getBoundingClientRect();
    const mv = ev => { const w = Math.max(260, Math.min(wa.width * 0.75, wa.right - ev.clientX)); panel.style.setProperty('--pdfw', w + 'px'); };
    const up = () => { rz.classList.remove('drag'); document.body.classList.remove('dragging-pdf'); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); try { localStorage.setItem('bflat.pdfw', panel.style.getPropertyValue('--pdfw')); } catch (e2) { } };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  });
}
/** 열기 창 (데스크톱 앱이면 윈도우 파일 창) */
async function openDialog() {
  const api = Native();
  if (!api) { $('#fileOpen').click(); return; }
  const res = await api.open_file('open');
  if (res) openFile(b64ToFile(res), res.path);
}
async function midiDialog() {
  const api = Native();
  if (!api) { $('#fileMidi').click(); return; }
  const res = await api.open_file('midi');
  if (res) placeMidiFromFile(b64ToFile(res));
}
function placeMidiFromFile(f) {
  const mi = App.selMeasures.length ? Math.min(...App.selMeasures) : (App.sel.length ? findNote(App.sel[0]).mi : App.playStart.m);
  loadMidiFile(f, mi, App.selMeasures.length ? 0 : App.playStart.t);
}
async function openFile(file, nativePath) {
  file = await withProperName(file);     // 휴대폰: 이름에 확장자가 없으면 내용으로 알아내요
  if (isScoreSource(file.name)) { openScoreSource(file); return; }
  try {
    const nm = file.name.toLowerCase();
    let s;
    if (nm.endsWith('.mxl')) s = importMusicXML(await unzipMxl(await file.arrayBuffer()));
    else if (nm.endsWith('.musicxml') || nm.endsWith('.xml')) s = importMusicXML(await file.text());
    else { s = JSON.parse(await file.text()); if (!s.measures) throw new Error('BFlat 악보 파일이 아니에요'); s = fixIds(s); }
    stopPlay();
    History.push(App.s);
    App.s = s; App.sel = []; App.selMeasures = []; App.playStart = { m: 0, t: 0 }; App.verse = 0; App.fileHandle = null; App.libId = null;
    App.nativePath = (nativePath && /\.bflat$/i.test(nativePath)) ? nativePath : null;
    leavePdfOnly();
    if (App.blank) { leaveBlank(); closeModal(); }
    if (Native()) Native().set_title(s.title || file.name);
    buildSubbar(); changed();
    toast(`열었어요 — ${file.name}`);
  } catch (e) { console.error(e); toast('열 수 없어요: ' + e.message, 4000); }
}
function exportMenu(x, y) {
  popMenu(x, y, [{ v: 'xml', html: '<b>MusicXML</b> <span class="muted">MuseScore·Sibelius 등에서 이어서</span>' }, { v: 'mid', html: '<b>MIDI</b> <span class="muted">도돌이표를 펼친 연주 순서</span>' }, { v: 'wav', html: '<b>오디오 WAV</b>' }, { v: 'pdf', html: '<b>PDF</b> <span class="muted">인쇄 창에서 "PDF로 저장"</span>' }, { v: 'json', html: '<b>BFlat 파일</b> (.bflat)' }], async v => {
    const nm = safeName(S());
    if (v === 'xml') downloadBlob(new Blob([exportMusicXML(S())], { type: 'application/vnd.recordare.musicxml+xml' }), nm + '.musicxml', 'musicxml');
    else if (v === 'mid') downloadBlob(exportMidi(S(), App.settings), nm + '.mid', 'mid');
    else if (v === 'wav') { toast('오디오 만드는 중…', 6000); const r = await downloadBlob(await renderWav(S(), App.ctxs, App.settings), nm + '.wav', 'wav'); if (!Native()) toast('WAV 저장했어요'); void r; }
    else if (v === 'pdf') printScore();
    else if (v === 'json') saveFile(true);
  }, '내보내기');
}
function printScore() {
  const prevSel = App.sel, prevM = App.selMeasures, prevMode = App.mode;
  App.sel = []; App.selMeasures = []; App.hoverMeasure = null;
  document.body.classList.add('printing');
  App.mode = 'print'; render();
  setTimeout(() => printNow(() => { App.sel = prevSel; App.selMeasures = prevM; App.mode = prevMode; document.body.classList.remove('printing'); render(); }), 50);
}
function placeMidi(arr, mi, t0) {
  if (!arr.length) { toast('MIDI에 음표가 없어요'); return; }
  const s = S(), si = curStaff();
  const base = arr[0].s;
  // 이어지는 (쉼표/음표) 조각 만들기 (틱 단위, 16분 = 12)
  const segs = [];
  let cur = 0;
  arr.forEach(n => {
    const st = (n.s - base) * 12, en = (n.e - base) * 12;
    if (st > cur) segs.push({ rest: true, len: st - cur });
    if (en > st) segs.push({ midi: n.m, len: en - st });
    cur = Math.max(cur, en);
  });
  commit(() => {
    let m = mi;
    const ctxs0 = computeContexts(s);
    let t = t0 - (t0 % 12);
    // 시작 마디: 놓은 박 앞 음표만 남기기
    const keepUntil = (meas, cap, tt) => { let acc = 0; const keep = []; for (const n of SNr(meas, si)) { const d = noteTicks(n, cap); if (acc + d <= tt) { keep.push(n); acc += d; } else break; } setSN(meas, si, keep); if (acc < tt) restsFor(acc, tt - acc).forEach(d => { const r = newNote(d.dur, null, true); r.dots = d.dots; SN(meas, si).push(r); }); };
    keepUntil(s.measures[m], ctxs0[m].cap, t);
    let prevPiece = null;
    const ensure = (k) => { while (k >= s.measures.length) { const n = s.lines[s.lines.length - 1] || 4; for (let j = 0; j < n; j++) s.measures.push(newMeasure()); s.lines.push(n); } };
    const capOf = k => { const c = computeContexts(s)[k]; return c.full; };
    let cap = capOf(m);
    segs.forEach(sg => {
      let left = sg.len;
      while (left > 0) {
        if (t >= cap) { m++; ensure(m); t = 0; cap = capOf(m); const mm = s.measures[m]; removeSlursFor(SNr(mm, si).map(n => n.id)); setSN(mm, si, []); }
        const take = Math.min(left, cap - t);
        const ds = restsFor(t, take);
        ds.forEach((d, k) => {
          const n = sg.rest ? newNote(d.dur, null, true) : newNote(d.dur, midiToPitch(sg.midi, computeContexts(s)[m].key));
          n.dots = d.dots; n.edited = true;
          SN(s.measures[m], si).push(n);
          if (!sg.rest && prevPiece && (k > 0 || left < sg.len)) s.slurs.push({ id: uid(), a: prevPiece.id, b: n.id, type: 'tie' });
          prevPiece = sg.rest ? null : n;
        });
        t += take; left -= take;
      }
      if (!sg.rest) prevPiece = null;
      prevPiece = null;
    });
    if (t < cap) restsFor(t, cap - t).forEach(d => { const r = newNote(d.dur, null, true); r.dots = d.dots; SN(s.measures[m], si).push(r); });
  });
  toast(`MIDI를 ${mi + 1}마디부터 넣었어요`);
}
async function loadMidiFile(file, mi, t) {
  try { const arr = parseMidi(await file.arrayBuffer()); placeMidi(arr, mi, t || 0); }
  catch (e) { toast('MIDI를 읽을 수 없어요: ' + e.message, 4000); }
}

/* ---------- 키보드 ---------- */
function onKey(e) {
  if ($('#modalRoot').innerHTML && e.key !== 'F1') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || (tag === 'select' && !/^F\d$/.test(e.key))) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (countPopKey(e)) return;
  const fk = /^F([1-7])$/.exec(k);
  if (fk) { e.preventDefault(); setMode(['note', 'slur', 'bar', 'chord', 'lyric', 'form', 'measure'][+fk[1] - 1]); return; }
  if (ctrl) {
    const lk = k.toLowerCase();
    if (lk === 'z') { e.preventDefault(); return undo(); }
    if (lk === 'y') { e.preventDefault(); return redo(); }
    if (lk === 's') { e.preventDefault(); return saveFile(e.shiftKey); }
    if (lk === 'o') { e.preventDefault(); return openDialog(); }
    if (lk === 'p') { e.preventDefault(); return printScore(); }
    if (App.mode === 'measure' && lk === 'c') { e.preventDefault(); return copyMeasures(false); }
    if (App.mode === 'measure' && lk === 'x') { e.preventDefault(); return copyMeasures(true); }
    if (App.mode === 'measure' && lk === 'v') { e.preventDefault(); return pasteMeasures(); }
    if (lk === '=' || lk === '+') { e.preventDefault(); return setZoom(App.zoom + .1); }
    if (lk === '-') { e.preventDefault(); return setZoom(App.zoom - .1); }
  }
  if (k === ' ') { e.preventDefault(); return togglePlay(); }
  if (k === 'Tab') { e.preventDefault(); const i = MODES.findIndex(m => m[0] === App.mode); return setMode(MODES[mod(i + (e.shiftKey ? -1 : 1), MODES.length)][0]); }
  if (k === 'Escape') {
    if (App.mode === 'harm') { e.preventDefault(); return leaveHarm(); }
    closePop(); closeEditors(); if (App.widthEdit) { App.widthEdit = false; App.selBar = null; } App.sel = []; App.selSlur = null; App.selMeasures = []; render(); return;
  }
  if (App.mode === 'note') return keyNote(e);
  if (App.mode === 'harm') return keyHarm(e);
  if (App.mode === 'slur') {
    if ((k === 't' || k === 'T') && App.selSlur) { e.preventDefault(); toggleTieType(); }
    if ((k === 'Delete' || k === 'Backspace') && App.selSlur) { e.preventDefault(); commit(() => S().slurs = S().slurs.filter(x => x.id !== App.selSlur)); App.selSlur = null; render(); }
    return;
  }
  if (App.mode === 'measure') {
    if (App.widthEdit && App.selBar !== null && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); return nudgeBar((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 12 : 2)); }
    if ((k === 'Delete' || k === 'Backspace') && App.selMeasures.length) { e.preventDefault(); commit(() => deleteMeasures(App.selMeasures)); App.selMeasures = []; render(); }
    if (k === 'Insert' && App.selMeasures.length) { e.preventDefault(); addMeasureAfter(Math.max(...App.selMeasures)); }
  }
}
/** 화음 탭 끝 → 음표 탭 (멜로디 다시 고칠 수 있음) */
function leaveHarm() {
  // 화음 음을 고른 채 끝내면 같은 박의 멜로디 음을 골라 둬요
  const f = App.sel.length ? findNote(App.sel[0]) : null;
  if (f && f.ov) { const g = App.lay.meas[f.mi]; const mn = SNr(f.m, f.si).find((n, q) => g.startsSt[f.si][q] === (f.n.t || 0)); App.sel = mn ? [mn.id] : []; }
  setMode('note');
}
/** 화음 탭 키: 멜로디는 잠그고 화음 음만 */
function keyHarm(e) {
  const k = e.key, code = e.code || '';
  const num = /^(Digit|Numpad)([0-9])$/.exec(code);
  const digit = num ? num[2] : (/^[0-9]$/.test(k) ? k : null);
  if (digit && NUMKEY_DUR[digit]) { e.preventDefault(); return harmPlace(NUMKEY_DUR[digit]); }
  if (code === 'Backquote' || k === '`') { e.preventDefault(); return harmPlace(NUMKEY_DUR['`']); }
  if (k === '.' || code === 'Period' || code === 'NumpadDecimal') { e.preventDefault(); return harmDot(); }
  if (k === 'h' || k === 'H' || k === 'ㅗ' || code === 'KeyH') { e.preventDefault(); return leaveHarm(); }
  if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
    e.preventDefault();
    const hc = App.hc || { mi: 0, si: 0, t: 0 }, si = Math.max(0, Math.min(nStaves() - 1, hc.si + (k === 'ArrowUp' ? -1 : 1)));
    const st = harmStops(hc.mi, si); let best = st[0]; st.forEach(t => { if (Math.abs(t - hc.t) < Math.abs(best - hc.t)) best = t; });
    return setHC(hc.mi, si, best);
  }
  if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); return harmPitch(k === 'ArrowUp' ? 1 : -1, e.ctrlKey ? 'oct' : e.shiftKey ? 'semi' : 'step'); }
  const L2 = { 'ㅁ': 'A', 'ㅠ': 'B', 'ㅊ': 'C', 'ㅇ': 'D', 'ㄷ': 'E', 'ㄹ': 'F', 'ㅎ': 'G' }[k] || (/^[a-gA-G]$/.test(k) ? k.toUpperCase() : null);
  if (L2 && !e.ctrlKey && !e.altKey) { e.preventDefault(); return harmPitch(0, 'letter', L2); }
  if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); return harmNav(k === 'ArrowLeft' ? -1 : 1, e.ctrlKey); }
  if (k === 'Enter') { e.preventDefault(); return harmNav(e.shiftKey ? -1 : 1, e.ctrlKey); }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return harmDelete(); }
  if (k === 'Insert') { e.preventDefault(); return harmAddTone(); }
  // 그 밖의 음표 단축키(쉼표, 셋잇단 등)는 멜로디를 바꾸니까 막아요
  if (/^[0tTnNsS+]$/.test(k) || code === 'CapsLock') { e.preventDefault(); toast('화음 탭에서는 멜로디가 잠겨 있어요 · Esc 로 끝낸 다음 고쳐요'); }
}
function keyNote(e) {
  const k = e.key, code = e.code || '';
  const num = /^(Digit|Numpad)([0-9])$/.exec(code);
  const digit = num ? num[2] : (/^[0-9]$/.test(k) ? k : null);
  if (digit && NUMKEY_DUR[digit]) { e.preventDefault(); return setDur(NUMKEY_DUR[digit]); }
  if (code === 'Backquote' || k === '`') { e.preventDefault(); return setDur(NUMKEY_DUR['`']); }
  if (code === 'CapsLock' || k === 'CapsLock') { e.preventDefault(); return countMenuForCurrent(); }
  if (digit === '0') { e.preventDefault(); const em = emptyCursor(); if (em !== null) return addToEmptyMeasure(em, 'rest'); return toggleRest(); }
  if (k === '.' || code === 'NumpadDecimal') { e.preventDefault(); return toggleDot(); }
  if (k === 'n' || k === 'N' || k === 'ㅜ') { e.preventDefault(); App.write = !App.write; render(); toast(App.write ? '쓰기 모드 켬 — 빈 곳 클릭 = 음표 추가' : '쓰기 모드 끔'); return; }
  if (k === 't' || k === 'T' || k === 'ㅅ') { e.preventDefault(); return toggleTri(); }
  if (k === '+' || code === 'NumpadAdd') { e.preventDefault(); return addSlurNext('tie'); }
  if (k === 's' || k === 'S' || k === 'ㄴ') { e.preventDefault(); return addSlurNext('slur'); }
  if (k === 'h' || k === 'H' || k === 'ㅗ' || code === 'KeyH') { e.preventDefault(); return setMode('harm'); }
  if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); return switchStaff(k === 'ArrowUp' ? -1 : 1); }
  const L2 = { 'ㅁ': 'A', 'ㅠ': 'B', 'ㅊ': 'C', 'ㅇ': 'D', 'ㄷ': 'E', 'ㄹ': 'F', 'ㅎ': 'G' }[k] || (/^[a-gA-G]$/.test(k) ? k.toUpperCase() : null);
  if (L2 && !e.ctrlKey && !e.altKey) { e.preventDefault(); const em = emptyCursor(); if (em !== null) return addToEmptyMeasure(em, 'note', L2); return setLetter(L2); }
  if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); return moveStep(k === 'ArrowUp' ? 1 : -1, e.ctrlKey ? 'oct' : e.shiftKey ? 'semi' : 'step'); }
  if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); const dir = k === 'ArrowLeft' ? -1 : 1; if (e.altKey) return swapSel(dir); return navNote(dir, e.ctrlKey); }
  if (k === 'Enter') { e.preventDefault(); return navNote(e.shiftKey ? -1 : 1, e.ctrlKey); }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return deleteSel(); }
  if (k === 'Insert') { e.preventDefault(); const em = emptyCursor(); if (em !== null) return addToEmptyMeasure(em, 'note'); return insertAfterSel(); }
}
function toggleTieType() {
  const sl = S().slurs.find(x => x.id === App.selSlur); if (!sl) return;
  if (sl.type === 'tie') { commit(() => sl.type = 'slur'); return; }
  const a = allNotes(); const i = a.findIndex(x => x.n.id === sl.a);
  if (!a[i + 1] || a[i + 1].n.id !== sl.b) { toast('붙임줄은 바로 옆 음끼리만 돼요'); return; }
  commit(() => { sl.type = 'tie'; const A = a[i].n, B = a[i + 1].n; if (A.p) B.p = { d: A.p.d, a: A.p.a }; });
}
function undo() { const p = History.undo(App.s); if (!p) return; App.s = fixIds(p); App.sel = App.sel.filter(id => findNote(id)); changed(); buildSubbar(); }
function redo() { const p = History.redo(App.s); if (!p) return; App.s = fixIds(p); App.sel = App.sel.filter(id => findNote(id)); changed(); buildSubbar(); }
function setZoom(z) { App.zoom = Math.max(.4, Math.min(2.5, Math.round(z * 10) / 10)); try { localStorage.setItem('bflat.zoom', App.zoom); } catch (e) { } render(); }

/* ---------- 상단 메뉴 (파일 · 도구 · 도움말) ---------- */
const TOP_MENUS = {
  menuFile: [['new', '새 악보…', ''], ['open', '열기…', 'Ctrl+O'], ['save', '저장', 'Ctrl+S'], '-', ['library', '내 악보함…', ''], ['libSave', '내 악보함에 저장', ''], '-', ['export', '내보내기…', ''], ['print', '인쇄 · PDF', 'Ctrl+P']],
  menuTools: [['info', '곡 정보 · 악보 종류', ''], ['transpose', '조옮김', ''], ['solfa', '계이름', ''], '-', ['pdf', '악보 인식 (PDF · 사진 · 한글)…', ''], ['midiIn', 'MIDI 넣기', '']],
  menuHelp: [['help', '사용법', ''], ['shortcuts', '단축키', '']],
};
function topMenu(act, btn) {
  const r = btn.getBoundingClientRect();
  const items = TOP_MENUS[act].map(it => it === '-' ? '-' : { v: it[0], html: `<span>${esc(it[1])}</span>${it[2] ? `<kbd>${it[2]}</kbd>` : ''}` });
  popMenu(r.left, r.bottom + 4, items, v => onAction(v, v === 'export' ? btn : null));
}
/* ---------- 버튼 ---------- */
function onAction(act, btn, e) {
  switch (act) {
    case 'new': return scoreTypeDialog();
    case 'open': return openDialog();
    case 'save': return saveFile(false);
    case 'export': { const r = btn.getBoundingClientRect(); return exportMenu(r.left, r.bottom + 4); }
    case 'print': return printScore();
    case 'info': return infoDialog();
    case 'transpose': return transposeDialog();
    case 'midiIn': return midiDialog();
    case 'pdf': return pdfDialog();
    case 'solfa': return solfaDialog();
    case 'pdfClose': return closePdf();
    case 'pdfOmr': return pdfRecognize();
    case 'pdfSol': return pdfSolfa();
    case 'pdfSolPrint': return pdfSolPrint();
    case 'undo': return undo();
    case 'redo': return redo();
    case 'play': return togglePlay();
    case 'rewind': App.playStart = { m: 0, t: 0 }; if (Player.playing) { stopPlay(); togglePlay(); } render(); return;
    case 'zoomIn': return setZoom(App.zoom + .1);
    case 'zoomOut': return setZoom(App.zoom - .1);
    case 'settings': return settingsDialog();
    case 'shortcuts': return shortcutsDialog();
    case 'help': return helpDialog();
    case 'menuFile': case 'menuTools': case 'menuHelp': return topMenu(act, btn);
    case 'library': return libraryDialog();
    case 'libSave': return libSave(false);
    case 'toggleWrite': App.write = !App.write; render(); return;
    case 'dot': return toggleDot();
    case 'tri': return toggleTri();
    case 'chordMode': return setMode('harm');
    case 'harmDone': return leaveHarm();
    case 'text': return editText();
    case 'fillAll': return fillRests(false);
    case 'fillWorked': return fillRests(true);
    case 'toMeasure': return setMode('measure');
    case 'toggleTie': return toggleTieType();
    case 'delSlur': commit(() => S().slurs = S().slurs.filter(x => x.id !== App.selSlur)); App.selSlur = null; render(); return;
    case 'mAdd': return addMeasureAfter(Math.max(...App.selMeasures));
    case 'mDel': commit(() => deleteMeasures(App.selMeasures)); App.selMeasures = []; render(); return;
    case 'lineBefore': return addLine(false);
    case 'lineAfter': return addLine(true);
    case 'lineDel': return deleteLine();
    case 'widthEdit': App.widthEdit = !App.widthEdit; if (!App.widthEdit) App.selBar = null; else toast('파란 마디선을 끌어 폭을 바꿔요 · Esc = 끝'); render(); return;
    case 'widthSame': return widthSame();
    case 'widthAuto': return widthAuto();
    case 'nextBad': case 'nextEmpty': {
      const want = act === 'nextBad' ? (c => c.status === 'short' || c.status === 'over') : (c => c.status === 'empty');
      const cur = App.selMeasures[0] !== undefined ? App.selMeasures[0] : (App.sel.length ? findNote(App.sel[0]).mi : -1);
      let i = App.ctxs.findIndex((c, k) => k > cur && want(c));
      if (i < 0) i = App.ctxs.findIndex(want);
      if (i < 0) return;
      if (App.mode === 'note' && S().measures[i].notes.length) App.sel = [S().measures[i].notes[0].id];
      else App.selMeasures = [i];
      setPlayStart(i, 0); render(); scrollToMeasure(i); return;
    }
  }
}

/* ---------- 시작 ---------- */
function init() {
  try { Object.assign(App.settings, JSON.parse(localStorage.getItem('bflat.settings') || '{}')); } catch (e) { }
  // 기본 화면을 "어둡게 + 미색 종이"로 바꾼 판(2): 예전에 저장한 설정도 한 번만 새 기본으로 맞춰요 (그 뒤로 바꾼 건 그대로)
  if ((App.settings.defaultsV || 0) < 2) { App.settings.theme = 'dark'; App.settings.paper = 'cream'; App.settings.defaultsV = 2; saveSettings(); }
  // 화면 언어: 지금 화면과 앞으로 생기는 창·알림 글자를 바꿔요
  I18N.start(); I18N.set(App.settings.lang || 'ko');
  try { const z = +localStorage.getItem('bflat.zoom'); if (z) App.zoom = z; } catch (e) { }
  applyTheme();
  let s = null;
  try { const raw = localStorage.getItem('bflat.autosave'); if (raw) s = fixIds(JSON.parse(raw)); } catch (e) { s = null; }
  App.saved = s;
  App.s = newScore({ title: '', num: 4, den: 4, mpl: 4, lines: 4, tempo: 90 });
  App.blank = true;
  document.body.classList.add('blank');
  $('#modes').innerHTML = MODES.map(([k, l, f]) => `<button data-mode="${k}" class="${k === App.mode ? 'on' : ''}"><small>${f}</small> ${l}</button>`).join('');
  $('#modes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (b && !b.disabled) { onAction(b.dataset.act, b, e); return; }
    const d = e.target.closest('[data-dur]'); if (d) { setDur(d.dataset.dur); return; }
    const a = e.target.closest('[data-art]'); if (a && !a.disabled) { toggleArt(a.dataset.art); return; }
    const v = e.target.closest('[data-verse]'); if (v) { App.verse = +v.dataset.verse; render(); return; }
  });
  document.addEventListener('change', e => { if (e.target.id === 'selDyn' && e.target.value) setDyn(e.target.value); });
  const pages = $('#pages');
  pages.addEventListener('mousedown', onMouseDown);
  $('#scroller').addEventListener('mousedown', e => { if (!e.target.closest('.page')) onMouseDown(e); });
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  pages.addEventListener('dblclick', onDblClick);
  pages.addEventListener('contextmenu', onContext);
  document.addEventListener('keydown', onKey);
  // 인터넷 주소로 연 웹앱(아이폰 Safari 등): 인터넷이 없어도 열리게 (PC 프로그램·안드로이드 앱 안에서는 안 써요)
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.AndroidBridge && !/^(localhost|127\.|bflat\.app$)/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  // 안드로이드 앱 자동 업데이트 알림 (앱이 새 화면 파일을 받아 두면 불러요)
  window.__bflatUpdateReady = built => {
    modal(`<h2>${LG('새 버전을 받았어요', 'A new version is ready', '新しいバージョンを受け取りました')}</h2>
      <p>${LG(`PC에서 업데이트한 최신 버전(${esc(built)})으로 바꿀 준비가 됐어요. 지금 다시 열까요? (쓰던 악보는 자동 저장돼 있어요)`, `The latest version from your PC (${esc(built)}) is ready. Reload now? (your score is autosaved)`, `PCで更新した最新版(${esc(built)})の準備ができました。今すぐ開き直しますか? (作業中の楽譜は自動保存されています)`)}</p>
      <div class="modal-btns"><button class="btn" data-close>${LG('나중에 (다음에 켤 때)', 'Later (next launch)', 'あとで (次回起動時)')}</button><button class="btn primary" id="uNow">${LG('지금 바꾸기', 'Reload now', '今すぐ切り替える')}</button></div>`, md => {
      $('#uNow', md).addEventListener('click', () => { try { if (!App.blank) localStorage.setItem('bflat.autosave', JSON.stringify(App.s)); } catch (e) { } location.reload(); });
    });
  };
  window.__bflatApkUpdate = (url, name) => {
    modal(`<h2>${LG('새 앱 설치 파일', 'New app installer', '新しいアプリ')}</h2>
      <p>${LG(`앱 틀이 새로 나왔어요 (버전 ${esc(name)}). 받아서 설치하면 지금 앱 위에 덮어 설치돼요 (악보는 그대로).`, `A new app build is available (version ${esc(name)}). Installing it updates this app in place (your scores stay).`, `アプリ本体の新しいバージョン(${esc(name)})があります。インストールするとこのアプリに上書きされます (楽譜はそのまま)。`)}</p>
      <div class="modal-btns"><button class="btn" data-close>${LG('나중에', 'Later', 'あとで')}</button><button class="btn primary" id="aGet">${LG('받기', 'Download', 'ダウンロード')}</button></div>`, md => {
      $('#aGet', md).addEventListener('click', () => { if (window.AndroidBridge && AndroidBridge.openUrl) AndroidBridge.openUrl(url); closeModal(); });
    });
  };
  // 터치 화면: 키 패드 (누르면 그 키를 누른 것과 똑같이) · 휴대폰 폭이면 악보를 화면 폭에 맞춰요
  const touch = !!window.AndroidBridge || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (touch) {
    document.body.classList.add('touch');
    $('#touchPad').hidden = false;
    $('#touchPad').addEventListener('click', e => {
      const b = e.target.closest('[data-key]'); if (!b) return;
      onKey({ key: b.dataset.key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: document.body, preventDefault() { }, stopPropagation() { } });
    });
    let hadZoom = false; try { hadZoom = !!localStorage.getItem('bflat.zoom'); } catch (e) { }
    if (!hadZoom && innerWidth < 760) App.zoom = Math.max(.3, Math.floor((innerWidth - 12) / L.PW * 100) / 100);
  }
  document.addEventListener('mousedown', e => { if (!e.__bflat && !e.target.closest('.pop')) closePop(); });
  $('#scroller').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(App.zoom + (e.deltaY < 0 ? .1 : -.1)); } }, { passive: false });
  $('#fileOpen').addEventListener('change', e => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; });
  $('#filePdf').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openScoreSource(f); });
  initPdfResizer();
  $('#fileMidi').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) placeMidiFromFile(f);
  });
  window.addEventListener('pywebviewready', () => { document.body.classList.add('desktop'); applyTheme(); if (S().title) Native().set_title(S().title); });
  // 파일 끌어 놓기
  $('#scroller').addEventListener('dragover', e => { e.preventDefault(); const p = pagePoint(e); const h = p ? hit(p) : null; showDropHint(h && h.g ? h : null); });
  $('#scroller').addEventListener('dragleave', () => hideOverlays());
  $('#scroller').addEventListener('drop', e => {
    e.preventDefault(); hideOverlays();
    const f = e.dataTransfer.files[0]; if (!f) return;
    const nm = f.name.toLowerCase();
    if (/\.midi?$/.test(nm)) { const p = pagePoint(e); const h = p ? hit(p) : null; if (h && h.g) { const t = Math.round(h.t / 12) * 12; loadMidiFile(f, h.mi, Math.min(t, App.ctxs[h.mi].cap - 12)); } else loadMidiFile(f, 0, 0); }
    else openFile(f);
  });
  window.addEventListener('beforeunload', () => { if (App.blank) return; try { localStorage.setItem('bflat.autosave', JSON.stringify(App.s)); } catch (e) { } });
  buildSubbar();
  render();
  // 첫 화면: (처음이면 회원 가입·로그인 → ) 백지 + 새 악보 창 (지난 작업은 "이전 작업 이어서"로)
  if (typeof Auth !== 'undefined') Auth.gate(() => scoreTypeDialog(true)); else scoreTypeDialog(true);
  // 글꼴이 늦게 로드되면 다시 그리기
  if (document.fonts) document.fonts.ready.then(() => render());
}
document.addEventListener('DOMContentLoaded', init);
