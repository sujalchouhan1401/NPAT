'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const GameManager = require('./server/gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false,
  },
  // Allow both transports; production environments (Render) favour WebSocket
  transports: ['polling', 'websocket'],
  // Generous timeouts for slow/mobile connections
  pingTimeout:  60000,
  pingInterval: 25000,
  // Upgrade from polling → WebSocket when possible
  upgradeTimeout: 10000,
  // Needed for some reverse-proxy environments (Render uses one)
  allowEIO3: true,
  maxHttpBufferSize: 1e6, // 1 MB — prevents oversized packet abuse
});

// Diagnostic: Check fetch availability
console.log(`[Diagnostic] Node version: ${process.version}`);
console.log(`[Diagnostic] fetch available: ${typeof fetch !== 'undefined'}`);
const gm     = new GameManager();

app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint — required by Render to confirm the service is alive
app.get('/health', (_, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// Catch-all: serve the SPA for any other route
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Global log for server start details
console.log('--- Server Initialized ---');
console.log('Static files served from /public');

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

  io.to(roomCode).emit('roundEnding', { reason });

  // Grace period (3s) to allow clients to sync their last partial answers
  setTimeout(async () => {
    try {
      // Re-fetch room in case it was deleted
      const r2 = gm.getRoom(roomCode);
      if (!r2) return;

      r2.roundActive = false; // NOW submissions are strictly closed
      console.log(`[Flow] Grace period ended for ${roomCode}. Calculating scores...`);
      // Validate all answers across all players for this round
      const validationResults = await gm.validateAllAnswers(roomCode).catch(err => {
        console.error(`[Critical Error] Validation logic failed:`, err);
        return {}; 
      });

      const result = gm.calculateScores(roomCode, validationResults);
      if (!result) {
        console.error(`[Error] Failed to calculate scores for room ${roomCode}`);
        return;
      }
      
      console.log(`[Flow] Emitting showScores for ${roomCode}`);
      io.to(roomCode).emit('showScores', result);
      // Fallback for older clients
      io.to(roomCode).emit('scoreUpdate', result);

      if (result.gameOver) {
        io.to(roomCode).emit('gameOver', result);
      } else {
        // Only proceed to next round if game is not over
        setTimeout(() => {
          console.log(`[Flow] Results screen end for ${roomCode}. Starting next turn...`);
          gm.clearValidationCache(); // Reset validation cache for next turn
          const nextData = gm.nextRound(roomCode);
          io.to(roomCode).emit('nextTurn', nextData);
          startSelectionTimer(roomCode);
        }, 5000); // 5s after showScores
      }
    } catch (err) {
      console.error(`[Critical Error] endRound failed for room ${roomCode}:`, err);
    }
  }, 3000); // 3s grace period
}

/* ─── Leave / Disconnect Helper ────────────────── */
function handlePlayerLeft(socket) {
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
}

/* ═══════════════════════════════════════════════════════
   SOCKET EVENTS
═══════════════════════════════════════════════════════ */

io.on('connection', socket => {
  console.log(`[Socket] User Connected: ${socket.id}`);

  /* ── Create Room ── */
  socket.on('createRoom', ({ playerName, rounds }) => {
    console.log(`[Socket] createRoom from ${playerName} (${socket.id})`);
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
    console.log(`[Socket] joinRoom: ${playerName} attempting to join ${roomCode}`);
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
    if (rounds) room.rounds = Math.min(Math.max(parseInt(rounds) || 5, 1), 10);

    const roundData = gm.startGame(room.code);
    if (roundData) {
      gm.clearValidationCache(); // Reset validation cache at game start
      io.to(room.code).emit('gameStarted', roundData);
      startSelectionTimer(room.code);
    }
  });

  /* ── Update Rounds (host only, while in lobby) ── */
  socket.on('updateRounds', ({ rounds }) => {
    const room = gm.getRoomByPlayer(socket.id);
    if (!room || room.host !== socket.id || room.phase !== 'lobby') return;
    room.rounds = Math.min(Math.max(parseInt(rounds) || 5, 1), 10);
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
  socket.on('submitAnswers', (data) => {
    try {
      const { roomCode, playerId, answers } = data || {};
      console.log(`[Server] Received submission from ${playerId} in room ${roomCode}`);
      console.log(`[Server] Answers:`, answers);

      const room = gm.getRoom(roomCode);
      if (!room) {
        console.warn(`[Server] Submission rejected: Room ${roomCode} not found.`);
        return socket.emit('error', 'Room not found.');
      }

      if (!room.players[socket.id]) {
        console.warn(`[Server] Submission rejected: Player ${socket.id} not in room ${roomCode}.`);
        return socket.emit('error', 'You are not in this room.');
      }

      if (!room.roundActive) {
        console.warn(`[Server] Submission rejected: Round is no longer active for room ${roomCode}.`);
        return; 
      }

      const result = gm.submitAnswers(room.code, socket.id, answers);
      if (!result) return;

      console.log(`[Server] Submission accepted for ${socket.id}`);
      socket.emit('answersAccepted');

      if (result.firstSubmit) {
        console.log(`[Flow] FIRST SUBMISSION by ${socket.id} in ${roomCode}. Starting 3s grace period.`);
        
        clearRoomTimer(room);

        io.to(room.code).emit('roundStopped', {
          submittedBy: room.players[socket.id]?.name,
        });
        
        // Trigger endRound flow (which handles validation and scoring)
        endRound(room.code, 'firstSubmit');
      } else {
        const allSubmitted = Object.keys(room.players).every(id => room.answers[id]);
        if (allSubmitted) {
          console.log(`[Server] All players submitted in room ${roomCode}.`);
        }
      }
    } catch (err) {
      console.error(`[Critical Server Error] submitAnswers listener failed:`, err);
      socket.emit('error', 'An internal error occurred during submission.');
    }
  });

  /* ── Update Answer (Real-time Sync) ── */
  socket.on('updateAnswer', (data) => {
    try {
      const { roomCode, category, value } = data || {};
      const room = gm.getRoom(roomCode);
      
      if (!room || room.phase !== 'playing' || !room.roundActive) return;

      // Update answer in real-time
      if (!room.answers[socket.id]) room.answers[socket.id] = {};
      room.answers[socket.id][category] = (value || '').trim();
      
    } catch (err) {
      console.error(`[Server Error] updateAnswer listener failed:`, err);
    }
  });

  /* ── Leave Room ── */
  socket.on('leaveRoom', () => {
    console.log(`[Socket] User Leaving Room: ${socket.id}`);
    handlePlayerLeft(socket);
  });

  /* ── Disconnect ── */
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] User Disconnected: ${socket.id} (Reason: ${reason})`);
    handlePlayerLeft(socket);
  });
});

/* ═══════════════════════════════════════════════════════
   START SERVER
═══════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮  NPAT server running → http://localhost:${PORT}`));

// Global Crash Prevention
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error(`[Uncaught Exception] at: ${origin}. error: ${err}`);
});
