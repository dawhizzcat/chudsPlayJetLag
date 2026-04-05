initMap();

// ---------- Session Persistence ----------
// Save profile + gameId to localStorage so page refresh / phone kill doesn't lose the session

function saveSession() {
  try {
    localStorage.setItem("jl_profile", JSON.stringify(state.profile));
    localStorage.setItem("jl_gameId", state.gameId || "");
  } catch(e) {}
}

function clearSession() {
  try {
    localStorage.removeItem("jl_profile");
    localStorage.removeItem("jl_gameId");
  } catch(e) {}
}

function loadSession() {
  try {
    const p = localStorage.getItem("jl_profile");
    const g = localStorage.getItem("jl_gameId");
    if (p) state.profile = JSON.parse(p);
    if (g) state.gameId = g || null;
  } catch(e) {}
}

// On page load: restore session and silently rejoin if we have a gameId
async function tryResumeSession() {
  loadSession();
  if (!state.profile || !state.gameId) {
    document.getElementById("splashScreen").style.display = "";
    return false;
  }

  console.log("[Session] Attempting silent rejoin:", state.gameId);

  let game;
  try {
    // Re-join to make sure we're in the player list (idempotent on backend)
    game = await apiPost("/game/join", {
      gameId: state.gameId,
      player: { id: state.profile.id, name: state.profile.name }
    });
  } catch(e) {
    console.warn("[Session] Rejoin network error:", e);
    document.getElementById("splashScreen").style.display = "";
    return false;
  }

  if (!game || game.error) {
    // Game is gone — clear stale session silently
    console.log("[Session] Game not found, clearing session");
    clearSession();
    state.gameId = null;
    document.getElementById("splashScreen").style.display = "";
    return false;
  }

  console.log("[Session] Rejoined successfully, status:", game.status);
  state.gameData = game;

  hideSplash();

  // Restore timers if mid-round
  if ((game.status === "hide" || game.status === "seek") && game.hideStart) {
    if (!elapsedClockStarted) {
      elapsedClockStarted = true;
      startElapsedClock(game.hideStart);
    }
    if (game.status === "hide" && game.hideTime) {
      startLocalTimer(game.hideStart, game.hideTime);
    }
    startPollingFast();
  }

  lastRoutedStatus = game.status; // prevent lobby from resetting hider selection on resume
  routeToScreen(game);
  return true;
}

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

// ---------- Offline Guard ----------

function isOffline() {
  // navigator.onLine is fast but not always accurate — we also track
  // server reachability via serverOnline flag updated by checkServerStatus
  return !navigator.onLine || !serverOnline;
}

async function createProfile() {
  if (isOffline()) { alert("You appear to be offline. Check your connection and try again."); return; }
  const name = document.getElementById("nameInput").value.trim() || "Player";
  const profile = await apiPost("/profile/create", { name });
  if (!profile || profile.error || !profile.id) {
    alert("Failed to create profile: " + (profile?.error || "Unknown error"));
    return;
  }
  state.profile = profile;
  saveSession(); // persist immediately
  alert(`Profile created! Welcome, ${profile.name}`);
}

async function createGameFromInput() {
  if (isOffline()) { alert("You appear to be offline. Check your connection and try again."); return; }
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
  await apiPost("/game/join", {
    gameId: state.gameId,
    player: { id: state.profile.id, name: state.profile.name }
  });
  saveSession();
  hideSplash();
  showScreen("hostScreen");
}

async function joinGame() {
  if (isOffline()) { alert("You appear to be offline. Check your connection and try again."); return; }
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

  saveSession();

  if (game.status === "hide" || game.status === "seek") {
    state.gameData = game;
    hideSplash();
    if (game.hideStart && !elapsedClockStarted) {
      elapsedClockStarted = true;
      startElapsedClock(game.hideStart);
    }
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
    if (!el) return;
    if (id === screenId) {
      el.style.display = (id === "hiderSeekScreen") ? "flex" : "";
    } else {
      el.style.display = "none";
    }
  });
  if (screenId === "seekMapScreen") {
    setTimeout(() => map.invalidateSize(), 100);
  }
  if (screenId === "hiderSeekScreen") {
    // Use rAF + timeout so the flex layout has fully painted before Leaflet measures
    requestAnimationFrame(() => {
      setTimeout(() => {
        initHiderMap();
        if (state.gameData) updateHiderMap(state.gameData);
      }, 150);
    });
  }
}

let lastRoutedStatus = null;

