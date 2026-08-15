const baseUrl = "https://wearifully-undeniable-emmett.ngrok-free.dev";
const DEFAULT_TIMEOUT_MS = 8000;

async function apiPost(path, data, retry = true) {
  try {
    const res = await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "123",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    return res.json();
  } catch (e) {
    if (retry) {
      // One quiet retry covers the vast majority of transient blips
      // (brief cell handoff, a single dropped packet) without the caller
      // needing to know or handle it.
      await new Promise(r => setTimeout(r, 500));
      return apiPost(path, data, false);
    }
    throw e;
  }
}


async function apiGet(path, retry = true) {
  try {
    const res = await fetch(baseUrl + path, {
      headers: {
        "ngrok-skip-browser-warning": "123",
        "User-Agent": "Mozilla/5.0"
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });

    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("NOT JSON:", text);
      throw e;
    }
  } catch (e) {
    if (retry) {
      await new Promise(r => setTimeout(r, 500));
      return apiGet(path, false);
    }
    throw e;
  }
}