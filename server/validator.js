'use strict';

const NAMES  = require('./data/names');
const PLACES = require('./data/places');

/**
 * NPAT Validation Engine
 * ──────────────────────
 * Handles per-category word validation with:
 *  • Dictionary API (primary) for Animal & Thing
 *  • Local datasets (fallback) for Name & Place
 *  • In-memory cache to avoid duplicate API calls across a round
 *  • Per-category logic so Names/Places get leniency the dictionary doesn't provide
 */

const DICT_API   = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const API_TIMEOUT_MS = 3000; // generous but bounded

/* ── In-memory cache: word → { valid, ts } ── */
const _cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function _cacheGet(word) {
  const entry = _cache.get(word);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(word); return undefined; }
  return entry.valid;
}

function _cacheSet(word, valid) {
  _cache.set(word, { valid, ts: Date.now() });
}

/**
 * Call the Dictionary API for `word`.
 * Returns: 'valid' | 'invalid' | 'timeout' | 'error'
 */
async function _callDictAPI(word) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const resp = await fetch(`${DICT_API}${encodeURIComponent(word)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok)            return 'valid';   // 200 → real English word
    if (resp.status === 404) return 'invalid'; // definitively not in dictionary
    return 'error'; // unexpected status, treat conservatively
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.warn(`[Validator] API timeout for "${word}"`);
      return 'timeout';
    }
    console.warn(`[Validator] API error for "${word}":`, err.message);
    return 'error';
  }
}

/**
 * Validate a single word for the "name" category.
 *
 * Strategy:
 *  1. Must start with `letter`.
 *  2. Check in-memory cache.
 *  3. Try Dictionary API — if 200, valid (some names are dictionary words).
 *  4. On 404 / timeout / error → check local NAMES dataset.
 *  5. If not in dataset → allow it anyway (names are hard to exhaustively validate).
 */
async function validateName(word, letter) {
  const w = word.trim().toLowerCase();
  if (!w || w[0] !== letter.toLowerCase()) return { valid: false, reason: 'wrong_letter' };

  const cached = _cacheGet(`name:${w}`);
  if (cached !== undefined) return { valid: cached, reason: 'cache' };

  const apiResult = await _callDictAPI(w);

  let valid;
  if (apiResult === 'valid') {
    valid = true; // dictionary confirmed
  } else if (apiResult === 'invalid') {
    // 404 from dictionary — check local names dataset
    valid = NAMES.has(w);
    if (!valid) {
      // Names are proper nouns — if it starts with the right letter and is ≥2 chars,
      // give benefit of the doubt (real names like "Zubair" won't be in any dictionary)
      valid = w.length >= 2;
    }
  } else {
    // timeout / network error → fallback to local dataset, else allow
    valid = NAMES.has(w) || w.length >= 2;
  }

  _cacheSet(`name:${w}`, valid);
  console.log(`[Validator] Name "${w}" → ${valid} (api:${apiResult})`);
  return { valid, reason: apiResult };
}

/**
 * Validate a single word for the "place" category.
 *
 * Strategy:
 *  1. Must start with `letter`.
 *  2. Check cache.
 *  3. Try Dictionary API — if 200, valid.
 *  4. On 404 → check local PLACES dataset.
 *  5. If not in dataset → allow it anyway (place names vary vastly by language/region).
 */
async function validatePlace(word, letter) {
  const w = word.trim().toLowerCase();
  if (!w || w[0] !== letter.toLowerCase()) return { valid: false, reason: 'wrong_letter' };

  const cached = _cacheGet(`place:${w}`);
  if (cached !== undefined) return { valid: cached, reason: 'cache' };

  const apiResult = await _callDictAPI(w);

  let valid;
  if (apiResult === 'valid') {
    valid = true;
  } else if (apiResult === 'invalid') {
    // Check local dataset; if not there, still give benefit of the doubt
    valid = PLACES.has(w) || w.length >= 2;
  } else {
    valid = PLACES.has(w) || w.length >= 2;
  }

  _cacheSet(`place:${w}`, valid);
  console.log(`[Validator] Place "${w}" → ${valid} (api:${apiResult})`);
  return { valid, reason: apiResult };
}

/**
 * Validate a single word for the "animal" category.
 *
 * Strategy:
 *  1. Must start with `letter`.
 *  2. Check cache.
 *  3. Dictionary API is the primary source — 200 = valid, 404 = invalid.
 *  4. On timeout/error → allow (don't punish players for network issues).
 */
async function validateAnimal(word, letter) {
  const w = word.trim().toLowerCase();
  if (!w || w[0] !== letter.toLowerCase()) return { valid: false, reason: 'wrong_letter' };

  const cached = _cacheGet(`animal:${w}`);
  if (cached !== undefined) return { valid: cached, reason: 'cache' };

  const apiResult = await _callDictAPI(w);

  let valid;
  if (apiResult === 'valid')   valid = true;
  else if (apiResult === 'invalid') valid = false; // 404 = not a real word → invalid
  else valid = true; // timeout/error → benefit of doubt

  _cacheSet(`animal:${w}`, valid);
  console.log(`[Validator] Animal "${w}" → ${valid} (api:${apiResult})`);
  return { valid, reason: apiResult };
}

/**
 * Validate a single word for the "thing" category.
 *
 * Same strict strategy as Animal — dictionary is the authority.
 */
async function validateThing(word, letter) {
  const w = word.trim().toLowerCase();
  if (!w || w[0] !== letter.toLowerCase()) return { valid: false, reason: 'wrong_letter' };

  const cached = _cacheGet(`thing:${w}`);
  if (cached !== undefined) return { valid: cached, reason: 'cache' };

  const apiResult = await _callDictAPI(w);

  let valid;
  if (apiResult === 'valid')   valid = true;
  else if (apiResult === 'invalid') valid = false;
  else valid = true;

  _cacheSet(`thing:${w}`, valid);
  console.log(`[Validator] Thing "${w}" → ${valid} (api:${apiResult})`);
  return { valid, reason: apiResult };
}

/* ── Category dispatch map ── */
const VALIDATORS = {
  name:   validateName,
  place:  validatePlace,
  animal: validateAnimal,
  thing:  validateThing,
};

/**
 * Validate all answers for all players in a room.
 *
 * @param {Object} answers   - { [playerId]: { name, place, animal, thing } }
 * @param {string} letter    - The selected letter for this round
 * @returns {Promise<Object>} - { [playerId]: { name, place, animal, thing } each with { value, valid } }
 */
async function validateAllAnswers(answers, letter) {
  const L = (letter || '').toUpperCase();

  // ── De-duplicate across all players to minimise API calls ──
  // Map: "category:word" → Promise<boolean>
  const pendingMap = new Map();

  function getValidation(category, word) {
    const key = `${category}:${word.trim().toLowerCase()}`;
    if (!pendingMap.has(key)) {
      const validator = VALIDATORS[category];
      if (!validator) {
        pendingMap.set(key, Promise.resolve({ valid: false, reason: 'unknown_category' }));
      } else {
        pendingMap.set(key, validator(word, L));
      }
    }
    return pendingMap.get(key);
  }

  const CATEGORIES = ['name', 'place', 'animal', 'thing'];

  // Kick off all validations in parallel (de-duped by key)
  const playerIds = Object.keys(answers);
  const allPromises = [];

  for (const pid of playerIds) {
    for (const cat of CATEGORIES) {
      const word = (answers[pid]?.[cat] || '').trim();
      allPromises.push(getValidation(cat, word || ''));
    }
  }

  await Promise.all(allPromises); // wait for everything

  // ── Build structured result ──
  const results = {};

  for (const pid of playerIds) {
    results[pid] = { playerId: pid, answers: {} };

    for (const cat of CATEGORIES) {
      const word  = (answers[pid]?.[cat] || '').trim();
      const key   = `${cat}:${word.toLowerCase()}`;
      const entry = await pendingMap.get(key);

      results[pid].answers[cat] = {
        value: word,
        valid: entry ? entry.valid : false,
      };
    }
  }

  return results;
}

/** Clear validation cache (call between games if desired) */
function clearCache() {
  _cache.clear();
}

module.exports = { validateAllAnswers, clearCache };
