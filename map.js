let map;
let markers = {};

function initMap() {
  map = L.map('map').setView([42.37, -72.52], 13); // Amherst area

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

function updateMarkers(positions) {
  for (let id in positions) {
    const pos = positions[id];

    if (!markers[id]) {
      markers[id] = L.marker([pos.lat, pos.lng]).addTo(map);
    } else {
      markers[id].setLatLng([pos.lat, pos.lng]);
    }
  }
}
