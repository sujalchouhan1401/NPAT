/* ═══════════════════════════════════════════════
   NPAT – Client-side Game Logic
   game.js
═══════════════════════════════════════════════ */

'use strict';

/* ─── Socket ────────────────────────────────── */
const socket = io({
  transports: ['websocket', 'polling']
});

/* ─── State ─────────────────────────────────── */
const state = {
  roomCode:   null,
  myId:       null,
  myName:     null,
  isHost:     false,
  players:    [],
  currentLetter: null,
  currentRound:  1,
  totalRounds:   5,
  currentTurn:   1,
  totalTurns:    1,
  submitted:  false,
  gamePhase:  'lobby', // lobby | selecting | playing | results | gameover
};

/* ─── Avatar colours ────────────────────────── */
const AVATAR_COLORS = [
  '#7c4dff','#e84393','#00b4d8','#06d6a0',
  '#ffd166','#ef476f','#118ab2','#f77f00',
  '#6d6875','#2ec4b6',
];

function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/* ═══════════════════════════════════════════════
   SCREEN MANAGEMENT
═══════════════════════════════════════════════ */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════════════
   FORM VALIDATION HELPERS
═══════════════════════════════════════════════ */

/**
 * Show an inline error message beneath a field.
 * Creates (or reuses) a `.field-error` span after the input.
 */
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  field.classList.add('field-invalid');

  // Reuse existing error element or create new
  let errEl = field.parentElement.querySelector('.field-error');
  if (!errEl) {
    errEl = document.createElement('span');
    errEl.className = 'field-error';
    field.after(errEl);
  }
  errEl.textContent = message;
  errEl.style.display = 'block';

  // Shake animation
  field.style.animation = 'none';
  field.offsetHeight;  // reflow
  field.style.animation = 'fieldShake 0.35s ease';
}

/**
 * Remove the inline error state from a field.
 */
function clearFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.remove('field-invalid');
  field.style.animation = '';
  const errEl = field.parentElement?.querySelector('.field-error');
  if (errEl) errEl.style.display = 'none';
}

/**
 * Clear ALL field errors inside a given form/screen.
 */
function clearAllErrors(screenId) {
  const screen = document.getElementById(`screen-${screenId}`);
  if (!screen) return;
  screen.querySelectorAll('.field-error').forEach(e => { e.style.display = 'none'; });
  screen.querySelectorAll('.field-invalid').forEach(e => e.classList.remove('field-invalid'));
}

/* ═══════════════════════════════════════════════
   BUTTON LOADING STATE
═══════════════════════════════════════════════ */

/**
 * Put a button into loading mode (disabled + spinner text).
 * Returns a restore function to call on completion.
 */
function setButtonLoading(btnId, loadingText = 'Please wait…') {
  const btn = document.getElementById(btnId);
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
  btn.style.opacity = '0.8';
  return function restore(newText) {
    btn.disabled = false;
    btn.innerHTML = newText ?? original;
    btn.style.opacity = '';
  };
}

/* ═══════════════════════════════════════════════
   SOUND ENGINE  (Web Audio API – no files needed)
═══════════════════════════════════════════════ */

let audioCtx = null;

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, type, duration, gain = 0.25, delay = 0) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gn  = ctx.createGain();
    osc.connect(gn);
    gn.connect(ctx.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gn.gain.setValueAtTime(gain, ctx.currentTime + delay);
    gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime  + delay + duration);
  } catch (_) { /* browsers that block AudioContext */ }
}

const SFX = {
  click()      { playTone(700, 'sine', 0.05, 0.15); },
  tick()       { playTone(880, 'sine', 0.04, 0.05); },
  tickUrgent() { playTone(1000, 'sine', 0.04, 0.08); },
  join()       { playTone(440, 'sine', 0.1, 0.15); playTone(554, 'sine', 0.1, 0.15, 0.1); },
  submit()     { [0,0.08,0.16].forEach((d,i)=>playTone([523,659,784][i],'sine',0.1,0.15,d)); },
  letterPick() { playTone(784, 'sine', 0.15, 0.2); playTone(988, 'sine', 0.15, 0.15, 0.12); },
  roundEnd()   { [0,0.08,0.16,0.28].forEach((d,i)=>playTone([392,494,588,784][i],'sine',0.12,0.15,d)); },
  winner()     {
    const notes = [523,659,784,1047,784,659,523];
    notes.forEach((f,i) => playTone(f, 'sine', 0.18, 0.2, i * 0.1));
  },
};

