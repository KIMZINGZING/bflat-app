'use strict';
/* ===== BFlat Studio — 재생 ===== */
const TEMPO_RE = /(?:♩|q|𝅘𝅥)\s*=\s*(\d{2,3})/i;

/** 연주 이벤트 만들기 (재생 순서 펼침 · 모든 줄 · 화음) */
function buildPerformance(s, ctxs, opt) {
  opt = opt || {};
  const order = playOrder(s);
  const tied = tieSets(s);
  const nSt = staffCount(s);
  const startM = opt.startM || 0, startT = opt.startT || 0;
  let k0 = order.indexOf(startM);
  if (k0 < 0) k0 = 0;
  let tempo = s.tempo || 90;
  // 시작점 이전의 템포 글자 반영
  for (let k = 0; k < k0; k++) s.measures[order[k]].notes.forEach(n => { const mm = TEMPO_RE.exec(n.text || ''); if (mm) tempo = +mm[1]; });
  const ev = [], marks = [], chords = [];
  let time = 0;
  const DYN_VEL = { ppp: .25, pp: .33, p: .45, mp: .58, mf: .7, f: .82, ff: .92, fff: 1 };
  const vel = Array(nSt).fill(.72);
  const pending = new Map(); // 붙임줄: 다음 음표 id → [이어 갈 이벤트]
  for (let k = k0; k < order.length; k++) {
    const mi = order[k], m = s.measures[mi], c = ctxs[mi];
    const skip = (k === k0) ? startT : 0;
    const len = Math.max(c.cap, c.sum);
    const mStart = time;
    // 이 마디의 빠르기 변화 (첫 줄 글자 기준) → 박 위치를 초로 바꾸는 함수
    const changes = [{ t: 0, tempo }];
    let tt = 0;
    m.notes.forEach(n => { const mm = TEMPO_RE.exec(n.text || ''); if (mm) changes.push({ t: tt, tempo: +mm[1] }); tt += noteTicks(n, c.cap); });
    const secAt = tick => {   // skip 지점부터 tick 까지 걸리는 초
      let sec = 0;
      for (let q = 0; q < changes.length; q++) {
        const a = Math.max(changes[q].t, skip), b = Math.min(q + 1 < changes.length ? changes[q + 1].t : Infinity, tick);
        if (b > a) sec += (b - a) * 60 / changes[q].tempo / TPQ;
      }
      return sec;
    };
    tempo = changes[changes.length - 1].tempo;
    // 스윙: 박 안의 앞 8분음표는 길게(2/3), 뒤 8분음표는 짧게(1/3) — 박 경계는 그대로
    const swingOn = s.swing && c.den !== 8 && !isCompound(c);
    const W = tick => {
      if (!swingOn) return tick;
      const b = Math.floor(tick / TPQ) * TPQ, p = tick - b, h = TPQ / 2;
      return b + (p < h ? p * 4 / 3 : TPQ * 2 / 3 + (p - h) * 2 / 3);
    };
    const off = swingOn ? secAt(W(skip)) : 0;
    const secW = tick => swingOn ? Math.max(0, secAt(W(tick)) - off) : secAt(tick);
    const mDur = secAt(Math.max(len, skip));
    for (let si = 0; si < nSt; si++) {
      let t = 0;
      SNr(m, si).forEach(n => {
        const d = noteTicks(n, c.cap);
        const t0 = t; t += d;
        if (t0 + d <= skip) return;
        if (n.dyn && DYN_VEL[n.dyn]) vel[si] = DYN_VEL[n.dyn];
        const st = mStart + secW(Math.max(t0, skip));
        const dur = secW(t0 + d) - secW(Math.max(t0, skip));
        if (n.rest || !n.p) return;
        const midis = notePitches(n).map(pitchMidi);
        let fresh = midis;
        const carry = [];
        if (pending.has(n.id)) {
          const evs = pending.get(n.id); pending.delete(n.id);
          fresh = [];
          midis.forEach(md => { const e = evs.find(x => x.midi === md); if (e) { e.dur += dur; carry.push(e); } else fresh.push(md); });
        }
        let dd = dur;
        if ((n.art || []).includes('staccato')) dd *= .5;
        if ((n.art || []).includes('fermata')) dd *= 1.6;
        const v = vel[si] * ((n.art || []).some(a => a === 'accent' || a === 'marcato') ? 1.18 : 1) * (midis.length > 2 ? .8 : 1);
        const made = fresh.map(md => ({ time: st, dur: dd, midi: md, vel: Math.min(1, v), id: n.id, mi }));
        made.forEach(e => ev.push(e));
        if (tied.from.has(n.id)) pending.set(tied.from.get(n.id), carry.concat(made));
      });
      // 둘째 성부 (길이가 다른 화음 음)
      OVr(m, si).forEach(n => {
        if (n.rest || !n.p) return;
        const d = noteTicks(n, c.cap), t0 = n.t || 0;
        if (t0 + d <= skip) return;
        const st = mStart + secW(Math.max(t0, skip));
        const dur = secW(t0 + d) - secW(Math.max(t0, skip));
        notePitches(n).forEach(p => ev.push({ time: st, dur, midi: pitchMidi(p), vel: Math.min(1, vel[si] * .85), id: n.id, mi }));
      });
    }
    // 코드 이름 반주
    const chs = m.chords.slice().sort((a, b) => a.t - b.t);
    chs.forEach((ch, ci) => {
      if (ch.t < skip) return;
      const end = ci + 1 < chs.length ? chs[ci + 1].t : len;
      const tones = chordTones(ch.name);
      if (!tones) return;
      chords.push({ time: mStart + secW(ch.t), dur: secW(end) - secW(ch.t), tones });
    });
    marks.push({ time: mStart, mi, dur: mDur, len, skip });
    time += mDur;
  }
  return { ev, chords, marks, total: time, order, k0 };
}

