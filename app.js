initMap();

async function createProfile() {
  const name = document.getElementById("nameInput").value;
  const profile = await apiPost("/profile/create", { name });

  state.profile = profile;
  localStorage.setItem("profile", JSON.stringify(profile));
}

async function createGameFromInput() {
  const gameId = document.getElementById("gameIdInput").value.trim();
  if (!gameId) {
    alert("Please enter a game ID!");
    return;
  }

  try {
    const game = await apiPost("/game/create", { gameId });
    console.log("Game created:", game);
    alert(`Game ${game.gameId} created!`);
  } catch (e) {
    console.error("Failed to create game:", e);
    alert("Failed to create game, see console for details.");
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