/* ═══════════════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════════════ */

function showToast(msg, type = 'info', duration = 3000) {
  const c   = document.getElementById('toast-container');
  
  // Prevent stacking identical errors quickly
  const existing = Array.from(c.querySelectorAll('.toast')).find(t => t.textContent === msg);
  if (existing && type === 'error') return;

  const div = document.createElement('div');
  div.className = `toast toast-${type}`;
  div.textContent = msg;
  c.appendChild(div);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateY(24px) scale(0.9)';
    div.style.transition = 'all 0.35s';
    setTimeout(() => div.remove(), 350);
  }, duration);
}

/* ═══════════════════════════════════════════════
   TIMER DISPLAY
═══════════════════════════════════════════════ */

function setTimer(el, value, phase) {
  el.textContent = value;
  el.classList.toggle('urgent', value <= 10 && phase === 'game');
  if (value <= 10 && phase === 'game')   SFX.tickUrgent();
  else if (phase === 'selection' && value <= 5) SFX.tick();
}

/* ═══════════════════════════════════════════════
   PLAYERS LIST (shared)
═══════════════════════════════════════════════ */

function renderPlayersList(containerId, players, hostId) {
  const ul = document.getElementById(containerId);
  ul.innerHTML = '';
  players.forEach(p => {
    const isMe  = p.id === state.myId;
    const isHost = p.id === hostId;
    const li = document.createElement('li');
    li.className = `player-item${isHost ? ' host-player' : ''}${isMe ? ' me' : ''}`;
    li.innerHTML = `
      <div class="player-avatar" style="background:${avatarColor(p.name)}">${p.name[0].toUpperCase()}</div>
      <span>${p.name}</span>
      ${isHost ? '<span class="player-badge">Host 👑</span>' : ''}
      ${isMe && !isHost ? '<span class="player-badge me-badge">You ✨</span>' : ''}
      ${isMe && isHost  ? '<span class="player-badge me-badge">You 👑</span>' : ''}
    `;
    ul.appendChild(li);
  });
}

/* ═══════════════════════════════════════════════
   ALPHABET GRID
═══════════════════════════════════════════════ */

function buildAlphabetGrid(available, used) {
  const grid = document.getElementById('alphabet-grid');
  grid.innerHTML = '';
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(letter => {
    const btn = document.createElement('button');
    btn.className  = 'alpha-btn';
    btn.textContent = letter;
    btn.dataset.letter = letter;

    const isUsed     = used.includes(letter);
    const isAvailable = available.includes(letter);

    if (isUsed)      { btn.classList.add('used'); btn.disabled = true; }
    if (!isAvailable) btn.disabled = true;

    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      SFX.letterPick();
      socket.emit('selectAlphabet', { letter });
    });

    grid.appendChild(btn);
  });
}

/* ═══════════════════════════════════════════════
   GAME TABLE (answer inputs)
═══════════════════════════════════════════════ */

function buildGameTable(players, letter) {
  const tbody = document.getElementById('game-table-body');
  tbody.innerHTML = '';

  players.forEach(p => {
    const isMe = p.id === state.myId;
    const tr   = document.createElement('tr');
    tr.className = 'player-row';
    tr.dataset.playerId = p.id;

    const cats = ['name', 'place', 'animal', 'thing'];
    let cells = `<td class="player-name-cell">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="player-avatar" style="background:${avatarColor(p.name)};width:28px;height:28px;font-size:0.9rem">${p.name[0].toUpperCase()}</div>
        ${p.name}${isMe ? ' ✨' : ''}
      </div>
    </td>`;

    cats.forEach((cat, i) => {
      if (isMe) {
        cells += `<td><input class="answer-input" id="ans-${cat}" type="text"
          maxlength="40" placeholder="${letter}…" autocomplete="off"
          data-cat="${cat}" data-idx="${i}" /></td>`;
      } else {
        cells += `<td><span id="opp-${p.id}-${cat}" style="font-family:var(--font-hand);color:var(--ink-light);font-size:1rem">—</span></td>`;
      }
    });

    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  // Tab through inputs, Enter = move to next
  const inputs = [...document.querySelectorAll('.answer-input')];
  inputs.forEach((inp, idx) => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const next = inputs[idx + 1];
        if (next) next.focus(); else inputs[0].focus();
      }
    });
  });

  // Focus first input
  if (inputs[0]) setTimeout(() => inputs[0].focus(), 300);
}

