const baseUrl = "https://YOUR_NGROK_URL";

async function apiPost(path, data) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(baseUrl + path);
  return res.json();
}
