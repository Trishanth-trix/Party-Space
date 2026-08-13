const socket = io();

const state = {
  roomId: "lounge",
  isHost: false,
  playerReady: false,
  suppressEvents: false,
};

const elements = {
  roomInput: document.querySelector("#roomInput"),
  joinButton: document.querySelector("#joinButton"),
  userCount: document.querySelector("#userCount"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  results: document.querySelector("#results"),
  trackTitle: document.querySelector("#trackTitle"),
  hostStatus: document.querySelector("#hostStatus"),
  emptyPlayer: document.querySelector("#emptyPlayer"),
};

let player;

window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("player", {
    height: "100%",
    width: "100%",
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady: () => {
        state.playerReady = true;
        joinRoom(state.roomId);
      },
      onStateChange: handlePlayerStateChange,
    },
  });
};

function joinRoom(roomId) {
  state.roomId = roomId.trim() || "lounge";
  elements.roomInput.value = state.roomId;
  socket.emit("join-room", state.roomId);
}

function handlePlayerStateChange(event) {
  if (!state.playerReady || state.suppressEvents) return;

  const positionSec = player.getCurrentTime() || 0;
  if (event.data === YT.PlayerState.PLAYING) {
    socket.emit("play", { roomId: state.roomId, positionSec });
  }
  if (event.data === YT.PlayerState.PAUSED) {
    socket.emit("pause", { roomId: state.roomId, positionSec });
  }
}

function loadVideo(videoId, title, positionSec = 0, shouldPlay = true) {
  if (!state.playerReady) return;

  elements.emptyPlayer.classList.add("is-hidden");
  elements.trackTitle.textContent = title || "Untitled video";
  state.suppressEvents = true;
  player.loadVideoById({ videoId, startSeconds: Math.max(0, positionSec) });

  if (!shouldPlay) {
    setTimeout(() => player.pauseVideo(), 350);
  }

  setTimeout(() => {
    state.suppressEvents = false;
  }, 700);
}

function syncPlayerPosition(positionSec, action) {
  if (!state.playerReady) return;

  state.suppressEvents = true;
  player.seekTo(Math.max(0, positionSec), true);

  if (action === "play") player.playVideo();
  if (action === "pause") player.pauseVideo();

  setTimeout(() => {
    state.suppressEvents = false;
  }, 500);
}

elements.joinButton.addEventListener("click", () => joinRoom(elements.roomInput.value));
elements.roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom(elements.roomInput.value);
});

elements.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = elements.searchInput.value.trim();
  if (!query) return;

  elements.results.innerHTML = '<p class="notice">Searching...</p>';

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error("Search failed");
    const data = await response.json();
    renderResults(data.videos || []);
  } catch (error) {
    elements.results.innerHTML = '<p class="notice">Search failed. Try again.</p>';
  }
});

function renderResults(videos) {
  if (!videos.length) {
    elements.results.innerHTML = '<p class="notice">No videos found.</p>';
    return;
  }

  elements.results.innerHTML = "";
  for (const video of videos) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "result";
    button.innerHTML = `
      <img src="${video.thumbnail}" alt="" loading="lazy" />
      <span>
        <h3>${video.title}</h3>
        <p>${video.author || "Unknown"} · ${video.duration || ""}</p>
      </span>
    `;
    button.addEventListener("click", () => {
      socket.emit("load-video", {
        roomId: state.roomId,
        videoId: video.videoId,
        title: video.title,
      });
    });
    elements.results.appendChild(button);
  }
}

socket.on("sync-state", ({ videoId, title, isPlaying, positionSec, isHost }) => {
  state.isHost = isHost;
  elements.hostStatus.textContent = isHost ? "You are room host" : "Synced to room host";

  if (videoId) {
    loadVideo(videoId, title, positionSec, isPlaying);
  }
});

socket.on("user-count", (count) => {
  elements.userCount.textContent = count;
});

socket.on("load-video", ({ videoId, title }) => {
  loadVideo(videoId, title, 0, true);
});

socket.on("play", ({ positionSec }) => syncPlayerPosition(positionSec, "play"));
socket.on("pause", ({ positionSec }) => syncPlayerPosition(positionSec, "pause"));
socket.on("seek", ({ positionSec }) => syncPlayerPosition(positionSec, "seek"));