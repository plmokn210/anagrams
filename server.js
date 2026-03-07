const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORD_LIST_PATH = path.join(__dirname, 'data', 'words.txt');
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const KEEPALIVE_MS = 15000;

const TILE_DISTRIBUTION = {
  A: 13,
  B: 3,
  C: 3,
  D: 6,
  E: 18,
  F: 3,
  G: 4,
  H: 3,
  I: 12,
  J: 2,
  K: 2,
  L: 5,
  M: 3,
  N: 8,
  O: 11,
  P: 3,
  Q: 2,
  R: 9,
  S: 6,
  T: 9,
  U: 6,
  V: 3,
  W: 3,
  X: 2,
  Y: 3,
  Z: 2
};

const DICTIONARY = loadDictionary();
const rooms = new Map();

function loadDictionary() {
  const words = fs.readFileSync(WORD_LIST_PATH, 'utf8')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set(words);
}

function buildBag() {
  const bag = [];
  for (const [letter, count] of Object.entries(TILE_DISTRIBUTION)) {
    for (let index = 0; index < count; index += 1) {
      bag.push(letter);
    }
  }
  return shuffle(bag);
}

function shuffle(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function safePlayerName(value) {
  const trimmed = String(value || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return 'Player';
  }
  return trimmed.slice(0, 24);
}

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidWordShape(word) {
  return /^[a-z]{4,}$/.test(word);
}

function addInflectionCandidate(candidates, word) {
  if (word && /^[a-z]{3,}$/.test(word)) {
    candidates.add(word);
  }
}

function getInflectionBases(word) {
  const candidates = new Set();

  if (word.endsWith('ies') && word.length > 4) {
    addInflectionCandidate(candidates, word.slice(0, -3) + 'y');
  }
  if (word.endsWith('ves') && word.length > 4) {
    addInflectionCandidate(candidates, word.slice(0, -3) + 'f');
    addInflectionCandidate(candidates, word.slice(0, -3) + 'fe');
  }
  if (word.endsWith('es') && word.length > 4) {
    addInflectionCandidate(candidates, word.slice(0, -2));
    addInflectionCandidate(candidates, word.slice(0, -1));
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) {
    addInflectionCandidate(candidates, word.slice(0, -1));
  }

  if (word.endsWith('ied') && word.length > 4) {
    addInflectionCandidate(candidates, word.slice(0, -3) + 'y');
  }
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2);
    addInflectionCandidate(candidates, stem);
    addInflectionCandidate(candidates, word.slice(0, -1));
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      addInflectionCandidate(candidates, stem.slice(0, -1));
    }
  }

  if (word.endsWith('ying') && word.length > 5) {
    addInflectionCandidate(candidates, word.slice(0, -4) + 'ie');
  }
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3);
    addInflectionCandidate(candidates, stem);
    addInflectionCandidate(candidates, stem + 'e');
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      addInflectionCandidate(candidates, stem.slice(0, -1));
    }
  }

  if (word.endsWith('ier') && word.length > 4) {
    addInflectionCandidate(candidates, word.slice(0, -3) + 'y');
  }
  if (word.endsWith('iest') && word.length > 5) {
    addInflectionCandidate(candidates, word.slice(0, -4) + 'y');
  }
  if (word.endsWith('er') && word.length > 4) {
    const stem = word.slice(0, -2);
    addInflectionCandidate(candidates, stem);
    addInflectionCandidate(candidates, stem + 'e');
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      addInflectionCandidate(candidates, stem.slice(0, -1));
    }
  }
  if (word.endsWith('est') && word.length > 5) {
    const stem = word.slice(0, -3);
    addInflectionCandidate(candidates, stem);
    addInflectionCandidate(candidates, stem + 'e');
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      addInflectionCandidate(candidates, stem.slice(0, -1));
    }
  }

  return [...candidates];
}

