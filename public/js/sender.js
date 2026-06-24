// Geolocation tracking and telemetry streamer for the iPhone (Sender Hub)

let socket = null;
let sessionId = getQueryParam('session');

// App State
let rideState = 'idle'; // 'idle', 'recording', 'paused'
let elapsedSeconds = 0;
let totalDistanceMeters = 0;
let averageSpeedMps = 0;
let currentSpeedMps = 0;
let currentElevationM = null;
let currentAccuracyM = null;

let pathCoordinates = []; // Array of [lat, lng]
let lastGpsCoords = null; // { lat, lng, timestamp }
let watchId = null;
let timerInterval = null;

// UI Elements
const statusCircle = document.getElementById('status-circle');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const btnPause = document.getElementById('btn-pause');
const btnReset = document.getElementById('btn-reset');
const liveSpeed = document.getElementById('live-speed-display').querySelector('span');
const liveDistance = document.getElementById('live-distance');
const liveDuration = document.getElementById('live-duration');
const consoleLog = document.getElementById('console-log');
const speedUnitLbl = document.getElementById('speed-unit-lbl');

// Initialize Session
if (!sessionId) {
  alert('No session ID provided. Redirecting to home.');
  window.location.href = '/';
} else {
  document.getElementById('session-display').textContent = `Session: ${sessionId}`;
  connectWebSocket();
}

