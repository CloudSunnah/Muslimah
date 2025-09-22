/**
 * Vercel Serverless Function (with CORS fix)
 * This function acts as a secure proxy to the Gemini API.
 * It takes the request from our frontend, adds the secret API key on the server-side,
 * and then forwards the request to Google.
 * This keeps the API key safe and hidden from users.
 */
export default async function handler(request, response) {
  // --- START CORS FIX ---
  // Set headers to allow cross-origin requests.
  // This is crucial for the preview environment and other domains to access this API.
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Browsers send an OPTIONS (preflight) request before a POST request
  // to check for CORS permissions. We respond with OK immediately.
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }
  // --- END CORS FIX ---

  // Only allow POST method for the actual API call
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // Get the API key from Environment Variables configured in Vercel
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // If the API key is not found, send an error
    return response.status(500).json({ error: 'API key is not configured.' });
  }

  // The actual Gemini API URL
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

  try {
    // Forward the request from the frontend to the Gemini API
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Send the body from the frontend request directly to Gemini
      body: JSON.stringify(request.body),
    });

    // If Gemini returns an error, forward that error
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API Error:", errorText);
      return response.status(geminiResponse.status).json({ error: `API Error: ${geminiResponse.statusText}` });
    }

    // If successful, send the data from Gemini back to the frontend
    const data = await geminiResponse.json();

    // --- LOGIKA CACHING DITAMBAHKAN DI SINI ---
    // Memberi tahu Vercel untuk menyimpan jawaban ini di Edge selama 1 jam (3600 detik).
    // Ini akan mengurangi beban kerja fungsi jika ada permintaan yang sama persis.
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=60');

    return response.status(200).json(data);

  } catch (error) {
    console.error('Proxy Error:', error);
    return response.status(500).json({ error: 'An internal error occurred on the proxy server.' });
  }
}