/* ═══════════════════════════════════════════════
   ROUND RESULTS
═══════════════════════════════════════════════ */

function renderRoundResults(data) {
  const { round, letter, roundScores, leaderboard } = data;

  document.getElementById('results-letter').textContent = letter;
  document.getElementById('results-round-title').textContent = `Round ${round} Results`;
  document.getElementById('results-round-sub').textContent =
    data.gameOver ? '🎉 Final round complete!' : `Round ${round} of ${state.totalRounds} done`;

  // Score table
  const tbody = document.getElementById('results-score-body');
  tbody.innerHTML = '';
  const cats = ['name', 'place', 'animal', 'thing'];

  Object.values(roundScores).forEach(ps => {
    const tr = document.createElement('tr');
    let cells = `<td><b>${ps.name}</b></td>`;
    cats.forEach(cat => {
      const c = ps.categories[cat] || { answer: '', points: 0 };
      const pillClass = c.points === 0 ? 'zero' : c.shared ? 'shared' : '';
      cells += `<td>
        <div>${c.answer || '<i style="opacity:.4">—</i>'}</div>
        <span class="points-pill ${pillClass}">${c.points}pts</span>
      </td>`;
    });
    cells += `<td><b style="font-size:1.3rem;color:var(--accent2)">${ps.total}</b></td>`;
    tr.innerHTML = cells;
    tbody.appendChild(tr);
  });

  // Leaderboard
  renderLeaderboard('results-leaderboard', leaderboard);
}

