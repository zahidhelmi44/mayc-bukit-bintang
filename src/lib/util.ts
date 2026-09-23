import { getCollection, type CollectionEntry } from 'astro:content';

export type Artikel = CollectionEntry<'artikel'>;

const BULAN = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

export function tarikhPenuh(d?: Date) {
  if (!d) return '';
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function tarikhPendek(d?: Date) {
  if (!d) return '';
  return `${d.getUTCDate()} ${BULAN_PENDEK[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function minitBacaan(teks: string) {
  const perkataan = teks.replace(/[#>*_`\[\]()-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(perkataan / 200));
}

export function inisial(nama?: string) {
  if (!nama) return '';
  return nama.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

/** Artikel bertarikh (terbaru dahulu), kemudian artikel tanpa tarikh. Draf disembunyikan. */
export async function semuaArtikel(): Promise<Artikel[]> {
  const semua = await getCollection('artikel', ({ data }) => !data.draft);
  return semua.sort((a, b) => {
    if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;
    const ta = a.data.date?.getTime() ?? -Infinity;
    const tb = b.data.date?.getTime() ?? -Infinity;
    return tb - ta;
  });
}

export function pautanArtikel(a: Artikel) {
  return `/artikel/${a.id}/`;
}

export function jenisVideo(url?: string): { jenis: 'instagram' | 'youtube' | 'tiktok' | 'lain'; url: string; id?: string } | null {
  if (!url) return null;
  const u = url.trim();
  const ig = u.match(/instagram\.com\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
  if (ig) return { jenis: 'instagram', url: `https://www.instagram.com/${ig[1]}/${ig[2]}/`, id: ig[2] };
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return { jenis: 'youtube', url: u, id: yt[1] };
  const tt = u.match(/tiktok\.com\/.*\/video\/(\d+)/);
  if (tt) return { jenis: 'tiktok', url: u, id: tt[1] };
  return { jenis: 'lain', url: u };
}
