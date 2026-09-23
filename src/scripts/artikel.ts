const data = JSON.parse(document.getElementById('data-artikel')?.textContent || '{}') as {
  tajuk: string; kategori: string; tarikh: string; url: string;
};

const toast = document.querySelector<HTMLElement>('[data-toast]');
function beritahu(teks: string) {
  if (!toast) return;
  toast.textContent = teks;
  toast.classList.add('tunjuk');
  setTimeout(() => toast.classList.remove('tunjuk'), 2200);
}

// Bar kemajuan bacaan
const bar = document.querySelector<HTMLElement>('[data-kemajuan]');
const prosa = document.querySelector<HTMLElement>('[data-prosa]');
if (bar && prosa) {
  const kira = () => {
    const r = prosa.getBoundingClientRect();
    const jumlah = r.height + window.innerHeight * 0.3;
    const dibaca = Math.min(1, Math.max(0, (window.innerHeight * 0.7 - r.top) / jumlah));
    bar.style.width = `${dibaca * 100}%`;
  };
  addEventListener('scroll', kira, { passive: true });
  kira();
}

// Salin pautan
document.querySelectorAll<HTMLButtonElement>('[data-salin]').forEach((b) =>
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.salin || location.href); beritahu('Pautan disalin'); }
    catch { beritahu('Tidak dapat menyalin. Salin dari bar alamat.'); }
  })
);

// Kongsi petikan sebagai gambar
const alat = document.querySelector<HTMLElement>('[data-alat-pilih]');
let petikan = '';

function kemasAlat() {
  const sel = getSelection();
  const teks = sel?.toString().trim() ?? '';
  if (!alat || !sel || !prosa || teks.length < 12 || !prosa.contains(sel.anchorNode)) {
    alat?.classList.remove('buka');
    return;
  }
  petikan = teks.length > 280 ? teks.slice(0, 277) + '…' : teks;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const x = Math.min(Math.max(r.left + r.width / 2, 150), innerWidth - 150);
  alat.style.left = `${x + scrollX}px`;
  alat.style.top = `${r.top + scrollY - 12}px`;
  alat.classList.add('buka');
}
document.addEventListener('selectionchange', () => { clearTimeout((kemasAlat as any).t); (kemasAlat as any).t = setTimeout(kemasAlat, 250); });

document.querySelector('[data-salin-petikan]')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`“${petikan}”\n— ${data.tajuk}\n${data.url}`); beritahu('Petikan disalin'); } catch {}
  alat?.classList.remove('buka');
});

function muatGambar(src: string) {
  return new Promise<HTMLImageElement>((ok, gagal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = gagal; i.src = src; });
}

function balut(ctx: CanvasRenderingContext2D, teks: string, lebar: number) {
  const perkataan = teks.split(/\s+/);
  const baris: string[] = [];
  let semasa = '';
  for (const p of perkataan) {
    const cuba = semasa ? `${semasa} ${p}` : p;
    if (ctx.measureText(cuba).width > lebar && semasa) { baris.push(semasa); semasa = p; } else semasa = cuba;
  }
  if (semasa) baris.push(semasa);
  return baris;
}

async function janaKad(teks: string): Promise<Blob> {
  const W = 1080, H = 1920, M = 90;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  await document.fonts.ready;
  ctx.fillStyle = '#17140F'; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#A8A095';
  ctx.font = '500 28px "DM Mono", monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(data.kategori.toUpperCase(), M, 110);
  if (data.tarikh) { const t = data.tarikh.toUpperCase(); ctx.fillText(t, W - M - ctx.measureText(t).width, 110); }

  let saiz = 92;
  ctx.font = `italic 400 ${saiz}px "Instrument Serif", Georgia, serif`;
  let baris = balut(ctx, teks, W - 2 * M);
  while (baris.length * saiz * 1.1 > 900 && saiz > 52) {
    saiz -= 6;
    ctx.font = `italic 400 ${saiz}px "Instrument Serif", Georgia, serif`;
    baris = balut(ctx, teks, W - 2 * M);
  }
  const tinggi = baris.length * saiz * 1.1;
  let y = Math.max(360, (H - tinggi) / 2 - 80);

  ctx.fillStyle = '#E8B04B';
  ctx.font = `400 260px "Instrument Serif", Georgia, serif`;
  ctx.fillText('“', M - 10, y - 200);

  ctx.fillStyle = '#F4EFE6';
  ctx.font = `italic 400 ${saiz}px "Instrument Serif", Georgia, serif`;
  for (const b of baris) { ctx.fillText(b, M, y); y += saiz * 1.1; }

  ctx.fillStyle = '#D8D0C3';
  ctx.font = '500 34px "Bricolage Grotesque", sans-serif';
  y += 36;
  for (const b of balut(ctx, `— Daripada artikel: ${data.tajuk}`, W - 2 * M).slice(0, 3)) { ctx.fillText(b, M, y); y += 46; }

  const kotakY = H - 90 - 190;
  ctx.fillStyle = '#F4EFE6';
  ctx.beginPath(); (ctx as any).roundRect ? (ctx as any).roundRect(M - 20, kotakY, W - 2 * M + 40, 190, 40) : ctx.rect(M - 20, kotakY, W - 2 * M + 40, 190); ctx.fill();
  try {
    const logo = await muatGambar('/brand/mayc-bukit-bintang-logo.png');
    const lh = 140, lw = (logo.width / logo.height) * lh;
    ctx.drawImage(logo, M + 5, kotakY + 25, lw, lh);
    ctx.fillStyle = '#17140F';
    ctx.font = '700 40px "Bricolage Grotesque", sans-serif';
    ctx.fillText('MAYC', M + lw + 30, kotakY + 58);
    ctx.fillStyle = '#6B645A';
    ctx.font = '500 24px "DM Mono", monospace';
    ctx.fillText('BUKIT BINTANG', M + lw + 30, kotakY + 108);
  } catch {}
  ctx.fillStyle = '#17140F';
  ctx.font = '500 26px "DM Mono", monospace';
  const domain = 'maycbukitbintang.com';
  ctx.fillText(domain, W - M - ctx.measureText(domain).width, kotakY + 80);

  return new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
}

document.querySelector('[data-kongsi-gambar]')?.addEventListener('click', async () => {
  alat?.classList.remove('buka');
  beritahu('Menyediakan gambar…');
  const blob = await janaKad(petikan);
  const fail = new File([blob], 'petikan-mayc-bukit-bintang.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [fail] })) {
    try { await navigator.share({ files: [fail], text: `${data.tajuk}\n${data.url}` }); return; } catch { return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fail.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  beritahu('Gambar dimuat turun');
});
