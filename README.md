# lanettirr

Windows için yerel **TR Hub**, **EN Hub** ve **Mega Bridge** paketi — tek kurulumla Nuvio Desktop üzerinde yüzlerce Türkçe ve yabancı kaynağı hızlıca izlemenizi sağlar.

Depo: https://github.com/0mamiis/lanettirr

## Neler Sunar?

- **TR Hub**: 299+ Türkçe kaynak, sonuçlar geldikçe canlı akar.
- **EN Hub**: 80 yabancı kaynak, sonuçlar geldikçe canlı akar.
- **Mega Bridge**: `480p / 720p / 1080p / 2K / 4K` tek kartlar halinde sunulur ve tamamen yerel çalışır.

## 3 Adımda Kurulum

1. **İndir ve çıkar**: [GitHub sayfasından](https://github.com/0mamiis/lanettirr) **Code → Download ZIP** ile arşivi indirip bir klasöre çıkarın. Windows SmartScreen uyarısı çıkarsa **Ek bilgi → Yine de çalıştır** seçeneğini kullanın.
2. **Kurulumu çalıştır**: Klasördeki `kur.bat` dosyasına çift tıklayın. Node.js, Java 21, FFmpeg, gerekli npm paketleri ve `cs-host-deps.zip` otomatik olarak kurulur.
3. **Servisleri başlat**: `baslat.bat` dosyasını çalıştırıp servislerin hazır olmasını bekleyin.

## Nuvio Desktop Ayarları

### 1. Pluginler (TR Hub ve EN Hub)

**Ayarlar → Medya → İçerik & Keşif → Pluginler** bölümüne aşağıdaki iki adresi ekleyin:

- **TR Hub**: `http://127.0.0.1:7100/nuvio-repo/manifest.json`
- **EN Hub**: `http://127.0.0.1:7100/en-repo/manifest.json`

Aynı ekranda **"Eklenti sağlayıcılarını depoya göre grupla"** ayarını açık konuma getirin.

### 2. Eklentiler (Mega Bridge)

**Eklentiler** bölümüne aşağıdaki adresi ekleyin:

- **Mega**: `http://127.0.0.1:3001/manifest.json`

## Günlük Kullanım

- **Başlatmak için**: `baslat.bat`
- **Durdurmak için**: `durdur.bat`
- **Otomatik başlatma (Windows Startup)**: Kurulum sırasında veya Windows Başlangıç (`shell:startup`) klasörüne `scripts/start-hidden.vbs` için kısayol ekleyerek servislerin bilgisayar açıldığında pencere göstermeden arka planda başlamasını sağlayabilirsiniz.

## Opsiyonel: Telefon / AIOStreams Kullanımı

Servisleri telefonunuzdan veya AIOStreams üzerinden dış erişimle kullanmak isterseniz:

1. Klasördeki `.env.example` dosyasını kopyalayıp adını `.env` yapın.
2. `.env` içinde `ENABLE_TUNNEL=1` ayarını açın ve gerekirse AIOStreams değişkenlerini doldurun.
3. `cloudflared` kurulu değilse yükleyin (veya `PATH` üzerine ekleyin), ardından `baslat.bat` ile servisleri yeniden başlatın.

## Kısa Sorun Giderme

- **SmartScreen / PowerShell uyarısı**: `.bat` dosyaları PowerShell'i `-ExecutionPolicy Bypass` ile çağırır; Windows uyarısında **Ek bilgi → Yine de çalıştır** demeniz yeterlidir.
- **Nuvio'da kaynak görünmüyor**: Servislerin çalıştığından emin olun (`baslat.bat`). Değişiklik sonrası `durdur.bat` ve ardından `baslat.bat` çalıştırıp Nuvio'da eklentileri yenileyin.
- **Port çakışması (`7100` veya `3001`)**: Önce `durdur.bat` ile eski işlemleri kapatın, sonra `baslat.bat` ile temiz başlatın.
- **Kurulum yarım kaldıysa**: `kur.bat` dosyasını yeniden çalıştırabilirsiniz; eksik bileşenler tekrar kontrol edilip tamamlanır.

## Lisans ve Üçüncü Taraf Bileşenler

- Proje lisansı: [LICENSE](LICENSE)
- Üçüncü taraf lisans ve bildirimleri: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