function renderLeaderboard(containerId, players) {
  const maxScore = players[0]?.score || 1;
  const div = document.getElementById(containerId);
  div.innerHTML = '';

  const medals = ['🥇','🥈','🥉'];
  players.forEach((p, i) => {
    const pct   = Math.round((p.score / maxScore) * 100);
    const isMe  = p.id === state.myId;
    const row   = document.createElement('div');
    row.className = 'lb-row';
    row.style.animationDelay = `${i * 0.07}s`;
    row.innerHTML = `
      <div class="lb-bar" style="width:${pct}%"></div>
      <div class="lb-rank">${medals[i] ?? i + 1}</div>
      <div class="player-avatar" style="background:${avatarColor(p.name)};width:32px;height:32px;font-size:1rem">${p.name[0].toUpperCase()}</div>
      <div class="lb-name">${p.name}${isMe ? ' <span style="font-size:.85rem;color:var(--accent2)">You</span>' : ''}</div>
      <div class="lb-score">${p.score}<span style="font-size:.8rem;font-weight:400;color:var(--ink-light)">pts</span></div>
    `;
    div.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════════════ */

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = Array.from({ length: 120 }, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height - canvas.height,
    w:  6 + Math.random() * 8,
    h:  10 + Math.random() * 6,
    r:  Math.random() * Math.PI * 2,
    dr: (Math.random() - 0.5) * 0.15,
    dx: (Math.random() - 0.5) * 2,
    dy: 2 + Math.random() * 4,
    c:  `hsl(${Math.random() * 360},90%,60%)`,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      p.x += p.dx; p.y += p.dy; p.r += p.dr;
      if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
    });
    frame++;
    if (frame < 300) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

/* ═══════════════════════════════════════════════
   HOME SCREEN BUTTONS
═══════════════════════════════════════════════ */

/* ─── Home nav ────────────────────────────────── */
document.getElementById('btn-create').addEventListener('click', () => {
  SFX.click();
  clearAllErrors('create');
  // Restore saved name
  if (state.myName) document.getElementById('create-name').value = state.myName;
  showScreen('create');
  setTimeout(() => document.getElementById('create-name').focus(), 350);
});

document.getElementById('btn-join').addEventListener('click', () => {
  SFX.click();
  clearAllErrors('join');
  if (state.myName) document.getElementById('join-name').value = state.myName;
  showScreen('join');
  setTimeout(() => {
    const nameEl = document.getElementById('join-name');
    nameEl.value ? document.getElementById('join-code').focus() : nameEl.focus();
  }, 350);
});

document.getElementById('btn-back-create').addEventListener('click', () => {
  SFX.click();
  clearAllErrors('create');
  showScreen('home');
});

document.getElementById('btn-back-join').addEventListener('click', () => {
  SFX.click();
  clearAllErrors('join');
  showScreen('home');
});

/* ─── Stepper Logic ─────────────────────────── */
function initStepper(id, min = 1, max = 10, onChange = null) {
  const minus = document.getElementById(`${id}-minus`);
  const plus  = document.getElementById(`${id}-plus`);
  const disp  = document.getElementById(`${id}-display`);
  const input = document.getElementById(id);

  const update = (val) => {
    val = Math.max(min, Math.min(max, val));
    disp.textContent = val;
    input.value = val;
    minus.disabled = (val <= min);
    plus.disabled  = (val >= max);
    if (onChange) onChange(val);
  };

  minus.addEventListener('click', () => { SFX.click(); update(parseInt(input.value) - 1); });
  plus.addEventListener('click',  () => { SFX.click(); update(parseInt(input.value) + 1); });

  // Init
  update(parseInt(input.value));
  return update;
}

const updateCreateRounds = initStepper('create-rounds', 1, 10);
const updateLobbyRounds = initStepper('lobby-rounds', 1, 10, (val) => {
  if (state.isHost) socket.emit('updateRounds', { rounds: val });
});

/* ─── Auto-uppercase + max-length enforcement ─── */
const joinCodeInput = document.getElementById('join-code');
joinCodeInput.addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (this.value.length > 0) clearFieldError('join-code');
});

/* ─── Clear errors on typing ─────────────────── */
document.getElementById('create-name').addEventListener('input', () => clearFieldError('create-name'));
document.getElementById('join-name').addEventListener('input',   () => clearFieldError('join-name'));
document.getElementById('join-code').addEventListener('input',   () => clearFieldError('join-code'));

/* ═══════════════════════════════════════════════
   CREATE ROOM
═══════════════════════════════════════════════ */

let _createRestore = null;

document.getElementById('btn-do-create').addEventListener('click', () => {
  SFX.click();
  clearAllErrors('create');

  const name   = document.getElementById('create-name').value.trim();
  const rounds = document.getElementById('create-rounds').value;

  // ── Validation ──
  if (!name) {
    showFieldError('create-name', '✏️ Please enter your name to continue');
    document.getElementById('create-name').focus();
    return;
  }
  if (name.length < 2) {
    showFieldError('create-name', '✏️ Name must be at least 2 characters');
    return;
  }

  // ── Loading state ──
  state.myName = name;
  _createRestore = setButtonLoading('btn-do-create', 'Creating room…');
  socket.emit('createRoom', { playerName: name, rounds });
});

/* ═══════════════════════════════════════════════
   JOIN ROOM
═══════════════════════════════════════════════ */

let _joinRestore = null;