/* 간단한 합성음 */
function voice(ac, dest, midi, when, dur, vel, timbre) {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = ac.createGain();
  g.connect(dest);
  const end = when + dur;
  const peak = .22 * vel;
  const oscs = [];
  if (timbre === 'organ') {
    [[1, 'sine', 1], [2, 'sine', .5], [3, 'sine', .25]].forEach(([mul, type, amp]) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f * mul; const og = ac.createGain(); og.gain.value = amp; o.connect(og); og.connect(g); oscs.push(o); });
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak * .8, when + .02); g.gain.setValueAtTime(peak * .8, Math.max(when + .02, end - .03)); g.gain.linearRampToValueAtTime(0, end + .05);
  } else if (timbre === 'sine') {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); oscs.push(o);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak * 1.2, when + .015); g.gain.setValueAtTime(peak * 1.2, Math.max(when + .015, end - .04)); g.gain.linearRampToValueAtTime(0, end + .06);
  } else { // piano 비슷한 소리
    const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const o3 = ac.createOscillator(); o3.type = 'sine'; o3.frequency.value = f * 3.01;
    const g2 = ac.createGain(); g2.gain.value = .35; const g3 = ac.createGain(); g3.gain.value = .12;
    o1.connect(g); o2.connect(g2); g2.connect(g); o3.connect(g3); g3.connect(g);
    oscs.push(o1, o2, o3);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak * 1.5, when + .006);
    g.gain.exponentialRampToValueAtTime(peak * .55, when + .25);
    g.gain.exponentialRampToValueAtTime(Math.max(.0008, peak * .25), Math.max(when + .26, end));
    g.gain.exponentialRampToValueAtTime(.0001, end + .18);
  }
  oscs.forEach(o => { o.start(when); o.stop(end + .25); });
  return oscs;
}

