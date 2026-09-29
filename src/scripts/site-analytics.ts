const root = document.querySelector<HTMLElement>('[data-site-analytics]');
const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
if (root?.dataset.api && navigator.doNotTrack !== '1' && !privacy.globalPrivacyControl && !location.pathname.startsWith('/admin/')) {
  const base = root.dataset.api.replace(/\/$/, '');
  const path = location.pathname === '/' ? '/' : location.pathname.replace(/\/$/, '') + '/';
  type Visit = { id: string; lastAt: number; referrer: string; utmSource: string; utmMedium: string; utmCampaign: string };
  const campaign = (value: string | null) => value && /^[a-zA-Z0-9_. -]{1,80}$/.test(value) ? value : '';
  let visitor = ''; let session: Visit | null = null;
  try {
    visitor = localStorage.getItem('mayc-site-visitor') || crypto.randomUUID(); localStorage.setItem('mayc-site-visitor', visitor);
    const saved = sessionStorage.getItem('mayc-site-session'); if (saved) session = JSON.parse(saved);
    if (!session || Date.now() - session.lastAt > 1800000) {
      let referrer = ''; try { const host = new URL(document.referrer).hostname; if (host !== location.hostname) referrer = host; } catch {}
      const query = new URLSearchParams(location.search);
      session = { id: crypto.randomUUID(), lastAt: Date.now(), referrer, utmSource: campaign(query.get('utm_source')), utmMedium: campaign(query.get('utm_medium')), utmCampaign: campaign(query.get('utm_campaign')) };
    }
    session.lastAt = Date.now(); sessionStorage.setItem('mayc-site-session', JSON.stringify(session));
  } catch { visitor = ''; session = null; }
  if (visitor && session) {
    const visit = session;
    const identity = { visitor, session: visit.id, pageId: crypto.randomUUID() };
    let started = false; let startPromise: Promise<boolean> | undefined;
    let activeMs = 0; let lastTick = performance.now(); let active = !document.hidden && document.hasFocus(); let deepest = 0;
    const send = async (payload: object) => {
      try { return (await fetch(`${base}/v1/analytics`, { method: 'POST', credentials: 'omit', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...identity, ...payload }), signal: AbortSignal.timeout(8000) })).ok; } catch { return false; }
    };
    const start = () => {
      if (!startPromise) startPromise = send({ type: 'page_view', path, device: innerWidth < 768 ? 'mobile' : innerWidth < 1100 ? 'tablet' : 'desktop', referrer: visit.referrer, utmSource: visit.utmSource, utmMedium: visit.utmMedium, utmCampaign: visit.utmCampaign }).then(ok => { started = ok; if (!ok) startPromise = undefined; return ok; });
      return startPromise;
    };
    const sample = () => {
      const now = performance.now();
      if (active) activeMs += Math.max(0, Math.min(now - lastTick, 20000));
      lastTick = now; active = !document.hidden && document.hasFocus();
      // Only measure the visible page; no form field or comment text is collected.
      deepest = Math.max(deepest, Math.min(100, Math.round((scrollY + innerHeight) / Math.max(document.documentElement.scrollHeight, innerHeight) * 100)));
    };
    const flush = async () => {
      sample();
      if (!started && !await start()) return;
      await send({ type: 'engagement', activeMs: Math.round(activeMs), scrollDepth: deepest });
      if (active) { try { visit.lastAt = Date.now(); sessionStorage.setItem('mayc-site-session', JSON.stringify(visit)); } catch {} }
    };
    const tick = () => { if (!document.hidden) { start(); flush(); } };
    if (!document.hidden) start();
    const timer = window.setInterval(tick, 15000);
    document.addEventListener('visibilitychange', () => { sample(); if (started || !document.hidden) flush(); });
    window.addEventListener('focus', sample); window.addEventListener('blur', () => { sample(); if (started) flush(); });
    window.addEventListener('pagehide', () => { window.clearInterval(timer); if (started) flush(); });
    document.addEventListener('click', event => {
      const element = (event.target as Element)?.closest('a,button'); if (!element || element.closest('#comments')) return;
      let action = ''; let target = '';
      if (element instanceof HTMLAnchorElement) {
        const url = new URL(element.href, location.href);
        if (url.protocol === 'mailto:') action = 'contact_email';
        else if (url.protocol === 'tel:') action = 'contact_phone';
        else if (url.hostname === 'wa.me' || url.hostname === 'api.whatsapp.com') action = 'whatsapp';
        else if (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) action = 'instagram';
        else if (url.hostname === 'race.maycbukitbintang.com') action = 'race_results';
        else if (url.origin === location.origin) { action = /^\/artikel\/[^/]+/.test(url.pathname) ? 'article_open' : 'navigation'; target = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '') + '/'; }
        else if (url.protocol === 'https:') action = 'external_link';
      } else if (element.hasAttribute('data-share-native')) action = 'share_menu';
      else if (element.hasAttribute('data-share-copy') || element.hasAttribute('data-salin')) action = 'copy_link';
      if (action) start().then(ok => { if (ok) send({ type: 'click', id: crypto.randomUUID(), action, target }); });
    });
  }
}
export {};
