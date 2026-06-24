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

// Heart Rate and Cadence Sensors
let currentHeartRate = null;
let currentCadence = null;
let isSimMode = false;
let simRouteIndex = 0;

let bleHrDevice = null;
let bleHrChar = null;
let bleCadenceDevice = null;
let bleCadenceChar = null;

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

const liveHeartRate = document.getElementById('live-heart-rate');
const liveCadence = document.getElementById('live-cadence');
const simModeToggle = document.getElementById('sim-mode-toggle');
const hrStatus = document.getElementById('hr-status');
const btnConnectHr = document.getElementById('btn-connect-hr');
const cadenceStatus = document.getElementById('cadence-status');
const btnConnectCadence = document.getElementById('btn-connect-cadence');

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

// Simulation Position Generator
function getSimulatedPosition(index) {
  // Center of Central Park: 40.785091, -73.968285
  const centerLat = 40.785091;
  const centerLng = -73.968285;
  const radius = 0.005; // elliptical loop
  const angle = (index * 0.015) % (2 * Math.PI);
  const lat = centerLat + radius * Math.cos(angle);
  const lng = centerLng + radius * Math.sin(angle) * 0.75;
  return { lat, lng };
}

// Workout Simulation Step
function runSimulationStep() {
  simRouteIndex++;
  const pos = getSimulatedPosition(simRouteIndex);
  
  // Simulated speed (averaging ~22 km/h with variability)
  currentSpeedMps = 5.2 + Math.sin(simRouteIndex * 0.06) * 2.2 + Math.random() * 0.4;
  
  // Simulated heart rate (matches effort/speed)
  if (!bleHrDevice) {
    const baseHr = 135;
    const speedEffortFactor = (currentSpeedMps - 5) * 6;
    currentHeartRate = Math.round(baseHr + speedEffortFactor + Math.sin(simRouteIndex * 0.04) * 8 + Math.random() * 2);
    currentHeartRate = Math.max(90, Math.min(185, currentHeartRate));
  }
  
  // Simulated cadence (normal cycling range 78-92 rpm)
  if (!bleCadenceDevice) {
    currentCadence = Math.round(84 + Math.cos(simRouteIndex * 0.05) * 5 + Math.random() * 1.5);
  }
  
  currentElevationM = Math.round(42 + Math.sin(simRouteIndex * 0.012) * 15);
  currentAccuracyM = 3.2; // premium GPS signal simulation

  const latitude = pos.lat;
  const longitude = pos.lng;
  const now = Date.now();

  if (lastGpsCoords) {
    const stepDistance = calculateDistance(
      lastGpsCoords.lat, 
      lastGpsCoords.lng, 
      latitude, 
      longitude
    );
    // Accumulate simulated distance
    totalDistanceMeters += stepDistance;
    pathCoordinates.push([latitude, longitude]);
  } else {
    // Start of path
    pathCoordinates.push([latitude, longitude]);
  }
  
  lastGpsCoords = { lat: latitude, lng: longitude, timestamp: now };
  
  // Periodic console log to avoid scrolling spam
  if (simRouteIndex % 5 === 0) {
    logSystem(`[Sim] GPS: Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)}, Speed ${Units.formatSpeed(currentSpeedMps)} ${Units.speedLabel()}, HR: ${currentHeartRate} bpm, Cadence: ${currentCadence} rpm`);
  }
}

