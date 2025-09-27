// Kode ini membutuhkan beberapa fungsi bantuan, kita definisikan di atas.
// Fungsi untuk mem-parse kunci privat dari format PEM
function importPrivateKey(pem) {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = pem.substring(pemHeader.length, pem.length - pemFooter.length - 1).replace(/\s/g, '');
  const binaryDer = atob(pemContents);
  const binaryDerArr = new Uint8Array(binaryDer.length);
  for (let i = 0; i < binaryDer.length; i++) {
    binaryDerArr[i] = binaryDer.charCodeAt(i);
  }
  return crypto.subtle.importKey("pkcs8", binaryDerArr, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]);
}

// Fungsi untuk membuat JWT
async function createJwt(serviceAccount, scope) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600, // Token berlaku selama 1 jam
    scope: scope,
  };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  const privateKey = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signatureInput));
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  return `${signatureInput}.${encodedSignature}`;
}

// Fungsi untuk mendapatkan Access Token Google
async function getAccessToken(serviceAccount) {
    const scope = "https://www.googleapis.com/auth/datastore";
    const jwt = await createJwt(serviceAccount, scope);
    
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    const data = await response.json();
    return data.access_token;
}

// ======================================================================
// FUNGSI UTAMA PROXY
// ======================================================================
export async function onRequest(context) {
  // Menangani preflight request (OPTIONS) untuk CORS
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Hanya izinkan metode POST
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  // Ambil semua secret dari environment
  const geminiApiKey = context.env.GEMINI_API_KEY;
  const firebaseServiceAccountStr = context.env.FIREBASE_SERVICE_ACCOUNT;
  const projectId = JSON.parse(firebaseServiceAccountStr).project_id;

  if (!geminiApiKey || !firebaseServiceAccountStr || !projectId) {
    return new Response(JSON.stringify({ error: 'Server configuration error.' }), { status: 500 });
  }

  try {
    const serviceAccount = JSON.parse(firebaseServiceAccountStr);
    const accessToken = await getAccessToken(serviceAccount);
    
    // --- Verifikasi Pengguna dari Frontend ---
    const idToken = context.request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!idToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    // Verifikasi token untuk mendapatkan UID
    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${geminiApiKey}`; // Gunakan gemini api key, karena web api key tidak di-set
    const verifyResponse = await fetch(verifyUrl, { method: 'POST', body: JSON.stringify({ idToken: idToken }) });
    const verifyData = await verifyResponse.json();
    const uid = verifyData?.users?.[0]?.localId;

    if (!uid) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    }
    
    // --- Logika Pembatasan Kuota ---
    const firestoreApiUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
    const userDocResponse = await fetch(firestoreApiUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    let aiCallCount = 0;
    let lastCallDate = '';

    if (userDocResponse.ok) {
        const docData = await userDocResponse.json();
        aiCallCount = docData.fields.aiCallCount?.integerValue || 0;
        lastCallDate = docData.fields.lastCallTimestamp?.timestampValue || new Date(0).toISOString();
    }
    
    const today = new Date().toISOString().split('T')[0];
    const lastDate = new Date(lastCallDate).toISOString().split('T')[0];

    if (today !== lastDate) {
        aiCallCount = 0; // Reset kuota jika hari sudah berbeda
    }

    if (aiCallCount >= 20) {
        return new Response(JSON.stringify({ error: 'Daily AI call limit exceeded. Please try again tomorrow.' }), { status: 429 });
    }

    // --- Lanjutkan ke Gemini API jika kuota OK ---
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-05-20:generateContent?key=${geminiApiKey}`;
    const requestBody = await context.request.json();
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API Error: ${geminiResponse.statusText}`);
    }

    // --- Update kuota pengguna di Firestore SETELAH panggilan berhasil ---
    const updatedFields = {
        fields: {
            aiCallCount: { integerValue: (aiCallCount + 1).toString() },
            lastCallTimestamp: { timestampValue: new Date().toISOString() }
        }
    };
    await fetch(`${firestoreApiUrl}?updateMask.fieldPaths=aiCallCount&updateMask.fieldPaths=lastCallTimestamp`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedFields),
    });

    const data = await geminiResponse.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Proxy Error:', error);
    return new Response(JSON.stringify({ error: 'An internal error occurred.' }), { status: 500 });
  }
}
