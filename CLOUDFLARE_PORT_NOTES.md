# KuponLab v5.5 Cloudflare port notları

## Runtime uyumluluğu

Hatchable'ın `req/res` API dosyaları yeniden yazılmadı. `worker.js` bunları Cloudflare Request/Response modeli ile uyumlu bir adaptör üzerinden çalıştırır. Böylece analiz kodu tek yerde kalır.

## D1 adaptörü

`lib/db.js` eski `db.query(sql, params)` ve `db.transaction([...])` çağrılarını D1 prepared statement'larına dönüştürür. PostgreSQL `$1` parametreleri D1'in `?` parametrelerine çevrilir. `now()` ve temel cast'ler SQLite biçimine normalize edilir.

PostgreSQL'e özel kalan sorgular doğrudan dönüştürüldü:

- `ANY(array)` -> parçalı `IN (...)`
- `LEAST/GREATEST` -> SQLite `MIN/MAX`
- interval tabanlı zaman sorguları -> SQLite datetime / Unix timestamp
- İstanbul günlük odds filtresi -> JS ile +03:00 gün başlangıç/bitiş timestamp'i
- JSONB kolonları -> JSON metni

D1'in bir sorguda 100 bind parametre sınırı nedeniyle toplu insert'ler güvenli SQL literal batching ile yapılıyor. Dış kaynak metinleri tek tırnak escaping ile güvenli hale getiriliyor.

## D1 query bütçesi

Free planda D1 sorgu sayısı önemli olduğu için:

- Global Elo ev/deplasman rating lookup 2 sorgudan 1 sorguya düşürüldü.
- Günlük toplu insights taramasında oran geçmişi ve prediction-history yazımı yapılmıyor.
- Tek maç analizinde kalıcı snapshot/odds/performance kayıtları devam ediyor.
- Büyük prediction ve odds insert'leri birkaç bulk statement'a indirildi.

## Stateless fallback

D1 binding yoksa DB adaptörü boş sonuç döndürür. Modelin esas canlı veri akışı ESPN/İddaa üzerinden çalışmaya devam eder. Bu, önce siteyi yayına alıp D1'i sonra bağlamayı mümkün kılar.