function routeToScreen(game) {
  if (game.status === "lobby") {
    if (game.hostId === state.profile.id) {
      // Only reset hider selection when transitioning INTO lobby, not on every poll
      if (lastRoutedStatus !== "lobby") {
        selectedHiderId = null;
        const startBtn = document.getElementById("startGameBtn");
        if (startBtn) startBtn.style.display = "none";
      }
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
      // Only call showScreen on transition into seek — not every poll.
      // showScreen triggers initHiderMap which resets zoom/overlays.
      if (lastRoutedStatus !== "seek") {
        showScreen("hiderSeekScreen");
      }
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
      // Car mode badge
      const carBadge = document.getElementById("carModeBadge");
      if (carBadge) carBadge.style.display = game.carMode ? "flex" : "none";
    }
  }
  lastRoutedStatus = game.status;
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

  gameStarting = true; // block pollState re-routing during start sequence

  const hideTime = parseInt(document.getElementById("hideTimeInput").value) * 60;
  const playAreaMiles = parseFloat(document.getElementById("playAreaInput").value) || null;
  const carMode = document.getElementById("carModeToggle").checked;

  await apiPost("/game/select_hider", {
    gameId: state.gameId, hiderId: selectedHiderId,
    hostId: state.profile.id, hideTime, playAreaMiles, carMode
  });

  const isHider = selectedHiderId === state.profile.id;
  showScreen(isHider ? "hiderScreen" : "seekerScreen");

  const estimatedStart = Date.now() / 1000;
  startLocalTimer(estimatedStart, hideTime);
  startPollingFast();

  // Use cached GPS — eliminates the 5s timeout that was blocking the start sequence
  const hostLat = lastKnownPos ? lastKnownPos.lat : null;
  const hostLng = lastKnownPos ? lastKnownPos.lng : null;

  const game = await apiPost("/game/start", {
    gameId: state.gameId, hostId: state.profile.id,
    hostLat, hostLng
  });

  gameStarting = false; // release — polls can route again

  if (!game || game.error) {
    alert("Failed to start: " + (game?.error || "Unknown error"));
    return;
  }
  // Re-sync timer to actual server hideStart, correcting estimated-start drift
  startLocalTimer(game.game.hideStart, hideTime);
  if (state.gameData) state.gameData.hideStart = game.game.hideStart;
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
  const isOpen = panel.style.display === "flex";
  panel.style.display = isOpen ? "none" : "flex";
  if (!isOpen) panel.style.flexDirection = "column";
}

// Questions pending server response — greyed out in the menu until answered or failed
const pendingQuestions = new Set();

async function askQuestion(question) {
  if (pendingQuestions.has(question)) return; // already in flight, ignore tap

  // Close menu and mark pending immediately — feels instant
  toggleQuestionMenu();
  pendingQuestions.add(question);
  renderQuestionButtons(); // grey out the button right away

  const askerLat = lastKnownPos ? lastKnownPos.lat : null;
  const askerLng = lastKnownPos ? lastKnownPos.lng : null;

  const result = await apiPost("/game/ask_question", {
    gameId: state.gameId, playerId: state.profile.id, question,
    askerLat, askerLng
  });

  pendingQuestions.delete(question);
  renderQuestionButtons(); // restore button

  if (!result || result.error) { alert("Failed to send question."); return; }

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

function renderQuestionButtons() {
  // Also grey out questions that are already unanswered in the log
  const unansweredQuestions = new Set(
    (state.gameData?.questions || [])
      .filter(q => !q.answer)
      .map(q => q.question)
  );
  const list = document.getElementById("questionList");
  if (!list) return;
  list.querySelectorAll(".question-option").forEach(btn => {
    const q = btn.dataset.question;
    const blocked = pendingQuestions.has(q) || unansweredQuestions.has(q);
    btn.disabled = blocked;
    btn.style.opacity = blocked ? "0.4" : "";
    btn.style.cursor = blocked ? "not-allowed" : "";
    btn.title = blocked ? "Awaiting answer..." : "";
  });
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

// Challenges with enforced durations (seconds). Name must match card name exactly.
const CHALLENGE_DURATIONS = {
  "Slowpoke": 120,
  "Wrong Way": 120,  // generous — they need time to walk 200m back too
  "U-Turn": 600,
};

let challengeTimerInterval = null;
let currentChallengeId = null; // track which challenge the timer belongs to

function updateChallengeOverlay(game) {
  const overlay = document.getElementById("challengeOverlay");
  const challenge = game.activeChallenge;

  if (!challenge) {
    overlay.style.display = "none";
    if (challengeTimerInterval) { clearInterval(challengeTimerInterval); challengeTimerInterval = null; }
    currentChallengeId = null;
    return;
  }

  document.getElementById("challengeName").textContent = challenge.name;
  document.getElementById("challengeDesc").textContent = challenge.desc;
  overlay.style.display = "flex";

  const duration = CHALLENGE_DURATIONS[challenge.name] || 0;
  const timerEl = document.getElementById("challengeTimer");
  const doneBtn = document.getElementById("challengeDoneBtn");

  // Only (re)start the timer if this is a new challenge
  if (challenge.id !== currentChallengeId) {
    currentChallengeId = challenge.id;
    if (challengeTimerInterval) { clearInterval(challengeTimerInterval); challengeTimerInterval = null; }

    if (duration > 0) {
      const endTime = (challenge.playedAt * 1000) + (duration * 1000);
      timerEl.style.display = "block";
      doneBtn.disabled = true;
      doneBtn.style.opacity = "0.4";

      challengeTimerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
        const m = Math.floor(remaining / 60);
        const s = String(remaining % 60).padStart(2, "0");
        timerEl.textContent = `⏳ ${m}:${s} remaining`;
        if (remaining === 0) {
          clearInterval(challengeTimerInterval);
          challengeTimerInterval = null;
          timerEl.textContent = "✅ Time's up — you may complete the challenge!";
          doneBtn.disabled = false;
          doneBtn.style.opacity = "";
        }
      }, 1000);
    } else {
      // No enforced duration — show immediately completable
      timerEl.style.display = "none";
      doneBtn.disabled = false;
      doneBtn.style.opacity = "";
    }
  }
}

