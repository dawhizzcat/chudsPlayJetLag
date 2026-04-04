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