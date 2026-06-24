# AeroCycle - Bike Computer Mirror

AeroCycle is a real-time cycling telemetry mirroring system. It allows you to keep your expensive smartphone safe, dry, and cool inside your pocket or frame bag (acting as a **Pocket Sensor Hub**), while streaming live GPS telemetry (speed, location, path, distance, average speed, elevation) over WebSockets to a secondary/older smartphone, tablet, or e-reader mounted on your handlebars (acting as the **Handlebar Dashboard**).

---

## 🚲 Architecture & Features

```
[ Pocket Sensor Hub ]  -- WebSocket (Live GPS Telemetry) -->  [ Handlebar Dashboard ]
(Pocket Phone)                                               (Handlebar Device)
                                                             * Live Map Tracking
                                                             * Large Speedometer
                                                             * Metrics & Controls
```

- **Safety First:** Keep your primary phone safe from vibration, crashes, sun-glare, overheating, and rain.
- **WebSocket Streaming:** Ultra-low latency, bidirectional messaging. Start, pause, or reset the ride from either screen.
- **Interactive Map:** The handlebar display utilizes Leaflet.js to plot your real-time path and position.
- **Wake Lock support:** Keep your handlebar screen awake without it dimming or sleeping during long rides.
- **Responsive Web UI:** Tailored day/night modes, large legible typography, and beautiful modern interfaces.

---

## 📋 Requirements

- **Node.js** (v16.0.0 or higher)
- **Local Network Connection:** Both devices must be connected to the same local Wi-Fi network (or the server must be exposed to the internet via tunnels like `ngrok`).
- **Secure Context (HTTPS):** Modern mobile browsers (iOS Safari, Chrome, etc.) **require a secure context (HTTPS or localhost)** to allow access to the browser's Geolocation (GPS) API. Running the server with SSL/TLS certificates is highly recommended.

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
Clone this repository to your computer/server and install the Node.js packages:
```bash
npm install
```

### 2. Configure SSL/HTTPS (Recommended)
Since your Pocket Sensor Hub needs GPS access, it must connect to the server securely. AeroCycle automatically enables HTTPS if it detects `key.pem` and `cert.pem` in the root folder.

Generate self-signed certificates using `openssl`:
```bash
openssl req -newkey rsa:2048 -new -nodes -x509 -days 365 -keyout key.pem -out cert.pem
```
*(When prompted, you can press Enter to skip/default the certificate metadata fields).*

### 3. Run the Server
Start the Express and WebSocket server:
```bash
npm start
```

Once started, the console will print your local network IP (e.g., `192.168.1.15`). 
- **HTTP Mode URL:** `http://192.168.1.15:3000`
- **HTTPS Mode URL:** `https://192.168.1.15:3000`

---

## 📱 How to Use (Step-by-Step)

1. **Mount & Open Handlebar Dashboard:**
   - Mount your secondary display device (tablet, old phone, laptop) to your handlebars.
   - Open the browser on it and navigate to `https://<YOUR-SERVER-IP>:3000`.
   - Click **Handlebar Display**.
   - The screen will show a **4-digit pairing code** and a **QR Code**.

2. **Connect Pocket Sensor Hub:**
   - On your primary phone (in your pocket/bag), open the camera app and scan the **QR Code** from the handlebar screen, OR manually navigate to the server homepage and click **Pocket Sensor Hub** to type the **4-digit code**.
   - Make sure to **allow Location/GPS permissions** when prompted by your mobile browser.

3. **Start Riding!**
   - Once paired, the Dashboard on your handlebars will automatically transition into the live ride layout.
   - Tap **Start Ride** (on either device) to start tracking. Your speed, duration, distance, and live path will mirror in real-time.
   - Tap **Pause** or **Reset** to control your session.

---

## 💡 Troubleshooting & Mobile GPS Access

### I get "GPS Error: User denied Geolocation" or nothing updates
Modern browsers enforce strict security rules around the Geolocation API. If you load the app over plain `http://<IP-address>:3000` on your mobile phone, the browser will block GPS access.

**Solutions:**
1. **Enable HTTPS (Recommended):** Follow the SSL/HTTPS setup guide above to run the server securely. When visiting `https://...`, your browser will ask you to bypass the self-signed certificate warning (usually under *Advanced -> Proceed anyway*). Once bypassed, GPS will work.
2. **Chrome Local IP Workaround (Android):**
   - Open Chrome on your pocket phone.
   - Navigate to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
   - Enable this flag and add your server's IP/port (e.g., `http://192.168.1.15:3000`).
   - Relaunch Chrome.
3. **Use ngrok:**
   - Expose your local port via ngrok to get a free public HTTPS URL:
     ```bash
     ngrok http 3000
     ```
   - Connect both devices to the public HTTPS URL provided by ngrok.

---

## 🛠️ Project Structure

```
├── public/
│   ├── css/
│   │   └── style.css       # Premium responsive dashboard stylesheet
│   ├── js/
│   │   ├── common.js       # Reconnect WS handler, conversions, and theme support
│   │   ├── qrcode.min.js   # QR code generation utility for pairing
│   │   ├── receiver.js     # Handlebar Dashboard UI & map plotting logic
│   │   └── sender.js       # Pocket Phone GPS & sensor logging logic
│   ├── index.html          # Device selection homepage
│   ├── receiver.html       # Handlebar Dashboard display page
│   └── sender.html         # Pocket Phone sender controller page
├── package.json            # Node.js manifest
├── server.js               # Node.js HTTPS/HTTP & WebSocket server
└── README.md               # You are here!
```