async function completeChallenge() {
  const doneBtn = document.getElementById("challengeDoneBtn");
  if (doneBtn && doneBtn.disabled) return; // timer hasn't expired yet
  const result = await apiPost("/game/complete_challenge", {
    gameId: state.gameId, playerId: state.profile.id
  });
  if (!result || result.error) { alert("Failed to complete challenge."); return; }
  document.getElementById("challengeOverlay").style.display = "none";
  if (challengeTimerInterval) { clearInterval(challengeTimerInterval); challengeTimerInterval = null; }
  currentChallengeId = null;
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
  localHideEnd = null;

  state.gameData = result.game;
  routeToScreen(result.game);
}

// ---------- Hider Seek Screen ----------

function renderHiderSeekScreen(game) {
  renderHiderQuestions(game);
  renderHiderCards(game);
  updateHiderMap(game);
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

// ---------- Leave Game ----------

async function leaveGame() {
  if (!confirm("Leave this game? You can rejoin with the same game ID.")) return;
  // Only clear gameId — keep profile in localStorage so rejoin works after page refresh
  state.gameId = null;
  state.gameData = null;
  selectedHiderId = null;
  try { localStorage.setItem("jl_gameId", ""); } catch(e) {}
  stopPollingFast();
  if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  elapsedClockStarted = false;
  localHideEnd = null;
  lastRoutedStatus = null;
  document.getElementById("splashScreen").style.display = "";
  showScreen("__none__");
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
  resetToSplash();
}

function resetToSplash() {
  state.gameId = null;
  state.gameData = null;
  selectedHiderId = null;
  clearSession();           // wipe localStorage so we don't re-rejoin a dead game
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
let gameStarting = false; // blocks pollState routing during start sequence

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
    return; // silent — just try again next interval
  }
  if (!game) return;
  if (game.error) {
    if (game.error === "Game not found") {
      resetToSplash();
    }
    return;
  }
  // Don't re-route while the start sequence is in flight
  if (gameStarting) {
    state.gameData = game;
    return;
  }
  // Merge overlays: if server returns fewer overlays than we already have locally,
  // keep the local ones. This prevents a poll that lands between a question being
  // asked and the server write completing from wiping overlays off the map.
  if (state.gameData && game.overlays && state.gameData.overlays &&
      state.gameData.overlays.length > game.overlays.length) {
    game.overlays = state.gameData.overlays;
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
    localHideEnd = null;
  }

  routeToScreen(game);
}

setInterval(pollState, 5000);

// ---------- GPS ----------

let lastKnownPos = null; // cached so auto-questions work without a fresh GPS call

navigator.geolocation.watchPosition(pos => {
  lastKnownPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  if (!state.gameId || !state.profile) return;
  apiPost("/position/update", {
    gameId: state.gameId, playerId: state.profile.id,
    lat: pos.coords.latitude, lng: pos.coords.longitude
  });
}, err => console.warn("[GPS] watchPosition error:", err), {
  enableHighAccuracy: true, maximumAge: 10000
});

// ---------- Server Status ----------

let serverOnline = true; // tracks last known server reachability
let offlineStrikes = 0;  // require 2 consecutive failures before acting (avoids single blip)

async function checkServerStatus() {
  const el = document.getElementById("serverStatus");
  try {
    await fetch(baseUrl + "/", {
      headers: { "ngrok-skip-browser-warning": "123" },
      signal: AbortSignal.timeout(4000) // don't wait forever
    });
    el.textContent = "Server: Online";
    el.style.background = "rgba(0, 150, 0, 0.7)";
    serverOnline = true;
    offlineStrikes = 0;
  } catch (e) {
    offlineStrikes++;
    el.textContent = "Server: Offline";
    el.style.background = "rgba(150, 0, 0, 0.7)";
    // Only act after 2 consecutive failures to avoid false positives
    if (offlineStrikes >= 2) {
      serverOnline = false;
      // If we're in a game, silently leave (session preserved so they can rejoin)
      if (state.gameId) {
        console.warn("[Offline] Server unreachable — leaving room to prevent stuck state");
        // Same as leaveGame() but without the confirm dialog
        state.gameId = null;
        state.gameData = null;
        selectedHiderId = null;
        try { localStorage.setItem("jl_gameId", ""); } catch(err) {}
        stopPollingFast();
        if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        elapsedClockStarted = false;
        localHideEnd = null;
        lastRoutedStatus = null;
        document.getElementById("splashScreen").style.display = "";
        showScreen("__none__");
        alert("Lost connection to server. You have been returned to the lobby. Rejoin when back online.");
      }
    }
  }
}
setInterval(checkServerStatus, 3000);
checkServerStatus();

// ---------- Boot ----------
// Try to resume a saved session; if not, show splash normally
tryResumeSession();