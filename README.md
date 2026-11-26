# lanettirr

Windows için yerel **Lanettirr (Mega Bridge)** + **TR Hub** + **EN Hub** paketi — tek kurulumla Nuvio Desktop ve Stremio/AIOStreams üzerinde 48 dilde yüzlerce torrentsiz VOD kaynağını gerçek video doğrulaması, otomatik failover ve özel rozetlerle izlemenizi sağlar.

Depo: https://github.com/0mamiis/lanettirr

## Neler Sunar?

- **Tek Merkezden Çok Dilli Hub (48 Dil)**:
  - **TR Hub**: 193+ Türkçe kaynak (CS3 + Nuvio TR depoları), gerçek dublaj/altyazı ayrımıyla.
  - **EN Hub**: 10 EN deposundan tekilleştirilmiş 154+ yabancı kaynak (torrent sağlayıcıları hariç).
  - **Diğer 46 Dil**: 87 Nuvio JS + 38 CS3 deposu, tamamı torrent ve canlı TV hariç VOD odaklı.
- **Web Ayar Paneli (`/configure`)**:
  - Dil seçimi ve sürükle-bırak öncelik sıralaması.
  - Dil içi depo ve sağlayıcı bazlı aç/kapa kontrolü.
  - Çözünürlük filtreleri (`4K / 2K / 1080p / 720p / 480p`), kalite başına ve hub başına sonuç limiti.
  - Özelleştirilebilir kaynak sıralaması (varsayılan: **Kalite → Bitrate → Hız → Dublaj**).
  - Sıralı hub yükleme (`hseq`), sağlayıcı zaman aşımı, otomatik failover süresi ve kara liste (blacklist) yönetimi.
- **Gerçek Video Doğrulaması (`ffprobe`) ve 2 Satırlı Temiz Kartlar**:
  - Üst satırda gerçek ölçülmüş çözünürlük, bitrate (`Mbps`) ve yanıt süresi (`ms`).
  - Alt satırda doğrulanmış dil/dublaj bilgisi ile konteyner, HDR, video/ses kodeği ve kanal etiketleri (`MKV/MP4`, `HDR10`, `Dolby Vision`, `HEVC/H.264/AV1`, `5.1`, `AAC`, `Dual/Multi Audio`, `Multi Sub`).
- **Özel Fusion Rozet URL'si (`/badges.json`)**:
  - 220 rozetlik `FR-Badges` paketinin **Kalite → Dil/Dublaj → Konteyner → HDR/Bit → Kodek/Ses** önceliğiyle sıralanmış yerel/tünel adresi.
- **Otomatik Failover, Kara Liste ve İndirme Desteği**:
  - `/play/` hattı açılmayan veya zaman aşımına uğrayan kaynakları otomatik kara listeye alıp sıradaki çalışan kaynağa geçer.
  - `/p/` proxy'si SSRF korumalıdır; `HEAD`, `Range` (`206`) ve kesintisiz akış desteği sayesinde Nuvio içindeki indirme butonuyla uyumludur.

## 3 Adımda Kurulum

