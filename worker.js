/**
 * dealiq Hybrid Worker
 * PDF → Anthropic Claude (native PDF support, ~$0.01/contract)
 * Text → Groq Llama (free)
 */

const ALLOWED_ORIGINS = [
  'https://dealiq.co.il',
  'https://www.dealiq.co.il',
  'http://localhost:3456',
  'http://127.0.0.1:3456',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResp(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function hasPdf(messages) {
  return (messages || []).some(m =>
    Array.isArray(m.content) &&
    m.content.some(b => b.type === 'document')
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }
      if (request.method !== 'POST') {
        return jsonResp({ error: { message: 'Method Not Allowed' } }, 405, origin);
      }
      const url = new URL(request.url);
      if (url.pathname !== '/messages') {
        return jsonResp({ error: { message: 'Not Found' } }, 404, origin);
      }

      let body;
      try { body = await request.json(); }
      catch { return jsonResp({ error: { message: 'Invalid JSON' } }, 400, origin); }

      // ── Route: PDF → Anthropic ──────────────────────────────────────
      if (hasPdf(body.messages)) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: body.max_tokens || 1024,
            system: body.system,
            messages: body.messages,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          return jsonResp({ error: { message: data?.error?.message || 'Anthropic error' } }, res.status, origin);
        }
        return jsonResp(data, 200, origin);
      }

      // ── Route: Text → Groq (free) ───────────────────────────────────
      const messages = [];
      if (body.system) messages.push({ role: 'system', content: body.system });

      for (const msg of (body.messages || [])) {
        let content = '';
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text') content += block.text + '\n';
          }
        } else {
          content = String(msg.content || '');
        }
        messages.push({ role: msg.role || 'user', content });
      }

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          max_tokens: body.max_tokens || 1024,
          temperature: 0.3,
        }),
      });

      const groqData = await groqRes.json();
      if (!groqRes.ok) {
        return jsonResp({ error: { message: groqData?.error?.message || 'Groq error' } }, groqRes.status, origin);
      }

      const text = groqData?.choices?.[0]?.message?.content || '';
      return jsonResp({ content: [{ type: 'text', text }] }, 200, origin);

    } catch (err) {
      return jsonResp({ error: { message: err.message || 'Worker error' } }, 500, origin);
    }
  },
};
