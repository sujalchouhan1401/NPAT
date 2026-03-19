'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const GameManager = require('./server/gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const gm     = new GameManager();

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ═══════════════════════════════════════════════════════
   TIMER HELPERS
═══════════════════════════════════════════════════════ */

function clearRoomTimer(room) {
  if (room && room.currentTimer) {
    clearInterval(room.currentTimer);
    room.currentTimer = null;
  }
}

function startTimer(roomCode, seconds, phase, onExpire) {
  const room = gm.getRoom(roomCode);
  if (!room) return;

  clearRoomTimer(room);

  let timeLeft = seconds;
  io.to(roomCode).emit('timerUpdate', { time: timeLeft, phase });

  room.currentTimer = setInterval(() => {
    timeLeft--;
    io.to(roomCode).emit('timerUpdate', { time: timeLeft, phase });

    if (timeLeft <= 0) {
      clearRoomTimer(room);
      onExpire();
    }
  }, 1000);
}

/* ─── Letter-selection phase timer ──────────────────── */
function startSelectionTimer(roomCode) {
  startTimer(roomCode, 30, 'selection', () => {
    const room = gm.getRoom(roomCode);
    if (!room) return;
    const result = gm.autoSelectLetter(roomCode);
    if (result && !result.error) {
      const selectorId = room.selectorOrder[(room.currentSelectorIndex) % room.selectorOrder.length];
      const selectorName = room.players[selectorId]?.name || 'System';
      io.to(roomCode).emit('alphabetSelected', {
        letter: result.letter,
        autoSelected: true,
        selectorName
      });
      startGameTimer(roomCode);
    }
  });
}

/* ─── Answer phase timer ─────────────────────────────── */
function startGameTimer(roomCode) {
  startTimer(roomCode, 60, 'game', () => endRound(roomCode, 'timeout'));
}

/* ─── End-of-round logic ─────────────────────────────── */
function endRound(roomCode, reason) {
  const room = gm.getRoom(roomCode);
  if (!room || room.roundEnded) return;
  room.roundEnded = true;
  clearRoomTimer(room);

  const result = gm.calculateScores(roomCode);
  io.to(roomCode).emit('scoreUpdate', result);

  const delay = result.gameOver ? 0 : 0;
  setTimeout(() => {
    if (result.gameOver) {
      io.to(roomCode).emit('gameOver', result);
    } else {
      const nextData = gm.nextRound(roomCode);
      io.to(roomCode).emit('nextTurn', nextData);
      startSelectionTimer(roomCode);
    }
  }, 6000); // 6 s to read results before next round
}

/* ═══════════════════════════════════════════════════════
   SOCKET EVENTS
═══════════════════════════════════════════════════════ */

io.on('connection', socket => {
  /* ── Create Room ── */
  socket.on('createRoom', ({ playerName, rounds }) => {
    if (!playerName?.trim()) return socket.emit('error', 'Name is required');
    const room = gm.createRoom(socket.id, playerName.trim(), rounds);
    socket.join(room.code);
    socket.emit('roomCreated', {
      roomCode: room.code,
      player:   room.players[socket.id],
      isHost:   true,
    });
    io.to(room.code).emit('lobbyUpdate', {
      players: Object.values(room.players),
      host:    room.host,
      rounds:  room.rounds,
    });
  });

  /* ── Join Room ── */
  socket.on('joinRoom', ({ playerName, roomCode }) => {
    if (!playerName?.trim()) return socket.emit('error', 'Name is required');
    const code   = (roomCode || '').trim().toUpperCase();
    const result = gm.joinRoom(socket.id, playerName.trim(), code);

    if (result.error) return socket.emit('joinError', result.error);

    socket.join(code);
    socket.emit('roomJoined', {
      roomCode: code,
      player:   result.player,
      isHost:   false,
      rounds:   result.room.rounds,
    });
    io.to(code).emit('lobbyUpdate', {
      players: Object.values(result.room.players),
      host:    result.room.host,
      rounds:  result.room.rounds,
    });
  });

  /* ── Start Game (host only) ── */
  socket.on('startGame', ({ rounds } = {}) => {
    const room = gm.getRoomByPlayer(socket.id);
    if (!room || room.host !== socket.id) return;

    const playerCount = Object.keys(room.players).length;
    if (playerCount < 2) {
      return socket.emit('error', `Need at least 2 players! (${playerCount}/2 joined)`);
    }

    // Allow host to finalise rounds from the lobby selector
    if (rounds) room.rounds = Math.min(Math.max(parseInt(rounds) || 5, 1), 15);

    const roundData = gm.startGame(room.code);
    if (roundData) {
      io.to(room.code).emit('gameStarted', roundData);
      startSelectionTimer(room.code);
    }
  });

  /* ── Update Rounds (host only, while in lobby) ── */
  socket.on('updateRounds', ({ rounds }) => {
    const room = gm.getRoomByPlayer(socket.id);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return;
    room.rounds = Math.min(Math.max(parseInt(rounds) || 5, 1), 15);
    io.to(room.code).emit('lobbyUpdate', {
      players: Object.values(room.players),
      host:    room.host,
      rounds:  room.rounds,
    });
  });

  /* ── Select Alphabet ── */
  socket.on('selectAlphabet', ({ letter }) => {
    const room = gm.getRoomByPlayer(socket.id);
    if (!room) return;

    const result = gm.selectAlphabet(room.code, socket.id, letter);
    if (result?.error) return socket.emit('error', result.error);

    const selectorName = room.players[socket.id]?.name;
    io.to(room.code).emit('alphabetSelected', { letter: result.letter, autoSelected: false, selectorName });
    startGameTimer(room.code);
  });

  /* ── Submit Answers ── */
  socket.on('submitAnswers', ({ answers }) => {
    const room = gm.getRoomByPlayer(socket.id);
    if (!room || room.roundEnded) return;

    const result = gm.submitAnswers(room.code, socket.id, answers);
    if (!result) return;

    socket.emit('answersAccepted');

    if (result.firstSubmit) {
      // If any player submits early, immediately stop the round for all players
      io.to(room.code).emit('roundStopped', {
        submittedBy: room.players[socket.id]?.name,
      });
      endRound(room.code, 'firstSubmit');
    } else {
      // This case might not be reached if the round ends immediately on first submit,
      // but we keep it for safety in case of simultaneous submissions.
      const allSubmitted = Object.keys(room.players).every(id => room.answers[id]);
      if (allSubmitted) {
        endRound(room.code, 'allSubmitted');
      }
    }
  });

  /* ── Disconnect ── */
  socket.on('disconnect', () => {
    const room = gm.removePlayer(socket.id);
    if (!room) return;

    const remaining = Object.values(room.players);
    if (remaining.length === 0) {
      gm.deleteRoom(room.code);
      return;
    }

    // Re-assign host if needed
    if (room.host === socket.id) room.host = remaining[0].id;

    io.to(room.code).emit('playerLeft', {
      players: remaining,
      host:    room.host,
    });
  });
});

/* ═══════════════════════════════════════════════════════
   START SERVER
═══════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮  NPAT server running → http://localhost:${PORT}`));
