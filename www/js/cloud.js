'use strict';
/* ===== BFlat Studio — 내 악보함 계정 연동 (PC · 휴대폰 · 태블릿) =====
 * 같은 계정으로 로그인한 기기끼리 "내 악보함"을 똑같이 맞춰요.
 *  - 저장소: Firebase Cloud Firestore (회원 가입과 같은 프로젝트) · users/{uid}/scores/{악보 id}
 *    악보는 기기에 저장하는 것과 똑같이 gzip으로 줄여서 올려요 (보통 수십 KB)
 *  - 규칙(서버): 로그인한 본인(uid)만 자기 악보를 읽고 쓸 수 있어요
 *  - 맞추는 법: 악보마다 마지막으로 바꾼 시각(updated)을 비교해 더 새것으로
 *      · 두 기기에서 따로 고쳤으면(둘 다 지난번 맞춘 뒤 바뀜) 둘 다 남겨요 — 이 기기 것은 그대로, 다른 기기 것은 "(다른 기기)" 사본으로
 *      · 지운 악보는 "지움 표시"를 남겨서 다른 기기에서도 지워요 (지운 뒤에 다른 기기에서 고친 악보는 살려요)
 *  - 언제: 켤 때 · 내 악보함 열 때 · 저장·지우기·이름 바꾸기 뒤 · 앱으로 돌아올 때 · 켜 둔 동안 3분마다
 *  - 인터넷이 없거나 서버 준비가 안 됐으면 조용히 건너뛰고, 내 악보함에 상태만 보여요
 * 이 기기에서 다른 계정으로 저장한 악보(owner 가 다른 것)는 올리지 않아요.
 */
