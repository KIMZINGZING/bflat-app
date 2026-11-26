'use strict';
/* ===== BFlat Studio — 회원 가입 · 로그인 (이메일 + 비밀번호 · 이메일 인증) =====
 * Firebase Authentication 의 REST 주소를 바로 불러요 (따로 받을 프로그램 없음 · PC 프로그램 · 안드로이드 앱 · 아이폰 웹 앱 똑같이)
 *  - 처음 켤 때: 회원 가입 → 입력한 주소로 인증 메일 → 메일의 링크를 누르면 가입 완료 → 바로 시작
 *  - 한 번 로그인하면 이 기기에 기억해요 → 다음부터는 바로 시작 (인터넷이 없어도 돼요)
 *  - 설정 → 계정: 로그아웃 · 비밀번호 바꾸기(메일) · 회원 탈퇴
 * 설정은 js/auth-config.js (apiKey 가 비어 있으면 가입 없이 바로 써요)
 */
const Auth = {
  KEY: 'bflat.auth',
  key() { return (window.BFLAT_AUTH && window.BFLAT_AUTH.apiKey || '').trim(); },
  on() { return !!this.key(); },
  get() { try { const a = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return a && a.email && a.refreshToken ? a : null; } catch (e) { return null; } },
  set(a) {
    try {
      const keep = a || this.get();
      if (keep && keep.email) localStorage.setItem(this.KEY + '.last', keep.email);
      if (a) localStorage.setItem(this.KEY, JSON.stringify(a)); else localStorage.removeItem(this.KEY);
    } catch (e) { }
  },
  /** 로그아웃한 뒤에도 로그인 칸에 넣어 둘 마지막 이메일 */
  lastEmail() { const a = this.get(); if (a) return a.email; try { return localStorage.getItem(this.KEY + '.last') || ''; } catch (e) { return ''; } },
  lang() { const l = (window.App && App.settings && App.settings.lang) || 'ko'; return /^(en|ja)$/.test(l) ? l : 'ko'; },

  /** Firebase 부르기 → 성공 { ...응답 } · 실패 { error: 'EMAIL_EXISTS' 같은 이름 } */
  async call(path, body, base) {
    const headers = { 'Content-Type': 'application/json', 'X-Firebase-Locale': this.lang() };   // 인증 메일도 화면 언어로
    let res;
    try {
      res = await fetch(`${base || 'https://identitytoolkit.googleapis.com/v1/'}${path}?key=${encodeURIComponent(this.key())}`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    } catch (e) { return { error: 'NETWORK' }; }
    let data = {}; try { data = await res.json(); } catch (e) { }
    if (!res.ok) {
      const m = (data.error && data.error.message) || ('HTTP_' + res.status);
      return { error: /API key not valid/i.test(m) ? 'BAD_API_KEY' : m.split(/[ :]/)[0] };
    }
    return data;
  },
  signUp(email, password) { return this.call('accounts:signUp', { email, password, returnSecureToken: true }); },
  signIn(email, password) { return this.call('accounts:signInWithPassword', { email, password, returnSecureToken: true }); },
  sendVerify(idToken) { return this.call('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken }); },
  sendReset(email) { return this.call('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email }); },
  async lookup(idToken) { const r = await this.call('accounts:lookup', { idToken }); return r.error ? r : ((r.users || [])[0] || { error: 'USER_NOT_FOUND' }); },
  deleteAccount(idToken) { return this.call('accounts:delete', { idToken }); },
  /** 기억해 둔 열쇠(refreshToken)로 새 출입증(idToken) 받기 */
  async refresh(refreshToken) {
    let res;
    try {
      res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.key())}`, { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) });
    } catch (e) { return { error: 'NETWORK' }; }
    let d = {}; try { d = await res.json(); } catch (e) { }
    if (!res.ok) return { error: ((d.error && d.error.message) || 'HTTP_' + res.status).split(/[ :]/)[0] };
    return { idToken: d.id_token, refreshToken: d.refresh_token, localId: d.user_id };
  },

  errText(code) {
    const t = {
      EMAIL_EXISTS: LG('이미 가입한 이메일이에요 · "로그인"에서 들어가 주세요 (인증을 아직 안 했으면 로그인하면 인증 메일을 다시 보낼 수 있어요)', 'This email is already registered · please log in (if you have not verified yet, log in to resend the email)', 'このメールは登録済みです · ログインしてください (未認証ならログイン後に認証メールを再送できます)'),
      INVALID_EMAIL: LG('이메일 주소가 올바르지 않아요', 'The email address is not valid', 'メールアドレスが正しくありません'),
      MISSING_EMAIL: LG('이메일을 넣어 주세요', 'Enter your email', 'メールアドレスを入れてください'),
      WEAK_PASSWORD: LG('비밀번호가 너무 짧아요 (8자 이상)', 'Password is too short (8+ characters)', 'パスワードが短すぎます (8文字以上)'),
      MISSING_PASSWORD: LG('비밀번호를 넣어 주세요', 'Enter your password', 'パスワードを入れてください'),
      EMAIL_NOT_FOUND: LG('이메일 또는 비밀번호가 맞지 않아요', 'Wrong email or password', 'メールアドレスまたはパスワードが違います'),
      INVALID_PASSWORD: LG('이메일 또는 비밀번호가 맞지 않아요', 'Wrong email or password', 'メールアドレスまたはパスワードが違います'),
      INVALID_LOGIN_CREDENTIALS: LG('이메일 또는 비밀번호가 맞지 않아요 (아직 가입하지 않았다면 "회원 가입"으로)', 'Wrong email or password (not registered yet? use "Sign up")', 'メールアドレスまたはパスワードが違います (未登録なら「会員登録」へ)'),
      USER_DISABLED: LG('사용이 정지된 계정이에요', 'This account has been disabled', 'このアカウントは停止されています'),
      USER_NOT_FOUND: LG('계정을 찾을 수 없어요 (탈퇴했거나 지워진 계정)', 'Account not found (deleted)', 'アカウントが見つかりません (削除済み)'),
      TOO_MANY_ATTEMPTS_TRY_LATER: LG('너무 여러 번 시도했어요 · 잠시 뒤에 다시 해 주세요', 'Too many attempts · please try again later', '試行回数が多すぎます · しばらくしてからお試しください'),
      NETWORK: LG('인터넷에 연결할 수 없어요 · 처음 가입·로그인할 때는 인터넷이 필요해요', 'No internet · signing up or logging in needs the internet', 'インターネットに接続できません · 登録・ログインにはインターネットが必要です'),
      OPERATION_NOT_ALLOWED: LG('회원 가입 서버 설정이 아직 안 됐어요 (Firebase에서 이메일/비밀번호 로그인을 켜 주세요)', 'Sign-up is not enabled on the server (enable Email/Password in Firebase)', '登録サーバーの設定がまだです (FirebaseでEmail/Passwordを有効に)'),
      PASSWORD_LOGIN_DISABLED: LG('회원 가입 서버 설정이 아직 안 됐어요 (Firebase에서 이메일/비밀번호 로그인을 켜 주세요)', 'Sign-up is not enabled on the server (enable Email/Password in Firebase)', '登録サーバーの設定がまだです (FirebaseでEmail/Passwordを有効に)'),
      BAD_API_KEY: LG('회원 가입 서버 주소(API 키)가 맞지 않아요', 'The sign-up server key (API key) is wrong', '登録サーバーのキー(APIキー)が正しくありません'),
      CREDENTIAL_TOO_OLD_LOGIN_AGAIN: LG('보안을 위해 비밀번호를 다시 넣어 주세요', 'For security, enter your password again', 'セキュリティのため、パスワードをもう一度入れてください'),
    }[code];
    return t || LG('잠시 문제가 생겼어요', 'Something went wrong', '問題が発生しました') + ` (${code})`;
  },

  /* ---------- 시작할 때: 로그인돼 있으면 바로 next() · 아니면 가입·로그인 화면 ---------- */
  gate(next) {
    if (!this.on()) { next(); return; }
    const a = this.get();
    if (a && a.verified) { next(); this.recheck(); return; }    // 인터넷이 없어도 바로 시작 · 뒤에서 계정 확인
    this.show(a ? 'verify' : 'signup', next);
  },
  /** 뒤에서 조용히: 계정이 지워졌거나 정지됐으면 로그아웃 (인터넷이 없으면 그냥 두기) */
  async recheck() {
    const a = this.get(); if (!a) return;
    const r = await this.refresh(a.refreshToken);
    if (r.error) {
      if (/^(USER_NOT_FOUND|USER_DISABLED|INVALID_REFRESH_TOKEN|TOKEN_EXPIRED)$/.test(r.error)) {
        this.set(null);
        this.show('login', null, this.errText(r.error === 'USER_DISABLED' ? 'USER_DISABLED' : 'USER_NOT_FOUND'));
      }
      return;
    }
    this.set(Object.assign({}, a, { refreshToken: r.refreshToken, checked: Date.now() }));
  },

  /* ---------- 화면 ---------- */
  root: null, next: null, timer: 0, pending: null,
  show(view, next, msg) {
    if (next !== undefined && next !== null) this.next = next;
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = 'authRoot';
      // 이 화면에서 누른 키가 악보 편집 단축키로 가지 않게
      this.root.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const b = this.root.querySelector('[data-go]'); if (b) { e.preventDefault(); b.click(); } } });
      this.root.addEventListener('mousedown', e => e.stopPropagation());
      document.body.appendChild(this.root);
    }
    document.body.classList.add('auth-open');
    clearInterval(this.timer);
    this['v_' + view](msg);
    const ins = [...this.root.querySelectorAll('input:not([type=checkbox])')];
    const f = ins.find(i => !i.value) || ins[0]; if (f && !('ontouchstart' in window)) f.focus();
  },
  done() {
    clearInterval(this.timer);
    if (this.root) { this.root.remove(); this.root = null; }
    document.body.classList.remove('auth-open');
    const n = this.next; this.next = null;
    if (n) n();
  },
  frame(title, body) {
    this.root.innerHTML = `<div class="auth-card">
      <div class="auth-logo"><img src="assets/logo.svg" alt=""><b>BFlat Studio</b></div>
      <h2>${title}</h2>${body}</div>`;
  },
  msg(t, bad) { const m = this.root && this.root.querySelector('.auth-msg'); if (m) { m.textContent = t || ''; m.classList.toggle('bad', !!bad); } },
  busy(on) { if (!this.root) return; this.root.querySelectorAll('button,input').forEach(x => { x.disabled = !!on; }); },
  val(id) { const e = this.root.querySelector('#' + id); return e ? e.value.trim() : ''; },

  v_signup(m) {
    this.frame(LG('회원 가입', 'Sign up', '会員登録'), `
      <p class="auth-sub">${LG('이메일과 비밀번호만 있으면 돼요. 가입하면 입력한 이메일로 <b>인증 메일</b>이 가요.', 'Just an email and a password. We will send a <b>verification email</b>.', 'メールアドレスとパスワードだけでOK。登録すると<b>認証メール</b>が届きます。')}</p>
      <label class="fld">${LG('이메일', 'Email', 'メールアドレス')}<input class="inp" id="aEmail" type="email" autocomplete="email" inputmode="email" spellcheck="false" placeholder="name@example.com"></label>
      <label class="fld">${LG('비밀번호 (8자 이상)', 'Password (8+ characters)', 'パスワード (8文字以上)')}<span class="auth-pw"><input class="inp" id="aPw" type="password" autocomplete="new-password"><button type="button" class="btn" data-eye>👁</button></span></label>
      <label class="fld">${LG('비밀번호 확인', 'Confirm password', 'パスワード確認')}<input class="inp" id="aPw2" type="password" autocomplete="new-password"></label>
      <label class="chk auth-agree"><input type="checkbox" id="aAgree"> <span>${LG('<b>(필수)</b> 개인정보 수집·이용에 동의해요', '<b>(Required)</b> I agree to the collection and use of personal data', '<b>(必須)</b> 個人情報の収集・利用に同意します')} <a href="#" data-privacy>${LG('내용 보기', 'Details', '内容')}</a></span></label>
      <div class="auth-privacy" hidden>${LG('수집 항목: 이메일 주소 · 쓰는 곳: 회원 확인, 로그인, 비밀번호 찾기 · 보관: 회원 탈퇴할 때까지 (설정 → 계정 → 회원 탈퇴로 바로 지워져요) · 계정 정보는 Google Firebase에 안전하게 저장돼요. 비밀번호는 암호화되어 아무도 볼 수 없어요. 악보는 이 기기에만 저장돼요. 동의하지 않으면 가입할 수 없어요.',
        'Collected: email address · Used for: account check, login, password reset · Kept until you delete your account (Settings → Account → Delete account) · Account data is stored securely by Google Firebase; passwords are encrypted and nobody can read them. Your scores stay on this device. You cannot sign up without agreeing.',
        '収集項目: メールアドレス · 利用目的: 会員確認・ログイン・パスワード再設定 · 保管: 退会まで (設定 → アカウント → 退会ですぐ削除) · アカウント情報はGoogle Firebaseに安全に保存され、パスワードは暗号化されて誰にも見えません。楽譜はこの端末にだけ保存されます。同意しないと登録できません。')}</div>
      <p class="auth-msg"></p>
      <button class="btn primary auth-go" data-go>${LG('가입하고 인증 메일 받기', 'Sign up & send email', '登録して認証メールを受け取る')}</button>
      <p class="auth-alt">${LG('이미 계정이 있나요?', 'Already have an account?', 'アカウントをお持ちですか?')} <a href="#" data-view="login">${LG('로그인', 'Log in', 'ログイン')}</a></p>`);
    this.common(m);
    this.root.querySelector('[data-privacy]').addEventListener('click', e => { e.preventDefault(); const p = this.root.querySelector('.auth-privacy'); p.hidden = !p.hidden; });
    this.root.querySelector('[data-go]').addEventListener('click', async () => {
      const email = this.val('aEmail'), pw = this.root.querySelector('#aPw').value, pw2 = this.root.querySelector('#aPw2').value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return this.msg(this.errText('INVALID_EMAIL'), true);
      if (pw.length < 8) return this.msg(this.errText('WEAK_PASSWORD'), true);
      if (pw !== pw2) return this.msg(LG('비밀번호 두 칸이 서로 달라요', 'The two passwords do not match', 'パスワードが一致しません'), true);
      if (!this.root.querySelector('#aAgree').checked) return this.msg(LG('개인정보 수집·이용에 동의해야 가입할 수 있어요', 'Please agree to the privacy terms to sign up', '個人情報の収集・利用に同意してください'), true);
      this.busy(true); this.msg(LG('가입하는 중…', 'Signing up…', '登録中…'));
      const r = await this.signUp(email, pw);
      if (r.error) { this.busy(false); return this.msg(this.errText(r.error), true); }
      const s = await this.sendVerify(r.idToken);
      this.pending = { email: r.email || email, uid: r.localId, idToken: r.idToken, refreshToken: r.refreshToken, at: Date.now() };
      this.set({ email: this.pending.email, uid: r.localId, refreshToken: r.refreshToken, verified: false, agreedAt: Date.now() });
      this.show('verify', null, s.error ? this.errText(s.error) : '');
    });
  },

  v_login(m) {
    this.frame(LG('로그인', 'Log in', 'ログイン'), `
      <label class="fld">${LG('이메일', 'Email', 'メールアドレス')}<input class="inp" id="aEmail" type="email" autocomplete="email" inputmode="email" spellcheck="false" value="${esc(this.lastEmail())}"></label>
      <label class="fld">${LG('비밀번호', 'Password', 'パスワード')}<span class="auth-pw"><input class="inp" id="aPw" type="password" autocomplete="current-password"><button type="button" class="btn" data-eye>👁</button></span></label>
      <p class="auth-msg"></p>
      <button class="btn primary auth-go" data-go>${LG('로그인', 'Log in', 'ログイン')}</button>
      <p class="auth-alt"><a href="#" data-reset>${LG('비밀번호를 잊었어요', 'Forgot password?', 'パスワードを忘れた')}</a> · <a href="#" data-view="signup">${LG('회원 가입', 'Sign up', '会員登録')}</a></p>`);
    this.common(m);
    this.root.querySelector('[data-reset]').addEventListener('click', async e => {
      e.preventDefault();
      const email = this.val('aEmail');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return this.msg(LG('먼저 이메일을 넣고 다시 눌러 주세요', 'Enter your email first, then press again', '先にメールアドレスを入れてからもう一度押してください'), true);
      this.busy(true);
      const r = await this.sendReset(email);
      this.busy(false);
      // 가입하지 않은 주소여도 똑같이 알려요 (다른 사람이 가입 여부를 알아내지 못하게)
      if (r.error && r.error !== 'EMAIL_NOT_FOUND') return this.msg(this.errText(r.error), true);
      this.msg(LG(`${email} 로 비밀번호 바꾸기 메일을 보냈어요 (가입한 주소라면) · 메일의 링크에서 새 비밀번호를 정한 다음 여기서 로그인해요`, `If ${email} is registered, a password reset email is on its way · set a new password from the link, then log in here`, `${email} が登録済みなら、パスワード再設定メールを送りました · リンクで新しいパスワードを決めてからログインしてください`));
    });
    this.root.querySelector('[data-go]').addEventListener('click', async () => {
      const email = this.val('aEmail'), pw = this.root.querySelector('#aPw').value;
      if (!email) return this.msg(this.errText('MISSING_EMAIL'), true);
      if (!pw) return this.msg(this.errText('MISSING_PASSWORD'), true);
      this.busy(true); this.msg(LG('로그인하는 중…', 'Logging in…', 'ログイン中…'));
      const r = await this.signIn(email, pw);
      if (r.error) { this.busy(false); return this.msg(this.errText(r.error), true); }
      const u = await this.lookup(r.idToken);
      if (u.error) { this.busy(false); return this.msg(this.errText(u.error), true); }
      const acc = { email: r.email || email, uid: r.localId, refreshToken: r.refreshToken, verified: !!u.emailVerified, agreedAt: (this.get() || {}).agreedAt || Date.now() };
      this.set(acc);
      if (acc.verified) { this.welcome(LG('로그인했어요', 'Logged in', 'ログインしました')); return; }
      this.pending = { email: acc.email, uid: acc.uid, idToken: r.idToken, refreshToken: r.refreshToken, at: Date.now() };
      this.show('verify', null, LG('이메일 인증을 아직 안 했어요 · 메일함을 확인하거나 아래에서 다시 보내 주세요', 'Your email is not verified yet · check your inbox or resend below', 'メール認証がまだです · 受信箱を確認するか下から再送してください'));
    });
  },

  v_verify(m) {
    const a = this.get() || {};
    const email = (this.pending && this.pending.email) || a.email || '';
    this.frame(LG('이메일 인증', 'Verify your email', 'メール認証'), `
      <div class="auth-mail">✉️</div>
      <p class="auth-sub">${LG(`<b data-notr>${esc(email)}</b> 로 인증 메일을 보냈어요.<br>메일을 열고 <b>링크를 누르면 가입이 끝나요.</b> 이 화면은 저절로 넘어가요.`, `We sent a verification email to <b data-notr>${esc(email)}</b>.<br><b>Open it and tap the link</b> to finish. This screen continues by itself.`, `<b data-notr>${esc(email)}</b> に認証メールを送りました。<br>メールを開いて<b>リンクを押すと登録完了</b>です。この画面は自動で進みます。`)}</p>
      <p class="auth-hint">${LG('메일이 안 보이면 <b>스팸함·프로모션함</b>도 확인해 주세요. 보낸 곳: noreply@…firebaseapp.com', 'No email? Check your <b>spam / promotions</b> folder. Sender: noreply@…firebaseapp.com', 'メールが見当たらない場合は<b>迷惑メール</b>も確認してください。送信元: noreply@…firebaseapp.com')}</p>
      <p class="auth-msg"></p>
      <button class="btn primary auth-go" data-go>${LG('인증했어요 · 확인하기', 'I verified · check now', '認証しました · 確認する')}</button>
      <div class="auth-row"><button class="btn" data-resend>${LG('메일 다시 보내기', 'Resend email', 'メールを再送')}</button><button class="btn" data-other>${LG('다른 이메일로', 'Use another email', '別のメールで')}</button></div>`);
    this.common(m);
    const check = async quiet => {
      const tok = await this.idToken(); if (tok.error) { if (!quiet) this.msg(this.errText(tok.error), true); return; }
      const u = await this.lookup(tok.idToken);
      if (u.error) { if (!quiet) this.msg(this.errText(u.error), true); return; }
      if (u.emailVerified) {
        this.set(Object.assign({}, this.get(), { verified: true, verifiedAt: Date.now() }));
        this.pending = null;
        this.welcome(LG('가입이 끝났어요 🎉 환영해요!', 'You are all set 🎉 Welcome!', '登録完了 🎉 ようこそ!'));
      } else if (!quiet) this.msg(LG('아직 인증 전이에요 · 메일의 링크를 누른 다음 다시 눌러 주세요', 'Not verified yet · tap the link in the email, then try again', 'まだ認証されていません · メールのリンクを押してからもう一度'), true);
    };
    this.root.querySelector('[data-go]').addEventListener('click', () => check(false));
    this.root.querySelector('[data-resend]').addEventListener('click', async () => {
      const tok = await this.idToken(); if (tok.error) return this.msg(this.errText(tok.error), true);
      const r = await this.sendVerify(tok.idToken);
      this.msg(r.error ? this.errText(r.error) : LG('다시 보냈어요 · 가장 최근 메일의 링크를 눌러 주세요', 'Sent again · use the link in the newest email', '再送しました · 最新のメールのリンクを押してください'), !!r.error);
    });
    this.root.querySelector('[data-other]').addEventListener('click', () => { this.set(null); this.pending = null; this.show('signup'); });
    // 메일 앱에 갔다 돌아오면 · 5초마다 저절로 확인
    this.timer = setInterval(() => { if (!document.hidden) check(true); }, 5000);
    if (!this._vis) { this._vis = true; document.addEventListener('visibilitychange', () => { if (!document.hidden && this.root && this.root.querySelector('[data-resend]')) check(true); }); }
  },
  /** 인증 확인에 쓸 출입증 (가입 직후 받은 것 → 없으면 기억한 열쇠로 새로) */
  async idToken(fresh) {
    if (!fresh && this.pending && this.pending.idToken && Date.now() - (this.pending.at || 0) < 50 * 60000) return { idToken: this.pending.idToken };   // 출입증은 1시간짜리
    const a = this.get(); if (!a) return { error: 'USER_NOT_FOUND' };
    const r = await this.refresh(a.refreshToken);
    if (r.error) return r;
    this.set(Object.assign({}, a, { refreshToken: r.refreshToken }));
    this.pending = Object.assign({}, this.pending || { email: a.email }, { idToken: r.idToken, at: Date.now() });
    return { idToken: r.idToken };
  },
  welcome(text) {
    clearInterval(this.timer);
    this.frame(text, `<p class="auth-sub" data-notr>${esc((this.get() || {}).email || '')}</p><button class="btn primary auth-go" data-go>${LG('시작하기', 'Start', 'はじめる')}</button>`);
    this.root.querySelector('[data-go]').addEventListener('click', () => this.done());
    setTimeout(() => { if (this.root && this.root.querySelector('[data-go]')) this.done(); }, 1600);
  },
  common(m) {
    if (m) this.msg(m, true);
    this.root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); this.show(b.dataset.view); }));
    this.root.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => {
      this.root.querySelectorAll('#aPw,#aPw2').forEach(i => { i.type = i.type === 'password' ? 'text' : 'password'; });
    }));
  },

  /* ---------- 설정 → 계정 ---------- */
  pane(el) {
    if (!this.on()) { el.innerHTML = `<p class="muted">${LG('회원 가입 기능이 꺼져 있어요 (설정 파일 js/auth-config.js).', 'Accounts are turned off (js/auth-config.js).', 'アカウント機能はオフです (js/auth-config.js)。')}</p>`; return; }
    const a = this.get();
    el.innerHTML = `<div class="pl-box">
      <div>${LG('로그인한 계정', 'Signed in as', 'ログイン中のアカウント')}: <b data-notr>${esc(a ? a.email : '-')}</b> ${a && a.verified ? '✓' : ''}</div>
      <p class="muted small">${LG('악보는 이 기기에 저장돼요. 계정은 이 앱을 쓰는 사람을 확인하는 데만 써요.', 'Scores are saved on this device. The account is only used to identify you.', '楽譜はこの端末に保存されます。アカウントは利用者の確認にだけ使います。')}</p>
      <div class="row2"><button class="btn" id="acReset">${LG('비밀번호 바꾸기 (메일로)', 'Change password (by email)', 'パスワード変更 (メールで)')}</button><button class="btn" id="acOut">${LG('로그아웃', 'Log out', 'ログアウト')}</button></div>
      <details style="margin-top:12px"><summary class="small">${LG('회원 탈퇴', 'Delete account', '退会')}</summary>
        <p class="small muted">${LG('계정(이메일)이 바로 지워지고 되돌릴 수 없어요. 이 기기의 악보는 그대로 남아요. 확인을 위해 비밀번호를 넣어 주세요.', 'Your account (email) is deleted immediately and cannot be restored. Scores on this device stay. Enter your password to confirm.', 'アカウント(メール)はすぐ削除され、元に戻せません。この端末の楽譜は残ります。確認のためパスワードを入れてください。')}</p>
        <div class="row2"><input class="inp" id="acPw" type="password" autocomplete="current-password" placeholder="${LG('비밀번호', 'Password', 'パスワード')}"><button class="btn danger" id="acDel">${LG('탈퇴하기', 'Delete', '退会する')}</button></div>
      </details>
      <p class="small" id="acMsg"></p></div>`;
    const msg = (t, bad) => { const m = el.querySelector('#acMsg'); m.textContent = t; m.style.color = bad ? '#dc2626' : ''; };
    el.querySelector('#acReset').addEventListener('click', async () => {
      if (!a) return;
      const r = await this.sendReset(a.email);
      msg(r.error ? this.errText(r.error) : LG(`${a.email} 로 비밀번호 바꾸기 메일을 보냈어요`, `Password reset email sent to ${a.email}`, `${a.email} にパスワード再設定メールを送りました`), !!r.error);
    });
    el.querySelector('#acOut').addEventListener('click', () => {
      try { if (!App.blank) localStorage.setItem('bflat.autosave', JSON.stringify(App.s)); } catch (e) { }
      this.set(null); closeModal(); this.show('login', () => { });
    });
    el.querySelector('#acDel').addEventListener('click', async () => {
      if (!a) return;
      const pw = el.querySelector('#acPw').value;
      if (!pw) return msg(this.errText('MISSING_PASSWORD'), true);
      if (!confirm(LG('정말 탈퇴할까요? 계정이 바로 지워지고 되돌릴 수 없어요.', 'Really delete your account? This cannot be undone.', '本当に退会しますか? 元に戻せません。'))) return;
      const s = await this.signIn(a.email, pw);
      if (s.error) return msg(this.errText(s.error), true);
      const d = await this.deleteAccount(s.idToken);
      if (d.error) return msg(this.errText(d.error), true);
      this.set(null); try { localStorage.removeItem(this.KEY + '.last'); } catch (e) { } closeModal();
      this.show('signup', () => { }, LG('탈퇴했어요 · 계정이 지워졌어요', 'Your account has been deleted', '退会しました · アカウントは削除されました'));
    });
  },
};