document.getElementById('btn-do-join').addEventListener('click', () => {
  SFX.click();
  clearAllErrors('join');

  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();

  // ── Validation ──
  let hasError = false;

  if (!name) {
    showFieldError('join-name', '✏️ Please enter your name');
    hasError = true;
  } else if (name.length < 2) {
    showFieldError('join-name', '✏️ Name must be at least 2 characters');
    hasError = true;
  }

  if (!code) {
    showFieldError('join-code', '🔑 Room code is required');
    hasError = true;
  } else if (code.length < 5) {
    showFieldError('join-code', `🔑 Code must be 5 characters (${code.length}/5 entered)`);
    hasError = true;
  }

  if (hasError) {
    // Focus first invalid field
    const firstInvalid = document.querySelector('#screen-join .field-invalid');
    if (firstInvalid) firstInvalid.focus();
    return;
  }

  // ── Loading state ──
  state.myName = name;
  _joinRestore = setButtonLoading('btn-do-join', 'Joining room…');
  socket.emit('joinRoom', { playerName: name, roomCode: code });
});

/* ─── Enter key shortcuts ─────────────────────── */
document.getElementById('create-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-do-create').click();
});

document.getElementById('join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-do-join').click();
});

document.getElementById('join-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('join-code').focus();
});

/* ═══════════════════════════════════════════════
   LOBBY
═══════════════════════════════════════════════ */

document.getElementById('copy-code-btn').addEventListener('click', () => {
  SFX.click();
  navigator.clipboard.writeText(state.roomCode).then(() => {
    showToast('Room code copied! 📋', 'success', 1800);
  }).catch(() => {});
});

// Removed old lobby-rounds-select change listener (now handled by initStepper)

/* ─── Host: Start Game ────────────────────── */
document.getElementById('btn-start-game').addEventListener('click', () => {
  const count = state.players.length;
  if (count < 2) {
    showToast(`Need at least 2 players! (${count}/2)`, 'error', 3000);
    return;
  }
  SFX.click();
  socket.emit('startGame', { rounds: document.getElementById('lobby-rounds').value });
});

/**
 * Update every lobby DOM element driven by player count
 * and rounds. Called any time either changes.
 */
function _updateLobbyUI(players, rounds, hostId) {
  const count   = players.length;
  const MAX     = 10;
  const MIN     = 2;
  const pct     = Math.round((count / MAX) * 100);
  const isHost  = state.isHost;

  // Heading
  const heading = document.getElementById('lobby-players-heading');
  if (heading) heading.textContent = `👥 Players (${count}/10)`;

  // Slot progress bar
  const fill  = document.getElementById('slot-bar-fill');
  const label = document.getElementById('slot-bar-label');
  if (fill)  fill.style.width = `${pct}%`;
  if (fill)  fill.className   = `slot-bar-fill${count >= MAX ? ' full' : ''}`;
  if (label) label.textContent = `${count} / ${MAX} slots filled`;

  // Rounds badge (top right)
  const badge = document.getElementById('lobby-rounds-badge');
  if (badge) badge.textContent = `${rounds} Rounds`;

  // Guest rounds indicator
  const guestRounds = document.getElementById('lobby-guest-rounds');
  if (guestRounds) guestRounds.textContent = `${rounds} Rounds`;

  if (isHost) {
    // Sync rounds selector
    const sel = document.getElementById('lobby-rounds');
    if (sel && sel.value !== String(rounds)) {
      sel.value = rounds;
      const disp = document.getElementById('lobby-rounds-display');
      if (disp) disp.textContent = rounds;
    }

    // Min-player warning
    const warn  = document.getElementById('lobby-min-warning');
    const badge2 = document.getElementById('lobby-min-count');
    const hint  = document.getElementById('lobby-host-hint');
    const btn   = document.getElementById('btn-start-game');

    if (count < MIN) {
      // Not enough players
      if (warn)  warn.style.display  = 'flex';
      if (badge2) badge2.textContent = `${count}/${MIN}`;
      if (hint)  hint.textContent    = `Waiting for ${MIN - count} more player${MIN - count > 1 ? 's' : ''} to join…`;
      if (btn) { btn.disabled = true; btn.classList.add('btn-locked'); }
    } else {
      // Enough players — ready to go!
      if (warn)  warn.style.display  = 'none';
      if (hint)  hint.textContent    = `✅ Ready! ${count} player${count > 1 ? 's' : ''} joined.`;
      if (btn) { btn.disabled = false; btn.classList.remove('btn-locked'); }
    }
  }
}

/* ═══════════════════════════════════════════════
   SUBMIT ANSWERS
═══════════════════════════════════════════════ */

