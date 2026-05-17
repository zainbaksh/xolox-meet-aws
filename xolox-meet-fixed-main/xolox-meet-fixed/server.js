const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  allowEIO3: true
});

app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts');
if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

function getIceServers() {
  const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  const turnUrls = (process.env.TURN_URLS || process.env.TURN_URI || process.env.TURN_SERVER || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const turnUsername = process.env.TURN_USERNAME || process.env.TURN_USER || process.env.TWILIO_TURN_USERNAME || '';
  const turnCredential = process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD || process.env.TWILIO_TURN_PASSWORD || '';

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    stunServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential
    });
  }

  return stunServers;
}

app.get('/api/ice-servers', (_req, res) => {
  res.json({ iceServers: getIceServers() });
});

const rooms = {};
const ROOM_SOFT_CAP = 4;
const whiteboardEvents = {};
const recordingSessions = new Map();
const roomRecorders = {};
const roomPresentationState = {};

function writeRecordingMeta(filePath, patch) {
  const metaPath = `${filePath}.json`;
  let meta = {};
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
  }
  meta = { ...meta, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

function findFfmpegPath() {
  const envPath = process.env.FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const wingetBase = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetBase)) {
    const dirs = fs.readdirSync(wingetBase).filter((d) => d.startsWith('Gyan.FFmpeg_'));
    for (const d of dirs) {
      const root = path.join(wingetBase, d);
      const matches = [];
      const walk = (p, depth) => {
        if (depth > 5) return;
        let entries = [];
        try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (_) { return; }
        for (const e of entries) {
          const full = path.join(p, e.name);
          if (e.isDirectory()) walk(full, depth + 1);
          else if (e.isFile() && e.name.toLowerCase() === 'ffmpeg.exe') matches.push(full);
        }
      };
      walk(root, 0);
      if (matches.length > 0) return matches[0];
    }
  }
  return 'ffmpeg';
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += String(d); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

async function transcribeRecording(filePath) {
  const baseName = path.basename(filePath, path.extname(filePath));
  const wavPath = path.join(TRANSCRIPTS_DIR, `${baseName}.wav`);
  const txtPath = path.join(TRANSCRIPTS_DIR, `${baseName}.txt`);
  writeRecordingMeta(filePath, { transcriptStatus: 'processing' });

  const ffmpegBin = findFfmpegPath();
  try {
    await runCmd(ffmpegBin, ['-y', '-i', filePath, '-ac', '1', '-ar', '16000', wavPath]);
  } catch (e) {
    writeRecordingMeta(filePath, { transcriptStatus: 'failed', transcriptError: `ffmpeg unavailable: ${e.message}` });
    return;
  }

  let transcribed = false;
  try {
    const script = `
from faster_whisper import WhisperModel
model = WhisperModel("base", device="cpu", compute_type="int8")
segments, _ = model.transcribe(r"""${wavPath.replace(/\\/g, '\\\\')}""")
out = r"""${txtPath.replace(/\\/g, '\\\\')}"""
with open(out, "w", encoding="utf-8") as f:
    for s in segments:
        f.write(s.text.strip() + "\\n")
`;
    await runCmd('python', ['-c', script]);
    transcribed = true;
  } catch (_) {}

  if (!transcribed) {
    try {
      await runCmd('python', ['-m', 'whisper', wavPath, '--model', 'base', '--output_format', 'txt', '--output_dir', TRANSCRIPTS_DIR]);
      transcribed = true;
    } catch (e) {
      writeRecordingMeta(filePath, { transcriptStatus: 'failed', transcriptError: `whisper unavailable: ${e.message}` });
      return;
    }
  }

  if (fs.existsSync(txtPath)) {
    writeRecordingMeta(filePath, { transcriptStatus: 'ready', transcriptPath: txtPath });
  } else {
    writeRecordingMeta(filePath, { transcriptStatus: 'failed', transcriptError: 'Transcript file was not produced' });
  }
}

app.get('/api/room-size/:roomId', (req, res) => {
  const size = rooms[req.params.roomId]?.size || 0;
  res.json({ size, softCap: ROOM_SOFT_CAP, isAtCap: size >= ROOM_SOFT_CAP });
});

