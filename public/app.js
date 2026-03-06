const state = {
  playerId: localStorage.getItem('anagrams-player-id') || crypto.randomUUID(),
  playerName: localStorage.getItem('anagrams-player-name') || '',
  room: null,
  eventSource: null,
  soundEnabled: localStorage.getItem('anagrams-sound-enabled') !== 'false',
  audioContext: null
};

localStorage.setItem('anagrams-player-id', state.playerId);

const elements = {
  lobbyPanel: document.querySelector('#lobby-panel'),
  gamePanel: document.querySelector('#game-panel'),
  createForm: document.querySelector('#create-form'),
  joinForm: document.querySelector('#join-form'),
  createName: document.querySelector('#create-name'),
  joinName: document.querySelector('#join-name'),
  joinCode: document.querySelector('#join-code'),
  roomCode: document.querySelector('#room-code'),
  bagCount: document.querySelector('#bag-count'),
  turnIndicator: document.querySelector('#turn-indicator'),
  lastAction: document.querySelector('#last-action'),
  centerTiles: document.querySelector('#center-tiles'),
  compactWords: document.querySelector('#compact-words'),
  flipTile: document.querySelector('#flip-tile'),
  claimForm: document.querySelector('#claim-form'),
  claimWord: document.querySelector('#claim-word'),
  stealForm: document.querySelector('#steal-form'),
  stealSource: document.querySelector('#steal-source'),
  stealWord: document.querySelector('#steal-word'),
  playersGrid: document.querySelector('#players-grid'),
  challengePanel: document.querySelector('#challenge-panel'),
  challengeTitle: document.querySelector('#challenge-title'),
  challengeDescription: document.querySelector('#challenge-description'),
  challengeVotes: document.querySelector('#challenge-votes'),
  voteKeep: document.querySelector('#vote-keep'),
  voteRevert: document.querySelector('#vote-revert'),
  soundToggle: document.querySelector('#sound-toggle'),
  copyLink: document.querySelector('#copy-link'),
  leaveRoom: document.querySelector('#leave-room'),
  toast: document.querySelector('#toast'),
  finalCopy: document.querySelector('#final-copy'),
  endRound: document.querySelector('#end-round')
};

const params = new URLSearchParams(window.location.search);
const prefilledRoom = (params.get('room') || '').toUpperCase();
if (prefilledRoom) {
  elements.joinCode.value = prefilledRoom;
}

if (state.playerName) {
  elements.createName.value = state.playerName;
  elements.joinName.value = state.playerName;
}

function showToast(message, timeout = 2500) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, timeout);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

function persistName(name) {
  state.playerName = name;
  localStorage.setItem('anagrams-player-name', name);
  elements.createName.value = name;
  elements.joinName.value = name;
}

function getAudioContext() {
  if (state.audioContext) {
    return state.audioContext;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  state.audioContext = new AudioContextClass();
  return state.audioContext;
}

async function unlockAudio() {
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state === 'running') {
    return;
  }
  try {
    await audioContext.resume();
  } catch (error) {
    // Mobile browsers may delay unlock until the next interaction.
  }
}

function playToneSequence(tones) {
  if (!state.soundEnabled) {
    return;
  }
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== 'running') {
    return;
  }

  const startTime = audioContext.currentTime;
  for (const tone of tones) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const toneStart = startTime + tone.offset;
    const toneEnd = toneStart + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
    if (tone.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, toneEnd);
    }

    gainNode.gain.setValueAtTime(0.0001, toneStart);
    gainNode.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.02);
  }
}

function playFlipSound() {
  playToneSequence([
    { offset: 0, duration: 0.08, frequency: 620, endFrequency: 740, gain: 0.04, type: 'triangle' },
    { offset: 0.08, duration: 0.06, frequency: 740, endFrequency: 860, gain: 0.03, type: 'triangle' }
  ]);
}

