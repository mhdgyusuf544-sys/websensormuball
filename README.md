# WATER QUALITY MONITORING SYSTEM

Ringkasan proyek: sebuah dashboard monitoring kualitas air berbasis HTML/CSS/JS yang terhubung dengan ESP32 dan sensor turbidity, plus kalkulator EM Mudball dan kontrol dispenser.

Files utama:

- `index.html` — tampilan dashboard
- `style.css` — styling modern, responsif
- `script.js` — logika: pengambilan data ESP32, demo mode, Chart.js, history di `localStorage`, kalkulator dan kontrol dispenser

Cara menjalankan (lokal):

1. Buka file `index.html` di browser (double-click atau `File > Open`).
2. Default mode: mencoba mengambil data dari ESP32 pada `ESP32_IP` yang didefinisikan di `script.js`.

Aktifkan DEMO MODE:

- Klik tombol `DEMO MODE` di kanan atas. Ketika aktif, tampilan menunjukkan `DEMO MODE` dan data disimulasikan (turbidity, ADC, voltage). Gunakan ini untuk menguji grafik dan dispenser tanpa ESP32.

Mengganti konfigurasi penting (di `script.js`):

- `const ESP32_IP = "192.168.1.20";` — ubah alamat IP ESP32.
- `const MUD_BALL_PER_M2 = 5;` — jumlah EM Mudball per m².
- `const UPDATE_INTERVAL = 1000;` — interval update (ms).
- Ambang turbidity: `TURBIDITY_THRESHOLDS` (default diatur ke `jernih:10`, `agakKeruh:40`). Anda bisa mengubahnya di file atau dari console runtime:

  - Buka DevTools (F12) dan jalankan:

```js
window.TURBIDITY_THRESHOLDS.jernih = 8;
window.TURBIDITY_THRESHOLDS.agakKeruh = 35;
```

Format endpoint ESP32 yang diharapkan:

- GET /data

  Contoh response JSON:

```json
{
  "adc": 2850,
  "voltage": 2.31,
  "turbidity": 24.6,
  "status": "JERNIH"
}
```

- GET /dispense/status

  Contoh response JSON:

```json
{
  "target": 50,
  "released": 25,
  "remaining": 25,
  "progress": 50,
  "status": "DISPENSING"
}
```

- POST /dispense/start
- POST /dispense/stop
- POST /dispense/reset

Contoh cara menguji endpoint ESP32 dari komputer (curl):

```bash
curl http://192.168.1.20/data
curl http://192.168.1.20/dispense/status
curl -X POST http://192.168.1.20/dispense/start
```

Catatan validasi dan penggunaan:

- Input `Luas Area` harus > 0.
- Jumlah EM Mudball = `Luas Area × MUD_BALL_PER_M2`.
- Tombol `START DISPENSING` hanya aktif jika `Luas Area` valid dan target > 0.
- Data history disimpan sementara di `localStorage` (maksimal entri disimpan sesuai `MAX_HISTORY` di `script.js`).
- Grafik realtime menggunakan Chart.js via CDN; disimpan hingga `MAX_CHART_POINTS` data terakhir.

Menghubungkan ke ESP32 (contoh):

1. Pastikan ESP32 dan komputer berada di jaringan Wi‑Fi yang sama.
2. Sesuaikan `ESP32_IP` di `script.js` dengan IP yang digunakan ESP32.
3. Pastikan ESP32 melayani endpoint JSON seperti contoh di atas.

Jika Anda ingin, saya bisa membantu:

- Menyediakan contoh sketch ESP32 (Arduino/PlatformIO) yang menyajikan endpoint `/data` dan `/dispense/*` dengan format JSON sesuai contoh.
- Menambahkan UI untuk mengubah ambang turbidity dari dashboard.