function isAcceptedDictionaryWord(word) {
  if (DICTIONARY.has(word)) {
    return true;
  }

  return getInflectionBases(word).some((candidate) => DICTIONARY.has(candidate));
}

function countLetters(letters) {
  const counts = Object.create(null);
  for (const letter of letters) {
    counts[letter] = (counts[letter] || 0) + 1;
  }
  return counts;
}

function hasAvailableCounts(requiredCounts, poolLetters) {
  const poolCounts = countLetters(poolLetters.map((letter) => letter.toLowerCase()));
  for (const [letter, count] of Object.entries(requiredCounts)) {
    if ((poolCounts[letter] || 0) < count) {
      return false;
    }
  }
  return true;
}

function subtractCounts(totalCounts, removeCounts) {
  const remaining = Object.assign(Object.create(null), totalCounts);
  for (const [letter, count] of Object.entries(removeCounts)) {
    const next = (remaining[letter] || 0) - count;
    if (next < 0) {
      return null;
    }
    if (next === 0) {
      delete remaining[letter];
    } else {
      remaining[letter] = next;
    }
  }
  return remaining;
}

function copyCounts(counts) {
  return Object.fromEntries(Object.entries(counts));
}

function sumCounts(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function removeLettersFromCenter(room, countsToRemove) {
  const needed = Object.assign(Object.create(null), countsToRemove);
  const nextCenter = [];
  for (const tile of room.centerTiles) {
    const lower = tile.toLowerCase();
    if (needed[lower]) {
      needed[lower] -= 1;
      if (needed[lower] === 0) {
        delete needed[lower];
      }
    } else {
      nextCenter.push(tile);
    }
  }
  room.centerTiles = nextCenter;
}

function addLettersToCenter(room, countsToAdd) {
  const letters = [];
  for (const [letter, count] of Object.entries(countsToAdd)) {
    for (let index = 0; index < count; index += 1) {
      letters.push(letter.toUpperCase());
    }
  }
  room.centerTiles = room.centerTiles.concat(shuffle(letters));
}

function scoreWord(word) {
  return Math.max(0, word.length - 3);
}

function scorePlayer(words) {
  return words.reduce((total, word) => total + scoreWord(word.text), 0);
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) {
      return code;
    }
  }
  throw new Error('Unable to generate room code.');
}

function getOrCreatePlayerId(value) {
  const normalized = String(value || '').trim();
  if (normalized) {
    return normalized.slice(0, 64);
  }
  return crypto.randomUUID();
}

function getTurnOrder(room) {
  return Array.from(room.players.values())
    .sort((left, right) => left.joinedAt - right.joinedAt || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function setCurrentTurn(room, playerId) {
  room.currentTurnPlayerId = playerId || getTurnOrder(room)[0]?.id || null;
}

function getNextTurnPlayerId(room, currentPlayerId) {
  const players = getTurnOrder(room);
  if (!players.length) {
    return null;
  }
  const currentIndex = players.findIndex((player) => player.id === currentPlayerId);
  if (currentIndex === -1) {
    return players[0].id;
  }
  return players[(currentIndex + 1) % players.length].id;
}

function setRoomEvent(room, type, actor, extra = {}) {
  room.eventSeq += 1;
  room.lastEvent = {
    id: room.eventSeq,
    type,
    actorId: actor?.id || null,
    actorName: actor?.name || null,
    ...extra
  };
}

function createRoom(playerId, name) {
  const code = generateRoomCode();
  const room = {
    code,
    bag: buildBag(),
    centerTiles: [],
    players: new Map(),
    words: [],
    ended: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    clients: new Set(),
    currentTurnPlayerId: null,
    pendingVote: null,
    eventSeq: 0,
    lastEvent: { id: 0, type: 'room_created', actorId: null, actorName: null },
    lastAction: 'Room created.'
  };
  joinRoom(room, playerId, name);
  rooms.set(code, room);
  return room;
}

function joinRoom(room, playerId, name) {
  const existing = room.players.get(playerId);
  room.players.set(playerId, {
    id: playerId,
    name: safePlayerName(name),
    joinedAt: existing?.joinedAt || Date.now(),
    updatedAt: Date.now()
  });
  if (!room.currentTurnPlayerId) {
    room.currentTurnPlayerId = playerId;
  }
  room.updatedAt = Date.now();
  room.lastAction = `${safePlayerName(name)} joined the room.`;
  setRoomEvent(room, 'join', room.players.get(playerId), { currentTurnPlayerId: room.currentTurnPlayerId });
}

function ensureRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) {
    throw badRequest('Room not found.', 404);
  }
  return room;
}

function ensurePlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) {
    throw badRequest('Join the room before taking an action.', 403);
  }
  return player;
}

function ensureRoundOpen(room) {
  if (room.ended) {
    throw badRequest('The round is already over.');
  }
}

function ensureNoPendingVote(room) {
  if (room.pendingVote) {
    throw badRequest('Finish the vote first.');
  }
}

function ensureFlipTurn(room, playerId) {
  if (!room.currentTurnPlayerId) {
    setCurrentTurn(room, playerId);
    return;
  }
  if (room.currentTurnPlayerId !== playerId) {
    const currentTurnName = room.players.get(room.currentTurnPlayerId)?.name || 'the other player';
    throw badRequest(`It is ${currentTurnName}'s turn to flip.`);
  }
}

function badRequest(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildPlayProposal(room, rawWord, sourceWordId) {
  const word = normalizeWord(rawWord);
  if (!isValidWordShape(word)) {
    throw badRequest('Words must be at least 4 letters and use only A-Z.');
  }

  if (!sourceWordId) {
    const countsToRemove = countLetters(word);
    if (!hasAvailableCounts(countsToRemove, room.centerTiles)) {
      throw badRequest('Those letters are not all available in the middle.');
    }
    return {
      mode: 'claim',
      word,
      countsToRemove
    };
  }

  const source = room.words.find((entry) => entry.id === sourceWordId);
  if (!source) {
    throw badRequest('Source word not found.');
  }
  if (word.length <= source.text.length) {
    throw badRequest('A steal must make the word longer.');
  }

  const sourceCounts = countLetters(source.text);
  const newCounts = countLetters(word);
  const extraCounts = subtractCounts(newCounts, sourceCounts);

  if (!extraCounts) {
    throw badRequest('You cannot remove letters from an existing word.');
  }
  if (sumCounts(extraCounts) < 1) {
    throw badRequest('A steal must add at least one tile from the middle.');
  }
  if (!hasAvailableCounts(extraCounts, room.centerTiles)) {
    throw badRequest('The extra letters are not all available in the middle.');
  }

  return {
    mode: 'steal',
    word,
    sourceWordId,
    extraCounts
  };
}

function applyPlayProposal(room, player, proposal, approvedByVote = false) {
  if (proposal.mode === 'claim') {
    removeLettersFromCenter(room, proposal.countsToRemove);
    room.words.push({
      id: crypto.randomUUID(),
      text: proposal.word,
      ownerId: player.id,
      createdAt: Date.now(),
      stealHistory: []
    });
  } else {
    const source = room.words.find((entry) => entry.id === proposal.sourceWordId);
    if (!source) {
      throw badRequest('Source word not found.');
    }
    const previousTurnPlayerId = room.currentTurnPlayerId;
    removeLettersFromCenter(room, proposal.extraCounts);
    source.stealHistory = source.stealHistory || [];
    source.stealHistory.push({
      previousText: source.text,
      previousOwnerId: source.ownerId,
      previousTurnPlayerId,
      addedCounts: copyCounts(proposal.extraCounts),
      createdAt: Date.now()
    });
    source.text = proposal.word;
    source.ownerId = player.id;
  }

  setCurrentTurn(room, player.id);
  const verb = proposal.mode === 'claim' ? 'claimed' : 'stole';
  room.lastAction = approvedByVote
    ? `Vote complete. ${player.name} ${verb} ${proposal.word.toUpperCase()}. ${player.name} flips next.`
    : `${player.name} ${verb} ${proposal.word.toUpperCase()}. ${player.name} flips next.`;
  setRoomEvent(room, proposal.mode, player, {
    word: proposal.word,
    currentTurnPlayerId: room.currentTurnPlayerId,
    approvedByVote
  });
}

function openUnknownWordVote(room, player, proposal) {
  room.pendingVote = {
    id: crypto.randomUUID(),
    kind: 'word',
    wordText: proposal.word,
    proposerId: player.id,
    proposerName: player.name,
    eligiblePlayerIds: getTurnOrder(room).map((entry) => entry.id),
    votes: {},
    proposal
  };
  room.lastAction = `${player.name} says ${proposal.word.toUpperCase()} is a real word. Vote to allow it.`;
  setRoomEvent(room, 'word_vote_opened', player, {
    word: proposal.word,
    currentTurnPlayerId: room.currentTurnPlayerId
  });
}

function claimOrStealWord(room, playerId, rawWord, sourceWordId, requestUrl) {
  const player = ensurePlayer(room, playerId);
  ensureRoundOpen(room);
  ensureNoPendingVote(room);
  const proposal = buildPlayProposal(room, rawWord, sourceWordId);

  if (!isAcceptedDictionaryWord(proposal.word)) {
    openUnknownWordVote(room, player, proposal);
    broadcastRoom(room, requestUrl);
    return;
  }

  applyPlayProposal(room, player, proposal, false);
  broadcastRoom(room, requestUrl);
}

function openChallengeVote(room, playerId, sourceWordId, requestUrl) {
  const player = ensurePlayer(room, playerId);
  ensureRoundOpen(room);
  ensureNoPendingVote(room);
  const source = room.words.find((entry) => entry.id === sourceWordId);

  if (!source) {
    throw badRequest('Word not found.');
  }
  if (!source.stealHistory || !source.stealHistory.length) {
    throw badRequest('That word has no steal to challenge.');
  }

  room.pendingVote = {
    id: crypto.randomUUID(),
    kind: 'challenge',
    wordId: source.id,
    wordText: source.text,
    ownerId: source.ownerId,
    ownerName: room.players.get(source.ownerId)?.name || 'Unknown',
    proposerId: player.id,
    proposerName: player.name,
    eligiblePlayerIds: getTurnOrder(room).map((entry) => entry.id),
    votes: {}
  };
  room.lastAction = `${player.name} challenged ${source.text.toUpperCase()}. Voting is open.`;
  setRoomEvent(room, 'challenge_opened', player, {
    word: source.text,
    currentTurnPlayerId: room.currentTurnPlayerId
  });
  broadcastRoom(room, requestUrl);
}

function revertLatestSteal(room, source) {
  const lastSteal = source.stealHistory.pop();
  addLettersToCenter(room, lastSteal.addedCounts);
  source.text = lastSteal.previousText;
  source.ownerId = lastSteal.previousOwnerId;
  return lastSteal;
}

function resolvePendingVote(room, actor) {
  const pendingVote = room.pendingVote;
  const approveVotes = Object.values(pendingVote.votes).filter((vote) => vote === 'approve').length;
  const rejectVotes = Object.values(pendingVote.votes).filter((vote) => vote === 'reject').length;

  if (pendingVote.kind === 'challenge') {
    const source = room.words.find((entry) => entry.id === pendingVote.wordId);
    if (!source || !source.stealHistory || !source.stealHistory.length) {
      room.pendingVote = null;
      throw badRequest('The challenged word can no longer be resolved.');
    }

    if (approveVotes > rejectVotes) {
      room.lastAction = `Vote complete. ${source.text.toUpperCase()} stays with ${room.players.get(source.ownerId)?.name || 'Unknown'}.`;
      setRoomEvent(room, 'challenge_resolved_keep', actor, {
        word: source.text,
        currentTurnPlayerId: room.currentTurnPlayerId
      });
    } else {
      const reverted = revertLatestSteal(room, source);
      setCurrentTurn(room, reverted.previousTurnPlayerId || source.ownerId);
      room.lastAction = `Vote complete. ${source.text.toUpperCase()} returns to ${room.players.get(source.ownerId)?.name || 'Unknown'}.`;
      setRoomEvent(room, 'challenge_resolved_revert', actor, {
        word: source.text,
        currentTurnPlayerId: room.currentTurnPlayerId
      });
    }
    room.pendingVote = null;
    return;
  }

  if (approveVotes > rejectVotes) {
    const proposer = room.players.get(pendingVote.proposerId);
    if (!proposer) {
      room.pendingVote = null;
      throw badRequest('The proposed play can no longer be resolved.');
    }
    const proposal = pendingVote.proposal;
    room.pendingVote = null;
    applyPlayProposal(room, proposer, proposal, true);
    return;
  }

  room.lastAction = `Vote complete. ${pendingVote.wordText.toUpperCase()} was rejected.`;
  setRoomEvent(room, 'word_vote_rejected', actor, {
    word: pendingVote.wordText,
    currentTurnPlayerId: room.currentTurnPlayerId
  });
  room.pendingVote = null;
}

function vote(room, playerId, decision, requestUrl) {
  const player = ensurePlayer(room, playerId);
  ensureRoundOpen(room);
  if (!room.pendingVote) {
    throw badRequest('There is no active vote.');
  }
  if (!room.pendingVote.eligiblePlayerIds.includes(playerId)) {
    throw badRequest('You are not part of this vote.');
  }
  if (!['approve', 'reject'].includes(decision)) {
    throw badRequest('Vote must be approve or reject.');
  }

  room.pendingVote.votes[playerId] = decision;
  const everyoneVoted = room.pendingVote.eligiblePlayerIds.every((id) => room.pendingVote.votes[id]);

  if (everyoneVoted) {
    resolvePendingVote(room, player);
    broadcastRoom(room, requestUrl);
    return;
  }

  const waitingOn = room.pendingVote.eligiblePlayerIds
    .filter((id) => !room.pendingVote.votes[id])
    .map((id) => room.players.get(id)?.name || 'Unknown');

  room.lastAction = `${player.name} voted. Waiting on ${waitingOn.join(', ')}.`;
  setRoomEvent(room, 'vote_update', player, {
    word: room.pendingVote.wordText,
    currentTurnPlayerId: room.currentTurnPlayerId
  });
  broadcastRoom(room, requestUrl);
}

function flipTile(room, playerId, requestUrl) {
  const player = ensurePlayer(room, playerId);
  ensureRoundOpen(room);
  ensureNoPendingVote(room);
  ensureFlipTurn(room, playerId);
  if (!room.bag.length) {
    throw badRequest('No tiles are left to flip.');
  }

  const tile = room.bag.pop();
  room.centerTiles.push(tile);
  room.currentTurnPlayerId = getNextTurnPlayerId(room, playerId);
  const nextPlayerName = room.players.get(room.currentTurnPlayerId)?.name || 'Nobody';
  room.lastAction = `${player.name} flipped ${tile}. ${nextPlayerName} is up.`;
  setRoomEvent(room, 'flip', player, {
    tile,
    currentTurnPlayerId: room.currentTurnPlayerId,
    nextTurnPlayerName: nextPlayerName
  });
  broadcastRoom(room, requestUrl);
}

function endRound(room, playerId, requestUrl) {
  const player = ensurePlayer(room, playerId);
  ensureRoundOpen(room);
  ensureNoPendingVote(room);
  if (room.bag.length > 0) {
    throw badRequest('You can only end the round after the bag is empty.');
  }

  room.ended = true;
  room.lastAction = `${player.name} ended the round.`;
  setRoomEvent(room, 'end', player, { currentTurnPlayerId: room.currentTurnPlayerId });
  broadcastRoom(room, requestUrl);
}

function serializePendingVote(room) {
  if (!room.pendingVote) {
    return null;
  }

  const approveVotes = Object.values(room.pendingVote.votes).filter((vote) => vote === 'approve').length;
  const rejectVotes = Object.values(room.pendingVote.votes).filter((vote) => vote === 'reject').length;

  if (room.pendingVote.kind === 'challenge') {
    return {
      kind: 'challenge',
      wordText: room.pendingVote.wordText,
      title: `Challenge on ${room.pendingVote.wordText.toUpperCase()}`,
      description: `${room.pendingVote.proposerName} challenged ${room.pendingVote.ownerName}'s word. Vote to keep it or revert it.`,
      approveLabel: 'Keep word',
      rejectLabel: 'Revert word',
      approveVotes,
      rejectVotes,
      votes: room.pendingVote.eligiblePlayerIds.map((playerId) => ({
        playerId,
        playerName: room.players.get(playerId)?.name || 'Unknown',
        decision: room.pendingVote.votes[playerId] || null
      }))
    };
  }

  return {
    kind: 'word',
    wordText: room.pendingVote.wordText,
    title: `Vote on ${room.pendingVote.wordText.toUpperCase()}`,
    description: `${room.pendingVote.proposerName} says ${room.pendingVote.wordText.toUpperCase()} is a real word. Vote to allow it or reject it.`,
    approveLabel: 'Allow word',
    rejectLabel: 'Reject word',
    approveVotes,
    rejectVotes,
    votes: room.pendingVote.eligiblePlayerIds.map((playerId) => ({
      playerId,
      playerName: room.players.get(playerId)?.name || 'Unknown',
      decision: room.pendingVote.votes[playerId] || null
    }))
  };
}

function serializeRoom(room, requestUrl) {
  const wordsByPlayer = new Map();
  for (const playerId of room.players.keys()) {
    wordsByPlayer.set(playerId, []);
  }
  for (const word of room.words) {
    if (!wordsByPlayer.has(word.ownerId)) {
      wordsByPlayer.set(word.ownerId, []);
    }
    wordsByPlayer.get(word.ownerId).push({
      id: word.id,
      text: word.text,
      score: scoreWord(word.text),
      ownerId: word.ownerId,
      canChallenge: Boolean(word.stealHistory && word.stealHistory.length) && !room.pendingVote
    });
  }

  const players = Array.from(room.players.values()).map((player) => {
    const words = wordsByPlayer.get(player.id) || [];
    return {
      id: player.id,
      name: player.name,
      score: scorePlayer(words),
      words
    };
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  const winners = room.ended && players.length
    ? players.filter((player) => player.score === players[0].score).map((player) => player.name)
    : [];

  return {
    code: room.code,
    bagRemaining: room.bag.length,
    centerTiles: room.centerTiles,
    players,
    allWords: room.words.map((word) => ({
      id: word.id,
      text: word.text,
      ownerId: word.ownerId,
      ownerName: room.players.get(word.ownerId)?.name || 'Unknown',
      canChallenge: Boolean(word.stealHistory && word.stealHistory.length) && !room.pendingVote
    })),
    currentTurnPlayerId: room.currentTurnPlayerId,
    currentTurnPlayerName: room.pendingVote ? null : room.players.get(room.currentTurnPlayerId)?.name || null,
    pendingVote: serializePendingVote(room),
    ended: room.ended,
    lastAction: room.lastAction,
    lastEvent: room.lastEvent,
    winners,
    shareUrl: `${requestUrl.origin}/?room=${room.code}`
  };
}

function broadcastRoom(room, requestUrl) {
  room.updatedAt = Date.now();
  const payload = `event: state\ndata: ${JSON.stringify(serializeRoom(room, requestUrl))}\n\n`;
  for (const client of room.clients) {
    client.write(payload);
  }
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(badRequest('Request body is too large.', 413));
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(badRequest('Invalid JSON body.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath);
  const contentType = extension === '.html'
    ? 'text/html; charset=utf-8'
    : extension === '.css'
      ? 'text/css; charset=utf-8'
      : extension === '.js'
        ? 'application/javascript; charset=utf-8'
        : 'text/plain; charset=utf-8';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { error: 'File not found.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    response.end(content);
  });
}

function routeStatic(requestUrl, response) {
  const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  sendFile(response, filePath);
}

function cleanupRooms() {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms.entries()) {
    if (room.updatedAt < cutoff) {
      for (const client of room.clients) {
        client.end();
      }
      rooms.delete(code);
    }
  }
}

setInterval(cleanupRooms, 60 * 60 * 1000).unref();

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  try {
    if (request.method === 'GET' && pathname === '/api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/rooms/create') {
      const body = await parseJsonBody(request);
      const playerId = getOrCreatePlayerId(body.playerId);
      const room = createRoom(playerId, body.name);
      sendJson(response, 201, {
        playerId,
        room: serializeRoom(room, requestUrl)
      });
      return;
    }

    const roomMatch = pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|state|events|flip|play|challenge|vote|end))?$/);
    if (roomMatch) {
      const [, code, action = 'state'] = roomMatch;
      const room = ensureRoom(code);

      if (request.method === 'GET' && action === 'state') {
        sendJson(response, 200, { room: serializeRoom(room, requestUrl) });
        return;
      }

      if (request.method === 'GET' && action === 'events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        });
        response.write(`event: state\ndata: ${JSON.stringify(serializeRoom(room, requestUrl))}\n\n`);
        const keepAlive = setInterval(() => {
          response.write(': keep-alive\n\n');
        }, KEEPALIVE_MS);
        room.clients.add(response);
        request.on('close', () => {
          clearInterval(keepAlive);
          room.clients.delete(response);
        });
        return;
      }

      const body = await parseJsonBody(request);
      const playerId = getOrCreatePlayerId(body.playerId);

      if (request.method === 'POST' && action === 'join') {
        joinRoom(room, playerId, body.name);
        broadcastRoom(room, requestUrl);
        sendJson(response, 200, {
          playerId,
          room: serializeRoom(room, requestUrl)
        });
        return;
      }

      if (request.method === 'POST' && action === 'flip') {
        flipTile(room, playerId, requestUrl);
        sendJson(response, 200, { room: serializeRoom(room, requestUrl) });
        return;
      }

      if (request.method === 'POST' && action === 'play') {
        claimOrStealWord(room, playerId, body.word, body.sourceWordId || '', requestUrl);
        sendJson(response, 200, { room: serializeRoom(room, requestUrl) });
        return;
      }

      if (request.method === 'POST' && action === 'challenge') {
        openChallengeVote(room, playerId, body.sourceWordId, requestUrl);
        sendJson(response, 200, { room: serializeRoom(room, requestUrl) });
        return;
      }

      if (request.method === 'POST' && action === 'vote') {
        vote(room, playerId, body.decision, requestUrl);
        sendJson(response, 200, { room: serializeRoom(room, requestUrl) });
        return;
      }

      if (request.method === 'POST' && action === 'end') {
        endRound(room, playerId, requestUrl);
        sendJson(response, 200, { room: serializeRoom(room, requestUrl) });
        return;
      }
    }

    if (request.method === 'GET') {
      routeStatic(requestUrl, response);
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(response, statusCode, { error: error.message || 'Internal server error.' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('Anagrams Live running on http://' + HOST + ':' + PORT);
  });
}

module.exports = {
  DICTIONARY,
  isAcceptedDictionaryWord,
  createRoom,
  joinRoom,
  claimOrStealWord,
  openChallengeVote,
  vote,
  flipTile,
  endRound,
  serializeRoom
};