function playStealSound() {
  playToneSequence([
    { offset: 0, duration: 0.07, frequency: 740, endFrequency: 620, gain: 0.04, type: 'square' },
    { offset: 0.08, duration: 0.07, frequency: 620, endFrequency: 540, gain: 0.035, type: 'square' },
    { offset: 0.17, duration: 0.09, frequency: 820, endFrequency: 980, gain: 0.03, type: 'triangle' }
  ]);
}

function renderSoundToggle() {
  elements.soundToggle.textContent = state.soundEnabled ? 'Sound on' : 'Sound off';
}

function connectEvents(roomCode) {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource(`/api/rooms/${roomCode}/events`);
  state.eventSource.addEventListener('state', (event) => {
    const payload = JSON.parse(event.data);
    applyRoomUpdate(payload, true);
  });
  state.eventSource.onerror = () => {
    showToast('Live connection dropped. Trying again...');
  };
}

function setRoom(room) {
  elements.lobbyPanel.classList.add('hidden');
  elements.gamePanel.classList.remove('hidden');
  history.replaceState({}, '', `/?room=${room.code}`);
  applyRoomUpdate(room, false);
  connectEvents(room.code);
}

function leaveRoom() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.room = null;
  history.replaceState({}, '', '/');
  elements.gamePanel.classList.add('hidden');
  elements.lobbyPanel.classList.remove('hidden');
}

function renderTiles(tiles) {
  if (!tiles.length) {
    elements.centerTiles.className = 'tile-rack empty';
    elements.centerTiles.textContent = 'No tiles yet';
    return;
  }
  elements.centerTiles.className = 'tile-rack';
  elements.centerTiles.innerHTML = tiles.map((tile) => `<span class="tile">${tile}</span>`).join('');
}

function renderCompactWords(room) {
  elements.compactWords.innerHTML = room.players.map((player) => {
    const words = player.words.length ? player.words.map((word) => word.text.toUpperCase()).join(' · ') : 'none';
    return `
      <article class="compact-player">
        <strong>${player.name}${player.id === state.playerId ? ' (You)' : ''}</strong>
        <p>${words}</p>
      </article>
    `;
  }).join('');
}

function renderPlayers(room) {
  elements.playersGrid.innerHTML = room.players.map((player) => {
    const words = player.words.length
      ? player.words.map((word) => {
        const challengeButton = word.canChallenge && !room.ended && !room.pendingChallenge
          ? `<button class="pill-action" data-action="challenge" data-word-id="${word.id}" type="button">Challenge</button>`
          : '';

        return `
          <span class="word-pill">
            <strong>${word.text.toUpperCase()}</strong>
            <span>+${word.score}</span>
            ${challengeButton}
          </span>
        `;
      }).join('')
      : '<p class="hint">No words yet.</p>';

    return `
      <article class="player-card">
        <div class="player-head">
          <div>
            <h3>${player.name}${player.id === state.playerId ? ' (You)' : ''}</h3>
            <p class="hint">${player.words.length} word${player.words.length === 1 ? '' : 's'}</p>
          </div>
          <div class="player-score">${player.score}</div>
        </div>
        <div class="word-list">${words}</div>
      </article>
    `;
  }).join('');
}

function renderStealOptions(words) {
  const options = ['<option value="">Choose a word</option>'];
  for (const word of words) {
    options.push(`<option value="${word.id}">${word.text.toUpperCase()} · ${word.ownerName}</option>`);
  }
  elements.stealSource.innerHTML = options.join('');
}

function renderTurnState(room) {
  if (room.ended) {
    elements.turnIndicator.textContent = 'Round over';
    elements.flipTile.textContent = 'Flip tile';
    return;
  }
  if (room.pendingChallenge) {
    elements.turnIndicator.textContent = 'Vote pending';
    elements.flipTile.textContent = 'Vote pending';
    return;
  }

  const isYourTurn = room.currentTurnPlayerId === state.playerId;
  elements.turnIndicator.textContent = isYourTurn ? 'You' : room.currentTurnPlayerName || 'Waiting...';
  elements.flipTile.textContent = isYourTurn ? 'Flip tile' : `${room.currentTurnPlayerName || 'Waiting'} is up`;
}