app.post('/api/recordings/start', (req, res) => {
  const roomId = String(req.body?.roomId || 'room').replace(/[^a-zA-Z0-9_-]/g, '-');
  const userName = String(req.body?.userName || 'guest').replace(/[^a-zA-Z0-9_-]/g, '-');
  const recorderSocketId = String(req.body?.recorderSocketId || '');
  if (roomRecorders[roomId] && recorderSocketId && roomRecorders[roomId] !== recorderSocketId) {
    return res.status(403).json({ error: 'Only room recorder can start mixed recording' });
  }
  const sessionId = crypto.randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${stamp}_${roomId}_mixed_${userName}_${sessionId}.webm`;
  const filePath = path.join(RECORDINGS_DIR, fileName);

  recordingSessions.set(sessionId, {
    roomId,
    recorderSocketId,
    filePath,
    fileName,
    bytes: 0,
    createdAt: Date.now()
  });
  fs.writeFileSync(filePath, Buffer.alloc(0));
  writeRecordingMeta(filePath, {
    sessionId,
    roomId,
    recorderSocketId,
    fileName,
    createdAt: new Date().toISOString(),
    transcriptStatus: 'pending'
  });
  res.json({ sessionId, fileName });
});

app.post('/api/recordings/chunk/:sessionId', express.raw({ type: 'application/octet-stream', limit: '25mb' }), (req, res) => {
  const { sessionId } = req.params;
  const session = recordingSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Recording session not found' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Missing chunk data' });

  fs.appendFile(session.filePath, req.body, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to write recording chunk' });
    session.bytes += req.body.length;
    res.json({ ok: true, bytes: session.bytes });
  });
});

app.post('/api/recordings/stop/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = recordingSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Recording session not found' });

  recordingSessions.delete(sessionId);
  writeRecordingMeta(session.filePath, {
    stoppedAt: new Date().toISOString(),
    bytes: session.bytes,
    transcriptStatus: 'queued'
  });
  transcribeRecording(session.filePath).catch((e) => {
    writeRecordingMeta(session.filePath, { transcriptStatus: 'failed', transcriptError: e.message });
  });
  res.json({
    ok: true,
    path: session.filePath,
    bytes: session.bytes,
    transcriptStatus: 'queued'
  });
});

app.get('/api/recordings', (_req, res) => {
  const list = fs.readdirSync(RECORDINGS_DIR)
    .filter((n) => n.endsWith('.webm'))
    .map((name) => {
      const filePath = path.join(RECORDINGS_DIR, name);
      const st = fs.statSync(filePath);
      let meta = {};
      const metaPath = `${filePath}.json`;
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
      }
      return {
        fileName: name,
        filePath,
        bytes: st.size,
        createdAt: st.birthtime.toISOString(),
        transcriptStatus: meta.transcriptStatus || 'unknown',
        transcriptPath: meta.transcriptPath || null
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ recordings: list });
});

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join-room', ({ roomId, userName }) => {
    socket.data.userName = userName;
    socket.data.roomId = roomId;

    if (!rooms[roomId]) rooms[roomId] = new Set();

    const existingPeers = [...rooms[roomId]].map((id) => ({
      peerId: id,
      userName: io.sockets.sockets.get(id)?.data.userName || 'Guest'
    }));

    socket.emit('existing-peers', existingPeers);

    rooms[roomId].forEach((peerId) => {
      io.to(peerId).emit('peer-joined', { peerId: socket.id, userName });
    });

    rooms[roomId].add(socket.id);
    socket.join(roomId);
    if (!roomRecorders[roomId]) roomRecorders[roomId] = socket.id;
    io.to(roomId).emit('room-recorder', { recorderSocketId: roomRecorders[roomId] });
    if (!whiteboardEvents[roomId]) whiteboardEvents[roomId] = [];
    socket.emit('whiteboard-sync', { events: whiteboardEvents[roomId] });
    if (roomPresentationState[roomId]) {
      socket.emit('presentation-start', roomPresentationState[roomId]);
    }
    console.log(`${userName} joined ${roomId} (${rooms[roomId].size} users)`);
  });

  socket.on('offer', ({ to, offer }) => io.to(to).emit('offer', { from: socket.id, offer }));
  socket.on('answer', ({ to, answer }) => io.to(to).emit('answer', { from: socket.id, answer }));
  socket.on('ice-candidate', ({ to, candidate }) => io.to(to).emit('ice-candidate', { from: socket.id, candidate }));

  socket.on('chat-message', ({ roomId, name, text }) => {
    io.to(roomId).emit('chat-message', { name, text });
  });

  socket.on('whiteboard-draw', ({ roomId, segment }) => {
    if (!roomId || !segment) return;
    if (!whiteboardEvents[roomId]) whiteboardEvents[roomId] = [];
    whiteboardEvents[roomId].push(segment);
    if (whiteboardEvents[roomId].length > 5000) {
      whiteboardEvents[roomId] = whiteboardEvents[roomId].slice(-5000);
    }
    socket.to(roomId).emit('whiteboard-draw', { segment });
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    if (!roomId) return;
    whiteboardEvents[roomId] = [];
    io.to(roomId).emit('whiteboard-clear');
  });

  socket.on('whiteboard-state', ({ roomId, dataUrl }) => {
    if (!roomId || !dataUrl) return;
    socket.to(roomId).emit('whiteboard-state', { from: socket.id, dataUrl });
  });

  socket.on('presentation-start', ({ roomId, mode }) => {
    if (!roomId || !mode) return;
    roomPresentationState[roomId] = { mode, from: socket.id };
    io.to(roomId).emit('presentation-start', { mode, from: socket.id });
  });

  socket.on('presentation-stop', ({ roomId }) => {
    if (!roomId) return;
    if (roomPresentationState[roomId]?.from === socket.id) {
      delete roomPresentationState[roomId];
      io.to(roomId).emit('presentation-stop', { from: socket.id });
    }
  });

  socket.on('disconnect', () => {
    const { roomId, userName } = socket.data;
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket.id);
      if (rooms[roomId].size === 0) {
        delete rooms[roomId];
        delete whiteboardEvents[roomId];
        delete roomRecorders[roomId];
        delete roomPresentationState[roomId];
      }
      else {
        if (roomPresentationState[roomId]?.from === socket.id) {
          delete roomPresentationState[roomId];
          io.to(roomId).emit('presentation-stop', { from: socket.id });
        }
        if (roomRecorders[roomId] === socket.id) {
          roomRecorders[roomId] = [...rooms[roomId]][0];
          io.to(roomId).emit('room-recorder', { recorderSocketId: roomRecorders[roomId] });
        }
        io.to(roomId).emit('peer-left', { peerId: socket.id, userName });
      }
    }
    console.log('disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Xolox Meet on http://localhost:${PORT}`);
  if (!process.env.TURN_URLS) {
    console.log('TURN not configured. For best cross-city reliability set TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL.');
  }
});
