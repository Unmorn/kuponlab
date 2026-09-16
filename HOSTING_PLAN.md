# Hosting planı — Cloudflare Edition tamamlandı

KuponLab v5.5 artık Hatchable olmadan Cloudflare Workers üzerinde çalışabilecek şekilde port edildi.

- Frontend: Workers Static Assets
- Backend: Cloudflare Worker (`worker.js`)
- Database: D1 (opsiyonel; binding adı `DB`)
- Scheduled jobs: Workers Cron Triggers
- Edge cache: GET API rotalarında Cloudflare cache
- Client cache: iPhone/Safari localStorage + stale fallback

Telefonun kendisini 7/24 web sunucusu yapmak yerine telefon sadece yönetim ve kullanım cihazıdır. Sunucu Cloudflare edge üzerinde çalışır.