function logSystem(message) {
  const line = document.createElement('div');
  line.className = 'console-line';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${time}] ${message}`;
  consoleLog.appendChild(line);
  consoleLog.scrollTop = consoleLog.scrollHeight;
  console.log(message);
}

// Haversine formula to compute distance in meters between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // earth radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Connect to WebSocket Server
function connectWebSocket() {
  const connectionIndicator = document.getElementById('connection-indicator');
  
  socket = new BikeWebSocket(
    'sender',
    sessionId,
    // On Message
    (message) => {
      if (message.type === 'joined') {
        logSystem(`Joined session ${sessionId} as SENDER.`);
        // Immediately sync current ride state to any listening display
        sendTelemetry();
      } else if (message.type === 'control') {
        logSystem(`Received remote control command: '${message.action}'`);
        handleRemoteControl(message.action);
      }
    },
    // On Connection State Change
    (connected) => {
      if (connected) {
        connectionIndicator.className = 'badge-dot connected';
        logSystem('WebSocket server connected.');
      } else {
        connectionIndicator.className = 'badge-dot';
        logSystem('WebSocket server disconnected. Retrying...');
      }
    }
  );
  
  socket.connect();
}

// GPS Tracking Logic
function startGpsTracking() {
  if (watchId !== null) return;

  if (!("geolocation" in navigator)) {
    logSystem("Error: Geolocation API not supported by browser.");
    alert("Geolocation is not supported by your browser!");
    return;
  }

  logSystem("Requesting high-accuracy GPS access...");
  
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      handleGpsUpdate(position);
    },
    (error) => {
      logSystem(`GPS Error: ${error.message} (Code ${error.code})`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
}

function stopGpsTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    logSystem("GPS tracking paused.");
  }
}

function handleGpsUpdate(position) {
  const { latitude, longitude, speed, altitude, accuracy } = position.coords;
  
  currentElevationM = altitude;
  currentAccuracyM = accuracy;
  
  // Filter out terrible GPS accuracy (> 35 meters) to avoid route spikes
  if (accuracy > 35) {
    logSystem(`Ignored GPS update (poor accuracy: ${accuracy.toFixed(1)}m)`);
    return;
  }

  // Speed processing (filtering GPS jitter when stationary)
  let speedValue = speed;
  if (speedValue === null || isNaN(speedValue) || speedValue < 0.3) {
    speedValue = 0;
  }
  currentSpeedMps = speedValue;

  logSystem(`GPS: Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)}, Speed ${Units.formatSpeed(currentSpeedMps)} ${Units.speedLabel()}`);

  if (rideState === 'recording') {
    const now = Date.now();
    
    if (lastGpsCoords) {
      // Calculate distance from previous point
      const stepDistance = calculateDistance(
        lastGpsCoords.lat, 
        lastGpsCoords.lng, 
        latitude, 
        longitude
      );

      // Only accumulate distance if the distance moved is reasonable (prevent drift when stopped)
      // Speed threshold check (speed > 0.3 m/s)
      if (stepDistance > 1.5 && currentSpeedMps > 0.3) {
        totalDistanceMeters += stepDistance;
        pathCoordinates.push([latitude, longitude]);
        logSystem(`Moved +${stepDistance.toFixed(1)}m. Total: ${Units.formatDistance(totalDistanceMeters)} ${Units.distanceLabel()}`);
      }
    } else {
      // First point of session
      pathCoordinates.push([latitude, longitude]);
    }

    lastGpsCoords = { lat: latitude, lng: longitude, timestamp: now };
  }

  // Trigger telemetry send immediately on GPS update
  sendTelemetry();
  updateUI();
}

// Timer Loop
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (rideState === 'recording') {
      elapsedSeconds++;
      if (elapsedSeconds > 0) {
        averageSpeedMps = totalDistanceMeters / elapsedSeconds;
      }
      updateUI();
      // Send telemetry updates every second even if GPS hasn't fired to keep display timer ticking
      sendTelemetry();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Stream Telemetry over WebSocket
function sendTelemetry() {
  if (!socket || !socket.isConnected) return;

  socket.send({
    type: 'telemetry',
    data: {
      speed: currentSpeedMps,
      distance: totalDistanceMeters,
      duration: elapsedSeconds,
      avgSpeed: averageSpeedMps,
      elevation: currentElevationM,
      accuracy: currentAccuracyM,
      lat: lastGpsCoords ? lastGpsCoords.lat : null,
      lng: lastGpsCoords ? lastGpsCoords.lng : null,
      status: rideState,
      path: pathCoordinates
    }
  });
}

// Control Operations
function startRide() {
  if (rideState === 'recording') return;
  
  rideState = 'recording';
  logSystem("Ride Started!");
  
  // UI styling changes
  statusCircle.className = "sender-status-circle recording";
  statusIcon.className = "fa-solid fa-pause";
  statusIcon.style.color = "var(--accent-green)";
  statusText.textContent = "Recording";
  btnPause.disabled = false;
  btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';

  startGpsTracking();
  startTimer();
  sendTelemetry();
  
  // Sync state to remote
  sendControlMessage('start');
}

function pauseRide() {
  if (rideState !== 'recording') return;

  rideState = 'paused';
  logSystem("Ride Paused.");

  // UI styling changes
  statusCircle.className = "sender-status-circle paused";
  statusIcon.className = "fa-solid fa-play";
  statusIcon.style.color = "var(--accent-orange)";
  statusText.textContent = "Paused";
  btnPause.innerHTML = '<i class="fa-solid fa-play"></i> Resume';

  stopTimer();
  // We keep GPS watching open so we can update speed and position, 
  // but we won't accumulate distance in handleGpsUpdate while paused.
  sendTelemetry();
  
  // Sync state to remote
  sendControlMessage('pause');
}

function resetRide() {
  const confirmReset = confirm("Are you sure you want to reset this ride? This will delete all path history and stats.");
  if (!confirmReset) return;

  rideState = 'idle';
  logSystem("Ride Reset.");
  
  // Reset states
  elapsedSeconds = 0;
  totalDistanceMeters = 0;
  averageSpeedMps = 0;
  currentSpeedMps = 0;
  currentElevationM = null;
  pathCoordinates = [];
  lastGpsCoords = null;

  // UI reset
  statusCircle.className = "sender-status-circle";
  statusIcon.className = "fa-solid fa-play";
  statusIcon.style.color = "var(--accent-cyan)";
  statusText.textContent = "Start Ride";
  btnPause.disabled = true;
  btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';

  stopTimer();
  stopGpsTracking();
  updateUI();
  sendTelemetry();
  
  // Sync state to remote
  sendControlMessage('reset');
}

// Send control actions back to server so it relays to receiver
function sendControlMessage(action) {
  if (socket) {
    socket.send({
      type: 'control',
      action: action
    });
  }
}

// Handle control triggers coming in from the Receiver (Remote control)
function handleRemoteControl(action) {
  if (action === 'start') {
    if (rideState !== 'recording') {
      rideState = 'recording';
      statusCircle.className = "sender-status-circle recording";
      statusIcon.className = "fa-solid fa-pause";
      statusIcon.style.color = "var(--accent-green)";
      statusText.textContent = "Recording";
      btnPause.disabled = false;
      btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
      startGpsTracking();
      startTimer();
      updateUI();
    }
  } else if (action === 'pause') {
    if (rideState === 'recording') {
      rideState = 'paused';
      statusCircle.className = "sender-status-circle paused";
      statusIcon.className = "fa-solid fa-play";
      statusIcon.style.color = "var(--accent-orange)";
      statusText.textContent = "Paused";
      btnPause.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
      stopTimer();
      updateUI();
    }
  } else if (action === 'reset') {
    rideState = 'idle';
    elapsedSeconds = 0;
    totalDistanceMeters = 0;
    averageSpeedMps = 0;
    currentSpeedMps = 0;
    currentElevationM = null;
    pathCoordinates = [];
    lastGpsCoords = null;

    statusCircle.className = "sender-status-circle";
    statusIcon.className = "fa-solid fa-play";
    statusIcon.style.color = "var(--accent-cyan)";
    statusText.textContent = "Start Ride";
    btnPause.disabled = true;
    btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    stopTimer();
    stopGpsTracking();
    updateUI();
  }
}

// Update local UI representation
function updateUI() {
  liveSpeed.textContent = Units.formatSpeed(currentSpeedMps);
  speedUnitLbl.textContent = Units.speedLabel();
  liveDistance.textContent = `${Units.formatDistance(totalDistanceMeters)} ${Units.distanceLabel()}`;
  liveDuration.textContent = formatDuration(elapsedSeconds);
}

// Button Events
statusCircle.addEventListener('click', () => {
  if (rideState === 'idle' || rideState === 'paused') {
    startRide();
  } else if (rideState === 'recording') {
    pauseRide();
  }
});

btnPause.addEventListener('click', () => {
  if (rideState === 'recording') {
    pauseRide();
  } else if (rideState === 'paused') {
    startRide();
  }
});

btnReset.addEventListener('click', resetRide);

// Listen to unit settings change if triggerable, keep default units matching common config
speedUnitLbl.textContent = Units.speedLabel();

// Initialize UI
updateUI();
initTheme();