function renderChallenge(room) {
  const challenge = room.pendingChallenge;
  if (!challenge) {
    elements.challengePanel.classList.add('hidden');
    return;
  }

  elements.challengePanel.classList.remove('hidden');
  elements.challengeTitle.textContent = `Challenge on ${challenge.wordText.toUpperCase()}`;
  elements.challengeDescription.textContent = `${challenge.challengerName} challenged ${challenge.ownerName}'s word. Everyone votes before play resumes.`;

  const myVote = challenge.votes.find((vote) => vote.playerId === state.playerId)?.decision || null;
  elements.voteKeep.disabled = false;
  elements.voteRevert.disabled = false;
  elements.voteKeep.classList.toggle('selected', myVote === 'keep');
  elements.voteRevert.classList.toggle('selected', myVote === 'revert');

  elements.challengeVotes.innerHTML = challenge.votes.map((vote) => {
    const label = vote.decision ? (vote.decision === 'keep' ? 'keep' : 'revert') : 'waiting';
    return `
      <div class="vote-row ${vote.decision ? 'voted' : 'pending'}">
        <span>${vote.playerName}${vote.playerId === state.playerId ? ' (You)' : ''}</span>
        <strong>${label}</strong>
      </div>
    `;
  }).join('');
}

function renderFinalPanel(room) {
  const bagEmpty = room.bagRemaining === 0;
  elements.endRound.disabled = !bagEmpty || room.ended || Boolean(room.pendingChallenge);

  if (room.ended) {
    const winnerCopy = room.winners.length > 1
      ? `${room.winners.join(' and ')} tied for the win.`
      : `${room.winners[0] || 'Nobody'} wins the round.`;
    elements.finalCopy.textContent = winnerCopy;
    return;
  }
  if (room.pendingChallenge) {
    elements.finalCopy.textContent = 'Voting is open. Finish the challenge before ending the round.';
    return;
  }
  if (bagEmpty) {
    elements.finalCopy.textContent = 'The bag is empty. Resolve any challenges, then end the round when ready.';
  } else {
    elements.finalCopy.textContent = 'Claims and steals reset who gets the next flip.';
  }
}

function renderRoom() {
  const room = state.room;
  if (!room) {
    return;
  }

  const isYourTurn = room.currentTurnPlayerId === state.playerId;
  const pausedForChallenge = Boolean(room.pendingChallenge);

  elements.roomCode.textContent = room.code;
  elements.bagCount.textContent = String(room.bagRemaining);
  elements.lastAction.textContent = room.lastAction || 'Waiting for the next move.';
  elements.flipTile.disabled = room.ended || room.bagRemaining === 0 || !isYourTurn || pausedForChallenge;
  elements.claimWord.disabled = room.ended || pausedForChallenge;
  elements.stealSource.disabled = room.ended || pausedForChallenge;
  elements.stealWord.disabled = room.ended || pausedForChallenge;
  elements.claimForm.querySelector('button').disabled = room.ended || pausedForChallenge;
  elements.stealForm.querySelector('button').disabled = room.ended || pausedForChallenge;
  renderTurnState(room);
  renderTiles(room.centerTiles);
  renderCompactWords(room);
  renderPlayers(room);
  renderStealOptions(room.allWords);
  renderChallenge(room);
  renderFinalPanel(room);
  renderSoundToggle();
}

function applyRoomUpdate(room, allowEffects) {
  const previousRoom = state.room;
  const previousEventId = previousRoom?.lastEvent?.id || 0;
  const nextEventId = room.lastEvent?.id || 0;
  const becameYourTurn = previousRoom
    && previousRoom.currentTurnPlayerId !== state.playerId
    && room.currentTurnPlayerId === state.playerId
    && !room.ended
    && !room.pendingChallenge
    && room.bagRemaining > 0;

  state.room = room;
  renderRoom();

  if (!allowEffects || nextEventId <= previousEventId) {
    return;
  }

  if (room.lastEvent?.type === 'flip') {
    playFlipSound();
  }
  if (room.lastEvent?.type === 'steal') {
    playStealSound();
  }
  if (room.lastEvent?.type === 'challenge_opened') {
    showToast('Challenge opened. Vote to continue.', 2200);
  }
  if (room.lastEvent?.type === 'challenge_resolved_keep' || room.lastEvent?.type === 'challenge_resolved_revert') {
    showToast('Vote finished. Game resumed.', 1800);
  }
  if (becameYourTurn) {
    showToast('Your turn to flip.', 1800);
  }
}

