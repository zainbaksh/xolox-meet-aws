# Xolox Meet - WebRTC Video Conferencing

A lightweight, self-hosted WebRTC video conferencing application built with Node.js, Express, and Socket.io. Join rooms, video call with peers, chat in real time, and optionally record meetings with transcription support.

## Features

- 🎥 **Real-time Video Conferencing** - Peer-to-peer WebRTC for audio and video
- 💬 **Built-in Chat** - Send messages during a call
- 🏠 **Room-Based Meetings** - Join any named room with a soft cap of 4 users
- 🧠 **Whiteboard Sync** - Collaborative drawing events are synchronized across participants
- 📼 **Recording Support** - Save mixed `.webm` meeting recordings to `recordings/`
- 📝 **Transcript Generation** - Optional transcription using `ffmpeg` + `faster-whisper` or `whisper`
- 🌍 **Cross-City Reliability** - STUN servers included, optional TURN support for NAT traversal
- 🔓 **Self-Hosted** - No third-party API dependency is required for basic use
- ⚡ **Minimal Dependencies** - Simple stack for fast deployment

## Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla JavaScript, WebRTC API
- **Media:** STUN/TURN ICE servers, mixed recording via browser streams
- **Transcription:** Python-based `faster-whisper` or `whisper` if enabled

## Installation

### Prerequisites

- Node.js v14 or newer
- npm or yarn
- Optional for recording/transcription:
  - Python 3
  - `ffmpeg` available on PATH or configured via `FFMPEG_PATH`
  - `faster-whisper` or `whisper` Python package

### Setup

1. Open a terminal and navigate to the project directory:
   ```bash
   cd xolox-meet-fixed
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file from the example:
   ```bash
   copy .env.example .env
   ```

4. Edit `.env` and configure the optional TURN credentials:
   ```env
   PORT=3000
   TURN_URLS=
   TURN_USERNAME=
   TURN_CREDENTIAL=
   ```

## Usage

### Starting the Server

**Windows:**
```bash
start.bat
```

**Linux/macOS:**
```bash
./start.sh
```

**Or manually:**
```bash
npm start
```

By default the server runs at `http://localhost:3000` unless `PORT` is set.

### Using the App

1. Open the app in your browser.
2. Enter a **Room ID** (for example, `meeting-123`).
3. Enter your **Name**.
4. Click **Join**.
5. Share the Room ID with others to connect.
6. Video, chat, and collaborative whiteboard sync automatically.

## API Endpoints

### GET `/api/ice-servers`
Returns STUN/TURN ICE configuration for WebRTC peer connections.

**Response example:**
```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" },
    { "urls": "stun:stun2.l.google.com:19302" }
  ]
}
```

### GET `/api/room-size/:roomId`
Returns current participant count and soft capacity for a room.

**Response example:**
```json
{
  "size": 2,
  "softCap": 4,
  "isAtCap": false
}
```

### POST `/api/recordings/start`
Initialize a mixed meeting recording session.

**Request body:**
```json
{
  "roomId": "string",
  "userName": "string",
  "recorderSocketId": "string"
}
```

**Response example:**
```json
{
  "sessionId": "uuid",
  "fileName": "2026-05-14T..._room_mixed_user_uuid.webm"
}
```

### POST `/api/recordings/chunk/:sessionId`
Upload a recording chunk as `application/octet-stream`.

### POST `/api/recordings/stop/:sessionId`
Stop the recording session and queue transcription.

### GET `/api/recordings`
List saved recordings and transcript status.

## Socket.io Events

### Client → Server

- `join-room`
  ```js
  { roomId: "string", userName: "string" }
  ```
- `offer`
  ```js
  { to: "peerId", offer: RTCSessionDescription }
  ```
- `answer`
  ```js
  { to: "peerId", answer: RTCSessionDescription }
  ```
- `ice-candidate`
  ```js
  { to: "peerId", candidate: RTCIceCandidate }
  ```
- `chat-message`
  ```js
  { roomId: "string", name: "string", text: "string" }
  ```
