'use strict';

const { validateAllAnswers, clearCache } = require('./validator');

const CATEGORIES = ['name', 'place', 'animal', 'thing'];
const ALL_ALPHABETS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

class GameManager {
  constructor() {
    this.rooms = {};        // roomCode → room object
    this.playerRooms = {}; // socketId → roomCode
    // Note: validation cache is now managed inside validator.js with TTL
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
      roundActive: false, // Explicit flag for submission control
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
    room.roundActive = true; // Round is now active for submissions
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
    console.log(`[Logic] submitAnswers for room ${roomCode} from ${socketId}. Active: ${room?.roundActive}`);
    
    if (!room || room.phase !== 'playing' || !room.roundActive) {
      console.warn(`[Logic] Submission rejected. Room: ${!!room}, Phase: ${room?.phase}, Active: ${room?.roundActive}`);
      return null;
    }
    
    if (room.answers[socketId]) {
      console.warn(`[Logic] Duplicate submission from ${socketId}`);
      return null;
    }

    // Sanitize answers
    const clean = {};
    CATEGORIES.forEach(c => { clean[c] = (answers[c] || '').trim().slice(0, 60); });
    room.answers[socketId] = clean;

    const isFirst = room.firstSubmitter === null;
    if (isFirst) {
      room.firstSubmitter = socketId;
      // Note: roundActive is now kept TRUE during the 3s grace period
      // to capture other players' inputs. It is set to false in server.js endRound().
    }

    return { firstSubmit: isFirst };
  }

  /* ─── Validation (delegates to validator.js) ────────── */

  /**
   * Validate all player answers for a room.
   * Returns structured results: { [playerId]: { answers: { name, place, animal, thing: { value, valid } } } }
   */
  async validateAllAnswers(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return {};

    console.log(`[Validation] Starting for room ${roomCode}, letter: ${room.currentLetter}`);
    const results = await validateAllAnswers(room.answers, room.currentLetter);
    console.log(`[Validation] Complete for room ${roomCode}`);
    return results;
  }

  /** Clear the validator cache between games */
  clearValidationCache() {
    clearCache();
  }

  /* ─── Scoring ────────────────────────────────────────── */

  /**
   * Calculate scores using the structured validation results from validateAllAnswers().
   *
   * validationResults format:
   *   { [playerId]: { answers: { name, place, animal, thing: { value, valid } } } }
   *
   * Scoring rules:
   *   • 10 pts  → unique valid answer (no other player wrote the same word)
   *   •  5 pts  → shared valid answer (2+ players wrote the same word)
   *   •  0 pts  → blank, wrong letter, or invalid word
   */
  calculateScores(roomCode, validationResults = {}) {
    const room = this.rooms[roomCode];
    if (!room) return null;

    console.log(`\n--- [FLOW] SCORING START: ROOM ${roomCode} ---`);
    console.log(`Letter: ${room.currentLetter}`);

    const players = Object.values(room.players);
    const roundScores = {};
    players.forEach(p => {
      roundScores[p.id] = { name: p.name, categories: {}, total: 0 };
      console.log(`[Collected Answers] ${p.name}:`, room.answers[p.id] || 'NO DATA');
    });

    CATEGORIES.forEach(cat => {
      console.log(`\n[Category: ${cat.toUpperCase()}]`);

      // ── Step 1: determine each player's validity from structured results ──
      const normalised = {};
      const frequencyMap = {}; // normalised word → count of valid answers

      players.forEach(p => {
        const raw  = room.answers[p.id]?.[cat] ?? '';
        const norm = raw.trim().toLowerCase();

        // Pull validity from the new structured validation results
        const playerResult = validationResults[p.id]?.answers?.[cat];
        const isValid = playerResult ? playerResult.valid : false;

        normalised[p.id] = { raw, norm, isValid };

        if (norm && isValid) {
          frequencyMap[norm] = (frequencyMap[norm] || 0) + 1;
        }
      });

      console.log(`[Frequency Map]`, frequencyMap);

      // ── Step 2: award points ──
      players.forEach(p => {
        const { raw, norm, isValid } = normalised[p.id];

        if (!norm || !isValid) {
          roundScores[p.id].categories[cat] = { answer: raw, points: 0, shared: false, valid: false };
          console.log(`  > ${p.name}: "${raw}" → 0 pts (Invalid or Empty)`);
          return;
        }

        const count  = frequencyMap[norm];
        const shared = count > 1;
        // ✅ Strict 10 / 5 / 0 scoring
        const pts    = shared ? 5 : 10;

        roundScores[p.id].categories[cat] = { answer: raw, points: pts, shared, valid: true };
        roundScores[p.id].total += pts;
        console.log(`  > ${p.name}: "${raw}" → ${pts} pts ${shared ? `(Shared ×${count})` : '(Unique)'}`);
      });
    });

    // Update cumulative scores
    players.forEach(p => {
      p.score = Number((p.score + roundScores[p.id].total).toFixed(1));
      p.roundScores.push(roundScores[p.id].total);
    });

    console.log(`\n--- [FLOW] FINAL SCORES ---`);
    Object.values(roundScores).forEach(rs => console.log(`${rs.name}: ${rs.total} pts`));

    const leaderboard = [...players].sort((a, b) => b.score - a.score);
    const gameOver = room.currentSelectorIndex >= (room.rounds * players.length) - 1;

    console.log(`-------------------------------------------\n`);

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
    room.roundActive = false; // Reset for next selection
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