1. **İndir ve çıkar**: [GitHub sayfasından](https://github.com/0mamiis/lanettirr) **Code → Download ZIP** ile arşivi indirip bir klasöre çıkarın. Windows SmartScreen uyarısı çıkarsa **Ek bilgi → Yine de çalıştır** seçeneğini kullanın.
2. **Kurulumu çalıştır**: Klasördeki `kur.bat` dosyasına çift tıklayın. Node.js, Java 21, FFmpeg/`ffprobe`, gerekli npm paketleri ve `cs-host-deps.zip` otomatik olarak kurulur.
3. **Servisleri başlat**: `baslat.bat` dosyasını çalıştırıp tüm servislerin `HAZIR` durumuna geçmesini bekleyin.

## Nuvio Desktop Ayarları

### 1. Ayar Paneli (Önerilen Başlangıç)

Tarayıcıdan açıp dillerinizi, depolarınızı, sıralama ve failover ayarlarınızı kaydedin:

- **Ayar Paneli**: `http://127.0.0.1:3001/configure`

### 2. Pluginler (Lanettirr Çok Dilli Hub)

**Ayarlar → Medya → İçerik & Keşif → Pluginler** bölümüne aşağıdaki adresi ekleyin:

- **Lanettirr (Kayıtlı Ayarlarla)**: `http://127.0.0.1:3001/saved/nuvio-repo/manifest.json`

Aynı ekranda **"Eklenti sağlayıcılarını depoya göre grupla"** ayarını açık konuma getirin.

*(İsteğe bağlı olarak doğrudan ham hub adresleri de kullanılabilir: `http://127.0.0.1:7100/nuvio-repo/manifest.json` ve `http://127.0.0.1:7100/en-repo/manifest.json`.)*

### 3. Fusion Rozet URL'si (Önerilen)

Kartlardaki ikonların **Kalite → Dil/Dublaj → Konteyner → HDR → Kodek** sırasıyla düzgün görünmesi için **Görünüm → Düzen → Yayınlar → Fusion Rozet URL'si** alanına ekleyin:

- **Fusion Rozetleri**: `http://127.0.0.1:3001/badges.json`

### 4. Stremio / AIOStreams (Opsiyonel)

Stremio veya AIOStreams üzerinden kullanmak için:

- **Stremio Manifest**: `http://127.0.0.1:3001/saved/manifest.json`

## Günlük Kullanım

- **Başlatmak için**: `baslat.bat`
- **Durdurmak için**: `durdur.bat`
- **Güncellemek için**: Web ayar panelindeki (`http://127.0.0.1:3001/configure`) üst çubuktan tek tıkla **Güncelle** butonuna basabilir veya klasördeki `guncelle.bat` (Windows) / `./guncelle.sh` (Linux/Termux) betiğini çalıştırabilirsiniz. Güncelleme sırasında ayarlarınız (`saved-config.json`, `blacklist.json`, `.env`) otomatik korunur.
- **Sağlık kontrolü**: `http://127.0.0.1:3001/health`
- **Otomatik başlatma (Windows Startup)**: Windows Başlangıç (`shell:startup`) klasörüne `scripts/start-hidden.vbs` için kısayol ekleyerek servislerin bilgisayar açıldığında pencere göstermeden arka planda başlamasını sağlayabilirsiniz.

## Opsiyonel: Telefon / Uzaktan Erişim ve AIOStreams

Servisleri telefonunuzdan veya AIOStreams üzerinden dış erişimle kullanmak isterseniz:

1. Klasördeki `.env.example` dosyasını kopyalayıp adını `.env` yapın.
2. `.env` içinde `ENABLE_TUNNEL=1` ayarını açın ve gerekirse AIOStreams değişkenlerini (`AIOSTREAMS_BASE_URL`, `AIOSTREAMS_UUID`, `AIOSTREAMS_PASSWORD`) doldurun.
3. `cloudflared` kurulu değilse yükleyin (`winget install Cloudflare.cloudflared`), ardından `baslat.bat` ile servisleri yeniden başlatın.
4. Oluşan tünel adresi `.runtime/tunnel-url.txt` dosyasına yazılır; aynı `/configure`, `/saved/nuvio-repo/manifest.json` ve `/badges.json` uç noktaları tünel adresi üzerinden de çalışır.

## Kısa Sorun Giderme

- **SmartScreen / PowerShell uyarısı**: `.bat` dosyaları PowerShell'i `-ExecutionPolicy Bypass` ile çağırır; Windows uyarısında **Ek bilgi → Yine de çalıştır** demeniz yeterlidir.
- **Nuvio'da kaynak görünmüyor**: Servislerin çalıştığından emin olun (`http://127.0.0.1:3001/health`). Değişiklik sonrası `durdur.bat` ve ardından `baslat.bat` çalıştırıp Nuvio'da eklentileri yenileyin.
- **Kartlarda Mbps veya kodek rozetleri görünmüyor**: `ffprobe` kurulu olmalıdır; `kur.bat` bunu WinGet üzerinden otomatik kurar veya `.env` içinde `FFPROBE_PATH` / `MEGA_FFPROBE` tanımlanabilir.
- **Port çakışması (`7100` veya `3001`)**: Önce `durdur.bat` ile eski işlemleri kapatın, sonra `baslat.bat` ile temiz başlatın.
- **Kurulum yarım kaldıysa**: `kur.bat` dosyasını yeniden çalıştırabilirsiniz; eksik bileşenler tekrar kontrol edilip tamamlanır.

## Lisans ve Üçüncü Taraf Bileşenler

- Proje lisansı: [LICENSE](LICENSE)
- Üçüncü taraf lisans ve bildirimleri: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Destek / Donate

Projeyi desteklemek isterseniz aşağıdaki adresler üzerinden bağış yapabilirsiniz:

| Varlık | Ağ | Adres |
| :--- | :--- | :--- |
| **USDT** | **X Layer** | `XKOde2f6fbcdace36d5ceebdf545e992d3036269259` |
| **USDT** | **Tron (TRC20)** | `TNxCAUc1EJvRvAmEAVK5iAKrJBXp6MuJsA` |

## Star History

<a href="https://www.star-history.com/#0mamiis/lanettirr&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=0mamiis/lanettirr&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=0mamiis/lanettirr&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=0mamiis/lanettirr&type=Date" />
  </picture>
</a>

