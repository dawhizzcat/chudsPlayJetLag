initMap();

// ---------- Timer ----------

let timerInterval = null;
let localHideEnd = null; // timestamp (ms) when hiding ends

function startLocalTimer(hideStart, hideTime) {
  const endTime = (hideStart * 1000) + (hideTime * 1000);

  // Only reset if we're more than 2 seconds off
  if (localHideEnd && Math.abs(localHideEnd - endTime) < 2000) return;
  localHideEnd = endTime;

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((localHideEnd - Date.now()) / 1000));
    document.getElementById("hideTimerHider").textContent = remaining;
    document.getElementById("hideTimerSeeker").textContent = remaining;
    if (remaining === 0) clearInterval(timerInterval);
  }, 1000);
}

// ---------- Profile / Game Setup ----------

async function createProfile() {
  const name = document.getElementById("nameInput").value.trim() || "Player";
  const profile = await apiPost("/profile/create", { name });

  if (!profile || profile.error || !profile.id) {
    alert("Failed to create profile: " + (profile?.error || "Unknown error"));
    return;
  }

  state.profile = profile;
  alert(`Profile created! Welcome, ${profile.name}`);
}

async function createGameFromInput() {
  const inputGameId = document.getElementById("gameIdInput").value.trim();
  if (!inputGameId) return alert("Please enter a game ID.");
  if (!state.profile) return alert("Please create a profile first.");

  state.gameId = inputGameId;

  const game = await apiPost("/game/create", {
    gameId: state.gameId,
    hostId: state.profile.id
  });

  if (!game || game.error) {
    alert("Failed to create game: " + (game?.error || "Unknown error"));
    state.gameId = null;
    return;
  }

  hideMenu();
  showScreen("hostScreen");
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

  if (!game || game.error) {
    alert("Failed to join: " + (game?.error || "Unknown error"));
    state.gameId = null;
    return;
  }

  hideMenu();
  showScreen("waitingScreen");
}

function hideMenu() {
  document.getElementById("menu").style.display = "none";
}

function showScreen(screenId) {
  ["homeScreen","waitingScreen","hostScreen","hiderScreen","seekerScreen"].forEach(id => {
    document.getElementById(id).style.display = (id === screenId ? "block" : "none");
  });
}

// ---------- Host Controls ----------

let selectedHiderId = null;

async function selectHider(hiderId) {
  selectedHiderId = hiderId;
  renderHostPlayerList(state.gameData);
  document.getElementById("startGameBtn").style.display = "inline-block";
}

async function startGameRound() {
  const hideTime = parseInt(document.getElementById("hideTimeInput").value);

  await apiPost("/game/select_hider", {
    gameId: state.gameId,
    hiderId: selectedHiderId,
    hostId: state.profile.id,
    hideTime
  });

  const game = await apiPost("/game/start", {
    gameId: state.gameId,
    hostId: state.profile.id
  });

  if (!game || game.error) {
    alert("Failed to start: " + (game?.error || "Unknown error"));
    return;
  }

  // Use server-returned hideStart for accuracy
  startLocalTimer(game.game.hideStart, hideTime);
}

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

// ---------- Polling ----------

async function pollState() {
  if (!state.gameId || !state.profile) return;

  const game = await apiGet(`/state/${state.gameId}`);
  if (!game || game.error) return;
  state.gameData = game;

  updateMarkers(game.positions);

  // Sync timer from server if in hide phase (only corrects if drifted >2s)
  if (game.status === "hide" && game.hideStart && game.hideTime) {
    startLocalTimer(game.hideStart, game.hideTime);
  }

  // Screen routing
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

// ---------- GPS ----------

navigator.geolocation.watchPosition(pos => {
  if (!state.gameId || !state.profile) return;

  apiPost("/position/update", {
    gameId: state.gameId,
    playerId: state.profile.id,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude
  });
});