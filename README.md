# Laman web MAYC Bukit Bintang

Laman utama untuk **maycbukitbintang.com**, dibina dengan [Astro](https://astro.build) dan diterbitkan secara automatik ke **GitHub Pages**. Kandungan diurus melalui **Pages CMS** tanpa perlu menyentuh kod.

## Struktur ringkas

| Folder / fail | Isi |
|---|---|
| `src/content/artikel/` | Semua artikel (satu fail `.md` untuk satu artikel) |
| `src/data/acara.json` | Acara semasa: nama, masa, lokasi, pautan keputusan (countdown dijana daripada fail ini) |
| `src/data/tetapan.json` | Pengenalan cawangan, WhatsApp, e-mel, media sosial |
| `public/uploads/` | Foto yang dimuat naik |
| `public/brand/` | Logo MAYC Bukit Bintang dan logo acara |
| `public/CNAME` | Domain `maycbukitbintang.com` (jangan padam) |
| `.pages.yml` | Konfigurasi panel Pages CMS |
| `.github/workflows/deploy.yml` | Bina & terbitkan automatik setiap kali ada perubahan di `main` |

Maklumat yang dikosongkan dalam `tetapan.json` (contohnya WhatsApp) akan **disembunyikan** di laman, bukan dipaparkan kosong.

## Pemasangan kali pertama

1. Buat repo baharu di GitHub (contoh: `mayc-bukit-bintang`) dan muat naik semua fail dalam folder ini ke branch `main`.
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Tab **Actions** → tunggu larian "Terbitkan laman ke GitHub Pages" bertukar hijau.
4. **Settings → Pages → Custom domain**: `maycbukitbintang.com` → Save. Selepas semakan DNS lulus dan sijil siap, tandakan **Enforce HTTPS**.

## Mengurus kandungan (Pages CMS)

1. Buka <https://app.pagescms.org> dan log masuk dengan GitHub.
2. Pasang GitHub App Pages CMS pada repo ini.
3. Pilih repo → **Artikel** untuk tulis artikel baharu, **Acara semasa** untuk tukar acara, **Tetapan laman** untuk maklumat hubungan.
4. Tekan **Save**. Laman dikemas kini dalam 1–2 minit.

Untuk petikan besar dalam artikel, gunakan butang *blockquote* (") dalam editor.

## Menjalankan di komputer (pilihan)

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # hasil di folder dist/
```

Memerlukan Node.js 22.12 atau lebih baharu.