document.getElementById('btn-submit').addEventListener('click', submitAnswers);

function submitAnswers() {
  if (state.submitted) return;
  SFX.submit();

  const answers = {};
  ['name', 'place', 'animal', 'thing'].forEach(cat => {
    const inp = document.getElementById(`ans-${cat}`);
    answers[cat] = inp ? inp.value.trim() : '';
  });

  state.submitted = true;
  socket.emit('submitAnswers', { answers });

  // Disable inputs
  document.querySelectorAll('.answer-input').forEach(inp => inp.disabled = true);
  document.getElementById('submit-section').style.display = 'none';
  document.getElementById('submitted-msg').style.display  = 'flex';
}

/* ═══════════════════════════════════════════════
   GAME OVER BUTTONS
═══════════════════════════════════════════════ */

document.getElementById('btn-play-again').addEventListener('click', () => {
  SFX.click();
  // Reset and go to lobby (host must restart)
  showScreen('home');
  resetState();
});

document.getElementById('btn-home').addEventListener('click', () => {
  SFX.click();
  showScreen('home');
  resetState();
});

function resetState() {
  state.roomCode     = null;
  state.myId         = null;
  state.isHost       = false;
  state.players      = [];
  state.currentLetter = null;
  state.submitted    = false;
  state.gamePhase    = 'lobby';
}

/* ═══════════════════════════════════════════════
   SOCKET EVENTS
═══════════════════════════════════════════════ */

/* ── Room Created ── */
socket.on('roomCreated', ({ roomCode, player, isHost }) => {
  // Restore button before navigating away
  if (_createRestore) { _createRestore(); _createRestore = null; }

  state.myId     = socket.id;
  state.roomCode = roomCode;
  state.isHost   = isHost;

  // Populate lobby BEFORE showing screen so DOM is ready
  _setupLobby(roomCode, isHost);

  showScreen('lobby');
  // Flash the room code
  _flashRoomCode();
  showToast(`Room ${roomCode} created! Share the code 🎉`, 'success');
});

/* ── Room Joined ── */
socket.on('roomJoined', ({ roomCode, player, isHost, rounds }) => {
  if (_joinRestore) { _joinRestore(); _joinRestore = null; }

  state.myId        = socket.id;
  state.roomCode    = roomCode;
  state.isHost      = isHost;
  state.totalRounds = rounds;

  document.getElementById('lobby-rounds-badge').textContent = `${rounds} Rounds`;
  _setupLobby(roomCode, isHost);

  showScreen('lobby');
  SFX.join();
  showToast(`Joined room ${roomCode}! 🚀`, 'success');
});

/** Shared lobby DOM setup */
function _setupLobby(roomCode, isHost) {
  document.getElementById('lobby-code').textContent              = roomCode;
  document.getElementById('lobby-host-controls').style.display  = isHost ? 'block' : 'none';
  document.getElementById('lobby-waiting').style.display         = isHost ? 'none'  : 'flex';
}

/** Briefly animate the room code box to draw attention */
function _flashRoomCode() {
  const box = document.querySelector('.room-code-box');
  if (!box) return;
  box.style.transform = 'scale(1.04)';
  box.style.transition = 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)';
  setTimeout(() => { box.style.transform = ''; }, 350);
}

/* ── Join Error ── */
socket.on('joinError', msg => {
  // Restore button so user can try again
  if (_joinRestore) { _joinRestore('🚀 &nbsp; Join Room'); _joinRestore = null; }

  // Show error inline on the room-code field + toast
  showFieldError('join-code', `❌ ${msg}`);
  document.getElementById('join-code').focus();
  showToast(msg, 'error', 4000);
});

/* ── Lobby Update ── */
socket.on('lobbyUpdate', ({ players, host, rounds }) => {
  state.players     = players;
  state.totalRounds = rounds;

  renderPlayersList('lobby-players', players, host);
  _updateLobbyUI(players, rounds, host);

  if (state.isHost) {
    document.getElementById('lobby-host-controls').style.display = 'block';
    document.getElementById('lobby-waiting').style.display        = 'none';
  }

  // Only play join sound for newly arrived players (not self)
  if (players.length > 1) SFX.join();
});

