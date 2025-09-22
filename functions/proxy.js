/**
 * Cloudflare Pages Function
 * This function acts as a secure proxy to the Gemini API.
 * It's the equivalent of the Vercel function but adapted for the Cloudflare Workers runtime.
 */
export async function onRequest(context) {
  // `context` berisi request, environment variables (env), dll.

  // --- START CORS FIX ---
  // Menangani preflight request (OPTIONS) untuk CORS
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  // --- END CORS FIX ---

  // Hanya izinkan metode POST
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Ambil API key dari Environment Variables yang diatur di Cloudflare
  // Perhatikan: Caranya berbeda dari Vercel, di sini menggunakan `context.env`
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key is not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // URL Gemini API
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

  try {
    // Ambil body dari request frontend
    const requestBody = await context.request.json();

    // Teruskan request ke Gemini API
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    // Jika Gemini error, teruskan errornya
    if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error("Gemini API Error:", errorText);
        return new Response(JSON.stringify({ error: `API Error: ${geminiResponse.statusText}` }), {
            status: geminiResponse.status,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Jika berhasil, ambil data dan kirim kembali
    const data = await geminiResponse.json();

    // Buat respons baru untuk dikirim ke frontend
    // Ini juga berbeda dari Vercel, kita membuat object `Response` baru
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Tambahkan header CORS di sini juga untuk respons utama
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Proxy Error:', error);
    return new Response(JSON.stringify({ error: 'An internal error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
