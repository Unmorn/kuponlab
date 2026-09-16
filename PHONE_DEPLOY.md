# iPhone + Safari ile KuponLab yayınlama

Bu paket için telefona Termux, kod editörü veya başka bir uygulama kurmak gerekmez.

## En kolay yol

Cloudflare Worker kaynak kodu dashboard'da ZIP sürükle-bırak ile tam proje olarak import edilmiyor. Bu yüzden telefon için en temiz yol bir Git deposu üzerinden Cloudflare'a bağlamaktır.

1. Safari'de GitHub hesabına gir.
2. Yeni boş bir repo oluştur (örnek: `kuponlab`).
3. Bu ZIP'i iPhone Dosyalar uygulamasında açıp klasöre çıkar.
4. Repo dosyalarını GitHub'a yükle.
5. Safari'de Cloudflare Dashboard -> Workers & Pages -> Create application -> Import a repository yoluna gir.
6. `kuponlab` reposunu seç.
7. Worker projesi `wrangler.jsonc` dosyasını kullanır. Deploy et.
8. İlk açılışta `/api/_health` adresini kontrol et. `database: "stateless"` görmen normaldir.

Bu aşamada uygulamanın canlı analiz tarafı çalışabilir.

## D1'i sonra bağlamak

1. Cloudflare Dashboard -> Storage & Databases -> D1 -> Create database.
2. İsim: `kuponlab-db`.
3. Worker -> Bindings -> Add binding -> D1 database.
4. Variable name tam olarak: `DB`.
5. Database: `kuponlab-db`.
6. Worker'ı yeniden deploy et.

Sonraki `/api/_health` isteğinde `database: "d1"` görünür. Şema ilk API isteğinde otomatik oluşturulur; ayrıca SQL yapıştırmak zorunda değilsin.

## Yönetim endpointleri

Backfill endpointleri açık internete bırakılmadı. İstersen Worker -> Settings -> Variables and Secrets altında `ADMIN_TOKEN` secret'ı oluştur. Yönetim isteklerinde `x-admin-token` header'ı gerekir. Normal kullanım için buna ihtiyacın yok.

## Cronlar

`wrangler.jsonc` içinde:

- Her saat lineup kontrolü
- 2 saatte bir odds history yenileme
- Günlük global Elo
- Günlük performance grading/backfill
- Günlük model backtest/kalibrasyon

D1 bağlı değilse scheduled görevler güvenli biçimde atlanır.
