const express = require("express");
const http = require("node:http");
const { Server } = require("socket.io");
const yts = require("yt-search");
const path = require("node:path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// rooms.get(roomId) = { videoId, title, isPlaying, positionSec, updatedAt, hostId }
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      videoId: null,
      title: null,
      isPlaying: false,
      positionSec: 0,
      updatedAt: Date.now(),
      hostId: null,
    });
  }
  return rooms.get(roomId);
}

function currentPosition(room) {
  if (!room.isPlaying) return room.positionSec;
  const elapsed = (Date.now() - room.updatedAt) / 1000;
  return room.positionSec + elapsed;
}

app.get("/api/search", async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "Missing query" });

  try {
    const result = await yts(q);
    const videos = result.videos.slice(0, 10).map((video) => ({
      videoId: video.videoId,
      title: video.title,
      duration: video.timestamp,
      thumbnail: video.thumbnail,
      author: video.author?.name,
    }));
    res.json({ videos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

io.on("connection", (socket) => {
  let currentRoomId = null;

  socket.on("join-room", (roomId) => {
    currentRoomId = roomId;
    socket.join(roomId);
    const room = getRoom(roomId);

    if (!room.hostId) room.hostId = socket.id;

    socket.emit("sync-state", {
      videoId: room.videoId,
      title: room.title,
      isPlaying: room.isPlaying,
      positionSec: currentPosition(room),
      isHost: room.hostId === socket.id,
    });

    io.to(roomId).emit("user-count", io.sockets.adapter.rooms.get(roomId)?.size || 1);
  });

  socket.on("load-video", ({ roomId, videoId, title }) => {
    const room = getRoom(roomId);
    room.videoId = videoId;
    room.title = title;
    room.isPlaying = true;
    room.positionSec = 0;
    room.updatedAt = Date.now();
    io.to(roomId).emit("load-video", { videoId, title });
  });

  socket.on("play", ({ roomId, positionSec }) => {
    const room = getRoom(roomId);
    room.isPlaying = true;
    room.positionSec = positionSec;
    room.updatedAt = Date.now();
    socket.to(roomId).emit("play", { positionSec });
  });

  socket.on("pause", ({ roomId, positionSec }) => {
    const room = getRoom(roomId);
    room.isPlaying = false;
    room.positionSec = positionSec;
    room.updatedAt = Date.now();
    socket.to(roomId).emit("pause", { positionSec });
  });

  socket.on("seek", ({ roomId, positionSec }) => {
    const room = getRoom(roomId);
    room.positionSec = positionSec;
    room.updatedAt = Date.now();
    socket.to(roomId).emit("seek", { positionSec });
  });

  socket.on("disconnect", () => {
    if (currentRoomId) {
      const room = getRoom(currentRoomId);
      if (room.hostId === socket.id) room.hostId = null;
      const size = io.sockets.adapter.rooms.get(currentRoomId)?.size || 0;
      io.to(currentRoomId).emit("user-count", size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));