/* ── Player Left ── */
socket.on('playerLeft', ({ players, host }) => {
  state.players = players;

  renderPlayersList('lobby-players', players, host);
  _updateLobbyUI(players, state.totalRounds, host);
  showToast('A player left the room', 'warn');

  if (host === socket.id) {
    state.isHost = true;
    document.getElementById('lobby-host-controls').style.display = 'block';
    document.getElementById('lobby-waiting').style.display        = 'none';
    showToast('You are now the host! 👑', 'info');
  }
});

/* ── Game Started → go to letter selection ── */
socket.on('gameStarted', ({ round, totalRounds, turn, totalTurns, selectorId, selectorName, availableAlphabets, usedAlphabets }) => {
  state.currentRound  = round;
  state.totalRounds   = totalRounds;
  state.currentTurn   = turn;
  state.totalTurns    = totalTurns;
  state.gamePhase     = 'selecting';
  state.submitted     = false;

  setupSelectionScreen(round, totalRounds, turn, totalTurns, selectorId, selectorName, availableAlphabets, usedAlphabets || []);
  showScreen('select');
  showToast('Game started! First up: letter selection 🔤', 'info');
});

/* ── Next Turn ── */
socket.on('nextTurn', ({ round, totalRounds, turn, totalTurns, selectorId, selectorName, availableAlphabets, usedAlphabets }) => {
  state.currentRound = round;
  state.totalRounds  = totalRounds;
  state.currentTurn  = turn;
  state.totalTurns   = totalTurns;
  state.submitted    = false;
  state.gamePhase    = 'selecting';

  setupSelectionScreen(round, totalRounds, turn, totalTurns, selectorId, selectorName, availableAlphabets, usedAlphabets || []);
  showScreen('select');
  showToast(`Round ${round}, Turn ${turn} – pick a letter! 🔤`, 'info');
});

function setupSelectionScreen(round, totalRounds, turn, totalTurns, selectorId, selectorName, available, used) {
  document.getElementById('select-round-info').textContent = `Round ${round} of ${totalRounds} | Turn ${turn} of ${totalTurns}`;
  document.getElementById('select-timer').textContent = '30';
  document.getElementById('select-timer').classList.remove('urgent');

  const myTurn = selectorId === socket.id;
  document.getElementById('select-my-turn').style.display  = myTurn ? 'block' : 'none';
  document.getElementById('select-waiting').style.display  = myTurn ? 'none'  : 'block';

  // Render players list on selection screen to show turns
  renderPlayersList('select-players-list', state.players, null);
  
  // Highlight the selector in the list
  const playerItems = document.querySelectorAll('#select-players-list .player-item');
  playerItems.forEach(item => {
    const isSelector = item.textContent.includes(selectorName);
    if (isSelector) {
      item.classList.add('selector-active-highlight');
      const badge = document.createElement('span');
      badge.className = 'player-badge';
      badge.textContent = 'Choosing… ✍️';
      item.appendChild(badge);
    }
  });

  if (myTurn) {
    buildAlphabetGrid(available, used);
    document.getElementById('select-phase-label').textContent = '🎲 Your turn to pick!';
    document.getElementById('select-phase-label').classList.add('selector-highlight-text');
  } else {
    document.getElementById('selector-waiting-text').textContent =
      `${selectorName} is choosing a letter…`;
    document.getElementById('select-phase-label').textContent = `${selectorName}'s turn`;
    document.getElementById('select-phase-label').classList.remove('selector-highlight-text');
  }
}