// Web Bluetooth HRM pairing
async function connectHeartRate() {
  if (bleHrDevice) {
    disconnectHr();
    return;
  }

  if (!navigator.bluetooth) {
    logSystem("Error: Web Bluetooth API not supported in this browser.");
    alert("Web Bluetooth is not supported in this browser. Try Chrome on Android/Desktop, or Bluefy on iOS.");
    return;
  }

  logSystem("Searching for Bluetooth Heart Rate Monitor...");
  hrStatus.className = "sensor-status scanning";
  hrStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Scanning...';
  
  try {
    bleHrDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }]
    });
    
    logSystem(`HRM Found: ${bleHrDevice.name}. Connecting...`);
    bleHrDevice.addEventListener('gattserverdisconnected', onHrDisconnected);
    
    const server = await bleHrDevice.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    bleHrChar = await service.getCharacteristic('heart_rate_measurement');
    
    await bleHrChar.startNotifications();
    bleHrChar.addEventListener('characteristicvaluechanged', handleHrMeasurement);
    
    hrStatus.className = "sensor-status connected";
    hrStatus.innerHTML = `<i class="fa-solid fa-circle"></i> Connected (${bleHrDevice.name})`;
    btnConnectHr.className = "btn-ble-connect connected";
    btnConnectHr.textContent = "Disconnect";
    logSystem("Heart Rate Monitor connected successfully.");
  } catch (err) {
    logSystem(`HRM Error: ${err.message}`);
    disconnectHr();
  }
}

function handleHrMeasurement(event) {
  const value = event.target.value;
  const flags = value.getUint8(0);
  const rate16 = flags & 0x01;
  let hrValue;
  if (rate16) {
    hrValue = value.getUint16(1, true);
  } else {
    hrValue = value.getUint8(1);
  }
  currentHeartRate = hrValue;
  updateUI();
  sendTelemetry();
}

function disconnectHr() {
  if (bleHrChar) {
    try { bleHrChar.stopNotifications(); } catch(e){}
    bleHrChar = null;
  }
  if (bleHrDevice && bleHrDevice.gatt.connected) {
    bleHrDevice.gatt.disconnect();
  }
  bleHrDevice = null;
  onHrDisconnected();
}

function onHrDisconnected() {
  hrStatus.className = "sensor-status disconnected";
  hrStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Disconnected';
  btnConnectHr.className = "btn-ble-connect disconnected";
  btnConnectHr.textContent = "Connect";
  currentHeartRate = null;
  updateUI();
  logSystem("Heart Rate Monitor disconnected.");
}

// Web Bluetooth Cadence pairing
let lastCrankRevolutions = 0;
let lastCrankTime = 0;

async function connectCadence() {
  if (bleCadenceDevice) {
    disconnectCadence();
    return;
  }

  if (!navigator.bluetooth) {
    logSystem("Error: Web Bluetooth API not supported in this browser.");
    alert("Web Bluetooth is not supported in this browser. Try Chrome on Android/Desktop, or Bluefy on iOS.");
    return;
  }

  logSystem("Searching for Bluetooth Speed & Cadence Sensor...");
  cadenceStatus.className = "sensor-status scanning";
  cadenceStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Scanning...';
  
  try {
    bleCadenceDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['cycling_speed_and_cadence'] }]
    });
    
    logSystem(`Cadence Found: ${bleCadenceDevice.name}. Connecting...`);
    bleCadenceDevice.addEventListener('gattserverdisconnected', onCadenceDisconnected);
    
    const server = await bleCadenceDevice.gatt.connect();
    const service = await server.getPrimaryService('cycling_speed_and_cadence');
    bleCadenceChar = await service.getCharacteristic('csc_measurement');
    
    await bleCadenceChar.startNotifications();
    bleCadenceChar.addEventListener('characteristicvaluechanged', handleCadenceMeasurement);
    
    cadenceStatus.className = "sensor-status connected";
    cadenceStatus.innerHTML = `<i class="fa-solid fa-circle"></i> Connected (${bleCadenceDevice.name})`;
    btnConnectCadence.className = "btn-ble-connect connected";
    btnConnectCadence.textContent = "Disconnect";
    logSystem("Cadence sensor connected successfully.");
  } catch (err) {
    logSystem(`Cadence Error: ${err.message}`);
    disconnectCadence();
  }
}