- `whiteboard-draw`
  ```js
  { roomId: "string", segment: { ... } }
  ```
- `whiteboard-clear`
  ```js
  { roomId: "string" }
  ```

### Server → Client

- `existing-peers`
- `peer-joined`
- `peer-left`
- `offer`
- `answer`
- `ice-candidate`
- `chat-message`
- `whiteboard-sync`
- `whiteboard-draw`
- `whiteboard-clear`
- `room-recorder`

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `TURN_URLS` | Comma-separated TURN URLs | `` | No |
| `TURN_USERNAME` | TURN username | `` | No |
| `TURN_CREDENTIAL` | TURN password | `` | No |
| `FFMPEG_PATH` | Custom path to `ffmpeg` executable | `ffmpeg` | No |

### TURN Setup

Use a TURN server for better connectivity across NATs.

```env
TURN_URLS=turn:your-domain.com:3478,turns:your-domain.com:5349
TURN_USERNAME=your_username
TURN_CREDENTIAL=your_password
```

## Recording & Transcription

- Recordings are stored in `recordings/` as `.webm` files.
- Metadata and transcript progress are written to matching `.json` files.
- Transcription attempts use `ffmpeg` to convert audio, then `faster-whisper` or `whisper`.
- If transcription fails, metadata contains the failure reason.

## Project Structure

```
xolox-meet-fixed/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── requirements.txt
├── server.js
├── start.sh
├── start.bat
├── public/
│   ├── index.html
│   └── whiteboard.html
├── recordings/
│   └── *.webm.json (metadata files)
└── transcripts/
    ├── *.txt (transcripts)
    └── manual_test.txt
```

## Notes

- The soft room cap is currently `4` users.
- The first connected user in a room becomes the room recorder by default.
- If no TURN credentials are configured, the app falls back to public STUN servers only.

## License

This project is provided as-is for self-hosted WebRTC meetings and experimentation.

### Room Management
- Users join rooms by ID (any string)
- Rooms are created on-demand
- Empty rooms are automatically cleaned up
- Soft cap of 4 users per room (advisory, not enforced)

### WebRTC Peer Connection
- Automatic peer discovery when joining a room
- SDP (offer/answer) exchange via Socket.io
- ICE candidate gathering for NAT traversal
- Google STUN servers included by default
- Optional TURN server for edge cases

### Chat System
- Room-based messaging
- Messages broadcast to all room participants
- Includes sender name and message text
- Real-time delivery via Socket.io

## Browser Support

- Chrome/Edge 88+
- Firefox 87+
- Safari 15+
- Opera 74+

## Performance Notes

- **Soft cap of 4 users**: Performance is optimized for 2-4 participants per room. Beyond this, video quality may degrade.
- **TURN servers**: Without TURN, connection success depends on ISP port forwarding. For production use, configure TURN.
- **Bandwidth**: Video quality adapts based on available bandwidth.

## Troubleshooting

### "TURN not configured" warning
- This warning is informational. Local connections will work fine.
- For cross-city reliability, set TURN_URLS, TURN_USERNAME, and TURN_CREDENTIAL.

### Connection fails after peer joins
- Check your firewall/NAT settings
- Configure TURN servers for better NAT traversal
- Verify both peers can access the WebRTC signaling server

### No audio/video
- Check browser permissions for microphone/camera
- Ensure both peers have granted camera and microphone access
- Try a different browser to rule out browser-specific issues

## Development

### Starting in Development Mode
```bash
npm start
```

### Logs
- Socket.io connection events are logged to console
- Room join/leave events are logged with participant count
- TURN configuration status is logged on startup

## License

Xolox Meet - WebRTC Video Conferencing Application

## Support & Contributing

For issues, feature requests, or contributions, please refer to the project repository.

---

**Note**: This application is designed for self-hosting. For production deployments, ensure:
- HTTPS is enabled
- TURN servers are configured
- Firewall rules allow WebRTC traffic


###to do 
--permission- now
--file upload- later
--file sharing

**IMPORTANT** added ice debuging from lines 182 to 208 in index.html will remove once backend is stable
