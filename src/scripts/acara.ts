// Status acara & countdown. Masa dalam acara.json ditulis sebagai waktu Malaysia (UTC+8).
type Acara = { nama: string; mula: string; tamat: string; lokasi: string; pautanKeputusan: string; pautanRider?: string; pautanInfo: string; keterangan?: string };

const el = document.getElementById('data-acara');
if (el) {
  const acara: Acara = JSON.parse(el.textContent || '{}');
  const keMasa = (s: string) => {
    let t = String(s).trim().replace(' ', 'T');
    if (/T\d\d:\d\d$/.test(t)) t += ':00';
    if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(t)) t += '+08:00';
    return Date.parse(t);
  };
  const mula = keMasa(acara.mula);
  const tamat = keMasa(acara.tamat);
  const pautanRider = acara.pautanRider || acara.pautanKeputusan;
  const p = (n: number) => String(n).padStart(2, '0');

  const fasaSekarang = () => {
    const now = Date.now();
    return now < mula ? 'sebelum' : now < tamat ? 'berlangsung' : 'selepas';
  };

  const kemas = () => {
    const fasa = fasaSekarang();
    const beza = Math.max(0, mula - Date.now());
    const h = Math.floor(beza / 86400000);
    const j = Math.floor(beza / 3600000) % 24;
    const m = Math.floor(beza / 60000) % 60;
    const s = Math.floor(beza / 1000) % 60;

    document.querySelectorAll<HTMLElement>('[data-acara]').forEach((kad) => {
      kad.dataset.fasa = fasa;
      const set = (k: string, v: string) => { const x = kad.querySelector(`[data-${k}]`); if (x) x.textContent = v; };
      set('hari', p(h)); set('jam', p(j)); set('minit', p(m)); set('saat', p(s));
      set('status', fasa === 'sebelum' ? 'Acara seterusnya' : fasa === 'berlangsung' ? 'Sedang berlangsung' : 'Keputusan rasmi');
      const cta = kad.querySelector<HTMLAnchorElement>('[data-cta]');
      if (cta) {
        const label = cta.querySelector('[data-cta-label]');
        if (fasa === 'sebelum') { cta.href = pautanRider; if (label) label.textContent = 'Lihat senarai rider'; }
        else { cta.href = acara.pautanKeputusan; delete cta.dataset.kalendar; if (label) label.textContent = fasa === 'berlangsung' ? 'Keputusan langsung' : 'Lihat keputusan'; }
      }
    });

    const pil = document.querySelector('[data-teks-pil]');
    if (pil) pil.textContent = fasa === 'sebelum' ? `${acara.nama} · ${h > 0 ? h + ' hari lagi' : j + ' jam lagi'}` : fasa === 'berlangsung' ? `${acara.nama} · Langsung` : `Keputusan ${acara.nama}`;

    const teksBar = document.querySelector('[data-teks-bar]');
    const ctaBar = document.querySelector<HTMLAnchorElement>('[data-cta-bar]');
    if (teksBar) teksBar.textContent = fasa === 'sebelum' ? (h > 0 ? `${h} hari ${j} jam lagi` : `${j} jam ${m} minit lagi`) : fasa === 'berlangsung' ? 'Sedang berlangsung' : 'Keputusan kini tersedia';
    if (ctaBar) { ctaBar.textContent = fasa === 'sebelum' ? 'Rider' : 'Keputusan'; ctaBar.href = fasa === 'sebelum' ? pautanRider : acara.pautanKeputusan; }
  };
  kemas();
  setInterval(kemas, 1000);

  // Tambah ke kalendar (.ics)
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-kalendar]');
    if (!a) return;
    e.preventDefault();
    const f = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MAYC Bukit Bintang//ms', 'BEGIN:VEVENT',
      `UID:${mula}@maycbukitbintang.com`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(mula)}`, `DTEND:${f(tamat)}`,
      `SUMMARY:${acara.nama}`, `LOCATION:${acara.lokasi.replace(/,/g, '\\,')}`,
      `DESCRIPTION:${(acara.keterangan || '').replace(/,/g, '\\,')} Keputusan: ${acara.pautanKeputusan}`,
      `URL:${location.origin}${acara.pautanInfo}`, 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const dl = document.createElement('a');
    dl.href = url; dl.download = 'metro-madness-vol2.ics';
    document.body.appendChild(dl); dl.click(); dl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // Sembunyikan bar bawah bila kad acara sudah kelihatan
  const bar = document.querySelector<HTMLElement>('[data-bar-bawah]');
  const kad = document.querySelector('[data-acara]');
  if (bar && kad && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => bar.classList.toggle('sembunyi', e.isIntersecting), { threshold: 0.2 }).observe(kad);
  }
}
