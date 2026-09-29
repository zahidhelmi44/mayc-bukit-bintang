type Totals = { views: number; comments: number };
type Comment = { id: number; name: string; body: string; createdAt: number; slug?: string };
type GoogleAPI = { accounts: { id: { initialize(options: { client_id: string; callback: (data: { credential: string }) => void }): void; renderButton(element: HTMLElement, options: object): void; disableAutoSelect(): void } } };
declare global { interface Window { google?: GoogleAPI } }
const allStats = Array.from(document.querySelectorAll<HTMLElement>('[data-article-stats]'));
function updateStats(slug: string, totals: Totals) {
  for (const el of allStats.filter(el => el.dataset.articleStats === slug)) {
    const views = el.querySelector('[data-views]'); const comments = el.querySelector('[data-comment-count]');
    if (views) views.textContent = totals.views.toLocaleString();
    if (comments) comments.textContent = totals.comments.toLocaleString();
    el.removeAttribute('title');
  }
}
async function api(base: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, { ...init, credentials: 'omit', signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Please try again.'), { status: response.status });
  return data;
}
const groups = new Map<string, string[]>();
for (const el of allStats) {
  const base = el.dataset.engagementApi || ''; const slug = el.dataset.articleStats || '';
  if (base && slug) groups.set(base, [...new Set([...(groups.get(base) || []), slug])]);
}
for (const [base, slugs] of groups) {
  for (let i = 0; i < slugs.length; i += 50) {
    api(base, `/v1/stats?slugs=${encodeURIComponent(slugs.slice(i, i + 50).join(','))}`)
      .then(data => Object.entries(data.articles).forEach(([slug, totals]) => updateStats(slug, totals as Totals)))
      .catch(() => allStats.forEach(el => el.title = document.documentElement.lang.startsWith('en') ? 'Counts temporarily unavailable' : 'Jumlah belum dapat dimuatkan'));
  }
}
let googleLoader: Promise<GoogleAPI> | undefined;
function loadGoogle(): Promise<GoogleAPI> {
  if (window.google) return Promise.resolve(window.google);
  if (!googleLoader) googleLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timer = setTimeout(() => { script.remove(); googleLoader = undefined; reject(new Error('Google sign-in could not load. Please try again.')); }, 12000);
    script.onload = () => { clearTimeout(timer); if (window.google) resolve(window.google); else { googleLoader = undefined; reject(new Error('Google sign-in is unavailable.')); } };
    script.onerror = () => { clearTimeout(timer); script.remove(); googleLoader = undefined; reject(new Error('Google sign-in could not load. Please try again.')); };
    document.head.append(script);
  });
  return googleLoader;
}
for (const root of document.querySelectorAll<HTMLElement>('[data-comments-root]')) {
  const base = root.dataset.api || ''; const clientId = root.dataset.googleClient || ''; const slug = root.dataset.slug || '';
  const adminPage = root.dataset.admin === 'true'; const en = root.dataset.lang?.startsWith('en');
  const text = (ms: string, english: string) => en ? english : ms;
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const start = find<HTMLButtonElement>('[data-start-google]'); const signout = find<HTMLButtonElement>('[data-signout]');
  const googleButton = find<HTMLElement>('[data-google-button]'); const signedName = find<HTMLElement>('[data-signed-name]');
  const form = root.querySelector<HTMLFormElement>('[data-comment-form]'); const list = find<HTMLElement>('[data-comment-list]');
  const status = find<HTMLElement>('[data-comment-status]'); const more = find<HTMLButtonElement>('[data-more-comments]');
  const adminLink = root.querySelector<HTMLElement>('[data-admin-link]');
  let token = ''; let admin = false; let next: number | null = null; let comments: Comment[] = [];
  let submission: { body: string; id: string } | null = null;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const message = (value: string) => { status.textContent = value; };
  function signedOut() {
    token = ''; admin = false; start.hidden = false; signedName.hidden = true; signout.hidden = true; googleButton.replaceChildren();
    if (form) form.hidden = true; if (adminLink) adminLink.hidden = true;
    if (adminPage) { comments = []; next = null; more.hidden = true; }
    render();
  }
  function errorMessage(error: any) {
    if (error.status === 401) { signedOut(); message(text('Sesi tamat. Sila log masuk Google semula; draf komen awak masih ada.', 'Session expired. Sign in with Google again; your comment draft is still here.')); }
    else message(error.message || text('Tidak dapat memuatkan. Cuba lagi.', 'Unable to load. Please retry.'));
  }
  function render() {
    list.replaceChildren();
    for (const comment of comments) {
      const item = document.createElement('article'); item.className = 'comment-item';
      const header = document.createElement('header'); const name = document.createElement('strong'); name.textContent = comment.name;
      const date = document.createElement('time'); date.dateTime = new Date(comment.createdAt).toISOString(); date.textContent = new Date(comment.createdAt).toLocaleString(en ? 'en-MY' : 'ms-MY', { dateStyle: 'medium', timeStyle: 'short' });
      header.append(name, date); const body = document.createElement('p'); body.textContent = comment.body; item.append(header, body);
      if (adminPage && comment.slug) { const link = document.createElement('a'); link.href = `/artikel/${encodeURIComponent(comment.slug)}/#comments`; link.textContent = comment.slug.replaceAll('-', ' '); item.append(link); }
      if (admin) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = text('Padam komen', 'Delete comment');
        remove.addEventListener('click', async () => {
          if (!window.confirm(text('Padam komen ini?', 'Delete this comment?'))) return;
          remove.disabled = true;
          try {
            await api(base, `/v1/admin/comments/${comment.id}`, { method: 'DELETE', headers: auth() });
            comments = comments.filter(c => c.id !== comment.id); render();
            if (slug) await refreshStats(); message(text('Komen dipadam.', 'Comment deleted.'));
          } catch (error) { remove.disabled = false; errorMessage(error); }
        });
        item.append(remove);
      }
      list.append(item);
    }
  }
  async function refreshStats() {
    const data = await api(base, `/v1/stats?slugs=${encodeURIComponent(slug)}`); updateStats(slug, data.articles[slug]);
  }
  async function loadComments(append = false) {
    more.disabled = true;
    try {
      const path = adminPage ? '/v1/admin/comments' : `/v1/articles/${slug}/comments`;
      const data = await api(base, path + (append && next ? `?before=${next}` : ''), adminPage ? { headers: auth() } : {});
      comments = append ? [...comments, ...data.comments] : data.comments;
      next = data.next; more.hidden = next === null; render();
      message(comments.length ? '' : text('Belum ada komen.', 'No comments yet.'));
    } catch (error) { errorMessage(error); more.hidden = false; more.textContent = text('Cuba muatkan semula', 'Retry loading comments'); }
    finally { more.disabled = false; }
  }
  start.textContent = adminPage ? text('Log masuk admin', 'Admin sign-in') : start.textContent;
  start.addEventListener('click', async () => {
    if (!clientId || !base) { message(text('Log masuk belum tersedia.', 'Sign-in is not available yet.')); return; }
    start.disabled = true;
    try {
      const google = await loadGoogle();
      google.accounts.id.initialize({ client_id: clientId, callback: async ({ credential }) => {
        try {
          const me = await api(base, '/v1/me', { headers: { Authorization: `Bearer ${credential}` } });
          if (adminPage && !me.isAdmin) throw new Error(text('Akaun ini tiada akses admin.', 'This account does not have admin access.'));
          token = credential; admin = me.isAdmin; signedName.textContent = `${text('Log masuk sebagai', 'Signed in as')} ${me.name}`;
          signedName.hidden = false; signout.hidden = false; start.hidden = true; googleButton.replaceChildren();
          if (form) form.hidden = false; if (adminLink) adminLink.hidden = !admin;
          message(''); if (adminPage) await loadComments(); else render();
        } catch (error) { errorMessage(error); }
      } });
      google.accounts.id.renderButton(googleButton, { theme: 'outline', size: 'large', text: 'signin_with', width: 260 });
      start.hidden = true; message('');
    } catch (error) { errorMessage(error); } finally { start.disabled = false; }
  });
  signout.addEventListener('click', () => { window.google?.accounts.id.disableAutoSelect(); signedOut(); message(''); });
  more.addEventListener('click', () => loadComments(next !== null));
  form?.addEventListener('submit', async event => {
    event.preventDefault(); if (!token) { message(text('Log masuk Google dahulu.', 'Sign in with Google first.')); return; }
    const field = form.querySelector<HTMLTextAreaElement>('textarea')!; const body = field.value.trim(); if (!body) return;
    if (!submission || submission.body !== body) submission = { body, id: crypto.randomUUID() };
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; button.disabled = true;
    try {
      const data = await api(base, `/v1/articles/${slug}/comments`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ body, requestId: submission.id }) });
      field.value = ''; submission = null;
      comments = [data.comment, ...comments.filter(c => c.id !== data.comment.id)]; render(); updateStats(slug, data);
      message(text('Komen awak sudah disiarkan.', 'Your comment is now published.'));
    } catch (error) { errorMessage(error); } finally { button.disabled = false; }
  });
  if (!base) { message(text('Ruangan komen belum tersedia.', 'Comments are not available yet.')); continue; }
  if (!adminPage) {
    loadComments();
    // Reading stays public; only the comment form uses Google authentication.
    // One counted view per browser/article/UTC day, enforced again by the database.
    let visitor = '';
    try { visitor = localStorage.getItem('mayc-article-visitor') || crypto.randomUUID(); localStorage.setItem('mayc-article-visitor', visitor); } catch { visitor = ''; /* Do not count if durable browser storage is unavailable. */ }
    if (visitor) api(base, `/v1/articles/${slug}/views`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor }) }).then(data => updateStats(slug, data)).catch(() => {});
  }
}
export {};
