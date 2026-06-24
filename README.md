# AeroCycle - Bike Computer Mirror

AeroCycle is a lightweight, zero-install, real-time cycling telemetry mirroring system. It allows you to place your primary phone (iPhone) safely, dryly, and coolly in your pocket or frame bag while streaming live GPS telemetry directly to an old Android phone, tablet, or e-ink web browser mounted on your handlebars.

---

## Key Features

- **Sunlight-Readable Dashboard**: Glassmorphic widgets displaying speed, distance, average speed, elapsed time, and elevation using the high-contrast **Orbitron** font.
- **Integrated Leaflet Map**: A live dark-mode map plotting your current route breadcrumbs.
- **Resilient Connectivity**: A custom auto-reconnecting WebSocket client wrapper designed to survive cellular stutters on the road.
- **Bidirectional Remote Control**: Tap "Start", "Pause", or "Reset" directly from the handlebars screen to control the GPS recording on the iPhone in your pocket.
- **Screen Wake Lock**: A built-in toggle using the Web Wake Lock API to prevent the handlebars display from going to sleep.
- **Day/Night Theme Toggle**: Instant, high-contrast day mode or battery-saving dark mode.
- **Zero-Dependency Pairing**: Pairing works completely offline using a local QR code library.

---

## 100% Offline Road-Testing Guide (Android Termux)

This setup runs the entire Node.js server directly on your handlebar-mounted Android phone. **It requires zero internet connection, zero cell data, and zero laptops while riding.**

Because modern mobile browsers restrict Geolocation and Wake Lock APIs to secure contexts, the server runs in **HTTPS mode** using a self-signed SSL certificate.

### Step 1: Install Termux & Node.js on the Android Phone
1. Download and install **Termux** on your old Android phone.
   * *Note: Do not use the version on the Google Play Store (it is outdated). Download it from [F-Droid](https://f-droid.org/packages/com.termux/) or directly from the [Termux Github Releases](https://github.com/termux/termux-app/releases).*
2. Open Termux and run:
   ```bash
   pkg update
   pkg install nodejs openssl-tool git
   ```

### Step 2: Clone the Project in Termux
Navigate to your directory and clone the repository:
```bash
git clone https://github.com/ryeruva/AeroCycle.git ~/AeroCycle
cd ~/AeroCycle
```

### Step 3: Generate the Self-Signed SSL Certificate
Generate the SSL credentials in the project root:
```bash
openssl req -subj '/CN=localhost' -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365
```
*Note: The AeroCycle server automatically checks for `key.pem` and `cert.pem` on boot. Once found, it runs in **secure HTTPS mode**.*

### Step 4: Install Dependencies & Run the Server
Install the packages and start the server:
```bash
npm install
node server.js
```
You should see:
`SSL certificates found. Running in HTTPS mode.`

### Step 5: Configure the Hotspot & Connect
1. Turn on the **Portable Wi-Fi Hotspot** in the settings of your Android phone.
2. Turn on Wi-Fi on your iPhone and connect it to the Android phone's Wi-Fi hotspot.
   *(The server will automatically detect the hotspot local gateway IP—typically `192.168.43.1`).*

### Step 6: Open and Pair
1. On the handlebar-mounted Android phone, open Chrome and navigate to:
   `https://localhost:3000`
2. **Bypass the SSL Warning**: Click **Advanced** -> **Proceed to localhost (unsafe)**.
3. Select **Handlebar Display**. You will see your 4-digit code and a QR code.
   *(The QR code automatically points to the local network IP: `https://192.168.43.1:3000/sender.html?session=XXXX`).*
4. On your iPhone, open the Camera app and scan the QR code.
5. **Bypass the SSL Warning on iPhone**: Tap **Show Details** -> **Visit this website** (or **Proceed / Trust Certificate**).
6. Grant Location Access to allow GPS tracking, slip the iPhone into your pocket, and enjoy the ride!

---

## Local Testing (Quick Verification)

To test the application locally on a computer:
1. Start the server:
   ```bash
   node server.js
   ```
2. Open `http://localhost:3000` in a browser. Select **Handlebar Display** to get a 4-digit code.
3. Open another browser tab at `http://localhost:3000`. Select **Pocket Sensor Hub**, enter the code, and click **Connect**.
4. Click **Start Ride** (on either screen) and grant location access.
5. *(Optional)* Press `F12` to open developer tools, go to **Sensors**, select a mock location pathway, and verify that the map and speed gauges update in real-time.
