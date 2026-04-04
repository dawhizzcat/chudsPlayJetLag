initMap();

async function createProfile() {
  const name = document.getElementById("nameInput").value.trim() || "Player";
  const profile = await apiPost("/profile/create", { name });
  profileId = profile.id;  // <-- store this
  alert(`Profile created! Your ID: ${profileId}`);
}

async function createGameFromInput() {
  const inputGameId = document.getElementById("gameIdInput").value.trim();
  if (!inputGameId) return alert("Please enter a game ID.");
  if (!profileId) return alert("Please create a profile first.");

  gameId = inputGameId;

  try {
    const game = await apiPost("/game/create", {
      gameId,
      hostId: profileId
    });
    showScreen("hostScreen");
  } catch (e) {
    console.error("Create game failed:", e);
    alert("Failed to create game. Check console.");
  }
}

async function createGame(gameId) {
  return await apiPost("/game/create", { gameId });
}

async function joinGame() {
  const gameId = document.getElementById("gameIdInput").value;
  const player = state.profile;

  const game = await apiPost("/game/join", { gameId, player });

  state.gameId = gameId;
}

async function pollState() {
  if (!state.gameId) return;

  const game = await apiGet(`/state/${state.gameId}`);
  console.log("GAME DATA:", game);
  state.gameData = game;

  updateMarkers(game.positions);
}

setInterval(pollState, 5000);

// GPS updates
navigator.geolocation.watchPosition(pos => {
  if (!state.gameId || !state.profile) return;

  apiPost("/position/update", {
    gameId: state.gameId,
    playerId: state.profile.id,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude
  });
});







let profileId = null;
let gameId = null;

function showScreen(screenId) {
  ["homeScreen", "waitingScreen", "hiderScreen", "seekerScreen", "hostScreen"].forEach(id => {
    document.getElementById(id).style.display = (id === screenId) ? "block" : "none";
  });
}

// Poll game state every second
async function pollGameState() {
  if (!gameId || !profileId) return;

  const state = await apiGet(`/state/${gameId}`);

  // Role-based screens
  if (state.status === "lobby") {
    if (state.hostId === profileId) {
      showScreen("hostScreen");
      renderHostPlayerList(state);
    } else {
      showScreen("waitingScreen");
    }
  } else if (state.status === "started") {
    if (state.hiderId === profileId) {
      showScreen("hiderScreen");
    } else {
      showScreen("seekerScreen");
    }
  }
}

// Host selects a hider
async function selectHider(hiderId) {
  await apiPost("/game/select_hider", {
    gameId,
    hostId: profileId,
    hiderId
  });
}

// Render host's player list to pick a hider
function renderHostPlayerList(state) {
  const container = document.getElementById("hostPlayerList");
  container.innerHTML = "";
  state.players.forEach(p => {
    if (p.id !== profileId) {
      const btn = document.createElement("button");
      btn.textContent = p.name;
      btn.onclick = () => selectHider(p.id);
      container.appendChild(btn);
    }
  });
}

// Start polling
setInterval(pollGameState, 1000);

// Example: creating a game with host
async function createGameFromInput() {
  const inputGameId = document.getElementById("gameIdInput").value;
  gameId = inputGameId;
  const game = await apiPost("/game/create", { gameId, hostId: profileId });
  showScreen("hostScreen");
}