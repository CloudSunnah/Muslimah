/**
 * Vercel Serverless Function
 * This function acts as a secure proxy to the Gemini API.
 * It takes the request from our frontend, adds the secret API key on the server-side,
 * and then forwards the request to Google.
 * This keeps the API key safe and hidden from users.
 */
export default async function handler(request, response) {
  // Hanya izinkan metode POST
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // Ambil API key dari Environment Variables yang sudah diatur di Vercel
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Jika API key tidak ada, kirim error
    return response.status(500).json({ error: 'API key is not configured.' });
  }

  // URL API Gemini yang sebenarnya
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

  try {
    // Teruskan request dari frontend ke Gemini API
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Kirim body dari request frontend langsung ke Gemini
      body: JSON.stringify(request.body),
    });

    // Jika Gemini mengembalikan error, teruskan error tersebut
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API Error:", errorText);
      return response.status(geminiResponse.status).json({ error: `API Error: ${geminiResponse.statusText}` });
    }

    // Jika berhasil, kirimkan kembali data dari Gemini ke frontend
    const data = await geminiResponse.json();
    return response.status(200).json(data);

  } catch (error) {
    console.error('Proxy Error:', error);
    return response.status(500).json({ error: 'An internal error occurred on the proxy server.' });
  }
}