/** 소리 낼 음 목록 (시간 순) — 음표 + 코드 반주 */
function performanceVoices(perf, settings) {
  const list = [];
  perf.ev.forEach(e => list.push({ time: e.time, dur: Math.max(.05, e.dur * .97), midi: e.midi, vel: e.vel }));
  if (settings.chordAccomp) perf.chords.forEach(c => {
    const d = Math.max(.1, c.dur * .95);
    list.push({ time: c.time, dur: d, midi: c.bass !== undefined ? c.bass : c.tones.bass, vel: .55 });
    c.tones.tones.forEach(m => list.push({ time: c.time, dur: d, midi: m, vel: .32 }));
  });
  // 값이 이상한 음은 빼요 (하나 때문에 뒤의 모든 소리가 안 나는 일이 없게)
  return list.filter(v => [v.time, v.dur, v.midi, v.vel].every(Number.isFinite) && v.vel > 0).sort((a, b) => a.time - b.time);
}
function playVoice(ac, dest, v, t0, settings) {
  try { return voice(ac, dest, v.midi, t0 + v.time, v.dur, v.vel, settings.timbre); } catch (e) { console.warn('음 하나를 건너뛰었어요', v, e); return []; }
}
/** 한꺼번에 모두 (WAV 만들기용) */
function scheduleAll(ac, dest, perf, t0, settings) {
  const nodes = [];
  performanceVoices(perf, settings).forEach(v => nodes.push(...playVoice(ac, dest, v, t0, settings)));
  return nodes;
}

const Player = {
  ac: null, playing: false, nodes: [], perf: null, t0: 0, raf: 0, timer: 0, master: null, queue: [], qi: 0,
  AHEAD: 2.5,   // 몇 초 앞까지 미리 소리를 만들어 둘지 (곡 전체를 한꺼번에 만들면 긴 곡에서 소리가 끊겨요)
  start(s, ctxs, opt, settings, onFrame, onEnd) {
    this.stop();
    if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') this.ac.resume();
    this.master = this.ac.createGain();
    this.master.gain.value = settings.volume;
    this.master.connect(this.ac.destination);
    this.perf = buildPerformance(s, ctxs, opt);
    this.queue = performanceVoices(this.perf, settings); this.qi = 0;
    this.settings = settings;
    this.t0 = this.ac.currentTime + .12;
    this.playing = true;
    this.pump();
    this.timer = setInterval(() => this.pump(), 60);
    const loop = () => {
      if (!this.playing) return;
      if (this.ac.state === 'suspended') this.ac.resume();
      const el = this.ac.currentTime - this.t0;
      if (el > this.perf.total + .3) { this.stop(); onEnd && onEnd(); return; }
      onFrame && onFrame(el, this.perf);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  /** 앞으로 몇 초 동안 울릴 음만 만들어요 · 다 울린 음은 정리 */
  pump() {
    if (!this.playing || !this.master) return;
    const now = this.ac.currentTime, horizon = now - this.t0 + this.AHEAD;
    while (this.qi < this.queue.length && this.queue[this.qi].time < horizon) {
      const v = this.queue[this.qi++];
      const oscs = playVoice(this.ac, this.master, v, this.t0, this.settings);
      if (oscs.length) this.nodes.push({ oscs, end: this.t0 + v.time + v.dur + .3 });
    }
    if (this.nodes.length > 64) this.nodes = this.nodes.filter(n => n.end > now);
  },
  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer); this.timer = 0;
    if (this.master) { try { this.master.gain.setTargetAtTime(0, this.ac.currentTime, .02); } catch (e) { } const m = this.master; setTimeout(() => { try { m.disconnect(); } catch (e) { } }, 200); }
    this.nodes.forEach(n => n.oscs.forEach(o => { try { o.stop(this.ac.currentTime + .1); } catch (e) { } }));
    this.nodes = []; this.master = null; this.queue = []; this.qi = 0;
  },
  /** 한 음 미리 듣기 */
  preview(midi, settings) {
    if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') this.ac.resume();
    const g = this.ac.createGain(); g.gain.value = settings.volume; g.connect(this.ac.destination);
    voice(this.ac, g, midi, this.ac.currentTime + .01, .35, .7, settings.timbre);
    setTimeout(() => g.disconnect(), 1200);
  }
};

/** WAV 만들기 */
async function renderWav(s, ctxs, settings) {
  const perf = buildPerformance(s, ctxs, {});
  const sr = 44100;
  const len = Math.ceil((perf.total + 1.2) * sr);
  const oac = new OfflineAudioContext(2, len, sr);
  const g = oac.createGain(); g.gain.value = settings.volume; g.connect(oac.destination);
  scheduleAll(oac, g, perf, .05, settings);
  const buf = await oac.startRendering();
  return encodeWav(buf);
}
function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const ws = (o, str) => { for (let i = 0; i < str.length; i++) data.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); ws(36, 'data'); data.setUint32(40, n * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([data], { type: 'audio/wav' });
}
