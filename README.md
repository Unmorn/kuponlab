# KuponLab v5.6 Cloudflare Edition

KuponLab'ın telefondan kullanılabilen, Hatchable bağımlılığı kaldırılmış Cloudflare Workers sürümü.

## v5.6 düzeltmeleri

- Fikstürler canlı İddaa programıyla tarih, saat ve takım adına göre önceden eşleştirilir; analiz çağrısı doğrudan resmi event kimliğini kullanır.
- İddaa/config/event çağrılarına tekilleştirme, güvenli timeout ve kısa süreli stale cache eklendi.
- Özel kupon kombinasyon araması Cloudflare Worker CPU sınırına uygun hâle getirildi; eksik seçim sayısı artık gizlenmez.
- Hedef oran kuponlarında İddaa event/market/outcome ve MBS bilgileri korunur.
- Nesine aktarımı canlı bültende tekrar doğrulama yapar; geçersiz seçimi sessizce düşürmez ve bahsi otomatik göndermez.
- D1 bağlı değilse model sağlığı ve oran hareketi ekranları boş veri yerine özelliğin neden kapalı olduğunu açıkça gösterir.
- API yöntem doğrulaması, gövde sınırı, güvenlik başlıkları ve otomatik testler eklendi.

## Ne değişti?

- Hatchable route formatı korunup Cloudflare Worker router'ına bağlandı.
- `hatchable` veritabanı bağımlılığı kaldırıldı.
- D1 için SQLite uyumlu DB adaptörü eklendi (`lib/db.js`).
- D1 bağlı değilken uygulama **stateless modda yine çalışır**; canlı fikstür ve analiz özellikleri kullanılabilir.
- D1 bağlanınca şema Worker tarafından ilk istekte otomatik hazırlanır.
- Static frontend Worker Static Assets üzerinden sunulur.
- API GET isteklerine Cloudflare edge cache eklendi.
- iPhone/Safari localStorage cache korunup ağ hatasında 6 saate kadar eski cache'e geri düşme eklendi.
- İddaa oran geçmişi ve tahmin kaydı D1'in 100 bind-parametre sınırına göre optimize edildi.
- Global Elo sorgusu iki takım için tek D1 sorgusuna indirildi.
- Günlük toplu analiz sırasında gereksiz DB yazımları kapatıldı; böylece D1 Free plan query limiti daha rahat korunur.
- Cron görevleri Cloudflare Scheduled Workers tetikleyicilerine taşındı.
- Yönetim/backfill endpointleri varsayılan olarak kapalıdır; `ADMIN_TOKEN` secret'ı tanımlanmadan erişilemez.

## Mimari

Safari -> Cloudflare Worker -> ESPN / İddaa public endpoints
                         -> D1 (opsiyonel)
                         -> Static Assets
                         -> Edge Cache

## D1 olmadan ne çalışır?

Fikstür, maç analizi, model marketleri, İddaa canlı market eşleme, akıllı kuponlar, seçim merkezi ve Nesine transfer doğrulaması çalışır. Kalıcı backtest/kalibrasyon, global Elo geçmişi, oran hareket geçmişi ve lineup snapshot geçmişi D1 bağlandığında devreye girer.

## Dosyalar

- `worker.js`: Cloudflare Worker giriş noktası ve API router.
- `public/`: mobil web arayüzü.
- `api/`: mevcut API handler'ları.
- `lib/`: model, veri kaynakları ve D1 adaptörü.
- `cloudflare/schema.sql`: D1 şemasının okunabilir kopyası.
- `wrangler.jsonc`: Worker + static assets + cron ayarları.
- `PHONE_DEPLOY.md`: yalnızca iPhone/Safari ile yayınlama planı.

## Lokal/CLI deploy (bilgisayar varsa)

```bash
npm install
npx wrangler deploy
```

Telefon senaryosunda CLI gerekmez; `PHONE_DEPLOY.md` dosyasındaki Git + Cloudflare Dashboard yolunu kullan.
