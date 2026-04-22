/**
 * Cloudflare Worker — Claude API Proxy for dealiq
 *
 * Deploy to: https://dash.cloudflare.com → Workers → Create → Paste this code
 * Set environment variable: ANTHROPIC_API_KEY = sk-ant-api03-...
 *
 * The Worker receives POST /messages from the dashboard,
 * injects the API key, forwards to Anthropic, and returns the response.
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

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Only accept /messages path
    const url = new URL(request.url);
    if (url.pathname !== '/messages') {
      return new Response('Not Found', { status: 404 });
    }

    // Forward to Anthropic
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify(body),
    });

    const data = await anthropicRes.text();

    return new Response(data, {
      status: anthropicRes.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(origin),
      },
    });
  },
};
