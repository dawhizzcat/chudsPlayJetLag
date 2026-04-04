initMap();

async function createGame(gameId) {
  return await apiPost("/game/create", { gameId });
}

async function joinGame() {
  if (!state.profile) return alert("Create a profile first!");
  const gameId = document.getElementById("gameIdInput").value.trim();
  if (!gameId) return alert("Enter a game ID!");

  const game = await apiPost("/game/join", { gameId, player: state.profile });
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

async function createProfile() {
  const name = document.getElementById("nameInput").value.trim() || "Player";
  const profile = await apiPost("/profile/create", { name });
  profileId = profile.id;
  state.profile = profile; // <-- store the whole profile object
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

function showScreen(screenId) {
  ["homeScreen","waitingScreen","hostScreen","hiderScreen","seekerScreen"].forEach(id => {
    document.getElementById(id).style.display = (id === screenId ? "block" : "none");
  });
}


// Select hider
let selectedHiderId = null;

async function selectHider(hiderId) {
  selectedHiderId = hiderId;
  renderHostPlayerList(state.gameData); // refresh buttons
  document.getElementById("startGameBtn").style.display = "inline-block";
}

// Start game
async function startGameRound() {
  const hideTime = parseInt(document.getElementById("hideTimeInput").value);
  await apiPost("/game/start", { gameId, hostId: profileId });

  // Update hideStart in local state for timer
  state.gameData.status = "hide";
  state.gameData.hideStart = Date.now() / 1000; // timestamp
  state.gameData.hideTime = hideTime;
}

// Render host player list
function renderHostPlayerList(game) {
  const container = document.getElementById("hostPlayerList");
  container.innerHTML = "";
  game.players.forEach(p => {
    if (p.id !== profileId) {
      const btn = document.createElement("button");
      btn.textContent = `${p.name}${selectedHiderId === p.id ? " ✅" : ""}`;
      btn.onclick = () => selectHider(p.id);
      container.appendChild(btn);
    }
  });
}

// Poll game state
async function pollGameState() {
  if (!gameId || !profileId) return;

  const game = await apiGet(`/state/${gameId}`);
  state.gameData = game;

  let hideRemaining = 0;
  if (game.status === "hide" && game.hideStart && game.hideTime) {
    const elapsed = Math.floor(Date.now() / 1000 - game.hideStart);
    hideRemaining = Math.max(0, game.hideTime - elapsed);
  }

  document.getElementById("hideTimerHider").textContent = hideRemaining;
  document.getElementById("hideTimerSeeker").textContent = hideRemaining;

  // Role-based screens
  if (game.status === "lobby") {
    if (game.hostId === profileId) {
      showScreen("hostScreen");
      renderHostPlayerList(game);
    } else {
      showScreen("waitingScreen");
    }
  } else if (game.status === "hide") {
    if (game.hiderId === profileId) {
      showScreen("hiderScreen");
    } else {
      showScreen("seekerScreen");
    }
  }
}
