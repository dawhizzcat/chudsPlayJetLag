const baseUrl = "https://wearifully-undeniable-emmett.ngrok-free.dev";

async function apiPost(path, data) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "123",
      "User-Agent": "Mozilla/5.0"
    },
    body: JSON.stringify(data)
  });
  return res.json();
}


async function apiGet(path) {
  const res = await fetch(baseUrl + path, {
    headers: {
        "ngrok-skip-browser-warning": "123",
        "User-Agent": "Mozilla/5.0"
    }
  });

  const text = await res.text();
  console.log("RAW RESPONSE:", text);

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("NOT JSON:", text);
    throw e;
  }
}
