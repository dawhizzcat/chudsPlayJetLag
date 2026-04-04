initMap();

// ---------- Timer ----------

let timerInterval = null;
let localHideEnd = null;
let elapsedInterval = null;

function startLocalTimer(hideStart, hideTime) {
  const endTime = (hideStart * 1000) + (hideTime * 1000);
  if (localHideEnd && Math.abs(localHideEnd - endTime) < 2000) return;
  localHideEnd = endTime;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.floor((localHideEnd - Date.now()) / 1000));
    const rMins = Math.floor(remaining / 60);
    const rSecs = String(remaining % 60).padStart(2, "0");
    const rStr = `${rMins}:${rSecs}`;
    document.getElementById("hideTimerHider").textContent = rStr;
    document.getElementById("hideTimerSeeker").textContent = rStr;
    if (remaining === 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      // Immediately show seek screen locally — don't wait for poll
      if (state.gameData) {
        state.gameData.status = "seek";
        routeToScreen(state.gameData);
        if (!elapsedClockStarted && state.gameData.hideStart) {
          elapsedClockStarted = true;
          startElapsedClock(state.gameData.hideStart);
        }
      }
      pollState();
    }
  }, 1000);
}

function startElapsedClock(hideStart) {
  if (elapsedInterval) clearInterval(elapsedInterval);
  elapsedInterval = setInterval(() => {
    const elapsed = Math.floor(Date.now() / 1000 - hideStart);
    const mins = Math.floor(elapsed / 60);
    const secs = String(elapsed % 60).padStart(2, "0");
    const str = `${mins}:${secs}`;
    const h = document.getElementById("elapsedHider");
    const s = document.getElementById("elapsedSeeker");
    if (h) h.textContent = str;
    if (s) s.textContent = str;
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
  const game = await apiPost("/game/create", { gameId: state.gameId, hostId: state.profile.id });
  if (!game || game.error) {
    alert("Failed to create game: " + (game?.error || "Unknown error"));
    state.gameId = null;
    return;
  }
  // Host joins as a player too
  await apiPost("/game/join", {
    gameId: state.gameId,
    player: { id: state.profile.id, name: state.profile.name }
  });
  hideSplash();
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

  // Mid-round rejoin: route to correct screen and restore timers
  if (game.status === "hide" || game.status === "seek") {
    state.gameData = game;
    hideSplash();
    // Restore elapsed clock
    if (game.hideStart && !elapsedClockStarted) {
      elapsedClockStarted = true;
      startElapsedClock(game.hideStart);
    }
    // Restore countdown timer if still in hide phase
    if (game.status === "hide" && game.hideStart && game.hideTime) {
      startLocalTimer(game.hideStart, game.hideTime);
    }
    routeToScreen(game);
    startPollingFast();
    return;
  }

  hideSplash();
  if (game.hostId === state.profile.id) {
    showScreen("hostScreen");
  } else {
    showScreen("waitingScreen");
  }
}

function hideSplash() {
  document.getElementById("splashScreen").style.display = "none";
}

function showScreen(screenId) {
  const screens = [
    "waitingScreen", "hostScreen",
    "hiderScreen", "seekerScreen",
    "hiderSeekScreen", "seekMapScreen"
  ];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === screenId ? "" : "none");
  });
  if (screenId === "seekMapScreen") {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

// Route a player to the right screen based on game state
function routeToScreen(game) {
  if (game.status === "lobby") {
    if (game.hostId === state.profile.id) {
      // Reset hider selection when returning to lobby
      selectedHiderId = null;
      const startBtn = document.getElementById("startGameBtn");
      if (startBtn) startBtn.style.display = "none";
      showScreen("hostScreen");
      renderHostPlayerList(game);
    } else {
      showScreen("waitingScreen");
    }
    renderScores(game);

  } else if (game.status === "hide") {
    if (game.hiderId === state.profile.id) {
      showScreen("hiderScreen");
    } else {
      showScreen("seekerScreen");
    }

  } else if (game.status === "seek") {
    if (game.hiderId === state.profile.id) {
      showScreen("hiderSeekScreen");
      renderHiderSeekScreen(game);
    } else {
      showScreen("seekMapScreen");
      updateSeekerMarkers(game);
      renderQuestionLog(game);
      updateChallengeOverlay(game);
      updateOverlays(game.overlays, game.playAreaCenter, game.playAreaMiles);
      if (game.playAreaCenter && game.playAreaMiles) {
        updatePlayArea(game.playAreaCenter, game.playAreaMiles);
      }
    }
  }
}

// ---------- Host Controls ----------

let selectedHiderId = null;

async function selectHider(hiderId) {
  selectedHiderId = hiderId;
  renderHostPlayerList(state.gameData);
  document.getElementById("startGameBtn").style.display = "block";
}

async function startGameRound() {
  const startBtn = document.getElementById("startGameBtn");
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = "Starting..."; }

  const hideTime = parseInt(document.getElementById("hideTimeInput").value) * 60;
  const playAreaMiles = parseFloat(document.getElementById("playAreaInput").value) || null;

  await apiPost("/game/select_hider", {
    gameId: state.gameId, hiderId: selectedHiderId,
    hostId: state.profile.id, hideTime, playAreaMiles
  });

  // Optimistically show the right screen immediately
  const isHider = selectedHiderId === state.profile.id;
  showScreen(isHider ? "hiderScreen" : "seekerScreen");

  // Start a local best-guess timer while GPS + start call run in background
  const estimatedStart = Date.now() / 1000;
  startLocalTimer(estimatedStart, hideTime);
  startPollingFast();

  let hostLat = null, hostLng = null;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    hostLat = pos.coords.latitude;
    hostLng = pos.coords.longitude;
  } catch (e) {
    console.warn("[GPS] Could not get host position:", e);
  }

  const game = await apiPost("/game/start", {
    gameId: state.gameId, hostId: state.profile.id,
    hostLat, hostLng
  });
  if (!game || game.error) {
    alert("Failed to start: " + (game?.error || "Unknown error"));
    return;
  }
  // Re-sync timer to actual server hideStart
  startLocalTimer(game.game.hideStart, hideTime);
}

