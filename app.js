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
