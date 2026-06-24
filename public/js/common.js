// Shared configuration and utilities for Bike Computer Mirror

const Config = {
  // Determine WebSocket URL dynamically based on current page location
  getWsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  },
  
  // Default values
  units: localStorage.getItem('bike_units') || 'metric', // 'metric' or 'imperial'
  theme: localStorage.getItem('bike_theme') || 'dark', // 'dark' or 'light'
};

// Unit conversions
const Units = {
  // Speed conversions (input is always meters/second from Geolocation API)
  formatSpeed(mps, system = Config.units) {
    if (mps === null || mps === undefined || isNaN(mps) || mps < 0.2) return '0.0'; // Filter out drift
    const speed = system === 'metric' ? mps * 3.6 : mps * 2.23694;
    return speed.toFixed(1);
  },

  speedLabel(system = Config.units) {
    return system === 'metric' ? 'km/h' : 'mph';
  },

  // Distance conversions (input is always meters)
  formatDistance(meters, system = Config.units) {
    if (!meters || isNaN(meters)) return '0.00';
    const dist = system === 'metric' ? meters / 1000 : meters * 0.000621371;
    return dist.toFixed(2);
  },

  distanceLabel(system = Config.units) {
    return system === 'metric' ? 'km' : 'mi';
  },

  // Elevation conversions (input is always meters)
  formatElevation(m, system = Config.units) {
    if (m === null || m === undefined || isNaN(m)) return '---';
    const val = system === 'metric' ? m : m * 3.28084;
    return Math.round(val).toString();
  },

  elevationLabel(system = Config.units) {
    return system === 'metric' ? 'm' : 'ft';
  }
};

// Formatting helpers
function formatDuration(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00';
  const hrs = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

// Session Helpers
function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

// Theme management
function initTheme() {
  const savedTheme = Config.theme;
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  // Set up theme toggler buttons if present
  const togglers = document.querySelectorAll('.theme-switch');
  togglers.forEach(btn => {
    btn.innerHTML = savedTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    btn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('bike_theme', newTheme);
      Config.theme = newTheme;
      btn.innerHTML = newTheme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    });
  });
}

// Robust, auto-reconnecting WebSocket Wrapper
class BikeWebSocket {
  constructor(role, sessionId, onMessageCallback, onStateChangeCallback) {
    this.role = role;
    this.sessionId = sessionId;
    this.onMessage = onMessageCallback;
    this.onStateChange = onStateChangeCallback;
    this.ws = null;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isConnected = false;
  }

  connect() {
    if (this.ws) {
      this.ws.close();
    }

    const wsUrl = Config.getWsUrl();
    console.log(`Connecting WebSocket to: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket Connected! Registering role...');
      this.isConnected = true;
      
      // Join session
      this.send({
        type: 'join',
        role: this.role,
        sessionId: this.sessionId
      });

      if (this.onStateChange) this.onStateChange(true);
      
      // Start heatbeats
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'pong') {
          // Received heartbeat back
          return;
        }
        if (this.onMessage) {
          this.onMessage(message);
        }
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    this.ws.onclose = (event) => {
      console.warn('WebSocket disconnected. Will attempt reconnect...', event.reason);
      this.isConnected = false;
      if (this.onStateChange) this.onStateChange(false);
      this.stopHeartbeat();
      
      // Reconnect after 3 seconds
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket encountered error:', error);
      this.ws.close();
    };
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 15000); // Send ping every 15s to keep connections alive
  }

  stopHeartbeat() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect loop
      this.ws.close();
    }
    this.isConnected = false;
    if (this.onStateChange) this.onStateChange(false);
  }
}
