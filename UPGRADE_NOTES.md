# KuponLab v5.4 package / Model 5.2 Ensemble

Bu paket, kullanıcının v5.3 export'u üzerine yapılan analiz ve istek-optimizasyon güncellemesidir.

## Model 5.2 Ensemble

- Ana Dixon-Coles senaryosuna ek olarak iki alternatif senaryo hesaplanır:
  - **Muhafazakar:** beklenen golleri lig/taban ortalamasına yaklaştırır.
  - **Form:** son maçlardaki gol üretimi/yeme değişimine daha duyarlıdır.
- 1-X-2, 2.5 üst/alt ve KG marketleri bu üç senaryonun ağırlıklı birleşiminden üretilir.
- Her standart market için **stability** skoru hesaplanır.
- Senaryolar birbirinden ayrıştığında:
  - genel güven puanı düşer,
  - risk puanı artar,
  - otomatik kuponlarda maç daha zor seçilir,
  - kullanıcıya risk bayrağı gösterilir.
- Beklenen gol bölümünde senaryoların xG aralığı da döndürülür.

## Otomatik kupon güvenlik katmanı

- Düşük risk, dengeli, yüksek risk ve uzun kupon profillerine minimum stabilite eşikleri eklendi.
- Günlük fırsat ve “en iyi seçimler” puanlamasına stabilite dahil edildi.
- Çok düşük stabiliteli maçlar fırsat taramasından çıkarılır.
- Özel/hedef kupon üretiminde de stabilite kalite skoruna dahil edildi.

## Telefon/Safari istek azaltma

- GET sonuçları Safari `localStorage` içinde TTL ile saklanır.
- Aynı endpoint aynı anda birden fazla kez çağrılırsa tek ağ isteğine birleştirilir.
- Önbellek süreleri:
  - fikstür: 3 dk
  - maç analizi: 5 dk
  - günlük/geniş analiz: 10 dk
  - model sağlık raporu: 30 dk
  - oran hareketi: 1 dk
  - en iyi seçimler: 5 dk
- Model önbellek anahtarı v5.2 ile ayrıldı; eski analizler yeni modelde kullanılmaz.

## Backtest notu

Model sürümü 5.1 -> 5.2 olarak değiştirildi. Eski 5.1 kalibrasyonunu yeni modele körlemesine taşımak yerine v5.2 kendi backtest verisini toplamaya başlar. Model sağlık ekranı 5.1 ile 5.2'yi eşleşen maçlarda karşılaştıracak şekilde güncellendi.

## Doğrulama

- Tüm `lib/*.js` ve `api/*.js` dosyaları `node --check` ile sözdizimi kontrolünden geçti.
- `public/index.html` içindeki inline JavaScript ayrıca çıkarılıp sözdizimi kontrolünden geçti.
- Model 5.2 örnek maç verisiyle çalıştırılıp ensemble/stability çıktısı doğrulandı.
