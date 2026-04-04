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
    document.getElementById("hideTimerHider").textContent = remaining;
    document.getElementById("hideTimerSeeker").textContent = remaining;
    if (remaining === 0) {
      clearInterval(timerInterval);
      console.log("[TIMER] Hit 0, firing pollState");
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
  const screens = [
    "homeScreen","waitingScreen","hostScreen",
    "hiderScreen","seekerScreen",
    "hiderSeekScreen","seekMapScreen"
  ];
  screens.forEach(id => {
    document.getElementById(id).style.display = (id === screenId ? "block" : "none");
  });
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
    gameId: state.gameId, hiderId: selectedHiderId,
    hostId: state.profile.id, hideTime
  });
  const game = await apiPost("/game/start", { gameId: state.gameId, hostId: state.profile.id });
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

// ---------- Question Menu (Seekers) ----------

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
    gameId: state.gameId, playerId: state.profile.id, question
  });
  if (!result || result.error) { alert("Failed to send question."); return; }
  toggleQuestionMenu();
  if (state.gameData) {
    state.gameData.questions.push(result.question);
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
    el.innerHTML = `<span class="q-text">❓ ${q.question}</span>${q.answer
      ? `<span class="q-answer">→ ${q.answer}</span>`
      : "<span class='q-pending'>Awaiting answer...</span>"}`;
    log.appendChild(el);
  });
}

// ---------- Challenge Overlay (Seekers) ----------

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
    gameId: state.gameId,
    playerId: state.profile.id
  });
  if (!result || result.error) { alert("Failed to complete challenge."); return; }
  // Hide overlay immediately, poll will confirm
  document.getElementById("challengeOverlay").style.display = "none";
  if (state.gameData) state.gameData.activeChallenge = null;
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
    bonusSec.textContent = bonus;
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

// ---------- Seeker Map Markers ----------

function updateSeekerMarkers(game) {
  const seekerPositions = {};
  for (const [id, pos] of Object.entries(game.positions)) {
    if (id !== game.hiderId) seekerPositions[id] = pos;
  }
  updateMarkers(seekerPositions, game.players);
}

// ---------- Polling ----------

let elapsedClockStarted = false;

async function pollState() {
  if (!state.gameId || !state.profile) return;

  const game = await apiGet(`/state/${state.gameId}`);
  if (!game || game.error) return;
  console.log("[POLL] status:", game.status, "hideStart:", game.hideStart, "hideTime:", game.hideTime);
  state.gameData = game;

  if ((game.status === "hide" || game.status === "seek") && game.hideStart && !elapsedClockStarted) {
    elapsedClockStarted = true;
    startElapsedClock(game.hideStart);
  }

  if (game.status === "hide" && game.hideStart && game.hideTime) {
    startLocalTimer(game.hideStart, game.hideTime);
  }

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
      showScreen("hiderSeekScreen");
      renderHiderSeekScreen(game);
    } else {
      showScreen("seekMapScreen");
      updateSeekerMarkers(game);
      renderQuestionLog(game);
      updateChallengeOverlay(game); // show/hide challenge blocking screen
    }
  }
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