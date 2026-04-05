let map;
let markers = {};
let overlayLayers = [];
let playAreaLayer = null;
let playAreaFitted = false;

// --- Second map for hider seek screen ---
let hiderMap = null;
let hiderMarkers = {};
let hiderOverlayLayers = [];
let hiderPlayAreaLayer = null;
let hiderMapFitted = false;

function initMap() {
  map = L.map('map').setView([42.37, -72.52], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);
}

function initHiderMap() {
  // Destroy any previous instance so Leaflet can remeasure the now-visible div
  if (hiderMap) {
    hiderMap.remove();
    hiderMap = null;
    hiderMarkers = {};
    hiderOverlayLayers = [];
    hiderPlayAreaLayer = null;
    hiderMapFitted = false;
  }
  hiderMap = L.map('hiderMapDiv', { zoomControl: true }).setView([42.37, -72.52], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(hiderMap);
}

function updateHiderMap(game) {
  if (!hiderMap) return;

  // All players, labeled by name
  const nameMap = {};
  (game.players || []).forEach(p => nameMap[p.id] = p.name);
  const positions = game.positions || {};

  // Remove stale markers
  for (const id in hiderMarkers) {
    if (!positions[id]) { hiderMarkers[id].remove(); delete hiderMarkers[id]; }
  }

  for (const id in positions) {
    const pos = positions[id];
    if (!pos.lat || !pos.lng) continue;
    const label = nameMap[id] || id.slice(0, 6);
    const isHider = id === game.hiderId;
    const dotClass = isHider ? "marker-dot marker-dot-hider" : "marker-dot";
    const html = `<div class="player-marker"><div class="${dotClass}"></div><div class="marker-label">${label}</div></div>`;
    const icon = L.divIcon({ className: '', html, iconAnchor: [20, 20] });

    if (!hiderMarkers[id]) {
      hiderMarkers[id] = L.marker([pos.lat, pos.lng], { icon }).addTo(hiderMap);
      hiderMarkers[id]._jetlagDotClass = dotClass;
    } else {
      hiderMarkers[id].setLatLng([pos.lat, pos.lng]);
      // Recreate icon if role changed (e.g. hiderId resolved after marker was first drawn)
      if (hiderMarkers[id]._jetlagDotClass !== dotClass) {
        hiderMarkers[id].setIcon(icon);
        hiderMarkers[id]._jetlagDotClass = dotClass;
      }
    }
  }

  // Overlays — only redraw when count changes to avoid flicker on every poll
  const overlayCount = (game.overlays || []).length;
  if (overlayCount !== hiderOverlayLayers.length) {
    hiderOverlayLayers.forEach(l => hiderMap.removeLayer(l));
    hiderOverlayLayers = [];
    const bounds = (game.playAreaCenter && game.playAreaMiles)
      ? getPlayAreaBounds(game.playAreaCenter, game.playAreaMiles) : null;
    const BIG = bounds ? null : 10;
    (game.overlays || []).forEach(overlay => {
      let layer = null;
      if (overlay.type === "radius") layer = buildRadiusOverlay(overlay, bounds, BIG);
      else if (overlay.type === "half") layer = buildHalfPlaneOverlay(overlay, bounds, BIG);
      if (layer) { layer.addTo(hiderMap); hiderOverlayLayers.push(layer); }
    });
  }

  // Play area boundary
  if (!game.playAreaCenter || !game.playAreaMiles) {
    if (hiderPlayAreaLayer) { hiderMap.removeLayer(hiderPlayAreaLayer); hiderPlayAreaLayer = null; }
    hiderMapFitted = false;
  } else {
    const pb = getPlayAreaBounds(game.playAreaCenter, game.playAreaMiles);
    if (!hiderPlayAreaLayer) {
      hiderPlayAreaLayer = L.rectangle(pb, {
        color: "#facc15", weight: 2, fill: false, dashArray: "6 4"
      }).addTo(hiderMap);
    }
    if (!hiderMapFitted) {
      hiderMap.fitBounds(pb, { padding: [20, 20] });
      hiderMapFitted = true;
    }
  }
}

// players is optional array of {id, name} for labeling
function updateMarkers(positions, players) {
  const nameMap = {};
  if (players) players.forEach(p => nameMap[p.id] = p.name);

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

// Draw or update the play area boundary square
function updatePlayArea(center, miles) {
  if (!center || !miles) {
    // Round ended — clear layer and reset so next round fits again
    if (playAreaLayer) { map.removeLayer(playAreaLayer); playAreaLayer = null; }
    playAreaFitted = false;
    return;
  }

  const bounds = getPlayAreaBounds(center, miles);

  // Only draw the rectangle if it doesn't exist yet
  if (!playAreaLayer) {
    playAreaLayer = L.rectangle(bounds, {
      color: "#facc15",
      weight: 2,
      fill: false,
      dashArray: "6 4"
    }).addTo(map);
  }

  // Only zoom to fit once per round
  if (!playAreaFitted) {
    map.fitBounds(bounds, { padding: [20, 20] });
    playAreaFitted = true;
  }
}

// Returns Leaflet LatLngBounds for a square centered at center with side = miles
function getPlayAreaBounds(center, miles) {
  const metersPerMile = 1609.34;
  const halfM = (miles * metersPerMile) / 2;
  // Degrees per meter (approximate)
  const dLat = (halfM / 111320);
  const dLng = (halfM / (111320 * Math.cos(center.lat * Math.PI / 180)));
  return [
    [center.lat - dLat, center.lng - dLng],
    [center.lat + dLat, center.lng + dLng]
  ];
}

// Clear and redraw all exclusion zone overlays
function updateOverlays(overlays, playAreaCenter, playAreaMiles) {
  // Remove existing overlay layers
  overlayLayers.forEach(l => map.removeLayer(l));
  overlayLayers = [];

  if (!overlays || overlays.length === 0) return;

  // Compute play area bounds for clipping if available
  let bounds = null;
  if (playAreaCenter && playAreaMiles) {
    bounds = getPlayAreaBounds(playAreaCenter, playAreaMiles);
  }

  // Big padding for half-plane polygons (degrees)
  const BIG = bounds ? null : 10;

  overlays.forEach(overlay => {
    let layer = null;

    if (overlay.type === "radius") {
      layer = buildRadiusOverlay(overlay, bounds, BIG);
    } else if (overlay.type === "half") {
      layer = buildHalfPlaneOverlay(overlay, bounds, BIG);
    }

    if (layer) {
      layer.addTo(map);
      overlayLayers.push(layer);
    }
  });
}

// Hatched style for exclusion zones
function hatchStyle() {
  return {
    color: "#ef4444",
    weight: 1,
    fillColor: "#ef4444",
    fillOpacity: 0.25,
    dashArray: null
  };
}

// Build radius overlay: if inside=true, crosshatch outside the circle (hider must be inside)
// if inside=false, crosshatch inside the circle (hider must be outside)
function buildRadiusOverlay(overlay, bounds, BIG) {
  const center = [overlay.lat, overlay.lng];

  if (overlay.inside) {
    // Hider IS inside — shade everything outside the circle within play area
    // Use a large outer polygon with a circle hole (Leaflet supports this with arrays of rings)
    const outer = boundsToRing(bounds, BIG, overlay.lat, overlay.lng);
    const inner = circleRing(overlay.lat, overlay.lng, overlay.radiusM, 64);
    return L.polygon([outer, inner], hatchStyle());
  } else {
    // Hider is NOT inside — shade the circle itself
    const ring = circleRing(overlay.lat, overlay.lng, overlay.radiusM, 64);
    return L.polygon([ring], hatchStyle());
  }
}

// Build half-plane overlay
// direction = "north"|"south"|"east"|"west", hiderIs = true if hider IS in that direction
function buildHalfPlaneOverlay(overlay, bounds, BIG) {
  const lat = overlay.lat;
  const lng = overlay.lng;

  // Determine which half to shade (where hider CANNOT be)
  // If hider IS north, shade south half. If hider is NOT north, shade north half.
  let shadeDir;
  if (overlay.hiderIs) {
    // Hider confirmed in this direction → shade the opposite
    shadeDir = opposite(overlay.direction);
  } else {
    // Hider confirmed NOT in this direction → shade this direction
    shadeDir = overlay.direction;
  }

  // Build a rectangle covering the shaded half
  let ring;
  if (bounds) {
    const sw = bounds[0]; // [minLat, minLng]
    const ne = bounds[1]; // [maxLat, maxLng]
    const minLat = sw[0], minLng = sw[1], maxLat = ne[0], maxLng = ne[1];

    if (shadeDir === "north") {
      ring = [[lat, minLng], [maxLat, minLng], [maxLat, maxLng], [lat, maxLng]];
    } else if (shadeDir === "south") {
      ring = [[minLat, minLng], [lat, minLng], [lat, maxLng], [minLat, maxLng]];
    } else if (shadeDir === "east") {
      ring = [[minLat, lng], [maxLat, lng], [maxLat, maxLng], [minLat, maxLng]];
    } else { // west
      ring = [[minLat, minLng], [maxLat, minLng], [maxLat, lng], [minLat, lng]];
    }
  } else {
    const B = BIG;
    if (shadeDir === "north") {
      ring = [[lat, lng - B], [lat + B, lng - B], [lat + B, lng + B], [lat, lng + B]];
    } else if (shadeDir === "south") {
      ring = [[lat - B, lng - B], [lat, lng - B], [lat, lng + B], [lat - B, lng + B]];
    } else if (shadeDir === "east") {
      ring = [[lat - B, lng], [lat + B, lng], [lat + B, lng + B], [lat - B, lng + B]];
    } else { // west
      ring = [[lat - B, lng - B], [lat + B, lng - B], [lat + B, lng], [lat - B, lng]];
    }
  }

  return L.polygon([ring], hatchStyle());
}

function opposite(dir) {
  return { north: "south", south: "north", east: "west", west: "east" }[dir];
}

// Generate a polygon ring approximating a circle
function circleRing(lat, lng, radiusM, steps) {
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    const dLat = (radiusM * Math.cos(angle)) / 111320;
    const dLng = (radiusM * Math.sin(angle)) / (111320 * Math.cos(lat * Math.PI / 180));
    ring.push([lat + dLat, lng + dLng]);
  }
  return ring;
}

// Generate a large outer rectangle ring (for punching a hole)
function boundsToRing(bounds, BIG, lat, lng) {
  if (bounds) {
    const sw = bounds[0];
    const ne = bounds[1];
    // Add a small padding so the outer ring is slightly bigger than the play area
    const pad = 0.01;
    return [
      [sw[0] - pad, sw[1] - pad],
      [ne[0] + pad, sw[1] - pad],
      [ne[0] + pad, ne[1] + pad],
      [sw[0] - pad, ne[1] + pad]
    ];
  }
  const B = BIG;
  return [
    [lat - B, lng - B],
    [lat + B, lng - B],
    [lat + B, lng + B],
    [lat - B, lng + B]
  ];
}