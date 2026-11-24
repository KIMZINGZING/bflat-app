'use strict';
/* ===== BFlat Studio — 사진(JPG·PNG …) · 한글(HWP·HWPX) 악보를 PDF로 =====
 * 자동 인식(Audiveris)·옆에 띄워 보기·PDF 위 계이름은 모두 PDF를 다뤄요.
 * 그래서 사진과 한글 파일은 먼저 "그림 한 장 = 한 쪽"인 PDF로 바꿔서 같은 길로 보내요.
 *  - 사진·캡처: 작은 캡처는 키워요(오선 간격이 너무 좁으면 인식이 안 돼요) · 사진 방향(EXIF)은 그대로 반영
 *  - HWP(한글 5.0): 문서 안에 붙여 넣은 그림(BinData)을 꺼내요 · HWPX: zip 안의 BinData 그림
 *    (악보는 보통 그림으로 붙여 넣어요 · 아주 작은 그림(아이콘 등)은 빼요)
 */
const SCORE_IMG_EXT = /\.(png|jpe?g|bmp|gif|webp|tiff?)$/i;
const SCORE_DOC_EXT = /\.(hwp|hwpx)$/i;
function isScoreSource(name) { return /\.pdf$/i.test(name) || SCORE_IMG_EXT.test(name) || SCORE_DOC_EXT.test(name); }
/**
 * 휴대폰(특히 안드로이드 "다운로드"·클라우드)에서 고른 파일은 이름에 확장자가 없을 때가 있어요 (예: "msf:1000034")
 * → 파일 앞부분(매직 넘버)·형식으로 종류를 알아내서 이름 끝에 붙여요
 */
async function withProperName(file) {
  const known = /\.(pdf|png|jpe?g|bmp|gif|webp|tiff?|hwp|hwpx|bflat|json|musicxml|xml|mxl|midi?)$/i;
  if (known.test(file.name || '')) return file;
  const byType = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'audio/midi': 'mid', 'audio/x-midi': 'mid', 'application/vnd.recordare.musicxml': 'mxl', 'application/vnd.recordare.musicxml+xml': 'musicxml', 'application/x-hwp': 'hwp', 'application/haansofthwp': 'hwp', 'application/vnd.hancom.hwpx': 'hwpx' };
  let ext = byType[(file.type || '').toLowerCase()];
  if (!ext) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const s = String.fromCharCode(...head);
    if (s.startsWith('%PDF')) ext = 'pdf';
    else if (head[0] === 0x89 && s.slice(1, 4) === 'PNG') ext = 'png';
    else if (head[0] === 0xFF && head[1] === 0xD8) ext = 'jpg';
    else if (s.startsWith('GIF8')) ext = 'gif';
    else if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') ext = 'webp';
    else if (s.startsWith('BM')) ext = 'bmp';
    else if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) ext = 'hwp';
    else if (s.startsWith('MThd')) ext = 'mid';
    else if (s.startsWith('PK')) {
      // zip: 한글(HWPX)인지 MusicXML(.mxl)인지 안에 든 파일 이름으로
      const all = new Uint8Array(await file.arrayBuffer());
      let txt = ''; for (let i = 0; i < all.length; i += 0x8000) txt += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
      ext = /Contents\/section|version\.xml/.test(txt) && !/META-INF\/container\.xml[\s\S]*\.(musicxml|xml)/.test(txt) ? 'hwpx' : 'mxl';
    } else {
      const t = s.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
      if (t.startsWith('{')) ext = 'bflat';
      else if (t.startsWith('<')) ext = 'musicxml';
    }
  }
  if (!ext) return file;
  return new File([file], (file.name || 'file').replace(/[:/\\]/g, '_') + '.' + ext, { type: file.type });
}