/* ── Alphabet Selected → go to game screen ── */
socket.on('alphabetSelected', ({ letter, autoSelected, selectorName }) => {
  state.currentLetter = letter;
  state.gamePhase     = 'playing';
  state.submitted     = false;

  // Game screen setup
  document.getElementById('game-round-info').textContent  = `Round ${state.currentRound} of ${state.totalRounds} | Turn ${state.currentTurn} of ${state.totalTurns}`;
  document.getElementById('game-letter-label').textContent = `Letter: ${letter}`;
  document.getElementById('game-timer').textContent        = '60';
  document.getElementById('game-timer').classList.remove('urgent');

  // Phase banner
  document.getElementById('game-phase-banner').textContent = `🖊️ Fill in as many as you can! Letter: "${letter}"`;
  document.getElementById('game-phase-banner').className  = 'phase-banner playing';

  // Build table
  buildGameTable(state.players, letter);

  // Submit button (only for self)
  document.getElementById('submit-section').style.display = 'flex';
  document.getElementById('submitted-msg').style.display  = 'none';

  const msg = autoSelected
    ? `⚡ Time's up! "${letter}" was auto-selected!`
    : `✅ "${letter}" chosen by ${selectorName}!`;

  showScreen('game');
  SFX.letterPick();
  showToast(msg, 'info');
});

/* ── Timer Update ── */
socket.on('timerUpdate', ({ time, phase }) => {
  const el = document.getElementById(phase === 'selection' ? 'select-timer' : 'game-timer');
  if (el) setTimer(el, time, phase);
});

/* ── Round Stopped (Early Submission) ── */
socket.on('roundStopped', ({ submittedBy }) => {
  state.submitted = true; // prevent local submission if not already done
  
  // Disable all inputs immediately
  document.querySelectorAll('.answer-input').forEach(i => {
    i.disabled = true;
    i.blur(); // Remove focus
  });
  
  document.getElementById('submit-section').style.display = 'none';
  
  const banner = document.getElementById('game-phase-banner');
  banner.textContent = `⏰ ${submittedBy} submitted! Round stopped!`;
  banner.className = 'phase-banner ending';
  
  SFX.roundEnd();
  showToast(`${submittedBy} submitted first! 🏁`, 'warn', 2500);
});

/* ── Round Ending (legacy/fallback) ── */
socket.on('roundEnding', ({ submittedBy, allSubmitted }) => {
  // This might still be used for "Time's up" or other scenarios
  const banner = document.getElementById('game-phase-banner');
  banner.textContent = allSubmitted
    ? `✅ All submitted! Calculating scores…`
    : `⏰ ${submittedBy} submitted! Finish up!`;
  banner.className = 'phase-banner ending';
});

/* ── Answers Accepted ── */
socket.on('answersAccepted', () => {
  document.querySelectorAll('.answer-input').forEach(i => i.disabled = true);
  document.getElementById('submit-section').style.display = 'none';
  document.getElementById('submitted-msg').style.display  = 'flex';
});

/* ── Score Update (Round Results) ── */
socket.on('scoreUpdate', data => {
  SFX.roundEnd();
  renderRoundResults(data);

  if (!data.gameOver) {
    document.getElementById('results-next-msg').textContent = 'Next round starts in 6 seconds…';
  } else {
    document.getElementById('results-next-msg').textContent = 'Calculating final standings…';
  }

  showScreen('results');
});

/* ── Game Over ── */
socket.on('gameOver', data => {
  const winner = data.leaderboard?.[0] ?? data.finalScores?.[0];

  document.getElementById('winner-name').textContent = winner?.name ?? 'Everyone';
  renderLeaderboard('gameover-leaderboard', data.leaderboard ?? data.finalScores ?? []);

  setTimeout(() => {
    SFX.winner();
    launchConfetti();
    showScreen('gameover');
  }, 200);
});

/* ── Error ── */
socket.on('error', msg => {
  showToast(msg, 'error', 4000);
});

/* ── Connection lost ── */
socket.on('disconnect', () => {
  showToast('Connection lost. Trying to reconnect…', 'error', 5000);
});

socket.on('connect', () => {
  console.log('[Socket] Connected to server:', socket.id);
  state.myId = socket.id;
});

socket.on('connect_error', (err) => {
  console.error('[Socket] Connection Error:', err.message);
  showToast(`Connection error: ${err.message}`, 'error', 4000);
});

socket.on('reconnect_attempt', (attempt) => {
  console.log('[Socket] Reconnection attempt:', attempt);
});
