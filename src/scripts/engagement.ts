type Totals = { views: number; comments: number };
type Comment = { id: number; name: string; body: string; createdAt: number };
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
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}
const groups = new Map<string, string[]>();
for (const el of allStats) {
  const base = el.dataset.engagementApi || ''; const slug = el.dataset.articleStats || '';
  if (base && slug) groups.set(base, [...new Set([...(groups.get(base) || []), slug])]);
}
const statsReady: Promise<unknown>[] = [];
for (const [base, slugs] of groups) {
  for (let i = 0; i < slugs.length; i += 50) {
    statsReady.push(api(base, `/v1/stats?slugs=${encodeURIComponent(slugs.slice(i, i + 50).join(','))}`)
      .then(data => Object.entries(data.articles).forEach(([slug, totals]) => updateStats(slug, totals as Totals)))
      .catch(() => allStats.forEach(el => el.title = document.documentElement.lang.startsWith('en') ? 'Counts temporarily unavailable' : 'Jumlah belum dapat dimuatkan')));
  }
}
for (const root of document.querySelectorAll<HTMLElement>('[data-comments-root]')) {
  const base = root.dataset.api || ''; const slug = root.dataset.slug || ''; const en = root.dataset.lang?.startsWith('en');
  const text = (ms: string, english: string) => en ? english : ms;
  const form = root.querySelector<HTMLFormElement>('[data-comment-form]')!;
  const list = root.querySelector<HTMLElement>('[data-comment-list]')!;
  const status = root.querySelector<HTMLElement>('[data-comment-status]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more-comments]')!;
  const nameField = form.elements.namedItem('name') as HTMLInputElement;
  const emailField = form.elements.namedItem('email') as HTMLInputElement;
  const bodyField = form.elements.namedItem('body') as HTMLTextAreaElement;
  const remember = form.elements.namedItem('remember') as HTMLInputElement;
  const message = (value: string) => { status.textContent = value; };
  let next: number | null = null; let comments: Comment[] = [];
  let submission: { signature: string; id: string } | null = null;
  try { const saved = localStorage.getItem('mayc-comment-name'); if (saved) { nameField.value = saved.slice(0,80); remember.checked = true; } } catch {}
  remember.addEventListener('change', () => { if (!remember.checked) { try { localStorage.removeItem('mayc-comment-name'); } catch {} } });
  function render() {
    list.replaceChildren();
    for (const comment of comments) {
      const item = document.createElement('article'); item.className = 'comment-item';
      const header = document.createElement('header'); const name = document.createElement('strong'); name.textContent = comment.name;
      const date = document.createElement('time'); date.dateTime = new Date(comment.createdAt).toISOString(); date.textContent = new Date(comment.createdAt).toLocaleString(en ? 'en-MY' : 'ms-MY', { dateStyle: 'medium', timeStyle: 'short' });
      header.append(name, date); const body = document.createElement('p'); body.textContent = comment.body; item.append(header, body); list.append(item);
    }
  }
  async function loadComments(append = false) {
    more.disabled = true;
    try {
      const data = await api(base, `/v1/articles/${slug}/comments` + (append && next ? `?before=${next}` : ''));
      comments = append ? [...comments, ...data.comments] : data.comments;
      next = data.next; more.hidden = next === null; more.textContent = text('Lihat komen lagi', 'Load more comments'); render();
      message(comments.length ? '' : text('Belum ada komen. Jadilah yang pertama!', 'No comments yet. Be the first!'));
    } catch (error: any) { message(error.message); more.hidden = false; more.textContent = text('Cuba muatkan semula', 'Retry loading comments'); }
    finally { more.disabled = false; }
  }
  more.addEventListener('click', () => loadComments(next !== null));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = { name: nameField.value.trim(), email: emailField.value.trim(), body: bodyField.value.trim(), website: (form.elements.namedItem('website') as HTMLInputElement).value };
    if (!values.body || values.name.length < 2) { form.reportValidity(); return; }
    const signature = JSON.stringify(values);
    if (!submission || submission.signature !== signature) submission = { signature, id: crypto.randomUUID() };
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; button.disabled = true;
    try {
      const data = await api(base, `/v1/articles/${slug}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, requestId: submission.id }) });
      bodyField.value = ''; submission = null;
      // Only the display name is remembered, and only after an explicit checkbox choice.
      try { if (remember.checked) localStorage.setItem('mayc-comment-name', values.name); else localStorage.removeItem('mayc-comment-name'); } catch {}
      comments = [data.comment, ...comments.filter(c => c.id !== data.comment.id)]; render(); updateStats(slug, data);
      message(text('Komen awak sudah disiarkan.', 'Your comment is now published.'));
    } catch (error: any) { message(error.message || text('Cuba lagi.', 'Please retry.')); } finally { button.disabled = false; }
  });
  if (!base) { message(text('Ruangan komen belum tersedia.', 'Comments are not available yet.')); continue; }
  loadComments();
  // Views are separate from comment identity and do not include the submitted name/email.
  const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (navigator.doNotTrack !== '1' && !privacy.globalPrivacyControl) {
    let visitor = '';
    try { visitor = localStorage.getItem('mayc-article-visitor') || crypto.randomUUID(); localStorage.setItem('mayc-article-visitor', visitor); } catch { visitor = ''; }
    if (visitor) Promise.allSettled(statsReady).then(() => api(base, `/v1/articles/${slug}/views`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor }) }).then(data => updateStats(slug, data)).catch(() => {}));
  }
}
export {};
