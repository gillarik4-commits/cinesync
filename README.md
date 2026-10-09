# CineSync 🍿

CineSync is a robust, self-hosted web application that allows you to instantly spin up synchronized, real-time watch parties for your local media library. 

Bypass port-forwarding headaches and manual transcoding. CineSync leverages zero-terminal configuration, an automated FFmpeg media pipeline, and integrated Cloudflare Tunnels to effortlessly host seamless viewing experiences for your friends over the internet.

## Key Features 🚀

- **Zero-Config Cloudflare Tunneling:** CineSync automatically spins up and intercepts a secure Cloudflare Quick Tunnel (`.trycloudflare.com`) from directly within Node.js. No manual port-forwarding or external terminals required.
- **Automated FFmpeg Media Pipeline:** Select your local `.mkv`, `.mp4`, or `.avi`. The built-in dashboard will parse audio/subtitle tracks and spawn a background `ffmpeg` process to perfectly remux your selection into an optimized, web-ready `H.264 / AAC 2.0` stream.
- **HTTP 206 Partial Streaming:** The backend natively routes standard HTTP Byte-Range requests (`206 Partial Content`), ensuring instantaneous video buffering, skipping, and minimal memory footprints for remote clients.
- **Sub-Second WebSocket Synchronization:** The internal sync engine enforces strict timeline lockstep. Late joiners are fed interpolated time states, and active viewers are continuously checked for timeline drift (automatically snapping them back if they drift beyond 500ms).
- **Responsive Flexbox UI:** A modern glassmorphism theatre dashboard featuring a built-in interactive chat room, keyboard shortcuts (Space, F, Arrows), and responsive UI layouts for mobile compatibility.

## Prerequisites ⚙️

Ensure you have the following installed on your system before proceeding:
- **Node.js** (v18.0.0 or higher)
- **FFmpeg / FFprobe** (Available globally in your system's PATH)
- **cloudflared** (Installed globally or via npm for programmatic tunneling)

## Quick Start 🏁

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/yourusername/cinesync.git
   cd cinesync
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Start the Server:**
   ```bash
   npm start
   ```

4. **Host a Party:**
   - Open your browser to `http://localhost:3000`
   - Paste the absolute file path to your local media.
   - Select your preferred Audio and Subtitle tracks.
   - Click **Start Watch Party**.
   - Once transcoding completes, click **Share Link** to copy the public Cloudflare tunnel URL and send it to your friends!

## Technical Stack 🛠️
- **Backend:** Node.js, Express, `ws`
- **Frontend:** HTML5, Vanilla JavaScript, CSS Flexbox
- **Media Transcoding:** `fluent-ffmpeg`
- **Network Routing:** Cloudflare Quick Tunnels (Programmatic)

## License
MIT License. Free to use, modify, and distribute.
