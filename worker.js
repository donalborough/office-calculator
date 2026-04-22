/**
 * Cloudflare Worker — Gemini API Proxy for dealiq
 *
 * Set environment variable: GEMINI_API_KEY = your Google AI Studio key
 * Free tier: 15 req/min, 1M tokens/day — no credit card needed
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/messages') {
      return new Response('Not Found', { status: 404 });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response('Bad Request', { status: 400 }); }

    // Convert Anthropic-style request → Gemini format
    const parts = [];

    // System prompt
    if (body.system) {
      parts.push({ text: body.system + '\n\n' });
    }

    // Messages
    for (const msg of (body.messages || [])) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'document' && block.source?.type === 'base64') {
            parts.push({
              inlineData: {
                mimeType: block.source.media_type || 'application/pdf',
                data: block.source.data,
              }
            });
          }
        }
      } else {
        parts.push({ text: msg.content });
      }
    }

    const geminiBody = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: body.max_tokens || 1024,
        temperature: 0.3,
      }
    };

    const model = 'gemini-1.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      const errMsg = geminiData?.error?.message || 'Gemini API Error';
      return new Response(JSON.stringify({ error: { message: errMsg } }), {
        status: geminiRes.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    // Convert Gemini response → Anthropic-style format (so dashboard code works unchanged)
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const anthropicStyle = {
      content: [{ type: 'text', text }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };

    return new Response(JSON.stringify(anthropicStyle), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
