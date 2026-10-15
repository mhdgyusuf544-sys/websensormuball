# WATER QUALITY MONITORING SYSTEM

Dashboard monitoring kualitas air berbasis HTML/CSS/JavaScript, dengan kalkulator EM Mudball, grafik, dan riwayat lokal.

## Mode perangkat

Dashboard sekarang mendukung:

- **Arduino Uno melalui USB Serial (Web Serial API)** untuk membaca ADC sensor turbidity.
- **DEMO MODE** untuk menguji tampilan tanpa perangkat.
- Endpoint ESP32 lama untuk data sensor dan kontrol dispenser masih tersedia di kode; kontrol dispenser fisik tetap membutuhkan perangkat/firmware pengendali yang sesuai.

## Cara menjalankan lokal dengan Arduino Uno

1. Hubungkan sensor turbidity ke Arduino Uno:
   - VCC sensor → 5V Arduino
   - GND sensor → GND Arduino
   - AO sensor → A0 Arduino
   - DO tidak perlu dipakai untuk pembacaan analog.
2. Upload sketch Arduino berikut dengan baud rate 9600:

```cpp
const int pinSensor = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int adc = analogRead(pinSensor);
  Serial.print("{\\"adc\\":");
  Serial.print(adc);
  Serial.println("}");
  delay(1000);
}
```

3. Tutup Serial Monitor Arduino IDE agar port serial bebas.
4. Pastikan komputer menggunakan Google Chrome atau Microsoft Edge desktop yang mendukung Web Serial API.
5. Jalankan server lokal di folder proyek. Contoh jika Python terpasang:

```bash
python -m http.server 8000
```

6. Buka `http://localhost:8000` di Chrome/Edge.
7. Tekan **CONNECT ARDUINO UNO**, pilih port COM Arduino, lalu izinkan koneksi.
8. Dashboard akan menampilkan ADC, estimasi tegangan berdasarkan referensi 5 V, grafik ADC, dan riwayat.

> Catatan: nilai tegangan di dashboard adalah estimasi dari ADC dan asumsi referensi 5 V; hasil sebenarnya dapat berbeda. Dashboard tidak mengubah ADC menjadi NTU karena sensor perlu dikalibrasi terlebih dahulu. Untuk menghindari kerusakan, pastikan koneksi analog sesuai dengan rentang input board yang dipakai.

## Demo mode

Klik **DEMO MODE** untuk melihat data simulasi. Matikan DEMO MODE sebelum menghubungkan Arduino.

## Kalkulator EM Mudball

- `MUD_BALL_PER_M2 = 5` — jumlah EM Mudball per m².
- Jumlah EM Mudball = luas area × 5.
- Riwayat disimpan di `localStorage` browser.
- Grafik mempertahankan 50 titik data terakhir.

## Mode ESP32

Untuk firmware ESP32 lama, `script.js` masih memiliki konfigurasi `ESP32_IP` dan endpoint berikut:

- GET `/data`
- GET `/dispense/status`
- POST `/dispense/start`
- POST `/dispense/stop`
- POST `/dispense/reset`

Sesuaikan IP dan format JSON dengan firmware ESP32 yang digunakan. Jika menggunakan Arduino Uno, pilih tombol **CONNECT ARDUINO UNO** untuk membaca sensor melalui USB.
