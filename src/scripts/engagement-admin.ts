const root = document.querySelector<HTMLElement>('[data-engagement-admin]');
if (root?.dataset.api && root.querySelector('[data-admin-login]')) {
  const base = root.dataset.api.replace(/\/$/, '');
  const loginForm = root.querySelector<HTMLFormElement>('[data-admin-login]')!;
  const content = root.querySelector<HTMLElement>('[data-admin-content]')!;
  const status = root.querySelector<HTMLElement>('[data-admin-status]')!;
  const analytics = root.querySelector<HTMLElement>('[data-analytics-panel]')!;
  const commentsPanel = root.querySelector<HTMLElement>('[data-admin-comments-panel]')!;
  const commentList = root.querySelector<HTMLElement>('[data-admin-comments]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-admin-more]')!;
  const days = root.querySelector<HTMLSelectElement>('[data-analytics-days]')!;
  const summary = root.querySelector<HTMLElement>('[data-analytics-summary]')!;
  const tables = root.querySelector<HTMLElement>('[data-analytics-tables]')!;
  let token = ''; let expiry: ReturnType<typeof setTimeout> | undefined;
  let view = root.dataset.initialView || 'analytics'; let next: number | null = null;
  let comments: any[] = [];
  const message = (value: string) => { status.textContent = value; };
  function clearSession() { token = ''; clearTimeout(expiry); loginForm.hidden = false; content.hidden = true; comments = []; summary.replaceChildren(); tables.replaceChildren(); commentList.replaceChildren(); }
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(base + path, { ...init, credentials: 'omit', signal: AbortSignal.timeout(12000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
    const data = await response.json();
    if (!response.ok) { if (response.status === 401) clearSession(); throw new Error(data.error || 'Tidak dapat memuatkan data.'); }
    return data;
  }
  function table(title: string, headings: string[], rows: unknown[][]) {
    const heading = document.createElement('h2'); heading.textContent = title; tables.append(heading);
    if (!rows.length) { const empty = document.createElement('p'); empty.textContent = 'Belum ada data untuk tempoh ini.'; tables.append(empty); return; }
    const wrap = document.createElement('div'); wrap.className = 'table-wrap'; const table = document.createElement('table');
    const head = document.createElement('thead'); const line = document.createElement('tr');
    for (const label of headings) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; line.append(cell); }
    head.append(line); table.append(head); const body = document.createElement('tbody');
    for (const values of rows) { const row = document.createElement('tr'); for (const value of values) { const cell = document.createElement('td'); cell.textContent = String(value ?? '—'); row.append(cell); } body.append(row); }
    table.append(body); wrap.append(table); tables.append(wrap);
  }
  async function loadAnalytics() {
    message('Memuatkan analitik…');
    try {
      const data = await request(`/v1/admin/analytics?days=${days.value}`); const s = data.summary;
      summary.replaceChildren(); tables.replaceChildren();
      for (const [label, value] of [['Page views', s.pageViews], ['Anggaran pelawat unik', s.visitors], ['Sesi lawatan', s.sessions], ['Sesi engaged', s.engagedSessions], ['Kadar engagement', `${s.engagementRate}%`], ['Purata aktif / halaman', `${s.averageSeconds}s`]]) {
        const box = document.createElement('div'); box.className = 'metric'; const small = document.createElement('small'); small.textContent = String(label); const strong = document.createElement('strong'); strong.textContent = typeof value === 'number' ? value.toLocaleString() : String(value); box.append(small, strong); summary.append(box);
      }
      table('Halaman popular', ['Halaman', 'Views', 'Pelawat', 'Purata aktif', 'Purata scroll', 'Scroll ≥90%'], data.pages.map((p: any) => [p.path, p.views, p.visitors, `${p.averageSeconds}s`, `${p.averageScroll}%`, p.deepReads]));
      table('Sumber trafik', ['Sumber', 'Sesi'], data.sources.map((s: any) => [s.source, s.sessions]));
      table('Klik utama', ['Tindakan', 'Destinasi dalaman', 'Klik'], data.clicks.map((s: any) => [s.action, s.target || '—', s.clicks]));
      table('Kempen UTM', ['Sumber', 'Medium', 'Kempen', 'Sesi'], data.campaigns.map((s: any) => [s.source || '—', s.medium || '—', s.campaign || '—', s.sessions]));
      table('Peranti', ['Jenis', 'Views'], data.devices.map((s: any) => [s.device, s.views]));
      table('Trend harian', ['Tarikh Malaysia', 'Views', 'Pelawat'], data.daily.map((s: any) => [s.date, s.views, s.visitors]));
      message('Dikemas kini: ' + new Date(data.generatedAt).toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' }));
    } catch (error: any) { message(error.message); }
  }
  function renderComments() {
    commentList.replaceChildren();
    for (const c of comments) {
      const box = document.createElement('article'); box.className = 'admin-comment';
      const name = document.createElement('strong'); name.textContent = c.name;
      const metadata = document.createElement('small'); metadata.textContent = new Date(c.createdAt).toLocaleString('ms-MY');
      const email = document.createElement('small'); email.textContent = `Emel peribadi: ${c.email || 'Tidak diberikan'}`;
      const link = document.createElement('a'); link.href = `/artikel/${encodeURIComponent(c.slug)}/#comments`; link.textContent = c.slug.replaceAll('-', ' ');
      const body = document.createElement('p'); body.textContent = c.body;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Padam komen';
      remove.addEventListener('click', async () => {
        if (!confirm('Padam komen ini? Nama, emel dan teks komen akan dibuang daripada senarai.')) return;
        remove.disabled = true;
        try { await request(`/v1/admin/comments/${c.id}`, { method: 'DELETE' }); comments = comments.filter(x => x.id !== c.id); renderComments(); message('Komen dipadam.'); }
        catch (error: any) { remove.disabled = false; message(error.message); }
      });
      box.append(name, metadata, email, link, body, remove); commentList.append(box);
    }
  }
  async function loadComments(append = false) {
    more.disabled = true; message('Memuatkan komen…');
    try { const data = await request('/v1/admin/comments' + (append && next ? `?before=${next}` : '')); comments = append ? [...comments, ...data.comments] : data.comments; next = data.next; more.hidden = next === null; renderComments(); message(comments.length ? '' : 'Belum ada komen.'); }
    catch (error: any) { message(error.message); }
    finally { more.disabled = false; }
  }
  function setView(value: string) {
    view = value; analytics.hidden = view !== 'analytics'; commentsPanel.hidden = view !== 'comments';
    for (const button of root!.querySelectorAll<HTMLButtonElement>('[data-admin-tab]')) button.setAttribute('aria-pressed', String(button.dataset.adminTab === view));
    if (token) { if (view === 'analytics') loadAnalytics(); else loadComments(); }
  }
  loginForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = loginForm.querySelector<HTMLButtonElement>('button')!; const password = loginForm.elements.namedItem('password') as HTMLInputElement; button.disabled = true;
    try { const data = await request('/v1/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) }); token = data.token; password.value = ''; loginForm.hidden = true; content.hidden = false; expiry = setTimeout(() => { clearSession(); message('Sesi tamat. Log masuk semula.'); }, Math.max(0, data.expiresAt - Date.now())); setView(view); }
    catch (error: any) { message(error.message); } finally { button.disabled = false; }
  });
  root.querySelector('[data-admin-logout]')!.addEventListener('click', async () => { try { await request('/v1/admin/logout', { method: 'POST' }); } catch {} clearSession(); message('Log keluar.'); });
  root.querySelector('[data-refresh-analytics]')!.addEventListener('click', loadAnalytics); days.addEventListener('change', loadAnalytics);
  more.addEventListener('click', () => loadComments(true));
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-admin-tab]')) button.addEventListener('click', () => setView(button.dataset.adminTab!));
  setView(view);
}
export {};
