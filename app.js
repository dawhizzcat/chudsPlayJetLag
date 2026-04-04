initMap();

// ---------- Timer ----------

let timerInterval = null;
let localHideEnd = null;

function startLocalTimer(hideStart, hideTime) {
  const endTime = (hideStart * 1000) + (hideTime * 1000);

  if (localHideEnd && Math.abs(localHideEnd - endTime) < 2000) return;
  localHideEnd = endTime;

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((localHideEnd - Date.now()) / 1000));
    document.getElementById("hideTimerHider").textContent = remaining;
    document.getElementById("hideTimerSeeker").textContent = remaining;
    if (remaining === 0) {
      clearInterval(timerInterval);
      pollState(); // immediately sync with server on expiry
    }
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
  const screens = ["homeScreen","waitingScreen","hostScreen","hiderScreen","seekerScreen","seekMapScreen"];
  screens.forEach(id => {
    document.getElementById(id).style.display = (id === screenId ? "block" : "none");
  });

  // Invalidate map size when seek map becomes visible so tiles render correctly
  if (screenId === "seekMapScreen") {
    setTimeout(() => map.invalidateSize(), 100);
  }
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

// ---------- Question Menu ----------

const QUESTIONS = [
  "Are you within 500m of a road?",
  "Are you indoors?",
  "Are you within 1km of water?",
  "Are you on high ground?",
  "Are you within 500m of a park?",
  "Are you within 1km of the start point?",
  "Can you see a landmark?",
  "Are you moving?",
];

function toggleQuestionMenu() {
  const panel = document.getElementById("questionPanel");
  panel.style.display = panel.style.display === "none" ? "block" : "none";
}

async function askQuestion(question) {
  const result = await apiPost("/game/ask_question", {
    gameId: state.gameId,
    playerId: state.profile.id,
    question
  });

  if (!result || result.error) {
    alert("Failed to send question.");
    return;
  }

  toggleQuestionMenu();
  renderQuestionLog(state.gameData);
}

function renderQuestionLog(game) {
  const log = document.getElementById("questionLog");
  if (!log || !game.questions) return;
  log.innerHTML = "";
  game.questions.slice().reverse().forEach(q => {
    const el = document.createElement("div");
    el.className = "question-entry";
    el.innerHTML = `<span class="q-text">❓ ${q.question}</span>${q.answer ? `<span class="q-answer">→ ${q.answer}</span>` : "<span class='q-pending'>Awaiting answer...</span>"}`;
    log.appendChild(el);
  });
}

// ---------- Seeker Map Markers ----------

function updateSeekerMarkers(game) {
  // Show all seekers (not the hider) on the seek map
  const seekerPositions = {};
  for (const [id, pos] of Object.entries(game.positions)) {
    if (id !== game.hiderId) {
      seekerPositions[id] = pos;
    }
  }
  updateMarkers(seekerPositions, game.players);
}

// ---------- Polling ----------

let lastStatus = null;

async function pollState() {
  if (!state.gameId || !state.profile) return;

  const game = await apiGet(`/state/${state.gameId}`);
  if (!game || game.error) return;
  state.gameData = game;

  // Timer sync during hide phase
  if ((game.status === "hide" || game.status === "seek") && game.hideStart && game.hideTime) {
    if (game.status === "hide") startLocalTimer(game.hideStart, game.hideTime);
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

  } else if (game.status === "seek") {
    if (game.hiderId === state.profile.id) {
      // Hider just waits
      showScreen("hiderScreen");
      document.querySelector("#hiderScreen h2").textContent = "Seekers are hunting you!";
    } else {
      showScreen("seekMapScreen");
      updateSeekerMarkers(game);
      renderQuestionLog(game);
    }
  }

  lastStatus = game.status;
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