/**
 * Cloudflare Pages Function
 * Versi baru ini berfungsi sebagai proxy ke Cloudflare Workers AI, bukan lagi ke Gemini.
 */
export async function onRequest(context) {
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

  // Hanya izinkan metode POST
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Ambil body dari request frontend (yang masih dalam format Gemini)
    const geminiRequestBody = await context.request.json();

    // --- TRANSFORMASI INPUT ---
    // Ubah format dari Gemini ke format yang dimengerti Cloudflare Workers AI
    const messages = [];

    // 1. Tambahkan System Prompt dari frontend Anda
    if (geminiRequestBody.systemInstruction && geminiRequestBody.systemInstruction.parts[0].text) {
      messages.push({
        role: 'system',
        content: geminiRequestBody.systemInstruction.parts[0].text
      });
    }

    // 2. Ubah histori percakapan
    if (geminiRequestBody.contents) {
      geminiRequestBody.contents.forEach(content => {
        messages.push({
          role: content.role === 'model' ? 'assistant' : 'user', // Ubah 'model' menjadi 'assistant'
          content: content.parts[0].text
        });
      });
    }

    // --- PEMANGGILAN AI CLOUDFLARE ---
    // Panggil model Llama 3 8B melalui binding 'AI' yang kita buat di Langkah 1
    const aiResponse = await context.env.AI.run(
      '@cf/meta/llama-3-8b-instruct',
      { messages }
    );
    
    // --- TRANSFORMASI OUTPUT ---
    // Bungkus respons dari Cloudflare agar formatnya mirip seperti Gemini,
    // sehingga frontend (index.html) tidak perlu diubah sama sekali.
    const geminiLikeResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: aiResponse.response || "Maaf, terjadi kesalahan dari AI."
              }
            ],
            role: "model"
          },
          // Properti lain bisa ditambahkan jika frontend membutuhkannya
        }
      ]
    };

    // Kirim kembali respons yang sudah diformat ke frontend
    return new Response(JSON.stringify(geminiLikeResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Proxy Error:', error);
    return new Response(JSON.stringify({ error: 'An internal error occurred.' }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
       },
    });
  }
}