function renderHostPlayerList(game) {
  const container = document.getElementById("hostPlayerList");
  container.innerHTML = "";
  game.players.forEach(p => {
    const btn = document.createElement("button");
    btn.textContent = `${p.name}${selectedHiderId === p.id ? " ✅" : ""}`;
    btn.onclick = () => selectHider(p.id);
    container.appendChild(btn);
  });
}

// ---------- Scores ----------

function renderScores(game) {
  const container = document.getElementById("scoresList");
  if (!container) return;
  const scores = game.scores || [];
  if (scores.length === 0) {
    container.innerHTML = "<p class='empty-msg'>No rounds played yet.</p>";
    return;
  }
  container.innerHTML = "";
  [...scores].sort((a, b) => b.totalTime - a.totalTime).forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "score-entry";
    const mins = Math.floor(s.totalTime / 60);
    const secs = String(s.totalTime % 60).padStart(2, "0");
    const bonusMins = Math.floor(s.bonusTime / 60);
    const bonusSecs = String(s.bonusTime % 60).padStart(2, "0");
    const bonusStr = s.bonusTime > 0 ? ` <span class="score-bonus">(+${bonusMins}:${bonusSecs} bonus)</span>` : "";
    el.innerHTML = `
      <span class="score-rank">#${i + 1}</span>
      <span class="score-name">${s.hiderName}</span>
      <span class="score-time">${mins}:${secs}${bonusStr}</span>`;
    container.appendChild(el);
  });
}

// ---------- Questions (Seekers) ----------

const QUESTIONS = [
  "Are you within 500m of a road?",
  "Are you indoors?",
  "Are you within 1km of water?",
  "Are you on high ground?",
  "Are you within 500m of a park?",
  "Are you within 1km of the start point?",
  "Can you see a landmark?",
  "Are you moving?",
  "Are you within 500m of me?",
  "Are you within 1km of me?",
  "Are you within 2km of me?",
  "Are you within 3km of me?",
  "Are you north of me?",
  "Are you south of me?",
  "Are you east of me?",
  "Are you west of me?",
];

function toggleQuestionMenu() {
  const panel = document.getElementById("questionPanel");
  panel.style.display = panel.style.display === "none" ? "flex" : "none";
  // flex so the column layout works
  if (panel.style.display === "flex") {
    panel.style.flexDirection = "column";
  }
}

async function askQuestion(question) {
  let askerLat = null, askerLng = null;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    askerLat = pos.coords.latitude;
    askerLng = pos.coords.longitude;
  } catch (e) {
    console.warn("[GPS] Could not get seeker position:", e);
  }

  const result = await apiPost("/game/ask_question", {
    gameId: state.gameId, playerId: state.profile.id, question,
    askerLat, askerLng
  });
  if (!result || result.error) { alert("Failed to send question."); return; }
  toggleQuestionMenu();
  if (state.gameData) {
    state.gameData.questions.push(result.question);
    if (result.overlay) {
      state.gameData.overlays = state.gameData.overlays || [];
      state.gameData.overlays.push(result.overlay);
      updateOverlays(state.gameData.overlays, state.gameData.playAreaCenter, state.gameData.playAreaMiles);
    }
    renderQuestionLog(state.gameData);
  }
}

