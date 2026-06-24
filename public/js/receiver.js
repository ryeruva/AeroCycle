// Handlebar display dashboard rendering and coordinator (Receiver)

let socket = null;
let sessionId = getQueryParam('session');
let map = null;
let pathPolyline = null;
let positionMarker = null;
let wakeLock = null;
let currentRideStatus = 'idle';

// UI Panel Sections
const pairingPanel = document.getElementById('pairing-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const dashboardControls = document.getElementById('dashboard-controls');
const pairingCodeDisplay = document.getElementById('display-pairing-code');

// Dashboard Metric Elements
const dashSpeed = document.getElementById('dash-speed');
const dashSpeedUnit = document.getElementById('dash-speed-unit');
const dashDistance = document.getElementById('dash-distance');
const dashDistanceUnit = document.getElementById('dash-distance-unit');
const dashDuration = document.getElementById('dash-duration');
const dashAvgSpeed = document.getElementById('dash-avg-speed');
const dashAvgSpeedUnit = document.getElementById('dash-avg-speed-unit');
const dashElevation = document.getElementById('dash-elevation');
const dashElevationUnit = document.getElementById('dash-elevation-unit');
const dashGpsAcc = document.getElementById('dash-gps-acc');
const gpsSignalIcon = document.getElementById('gps-signal-icon');
const dashHeartRate = document.getElementById('dash-heart-rate');
const dashHeartIcon = document.getElementById('dash-heart-icon');
const dashCadence = document.getElementById('dash-cadence');

// Control Buttons
const btnDashStart = document.getElementById('btn-dash-start');
const btnDashReset = document.getElementById('btn-dash-reset');
const btnWakelock = document.getElementById('btn-wakelock');
const unitToggle = document.getElementById('unit-toggle');

// Initialize Session
if (!sessionId) {
  alert('No session ID provided. Redirecting to home.');
  window.location.href = '/';
} else {
  pairingCodeDisplay.textContent = sessionId;
  document.getElementById('session-display').textContent = `Session: ${sessionId}`;
  
  // Create pairing QR code pointing to the sender url on this host
  const ipAddress = getQueryParam('ip') || window.location.hostname;
  const protocol = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : '';
  const senderUrl = `${protocol}//${ipAddress}${port}/sender.html?session=${sessionId}`;
  try {
    if (typeof QRCode !== 'undefined') {
      new QRCode(document.getElementById("qrcode"), {
        text: senderUrl,
        width: 180,
        height: 180,
        colorDark: "#0d0f12",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      console.warn("QRCode library not loaded. Rendering hyperlink instead.");
      document.getElementById("qrcode").innerHTML = `
        <div style="padding: 1rem; border: 1px dashed var(--panel-border); border-radius: 8px;">
          <p style="font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--text-secondary);">Open pairing URL on your iPhone:</p>
          <a href="${senderUrl}" target="_blank" style="color: var(--accent-cyan); word-break: break-all; font-size: 0.85rem; font-weight: 600;">${senderUrl}</a>
        </div>
      `;
    }
  } catch (err) {
    console.error("Error generating QR code:", err);
  }

  connectWebSocket();
  initMap();
  setupUnitControls();
  setupWakeLock();
}

// Initialize Leaflet Map
function initMap() {
  try {
    if (typeof L === 'undefined') {
      console.warn("Leaflet map library is not loaded. Map display is disabled.");
      document.querySelector('.map-side').innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: rgba(0,0,0,0.2); padding: 2rem; text-align: center; border-radius: 20px;">
          <i class="fa-solid fa-map-location-dot" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
          <h3>Map Offline / Unavailable</h3>
          <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.5rem;">Could not load Leaflet map tiles. Speed and metrics telemetry will still update normally.</p>
        </div>
      `;
      return;
    }

    // Set default view (centered around equator, will jump to rider immediately)
    map = L.map('map', {
      zoomControl: false, // Hide controls for a cleaner display look
      attributionControl: false
    }).setView([0, 0], 2);

    // CartoDB Dark Matter Tiles - Matches premium dark theme perfectly
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      minZoom: 1
    }).addTo(map);

    // Polyline for breadcrumb path - vibrant neon lime
    pathPolyline = L.polyline([], {
      color: '#a3e635',
      weight: 6,
      opacity: 0.95,
      lineJoin: 'round'
    }).addTo(map);

    // Current position indicator - cyan blue pulsing dot
    positionMarker = L.circleMarker([0, 0], {
      color: '#06b6d4',
      fillColor: '#06b6d4',
      fillOpacity: 0.9,
      radius: 9,
      weight: 3,
      opacity: 1
    });
  } catch (err) {
    console.error("Failed to initialize Leaflet map:", err);
  }
}

// Connect to WebSocket Server
function connectWebSocket() {
  const connectionIndicator = document.getElementById('connection-indicator');
  
  socket = new BikeWebSocket(
    'receiver',
    sessionId,
    // On Message
    (message) => {
      if (message.type === 'joined') {
        console.log(`Joined session ${sessionId} as RECEIVER.`);
      } else if (message.type === 'telemetry') {
        handleTelemetryUpdate(message.data);
      } else if (message.type === 'control') {
        // Sync states if sender triggers changes locally
        handleRemoteControl(message.action);
      }
    },
    // On Connection State Change
    (connected) => {
      if (connected) {
        connectionIndicator.className = 'badge-dot connected';
      } else {
        connectionIndicator.className = 'badge-dot';
      }
    }
  );
  
  socket.connect();
}

// Handle Incoming Telemetry
let dashboardVisible = false;

function handleTelemetryUpdate(data) {
  // Unhide dashboard on first telemetry packet received
  if (!dashboardVisible) {
    pairingPanel.style.display = 'none';
    dashboardPanel.style.display = 'grid';
    dashboardControls.style.display = 'flex';
    
    // Refresh map layout bounds since container was display:none
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
    
    dashboardVisible = true;
  }

  currentRideStatus = data.status;

  // 1. Update Core Metrics using Selected Unit Preference
  dashSpeed.textContent = Units.formatSpeed(data.speed);
  dashDistance.textContent = Units.formatDistance(data.distance);
  dashDuration.textContent = formatDuration(data.duration);
  dashAvgSpeed.textContent = Units.formatSpeed(data.avgSpeed);
  
  if (data.elevation !== null && data.elevation !== undefined) {
    dashElevation.textContent = Units.formatElevation(data.elevation);
  } else {
    dashElevation.textContent = '---';
  }

  // Heart Rate display & animation speed sync
  if (data.heartRate !== null && data.heartRate !== undefined) {
    dashHeartRate.textContent = data.heartRate;
    dashHeartIcon.classList.add('pulse-active');
    // Set animation duration dynamically (duration of 1 beat = 60 / BPM seconds)
    const duration = 60 / data.heartRate;
    dashHeartIcon.style.setProperty('--pulse-duration', `${duration}s`);
  } else {
    dashHeartRate.textContent = '---';
    dashHeartIcon.classList.remove('pulse-active');
  }

  // Cadence display
  if (data.cadence !== null && data.cadence !== undefined) {
    dashCadence.textContent = data.cadence;
  } else {
    dashCadence.textContent = '---';
  }

  // GPS Accuracy & Signal Color
  if (data.accuracy !== null && data.accuracy !== undefined) {
    dashGpsAcc.textContent = Math.round(data.accuracy);
    if (data.accuracy < 10) {
      gpsSignalIcon.style.color = 'var(--accent-green)';
    } else if (data.accuracy < 25) {
      gpsSignalIcon.style.color = 'var(--accent-orange)';
    } else {
      gpsSignalIcon.style.color = 'var(--accent-red)';
    }
  }

  // 2. Sync Controller Button State
  updateStartButtonState(data.status);

  // 3. Update Map marker and polyline (if map initialized successfully)
  if (map && positionMarker && pathPolyline) {
    if (data.lat !== null && data.lng !== null) {
      const latlng = [data.lat, data.lng];
      
      // Add marker to map if not present
      if (!map.hasLayer(positionMarker)) {
        positionMarker.addTo(map);
        map.setView(latlng, 16); // Center and zoom in on first signal
      } else {
        // Smoothly pan map to new position
        map.panTo(latlng);
        positionMarker.setLatLng(latlng);
      }
    }

    if (data.path && data.path.length > 0) {
      pathPolyline.setLatLngs(data.path);
    }
  }
}

// Remote controller logic: Send buttons action back to sender
btnDashStart.addEventListener('click', () => {
  let nextAction = 'start';
  if (currentRideStatus === 'recording') {
    nextAction = 'pause';
  }
  
  if (socket) {
    socket.send({
      type: 'control',
      action: nextAction
    });
  }
  // Optimistically toggle state
  handleRemoteControl(nextAction);
});

btnDashReset.addEventListener('click', () => {
  const confirmReset = confirm("Reset ride? This clears distance and map route history.");
  if (!confirmReset) return;

  if (socket) {
    socket.send({
      type: 'control',
      action: 'reset'
    });
  }
  handleRemoteControl('reset');
});

function handleRemoteControl(action) {
  if (action === 'start') {
    currentRideStatus = 'recording';
    updateStartButtonState('recording');
  } else if (action === 'pause') {
    currentRideStatus = 'paused';
    updateStartButtonState('paused');
  } else if (action === 'reset') {
    currentRideStatus = 'idle';
    updateStartButtonState('idle');
    
    // Clear display values
    dashSpeed.textContent = '0.0';
    dashDistance.textContent = '0.00';
    dashDuration.textContent = '00:00:00';
    dashAvgSpeed.textContent = '0.0';
    dashElevation.textContent = '---';
    dashHeartRate.textContent = '---';
    dashHeartIcon.classList.remove('pulse-active');
    dashCadence.textContent = '---';
    dashGpsAcc.textContent = '--';
    
    // Clear map paths (if map was initialized)
    if (pathPolyline) pathPolyline.setLatLngs([]);
    if (map && positionMarker && map.hasLayer(positionMarker)) {
      map.removeLayer(positionMarker);
    }
  }
}

function updateStartButtonState(status) {
  if (status === 'recording') {
    btnDashStart.className = 'btn btn-secondary';
    btnDashStart.innerHTML = '<i class="fa-solid fa-pause"></i> Pause Ride';
  } else {
    btnDashStart.className = 'btn btn-primary';
    btnDashStart.innerHTML = '<i class="fa-solid fa-play"></i> Start Ride';
  }
}

// Units configuration
function setupUnitControls() {
  const activeUnit = Config.units;
  updateUnitLabels(activeUnit);

  // Set initial active state in HTML
  document.querySelectorAll('.unit-btn').forEach(btn => {
    if (btn.dataset.unit === activeUnit) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  unitToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.unit-btn');
    if (!btn || btn.classList.contains('active')) return;

    // Toggle CSS classes
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update global config & storage
    const system = btn.dataset.unit;
    Config.units = system;
    localStorage.setItem('bike_units', system);
    
    // Update metric label elements
    updateUnitLabels(system);
  });
}

function updateUnitLabels(system) {
  const speedLbl = Units.speedLabel(system);
  const distLbl = Units.distanceLabel(system);
  const elevLbl = Units.elevationLabel(system);

  dashSpeedUnit.textContent = speedLbl;
  dashAvgSpeedUnit.textContent = speedLbl;
  dashDistanceUnit.textContent = distLbl;
  dashElevationUnit.textContent = elevLbl;
}

// Screen Wake Lock API Setup
function setupWakeLock() {
  if (!('wakeLock' in navigator)) {
    btnWakelock.style.display = 'none'; // Not supported
    return;
  }

  btnWakelock.addEventListener('click', async () => {
    if (wakeLock === null) {
      // Request lock
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        btnWakelock.className = 'btn btn-secondary wake-lock-status active';
        btnWakelock.querySelector('span').textContent = 'Screen Kept Awake';
        btnWakelock.querySelector('i').className = 'fa-solid fa-lightbulb';
        console.log('Screen Wake Lock acquired.');
        
        // Re-acquire lock if page visibility changes
        document.addEventListener('visibilitychange', handleVisibilityChange);
      } catch (err) {
        console.error(`Wake Lock failed: ${err.message}`);
        alert('Could not lock screen awake. Ensure you grant browser permissions.');
      }
    } else {
      // Release lock
      releaseWakeLock();
    }
  });
}

async function handleVisibilityChange() {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock re-acquired.');
    } catch (err) {
      console.error(`Wake Lock re-acquire failed: ${err.message}`);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => {
      wakeLock = null;
      btnWakelock.className = 'btn btn-secondary wake-lock-status';
      btnWakelock.querySelector('span').textContent = 'Keep Screen On';
      btnWakelock.querySelector('i').className = 'fa-regular fa-lightbulb';
      console.log('Screen Wake Lock released.');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
  }
}

// Initialize UI theme
initTheme();