const Cloud = {
  MAX: 1000000,                      // 악보 하나 최대 (줄인 크기) — Firestore 문서 한도 1MB
  status: { state: 'idle', at: 0, msg: '' },
  _run: null, _again: false, _t: 0,

  project() { return (window.BFLAT_AUTH && window.BFLAT_AUTH.projectId) || 'bflat-studio'; },
  acct() { if (typeof Auth === 'undefined' || !Auth.on()) return null; const a = Auth.get(); return a && a.verified && a.uid ? a : null; },
  uid() { const a = this.acct(); return a ? a.uid : ''; },
  enabled() { return !!this.acct() && !(typeof App !== 'undefined' && App.settings && App.settings.cloudSync === false); },
  base() { return `https://firestore.googleapis.com/v1/projects/${this.project()}/databases/(default)/documents/users/${this.uid()}/scores`; },

  /* ---------- 이 기기에 기억해 두는 것 (계정마다): 지난번 맞춘 시각 · 지운 악보 ---------- */
  memKey() { return 'bflat.cloud.' + this.uid(); },
  mem() { try { const m = JSON.parse(localStorage.getItem(this.memKey()) || '{}'); return { base: m.base || {}, tomb: m.tomb || {}, last: m.last || 0 }; } catch (e) { return { base: {}, tomb: {}, last: 0 }; } },
  saveMem(m) { try { localStorage.setItem(this.memKey(), JSON.stringify(m)); } catch (e) { } },
  markDeleted(id) { if (!this.uid()) return; const m = this.mem(); m.tomb[id] = Date.now(); this.saveMem(m); },

  /* ---------- 서버 부르기 ---------- */
  async req(method, url, body, retried) {
    const tok = await Auth.idToken(retried);
    if (tok.error) return { error: tok.error };
    let res;
    try {
      res = await fetch(url, { method, cache: 'no-store', headers: Object.assign({ Authorization: 'Bearer ' + tok.idToken }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (e) { return { error: 'NETWORK' }; }
    if (res.status === 401 && !retried) return this.req(method, url, body, true);    // 출입증이 만료됐으면 새로 받아서 한 번 더
    let data = {}; try { data = await res.json(); } catch (e) { }
    if (!res.ok) {
      const st = (data.error && data.error.status) || '';
      return { error: res.status === 404 && /database|does not exist/i.test((data.error && data.error.message) || '') ? 'NO_DB' : (st || 'HTTP_' + res.status), status: res.status, message: (data.error && data.error.message) || '' };
    }
    return data;
  },
  num(f) { return f ? +(f.integerValue || f.doubleValue || 0) : 0; },
  meta(doc) {
    const f = doc.fields || {};
    return { id: doc.name.split('/').pop(), name: (f.name && f.name.stringValue) || '', composer: f.composer ? (f.composer.stringValue || '') : undefined, measures: this.num(f.measures), updated: this.num(f.updated), size: this.num(f.size), deleted: !!(f.deleted && f.deleted.booleanValue) };
  },
  /** 서버의 악보 목록 (내용 빼고) */
  async list() {
    const out = {}; let page = '';
    const mask = ['name', 'composer', 'measures', 'updated', 'size', 'deleted'].map(k => 'mask.fieldPaths=' + k).join('&');
    for (let guard = 0; guard < 50; guard++) {
      const r = await this.req('GET', `${this.base()}?pageSize=300&${mask}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
      if (r.error) return r;
      (r.documents || []).forEach(d => { const m = this.meta(d); out[m.id] = m; });
      if (!r.nextPageToken) break;
      page = r.nextPageToken;
    }
    return { items: out };
  },
  async get(id) {
    const r = await this.req('GET', `${this.base()}/${encodeURIComponent(id)}`);
    if (r.error) return r;
    const m = this.meta(r); const f = r.fields || {};
    m.data = f.data && f.data.bytesValue ? b64ToBytes(f.data.bytesValue) : null;
    return m;
  },
  put(it, gz) {
    return this.req('PATCH', `${this.base()}/${encodeURIComponent(it.id)}`, { fields: {
      name: { stringValue: it.name || '' }, composer: { stringValue: it.composer || '' }, measures: { integerValue: String(it.measures || 0) }, updated: { integerValue: String(it.updated || Date.now()) },
      size: { integerValue: String(gz.length) }, deleted: { booleanValue: false }, data: { bytesValue: bytesToB64(gz) } } });
  },
  tomb(id, name, at) {
    return this.req('PATCH', `${this.base()}/${encodeURIComponent(id)}`, { fields: {
      name: { stringValue: name || '' }, updated: { integerValue: String(at) }, deleted: { booleanValue: true } } });
  },
  /** 회원 탈퇴할 때: 서버의 내 악보를 모두 지워요 */
  async wipe() {
    const l = await this.list(); if (l.error) return l;
    for (const id of Object.keys(l.items)) { const r = await this.req('DELETE', `${this.base()}/${encodeURIComponent(id)}`); if (r.error) return r; }
    try { localStorage.removeItem(this.memKey()); } catch (e) { }
    return { ok: true };
  },

  /* ---------- 맞추기 ---------- */
  /** 잠깐 뒤에 맞추기 (저장·지우기를 여러 번 해도 한 번만) */
  soon(ms) { if (!this.enabled()) return; clearTimeout(this._t); this._t = setTimeout(() => this.sync(), ms === undefined ? 800 : ms); },
  /** 맞추기 → { up, down, del, copies } · 이미 도는 중이면 끝난 뒤 한 번 더 */
  sync() {
    if (!this.enabled()) return Promise.resolve({ skipped: true });
    if (this._run) { this._again = true; return this._run; }
    this._run = (async () => {
      let r;
      do { this._again = false; r = await this._sync(); } while (this._again && !r.error);
      return r;
    })().finally(() => { this._run = null; });
    return this._run;
  },
  setStatus(state, msg) { this.status = { state, at: Date.now(), msg: msg || '' }; this.onStatus(); },
  onStatus() { const el = document.querySelector('.lib-cloud'); if (el) el.innerHTML = this.statusHtml(); },
  async _sync() {
    const uid = this.uid();
    this.setStatus('busy');
    const R = await this.list();
    if (R.error) { this.setStatus('error', R.error); return R; }
    const remote = R.items;
    const loc = await Lib.list();
    const mine = {}, others = new Set();
    loc.items.forEach(it => { if (!it.owner || it.owner === uid) mine[it.id] = it; else others.add(it.id); });
    const m = this.mem();
    const st = { up: 0, down: 0, del: 0, copies: 0, skipped: 0 };
    const changedOpen = [];
    const upload = async it => {
      const gz = await Lib.loadRaw(it.id); if (!gz) return;
      if (gz.length > this.MAX) { st.skipped++; return; }
      const w = await this.put(it, gz); if (w.error) throw w;
      if (!it.owner) await Lib.saveRaw({ name: it.name, measures: it.measures, updated: it.updated, owner: uid }, gz, it.id);   // 이 계정 악보로 표시
      m.base[it.id] = it.updated; st.up++;
    };
    const download = async (r, asId, name) => {
      const full = await this.get(r.id); if (full.error) throw full;
      if (!full.data) return;
      const w = await Lib.saveRaw({ name: name || full.name, composer: full.composer, measures: full.measures, updated: full.updated, owner: uid }, full.data, asId || r.id);
      if (w && w.error) throw w;
      if (!asId) { m.base[r.id] = full.updated; if (typeof App !== 'undefined' && App.libId === r.id) changedOpen.push(full.name); }
      st.down++;
      return w;
    };
    try {
      for (const id of Object.keys(remote)) {
        if (others.has(id)) continue;
        const r = remote[id], l = mine[id], b = m.base[id];
        if (r.deleted) {
          if (l && l.updated !== b) await upload(l);            // 다른 기기에서 지웠지만 이 기기에서 그 뒤에 고쳤으면 살려요
          else if (l) { await Lib.del(id, true); st.del++; if (typeof App !== 'undefined' && App.libId === id) App.libId = null; }
          delete m.base[id]; delete m.tomb[id];
          continue;
        }
        if (!l) {
          const t = m.tomb[id];
          // 이 기기에서 지웠어요 → 다른 기기에도 (지운 뒤에 다른 기기에서 고친 악보면 다시 받아요)
          if (t && (b !== undefined ? r.updated === b : r.updated <= t)) { const w = await this.tomb(id, r.name, Math.max(t, r.updated + 1)); if (w.error) throw w; st.del++; }
          else await download(r);
          delete m.tomb[id];
          continue;
        }
        if (l.updated === r.updated) { m.base[id] = r.updated; continue; }
        // 지난번 맞춘 뒤 어느 쪽이 바뀌었는지로 정해요 (기기 시계가 서로 달라도 안 틀리게)
        const localChanged = l.updated !== b, remoteChanged = r.updated !== b;
        if (b !== undefined && localChanged && remoteChanged) {
          // 두 기기에서 따로 고쳤어요 → 다른 기기 것은 사본으로 받고, 이 기기 것을 올려요 (아무것도 잃지 않게)
          const copyId = Math.random().toString(16).slice(2, 14);
          await download(r, copyId, `${r.name} (${LG('다른 기기', 'other device', '別の端末')})`);
          st.copies++; this._again = true;           // 받은 사본도 바로 올려요
          await upload(l);
        } else if (b !== undefined) { if (localChanged) await upload(l); else await download(r); }
        else if (l.updated > r.updated) await upload(l);
        else await download(r);
      }
      for (const id of Object.keys(mine)) if (!remote[id]) await upload(mine[id]);         // 아직 서버에 없는 악보
      for (const id of Object.keys(m.tomb)) if (!remote[id]) delete m.tomb[id];
    } catch (e) {
      m.last = m.last || 0; this.saveMem(m);
      const code = (e && e.error) || (e && e.message) || 'ERROR';
      this.setStatus('error', code);
      return { error: code };
    }
    m.last = Date.now(); this.saveMem(m);
    this.setStatus('ok', st.skipped ? LG(`${st.skipped}개는 너무 커서 올리지 못했어요`, `${st.skipped} too large to upload`, `${st.skipped}件は大きすぎて送れませんでした`) : '');
    if (st.down || st.del || st.copies) this.changed(st, changedOpen);
    return st;
  },
  /** 다른 기기에서 바뀐 게 있으면: 내 악보함이 열려 있으면 다시 그리고, 알려 줘요 */
  changed(st, openNames) {
    const box = document.querySelector('.lib-modal');
    if (box && typeof libraryDialog === 'function') libraryDialog(true);
    const parts = [];
    if (st.down) parts.push(LG(`${st.down}개 받음`, `${st.down} received`, `${st.down}件受信`));
    if (st.del) parts.push(LG(`${st.del}개 지움`, `${st.del} deleted`, `${st.del}件削除`));
    if (st.copies) parts.push(LG(`두 기기에서 고친 악보 ${st.copies}개는 사본으로 남겼어요`, `${st.copies} edited on two devices kept as copies`, `2台で編集された${st.copies}件はコピーとして残しました`));
    if (typeof toast === 'function') toast('☁ ' + LG('다른 기기와 맞췄어요', 'Synced with your other devices', '他の端末と同期しました') + ' · ' + parts.join(' · ') +
      (openNames.length ? ' · ' + LG('지금 연 악보가 다른 기기에서 바뀌었어요 — 내 악보함에서 다시 열면 새것이에요', 'the open score changed on another device — reopen it from My scores', '開いている楽譜が他の端末で変わりました — マイ楽譜から開き直してください') : ''), 5200);
  },
  statusHtml() {
    if (typeof Auth === 'undefined' || !Auth.on()) return '';
    if (!this.acct()) return `☁ ${LG('로그인하면 같은 계정의 PC·휴대폰·태블릿과 내 악보함이 연동돼요', 'Log in to sync My scores with your PC, phone and tablet', 'ログインするとPC・スマホ・タブレットとマイ楽譜が同期されます')}`;
    if (!this.enabled()) return `☁ ${LG('계정 연동이 꺼져 있어요 (설정 → 계정)', 'Sync is off (Settings → Account)', '同期はオフです (設定 → アカウント)')}`;
    const s = this.status;
    if (s.state === 'busy') return `☁ ${LG('다른 기기와 맞추는 중…', 'Syncing…', '同期中…')}`;
    if (s.state === 'error') {
      const why = s.msg === 'NETWORK' ? LG('인터넷 연결 없음 · 연결되면 저절로 맞춰요', 'no internet · will sync when online', 'インターネットなし · 接続されたら自動で同期')
        : /NO_DB|PERMISSION_DENIED|HTTP_403|HTTP_404|NOT_FOUND/.test(s.msg) ? LG('연동 서버가 아직 준비되지 않았어요', 'the sync server is not set up yet', '同期サーバーの準備がまだです')
        : /UNAUTHENTICATED|TOKEN|USER_NOT_FOUND|USER_DISABLED/.test(s.msg) ? LG('로그인이 풀렸어요 · 설정 → 계정에서 다시 로그인해 주세요', 'you were logged out · log in again in Settings → Account', 'ログインが切れました · 設定 → アカウントで再ログイン') : s.msg;
      return `☁ <span style="color:#dc2626">${LG('연동 안 됨', 'Not synced', '未同期')}</span> · ${esc(why)} <button class="btn" data-cloud-sync>${LG('다시', 'Retry', '再試行')}</button>`;
    }
    const m = this.mem();
    const when = m.last ? new Date(m.last).toLocaleTimeString(I18N.lang === 'ko' ? 'ko-KR' : I18N.lang === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    return `☁ ${LG('계정에 연동됨', 'Synced to your account', 'アカウントと同期済み')} <span data-notr>(${esc((this.acct() || {}).email || '')})</span>${when ? ' · ' + when : ''}${s.msg ? ' · ' + esc(s.msg) : ''} <button class="btn" data-cloud-sync>${LG('지금 맞추기', 'Sync now', '今すぐ同期')}</button>`;
  },
  /** 켤 때 한 번 부르기: 앱으로 돌아올 때 · 3분마다 */
  start() {
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-cloud-sync]')) this.sync(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - this.status.at > 60000) this.soon(300); });
    window.addEventListener('online', () => this.soon(500));
    setInterval(() => { if (!document.hidden) this.sync(); }, 3 * 60000);
    this.soon(1500);
  },
};