function renderQuestionLog(game) {
  const log = document.getElementById("questionLog");
  if (!log || !game.questions) return;
  log.innerHTML = "";
  game.questions.slice().reverse().forEach(q => {
    const el = document.createElement("div");
    el.className = "question-entry";
    const autoTag = q.auto ? `<span class="q-auto-tag">⚡ Auto</span>` : "";
    el.innerHTML = `<span class="q-text">❓ ${q.question} ${autoTag}</span>${q.answer
      ? `<span class="q-answer">→ ${q.answer}</span>`
      : "<span class='q-pending'>Awaiting answer...</span>"}`;
    log.appendChild(el);
  });
}

// ---------- Challenge Overlay ----------

function updateChallengeOverlay(game) {
  const overlay = document.getElementById("challengeOverlay");
  const challenge = game.activeChallenge;
  if (challenge) {
    document.getElementById("challengeName").textContent = challenge.name;
    document.getElementById("challengeDesc").textContent = challenge.desc;
    overlay.style.display = "flex";
  } else {
    overlay.style.display = "none";
  }
}

async function completeChallenge() {
  const result = await apiPost("/game/complete_challenge", {
    gameId: state.gameId, playerId: state.profile.id
  });
  if (!result || result.error) { alert("Failed to complete challenge."); return; }
  document.getElementById("challengeOverlay").style.display = "none";
  if (state.gameData) state.gameData.activeChallenge = null;
}

// ---------- Found Hider ----------

async function foundHider() {
  if (!confirm("Confirm: you have found the hider?")) return;
  const result = await apiPost("/game/found", {
    gameId: state.gameId, seekerId: state.profile.id
  });
  if (!result || result.error) { alert("Error: " + (result?.error || "Unknown")); return; }

  const s = result.score;
  const mins = Math.floor(s.totalTime / 60);
  const secs = String(s.totalTime % 60).padStart(2, "0");
  const bonusMins = Math.floor(s.bonusTime / 60);
  const bonusSecs = String(s.bonusTime % 60).padStart(2, "0");
  alert(`${s.hiderName} was hidden for ${mins}:${secs} (+${bonusMins}:${bonusSecs} bonus)!`);

  if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
  elapsedClockStarted = false;

  state.gameData = result.game;
  routeToScreen(result.game);
}

// ---------- Hider Seek Screen ----------

function renderHiderSeekScreen(game) {
  renderHiderQuestions(game);
  renderHiderCards(game);
  const bonus = game.bonusTime || 0;
  const badge = document.getElementById("bonusBadge");
  const bonusSec = document.getElementById("bonusSeconds");
  if (bonus > 0) {
    badge.style.display = "inline-flex";
    const bMins = Math.floor(bonus / 60);
    const bSecs = String(bonus % 60).padStart(2, "0");
    bonusSec.textContent = `${bMins}:${bSecs}`;
  } else {
    badge.style.display = "none";
  }
}

function renderHiderQuestions(game) {
  const container = document.getElementById("hiderQuestionList");
  const unanswered = (game.questions || []).filter(q => !q.answer);
  if (unanswered.length === 0) {
    container.innerHTML = "<p class='empty-msg'>No unanswered questions.</p>";
    return;
  }
  container.innerHTML = "";
  unanswered.forEach(q => {
    const el = document.createElement("div");
    el.className = "hider-question-item";
    el.innerHTML = `
      <p class="hq-text">❓ ${q.question}</p>
      <div class="hq-buttons">
        <button class="hq-btn yes" onclick="answerQuestion('${q.id}', 'Yes')">Yes</button>
        <button class="hq-btn no"  onclick="answerQuestion('${q.id}', 'No')">No</button>
      </div>`;
    container.appendChild(el);
  });
}

async function answerQuestion(questionId, answer) {
  const result = await apiPost("/game/answer_question", {
    gameId: state.gameId, hiderId: state.profile.id, questionId, answer
  });
  if (!result || result.error) { alert("Failed to submit answer."); return; }
  if (state.gameData) {
    const q = state.gameData.questions.find(q => q.id === questionId);
    if (q) q.answer = answer;
    renderHiderSeekScreen(state.gameData);
  }
}

