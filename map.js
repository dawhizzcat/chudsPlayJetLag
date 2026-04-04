let map;
let markers = {};

function initMap() {
  map = L.map('map').setView([42.37, -72.52], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

// players is optional array of {id, name} for labeling
function updateMarkers(positions, players) {
  const nameMap = {};
  if (players) players.forEach(p => nameMap[p.id] = p.name);

  // Remove markers no longer in positions
  for (const id in markers) {
    if (!positions[id]) {
      markers[id].remove();
      delete markers[id];
    }
  }

  for (const id in positions) {
    const pos = positions[id];
    const label = nameMap[id] || id.slice(0, 6);

    if (!markers[id]) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="player-marker"><div class="marker-dot"></div><div class="marker-label">${label}</div></div>`,
        iconAnchor: [20, 20]
      });
      markers[id] = L.marker([pos.lat, pos.lng], { icon }).addTo(map);
    } else {
      markers[id].setLatLng([pos.lat, pos.lng]);
    }
  }
}