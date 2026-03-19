'use strict';

const CATEGORIES = ['name', 'place', 'animal', 'thing'];
const ALL_ALPHABETS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

class GameManager {
  constructor() {
    this.rooms = {};        // roomCode → room object
    this.playerRooms = {}; // socketId → roomCode
  }

  /* ─── Utilities ─────────────────────────────────────── */

  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return this.rooms[code] ? this._generateCode() : code;
  }

  _makePlayer(socketId, name) {
    return { id: socketId, name, score: 0, roundScores: [] };
  }

  _availableAlphabets(room) {
    // Lock used alphabets until 18 unique ones have been used
    if (room.usedAlphabets.length < 18) {
      return ALL_ALPHABETS.filter(a => !room.usedAlphabets.includes(a));
    }
    return [...ALL_ALPHABETS];
  }

  /* ─── Room management ────────────────────────────────── */

  createRoom(socketId, playerName, rounds) {
    const code = this._generateCode();
    const player = this._makePlayer(socketId, playerName);

    this.rooms[code] = {
      code,
      host: socketId,
      players: { [socketId]: player },
      rounds: Math.min(Math.max(parseInt(rounds) || 5, 1), 10),
      currentRound: 0,
      usedAlphabets: [],
      currentLetter: null,
      selectorOrder: [socketId],
      currentSelectorIndex: 0,
      answers: {},
      phase: 'lobby',       // lobby | selecting | playing | results
      roundEnded: false,
      firstSubmitter: null,
      currentTimer: null,
    };

    this.playerRooms[socketId] = code;
    return this.rooms[code];
  }

  joinRoom(socketId, playerName, roomCode) {
    const room = this.rooms[roomCode];
    if (!room)                                      return { error: 'Room not found! Check the code.' };
    if (room.phase !== 'lobby')                     return { error: 'Game has already started!' };
    if (Object.keys(room.players).length >= 10)     return { error: 'Room is full (max 10 players)!' };
    if (Object.values(room.players).some(p => p.name.toLowerCase() === playerName.toLowerCase()))
                                                    return { error: 'Name already taken in this room!' };

    const player = this._makePlayer(socketId, playerName);
    room.players[socketId] = player;
    room.selectorOrder.push(socketId);
    this.playerRooms[socketId] = roomCode;

    return { player, room };
  }

  /* ─── Game flow ──────────────────────────────────────── */

  startGame(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;

    room.phase = 'selecting';
    room.currentRound = 1;
    room.roundEnded = false;

    return this._roundStartPayload(room);
  }

  _roundStartPayload(room) {
    const players = Object.keys(room.players);
    const selectorId = room.selectorOrder[room.currentSelectorIndex % room.selectorOrder.length];
    
    // Calculate display round and display turn
    // Round 1 consists of every player getting one turn
    const displayRound = Math.floor(room.currentSelectorIndex / players.length) + 1;
    const displayTurn = (room.currentSelectorIndex % players.length) + 1;

    return {
      round: displayRound,
      totalRounds: room.rounds,
      turn: displayTurn,
      totalTurns: players.length,
      selectorId,
      selectorName: room.players[selectorId]?.name ?? 'Unknown',
      availableAlphabets: this._availableAlphabets(room),
      usedAlphabets: [...room.usedAlphabets],
    };
  }

  selectAlphabet(roomCode, socketId, letter) {
    const room = this.rooms[roomCode];
    if (!room) return { error: 'Room not found' };
    if (room.phase !== 'selecting') return { error: 'Not in selection phase' };

    const selectorId = room.selectorOrder[room.currentSelectorIndex % room.selectorOrder.length];
    if (selectorId !== socketId) return { error: 'Not your turn to select' };

    const L = letter.toUpperCase();
    if (!this._availableAlphabets(room).includes(L)) return { error: 'Letter not available' };

    room.currentLetter = L;
    if (!room.usedAlphabets.includes(L)) room.usedAlphabets.push(L);
    room.phase = 'playing';
    room.answers = {};
    room.roundEnded = false;
    room.firstSubmitter = null;

    return { letter: L };
  }

  autoSelectLetter(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;

    const available = this._availableAlphabets(room);
    const letter = available[Math.floor(Math.random() * available.length)];
    const selectorId = room.selectorOrder[room.currentSelectorIndex % room.selectorOrder.length];

    return this.selectAlphabet(roomCode, selectorId, letter);
  }

  submitAnswers(roomCode, socketId, answers) {
    const room = this.rooms[roomCode];
    if (!room || room.phase !== 'playing') return null;
    if (room.answers[socketId]) return null; // already submitted

    // Sanitize answers
    const clean = {};
    CATEGORIES.forEach(c => { clean[c] = (answers[c] || '').trim().slice(0, 60); });
    room.answers[socketId] = clean;

    const isFirst = room.firstSubmitter === null;
    if (isFirst) room.firstSubmitter = socketId;

    return { firstSubmit: isFirst };
  }

  /* ─── Scoring ────────────────────────────────────────── */

  calculateScores(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;

    const players = Object.values(room.players);
    const roundScores = {};
    players.forEach(p => { roundScores[p.id] = { name: p.name, categories: {}, total: 0 }; });

    CATEGORIES.forEach(cat => {
      // Normalize answers for deduplication
      const normalised = {};
      players.forEach(p => {
        const raw  = room.answers[p.id]?.[cat] ?? '';
        const norm = raw.trim().toLowerCase();
        normalised[p.id] = { raw, norm };
      });

      // Group by normalised value
      const groups = {};
      players.forEach(p => {
        const { norm } = normalised[p.id];
        if (!norm) return;
        if (!groups[norm]) groups[norm] = [];
        groups[norm].push(p.id);
      });

      // Award points
      players.forEach(p => {
        const { raw, norm } = normalised[p.id];
        if (!norm) {
          roundScores[p.id].categories[cat] = { answer: '', points: 0, shared: false };
          return;
        }
        const group = groups[norm];
        // Score = 10 / number of players with same answer
        const pts = Number((10 / group.length).toFixed(1)); 
        roundScores[p.id].categories[cat] = { answer: raw, points: pts, shared: group.length > 1 };
        roundScores[p.id].total += pts;
      });
    });

    // Update cumulative scores
    players.forEach(p => {
      p.score = Number((p.score + roundScores[p.id].total).toFixed(1));
      p.roundScores.push(roundScores[p.id].total);
    });

    const leaderboard = [...players].sort((a, b) => b.score - a.score);
    // Game over when every player has had 'rounds' number of turns
    const gameOver = room.currentSelectorIndex >= (room.rounds * players.length) - 1;

    return {
      round: Math.floor(room.currentSelectorIndex / players.length) + 1,
      totalRounds: room.rounds,
      turn: (room.currentSelectorIndex % players.length) + 1,
      totalTurns: players.length,
      letter: room.currentLetter,
      roundScores,
      leaderboard,
      gameOver,
      finalScores: gameOver ? leaderboard : null,
    };
  }

  nextRound(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;

    room.currentRound++;
    room.currentSelectorIndex++;
    room.phase = 'selecting';
    room.roundEnded = false;
    room.answers = {};
    room.firstSubmitter = null;

    return this._roundStartPayload(room);
  }

  /* ─── Player management ─────────────────────────────── */

  removePlayer(socketId) {
    const roomCode = this.playerRooms[socketId];
    if (!roomCode) return null;

    const room = this.rooms[roomCode];
    if (!room) return null;

    delete room.players[socketId];
    room.selectorOrder = room.selectorOrder.filter(id => id !== socketId);
    delete this.playerRooms[socketId];

    return room;
  }

  deleteRoom(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return;
    if (room.currentTimer) clearInterval(room.currentTimer);
    Object.keys(room.players).forEach(id => delete this.playerRooms[id]);
    delete this.rooms[roomCode];
  }

  /* ─── Lookups ────────────────────────────────────────── */

  getRoomByPlayer(socketId) { return this.rooms[this.playerRooms[socketId]]; }
  getRoom(roomCode)         { return this.rooms[roomCode]; }
}

module.exports = GameManager;