function renderHiderCards(game) {
  const container = document.getElementById("hiderCardList");
  const cards = (game.hiderCards || []).filter(c => !c.played);
  if (cards.length === 0) {
    container.innerHTML = "<p class='empty-msg'>No cards in hand.</p>";
    return;
  }
  container.innerHTML = "";
  cards.forEach(card => {
    const el = document.createElement("div");
    el.className = `hider-card ${card.type}`;
    el.innerHTML = `
      <div class="card-header">
        <span class="card-type-badge">${card.type === "challenge" ? "⚔️ Challenge" : "⬆️ Buff"}</span>
        <span class="card-name">${card.name}</span>
      </div>
      <p class="card-desc">${card.desc}</p>
      <button class="card-play-btn" onclick="playCard('${card.id}')">Play Card</button>`;
    container.appendChild(el);
  });
}

async function playCard(cardId) {
  const result = await apiPost("/game/play_card", {
    gameId: state.gameId, hiderId: state.profile.id, cardId
  });
  if (!result || result.error) { alert("Failed to play card."); return; }
  if (state.gameData) {
    const card = state.gameData.hiderCards.find(c => c.id === cardId);
    if (card) card.played = true;
    state.gameData.bonusTime = result.bonusTime;
    if (result.activeChallenge) state.gameData.activeChallenge = result.activeChallenge;
    renderHiderSeekScreen(state.gameData);
  }
}

// ---------- Seeker Markers ----------

function updateSeekerMarkers(game) {
  const seekerPositions = {};
  for (const [id, pos] of Object.entries(game.positions)) {
    if (id !== game.hiderId) seekerPositions[id] = pos;
  }
  updateMarkers(seekerPositions, game.players);
}

// ---------- Close Room ----------

async function closeRoom() {
  if (!confirm("Close this room? All game data will be deleted.")) return;
  const result = await apiPost("/game/close", {
    gameId: state.gameId, hostId: state.profile.id
  });
  if (!result || result.error) {
    alert("Failed to close room: " + (result?.error || "Unknown error"));
    return;
  }
  // Reset local state and return to splash
  state.gameId = null;
  state.gameData = null;
  selectedHiderId = null;
  stopPollingFast();
  if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  elapsedClockStarted = false;
  localHideEnd = null;
  document.getElementById("splashScreen").style.display = "";
  showScreen("__none__");
}

// ---------- Polling ----------

let elapsedClockStarted = false;
let fastPollInterval = null;

// Switch to fast polling (1s) during active game phases, restore to 5s in lobby
function startPollingFast() {
  if (fastPollInterval) return;
  fastPollInterval = setInterval(pollState, 1000);
}
function stopPollingFast() {
  if (fastPollInterval) { clearInterval(fastPollInterval); fastPollInterval = null; }
}

async function pollState() {
  if (!state.gameId || !state.profile) return;
  let game;
  try {
    game = await apiGet(`/state/${state.gameId}`);
  } catch (e) {
    console.warn("[Poll] Network error:", e);
    return;
  }
  if (!game) return;
  if (game.error) {
    // Game was deleted (room closed by host) — return to splash
    if (game.error === "Game not found") {
      state.gameId = null;
      state.gameData = null;
      stopPollingFast();
      if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      elapsedClockStarted = false;
      localHideEnd = null;
      document.getElementById("splashScreen").style.display = "";
      showScreen("__none__");
    }
    return;
  }
  state.gameData = game;

  if ((game.status === "hide" || game.status === "seek") && game.hideStart && !elapsedClockStarted) {
    elapsedClockStarted = true;
    startElapsedClock(game.hideStart);
  }
  if (game.status === "hide" && game.hideStart && game.hideTime) {
    startLocalTimer(game.hideStart, game.hideTime);
    startPollingFast();
  }
  if (game.status === "seek") {
    startPollingFast();
  }
  if (game.status === "lobby") {
    elapsedClockStarted = false;
    if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
    stopPollingFast();
  }

  routeToScreen(game);
}

setInterval(pollState, 5000);


// ---------- GPS ----------

navigator.geolocation.watchPosition(pos => {
  if (!state.gameId || !state.profile) return;
  apiPost("/position/update", {
    gameId: state.gameId, playerId: state.profile.id,
    lat: pos.coords.latitude, lng: pos.coords.longitude
  });
});

async function checkServerStatus() {
  const el = document.getElementById("serverStatus");

  try {
    await fetch(baseUrl + "/", {
      headers: {
        "ngrok-skip-browser-warning": "123"
      }
    });

    el.textContent = "Server: Online";
    el.style.background = "rgba(0, 150, 0, 0.7)";
  } catch (e) {
    el.textContent = "Server: Offline";
    el.style.background = "rgba(150, 0, 0, 0.7)";
  }
}

// check every 3 seconds
setInterval(checkServerStatus, 3000);
checkServerStatus();