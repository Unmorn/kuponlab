import { iddaaProgram } from '../lib/iddaa.js';

export const access = 'public';
export const methods = ['GET'];

export default async function iddaaProgramRoute(req, res) {
  const date = String(req.query.date || '');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'Tarih geçersiz.' });
  try {
    const data = await iddaaProgram(date || null);
    return res.json({ ok: true, ...data });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'İddaa programı geçici olarak alınamadı.',
      detail: String(error?.message || error)
    });
  }
}