/* ---------- zip (HWPX) ---------- */
function zipEntries(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip');
  const cnt = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < cnt; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    out.push({
      name, read: async () => {
        const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
        const data = new Uint8Array(buf, off + 30 + lnl + lel, csize);
        if (method === 0) return data.slice();
        return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      }
    });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/* ---------- OLE 복합 문서 (HWP 5.0) ---------- */
function cfbStreams(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (!sig.every((b, i) => u8[i] === b)) throw new Error('cfb');
  const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
  const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), cutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true), nMiniFat = dv.getUint32(64, true);
  let difatSec = dv.getUint32(68, true);
  const secOff = s => (s + 1) * ss;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
  for (let g = 0; fatSecs.length < nFat && difatSec < 0xFFFFFFFA && g < 10000; g++) {
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(secOff(difatSec) + i * 4, true));
    difatSec = dv.getUint32(secOff(difatSec) + ss - 4, true);
  }
  const fat = new Uint32Array(fatSecs.length * ss / 4);
  fatSecs.forEach((s, k) => { for (let i = 0; i < ss / 4; i++) fat[k * ss / 4 + i] = dv.getUint32(secOff(s) + i * 4, true); });
  const chain = (start, table) => { const out = []; let s = start; for (let g = 0; s < 0xFFFFFFFA && g < table.length + 1; g++) { out.push(s); s = table[s]; } return out; };
  const readChain = (start, size) => {
    const secs = chain(start, fat), out = new Uint8Array(secs.length * ss);
    secs.forEach((s, k) => out.set(u8.subarray(secOff(s), secOff(s) + ss), k * ss));
    return size === undefined ? out : out.subarray(0, size);
  };
  const dir = readChain(dirStart);
  const ents = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir[o + 64] | (dir[o + 65] << 8);
    let name = ''; for (let i = 0; i < Math.max(0, nl - 2); i += 2) name += String.fromCharCode(dir[o + i] | (dir[o + i + 1] << 8));
    const ddv = new DataView(dir.buffer, dir.byteOffset + o, 128);
    ents.push({ name, type: dir[o + 66], start: ddv.getUint32(116, true), size: ddv.getUint32(120, true) });
  }
  const root = ents[0];
  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0);
  const miniFat = new Uint32Array(nMiniFat * ss / 4);
  if (nMiniFat) chain(miniFatStart, fat).forEach((s, k) => { for (let i = 0; i < ss / 4; i++) miniFat[k * ss / 4 + i] = dv.getUint32(secOff(s) + i * 4, true); });
  const readMini = (start, size) => { const secs = chain(start, miniFat), out = new Uint8Array(secs.length * mss); secs.forEach((s, k) => out.set(miniStream.subarray(s * mss, s * mss + mss), k * mss)); return out.subarray(0, size); };
  const streams = {};
  ents.forEach(e => { if (e.type === 2) streams[e.name] = () => (e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size)); });
  return streams;
}
/** raw deflate 풀기 — 압축 끝 뒤에 남는 바이트가 있으면 브라우저가 오류를 내서, 그 전까지 푼 것을 써요 (압축 안 된 그림이면 그대로) */
async function inflateRaw(bytes) {
  const chunks = []; let total = 0;
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
  } catch (e) { /* 끝 뒤 군더더기 */ }
  if (!total) return bytes;
  const out = new Uint8Array(total); let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; });
  return out;
}
/** 한글 파일 안의 그림들 → [{name, blob}] (문서에 넣은 차례대로) */
async function hwpImages(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const mime = n => /\.png$/i.test(n) ? 'image/png' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : /\.bmp$/i.test(n) ? 'image/bmp' : /\.gif$/i.test(n) ? 'image/gif' : /\.tiff?$/i.test(n) ? 'image/tiff' : '';
  const out = [];
  if (u8[0] === 0x50 && u8[1] === 0x4B) {
    // HWPX (zip)
    for (const e of zipEntries(buf)) if (/^BinData\//i.test(e.name) && mime(e.name)) out.push({ name: e.name.split('/').pop(), blob: new Blob([await e.read()], { type: mime(e.name) }) });
  } else {
    const st = cfbStreams(buf);
    const fh = st.FileHeader ? st.FileHeader() : null;
    const compressed = fh ? (fh[36] & 1) === 1 : true;
    for (const name of Object.keys(st)) {
      if (!/^BIN\w+\.\w+$/i.test(name) || !mime(name)) continue;
      let data = st[name]();
      if (compressed) data = await inflateRaw(data);
      out.push({ name, blob: new Blob([data], { type: mime(name) }) });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out;
}

/* ---------- 그림 → PDF ---------- */
async function loadBitmap(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) {
    // createImageBitmap 이 못 읽는 형식(일부 BMP·TIFF)은 <img>로
    const url = URL.createObjectURL(blob);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
/**
 * 그림들 → 한 장에 한 쪽인 PDF (JPEG로 넣어요)
 *  - 가로가 2000px보다 작으면 키워요 (캡처 악보는 오선 간격이 좁아서 인식이 잘 안 돼요)
 *  - 아주 작은 그림(가로·세로 200px 미만: 아이콘·도장 등)은 빼요
 * → { blob, pages, skipped }
 */
async function imagesToPdf(blobs) {
  const pages = [];
  let skipped = 0;
  for (const b of blobs) {
    let bmp;
    try { bmp = await loadBitmap(b); } catch (e) { skipped++; continue; }
    const w0 = bmp.width, h0 = bmp.height;
    if (w0 < 200 || h0 < 200) { skipped++; continue; }
    const scale = Math.min(4, Math.max(1, 2000 / w0)), w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    if (w * h > 40e6) { skipped++; continue; }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);           // 투명한 PNG는 흰 바탕
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const jpg = new Uint8Array(await (await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.93))).arrayBuffer());
    // 쪽 크기: 300dpi로 보고 (가로 2000px ≈ 17cm)
    pages.push({ w, h, pw: w * 72 / 300, ph: h * 72 / 300, jpg });
    cv.width = cv.height = 0;
    if (bmp.close) bmp.close();
  }
  if (!pages.length) return { blob: null, pages: 0, skipped };
  return { blob: jpegPagesToPdf(pages), pages: pages.length, skipped };
}
function jpegPagesToPdf(pages) {
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (id, body, stream) => {
    offs[id] = len;
    if (stream) { push(`${id} 0 obj\n${body}\nstream\n`); push(stream); push('\nendstream\nendobj\n'); }
    else push(`${id} 0 obj\n${body}\nendobj\n`);
  };
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // %PDF-1.4 + 이진 표시
  const n = pages.length, pageId = k => 3 + k * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, k) => `${pageId(k)} 0 R`).join(' ')}] >>`);
  pages.forEach((p, k) => {
    const id = pageId(k), pw = p.pw.toFixed(2), ph = p.ph.toFixed(2);
    const content = enc.encode(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, `<< /Length ${content.length} >>`, content);
    obj(id + 2, `<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>`, p.jpg);
  });
  const size = 3 + n * 3, xref = len;
  let xr = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) xr += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
  push(xr + `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
/**
 * 악보 파일(PDF · 사진 · 한글) → PDF 파일
 * → { file: PDF File, kind: 'pdf'|'image'|'hwp', pages, skipped }  (못 바꾸면 error)
 */
async function scoreSourceToPdf(file) {
  const name = file.name || 'score';
  if (/\.pdf$/i.test(name)) return { file, kind: 'pdf' };
  const base = name.replace(/\.[^.]+$/, '');
  let blobs, kind;
  if (SCORE_IMG_EXT.test(name)) { blobs = [file]; kind = 'image'; }
  else if (SCORE_DOC_EXT.test(name)) {
    kind = 'hwp';
    try { blobs = (await hwpImages(file)).map(x => x.blob); }
    catch (e) { console.error(e); return { error: 'hwpRead', kind }; }
    if (!blobs.length) return { error: 'hwpNoImage', kind };
  } else return { error: 'type' };
  const r = await imagesToPdf(blobs);
  if (!r.blob) return { error: kind === 'hwp' ? 'hwpNoImage' : 'image', kind, skipped: r.skipped };
  return { file: new File([r.blob], base + '.pdf', { type: 'application/pdf' }), kind, pages: r.pages, skipped: r.skipped, srcName: name };
}