async function createRoom(name) {
  const payload = await request('/api/rooms/create', {
    method: 'POST',
    body: {
      playerId: state.playerId,
      name
    }
  });
  setRoom(payload.room);
}

async function joinRoom(name, roomCode) {
  const payload = await request(`/api/rooms/${roomCode}/join`, {
    method: 'POST',
    body: {
      playerId: state.playerId,
      name
    }
  });
  setRoom(payload.room);
}

async function sendAction(action, body = {}) {
  if (!state.room) {
    return;
  }
  const payload = await request(`/api/rooms/${state.room.code}/${action}`, {
    method: 'POST',
    body: {
      playerId: state.playerId,
      ...body
    }
  });
  applyRoomUpdate(payload.room, true);
}

elements.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = elements.createName.value.trim();
  if (!name) {
    return;
  }
  try {
    persistName(name);
    await createRoom(name);
  } catch (error) {
    showToast(error.message);
  }
});

elements.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = elements.joinName.value.trim();
  const roomCode = elements.joinCode.value.trim().toUpperCase();
  if (!name || !roomCode) {
    return;
  }
  try {
    persistName(name);
    await joinRoom(name, roomCode);
  } catch (error) {
    showToast(error.message);
  }
});

elements.flipTile.addEventListener('click', async () => {
  try {
    await sendAction('flip');
  } catch (error) {
    showToast(error.message);
  }
});

elements.claimForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const word = elements.claimWord.value.trim();
  if (!word) {
    return;
  }
  try {
    await sendAction('claim', { word });
    elements.claimWord.value = '';
  } catch (error) {
    showToast(error.message);
  }
});

elements.stealForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const sourceWordId = elements.stealSource.value;
  const word = elements.stealWord.value.trim();
  if (!sourceWordId || !word) {
    showToast('Choose a word to steal and type the new word.');
    return;
  }
  try {
    await sendAction('steal', { sourceWordId, word });
    elements.stealWord.value = '';
    elements.stealSource.value = '';
  } catch (error) {
    showToast(error.message);
  }
});

elements.playersGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="challenge"]');
  if (!button || !button.dataset.wordId) {
    return;
  }

  try {
    await sendAction('challenge', { sourceWordId: button.dataset.wordId });
  } catch (error) {
    showToast(error.message);
  }
});

elements.voteKeep.addEventListener('click', async () => {
  try {
    await sendAction('vote', { decision: 'keep' });
  } catch (error) {
    showToast(error.message);
  }
});

elements.voteRevert.addEventListener('click', async () => {
  try {
    await sendAction('vote', { decision: 'revert' });
  } catch (error) {
    showToast(error.message);
  }
});

elements.soundToggle.addEventListener('click', async () => {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('anagrams-sound-enabled', String(state.soundEnabled));
  renderSoundToggle();
  if (state.soundEnabled) {
    await unlockAudio();
    showToast('Sound on.');
  } else {
    showToast('Sound off.');
  }
});

elements.copyLink.addEventListener('click', async () => {
  if (!state.room) {
    return;
  }
  try {
    await navigator.clipboard.writeText(state.room.shareUrl);
    showToast('Invite link copied.');
  } catch (error) {
    showToast('Could not copy the link.');
  }
});

elements.leaveRoom.addEventListener('click', () => {
  leaveRoom();
});

elements.endRound.addEventListener('click', async () => {
  try {
    await sendAction('end');
  } catch (error) {
    showToast(error.message);
  }
});

window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);
window.addEventListener('beforeunload', () => {
  if (state.eventSource) {
    state.eventSource.close();
  }
});

renderSoundToggle();
