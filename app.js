initMap();

async function createProfile() {
  const name = document.getElementById("nameInput").value.trim() || "Player";
  const profile = await apiPost("/profile/create", { name });
  state.profile = profile;
  alert(`Profile created! Your ID: ${profile.id}`);
}

async function createGameFromInput() {
  const inputGameId = document.getElementById("gameIdInput").value.trim();
  if (!inputGameId) return alert("Please enter a game ID.");
  if (!state.profile) return alert("Please create a profile first.");

  state.gameId = inputGameId;

  try {
    const game = await apiPost("/game/create", {
      gameId: state.gameId,
      hostId: state.profile.id
    });
    showScreen("hostScreen");
  } catch (e) {
    console.error("Create game failed:", e);
    alert("Failed to create game. Check console.");
  }
}

async function joinGame() {
  if (!state.profile) return alert("Create a profile first!");
  const inputGameId = document.getElementById("gameIdInput").value.trim();
  if (!inputGameId) return alert("Enter a game ID!");

  state.gameId = inputGameId;

  const game = await apiPost("/game/join", {
    gameId: state.gameId,
    player: { id: state.profile.id, name: state.profile.name }
  });

  if (game.error) {
    alert("Failed to join: " + game.error);
    state.gameId = null;
    return;
  }

  showScreen("waitingScreen");
}

function showScreen(screenId) {
  ["homeScreen","waitingScreen","hostScreen","hiderScreen","seekerScreen"].forEach(id => {
    document.getElementById(id).style.display = (id === screenId ? "block" : "none");
  });
}

// Select hider
let selectedHiderId = null;

async function selectHider(hiderId) {
  selectedHiderId = hiderId;
  renderHostPlayerList(state.gameData);
  document.getElementById("startGameBtn").style.display = "inline-block";
}

// Start game
async function startGameRound() {
  const hideTime = parseInt(document.getElementById("hideTimeInput").value);
  await apiPost("/game/select_hider", {
    gameId: state.gameId,
    hiderId: selectedHiderId,
    hostId: state.profile.id,
    hideTime
  });
  await apiPost("/game/start", {
    gameId: state.gameId,
    hostId: state.profile.id
  });

  state.gameData.status = "hide";
  state.gameData.hideStart = Date.now() / 1000;
  state.gameData.hideTime = hideTime;
}

// Render host player list
function renderHostPlayerList(game) {
  const container = document.getElementById("hostPlayerList");
  container.innerHTML = "";
  game.players.forEach(p => {
    if (p.id !== state.profile.id) {
      const btn = document.createElement("button");
      btn.textContent = `${p.name}${selectedHiderId === p.id ? " ✅" : ""}`;
      btn.onclick = () => selectHider(p.id);
      container.appendChild(btn);
    }
  });
}

// Poll game state
async function pollState() {
  if (!state.gameId || !state.profile) return;

  const game = await apiGet(`/state/${state.gameId}`);
  if (game.error) return;
  state.gameData = game;

  updateMarkers(game.positions);

  let hideRemaining = 0;
  if (game.status === "hide" && game.hideStart && game.hideTime) {
    const elapsed = Math.floor(Date.now() / 1000 - game.hideStart);
    hideRemaining = Math.max(0, game.hideTime - elapsed);
  }

  document.getElementById("hideTimerHider").textContent = hideRemaining;
  document.getElementById("hideTimerSeeker").textContent = hideRemaining;

  if (game.status === "lobby") {
    if (game.hostId === state.profile.id) {
      showScreen("hostScreen");
      renderHostPlayerList(game);
    } else {
      showScreen("waitingScreen");
    }
  } else if (game.status === "hide") {
    if (game.hiderId === state.profile.id) {
      showScreen("hiderScreen");
    } else {
      showScreen("seekerScreen");
    }
  }
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