function handleCadenceMeasurement(event) {
  const value = event.target.value;
  const flags = value.getUint8(0);
  let index = 1;
  
  // Skip wheel revolutions if present (wheel = 6 bytes)
  if (flags & 0x01) {
    index += 6;
  }
  
  // Cadence crank revolutions
  if (flags & 0x02) {
    const crankRevolutions = value.getUint16(index, true);
    const crankTime = value.getUint16(index + 2, true); // 1/1024s unit
    
    if (lastCrankTime > 0 && crankTime !== lastCrankTime) {
      let revDiff = crankRevolutions - lastCrankRevolutions;
      if (revDiff < 0) revDiff += 65536; // rollover
      
      let timeDiff = (crankTime - lastCrankTime) / 1024;
      if (timeDiff < 0) timeDiff += 64; // rollover
      
      if (timeDiff > 0) {
        currentCadence = Math.round((revDiff / timeDiff) * 60);
      }
    }
    lastCrankRevolutions = crankRevolutions;
    lastCrankTime = crankTime;
    updateUI();
    sendTelemetry();
  }
}

function disconnectCadence() {
  if (bleCadenceChar) {
    try { bleCadenceChar.stopNotifications(); } catch(e){}
    bleCadenceChar = null;
  }
  if (bleCadenceDevice && bleCadenceDevice.gatt.connected) {
    bleCadenceDevice.gatt.disconnect();
  }
  bleCadenceDevice = null;
  onCadenceDisconnected();
}

function onCadenceDisconnected() {
  cadenceStatus.className = "sensor-status disconnected";
  cadenceStatus.innerHTML = '<i class="fa-solid fa-circle"></i> Disconnected';
  btnConnectCadence.className = "btn-ble-connect disconnected";
  btnConnectCadence.textContent = "Connect";
  currentCadence = null;
  lastCrankRevolutions = 0;
  lastCrankTime = 0;
  updateUI();
  logSystem("Cadence sensor disconnected.");
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
      
      if (isSimMode) {
        runSimulationStep();
      }
      
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
      path: pathCoordinates,
      heartRate: currentHeartRate,
      cadence: currentCadence
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
  
  if (simModeToggle) simModeToggle.disabled = true;

  if (isSimMode) {
    logSystem("Workout Simulation active. GPS bypass active.");
    runSimulationStep();
  } else {
    startGpsTracking();
  }
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
  simRouteIndex = 0;
  
  if (!bleHrDevice) currentHeartRate = null;
  if (!bleCadenceDevice) currentCadence = null;

  // UI reset
  statusCircle.className = "sender-status-circle";
  statusIcon.className = "fa-solid fa-play";
  statusIcon.style.color = "var(--accent-cyan)";
  statusText.textContent = "Start Ride";
  btnPause.disabled = true;
  btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
  
  if (simModeToggle) simModeToggle.disabled = false;

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
      
      if (simModeToggle) simModeToggle.disabled = true;
      
      if (isSimMode) {
        logSystem("Workout Simulation starting (remote trigger)...");
        runSimulationStep();
      } else {
        startGpsTracking();
      }
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
    simRouteIndex = 0;
    
    if (!bleHrDevice) currentHeartRate = null;
    if (!bleCadenceDevice) currentCadence = null;

    statusCircle.className = "sender-status-circle";
    statusIcon.className = "fa-solid fa-play";
    statusIcon.style.color = "var(--accent-cyan)";
    statusText.textContent = "Start Ride";
    btnPause.disabled = true;
    btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    
    if (simModeToggle) simModeToggle.disabled = false;
    
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
  
  // Update Bluetooth displays
  liveHeartRate.textContent = currentHeartRate ? `${currentHeartRate} bpm` : "--- bpm";
  liveCadence.textContent = currentCadence ? `${currentCadence} rpm` : "--- rpm";
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

// Connect Bluetooth device event listeners
btnConnectHr.addEventListener('click', connectHeartRate);
btnConnectCadence.addEventListener('click', connectCadence);

// Simulation Toggle change listener
simModeToggle.addEventListener('change', (e) => {
  isSimMode = e.target.checked;
  logSystem(isSimMode ? "Simulation Mode enabled. GPS bypass active." : "Simulation Mode disabled. Using real GPS.");
});

// Listen to unit settings change if triggerable, keep default units matching common config
speedUnitLbl.textContent = Units.speedLabel();

// Initialize UI
updateUI();
initTheme();
