const baseUrl = "https://wearifully-undeniable-emmett.ngrok-free.dev";

async function apiPost(path, data) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true"
    },
    body: JSON.stringify(data)
  });
  return res.json();
}
async function apiGet(path) {
  const res = await fetch(baseUrl + path, {
    headers: {
      "ngrok-skip-browser-warning": "true"
    }
  });
  return res.json();
}
