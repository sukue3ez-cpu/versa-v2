export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gasUrl = process.env.GAS_WEB_APP_URL;
  if (!gasUrl || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl)) {
    return res.status(500).json({ error: 'GAS_WEB_APP_URL belum diatur dengan URL Web App /exec yang benar.' });
  }

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });

    const raw = await upstream.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({
        error: 'Apps Script tidak mengembalikan JSON. Pastikan deployment Web App aktif dan aksesnya sesuai.'
      });
    }
    return res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Tidak dapat menghubungi Apps Script. Periksa deployment dan koneksi.' });
  }
}

