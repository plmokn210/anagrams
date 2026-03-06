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
  playForm: document.querySelector('#play-form'),
  playWord: document.querySelector('#play-word'),
  playSource: document.querySelector('#play-source'),
  playersGrid: document.querySelector('#players-grid'),
  votePanel: document.querySelector('#vote-panel'),
  homeButton: document.querySelector('#home-button'),
  voteTitle: document.querySelector('#vote-title'),
  voteDescription: document.querySelector('#vote-description'),
  voteList: document.querySelector('#vote-list'),
  voteApprove: document.querySelector('#vote-approve'),
  voteReject: document.querySelector('#vote-reject'),
  soundToggle: document.querySelector('#sound-toggle'),
  copyLink: document.querySelector('#copy-link'),
  leaveRoom: document.querySelector('#leave-room'),
  messageModal: document.querySelector('#message-modal'),
  messageModalBody: document.querySelector('#message-modal-body'),
  messageModalClose: document.querySelector('#message-modal-close'),
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

function normalizeNameForMessage(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

function shouldShowJessMessage(name) {
  const normalized = normalizeNameForMessage(name);
  return normalized.startsWith('jess');
}

function showJessMessage(name) {
  elements.messageModalBody.textContent = `hey ${String(name || 'jess').trim().toLowerCase()}, hope you enjoy this game i made for you. miss you`;
  elements.messageModal.classList.remove('hidden');
}

function closeJessMessage() {
  elements.messageModal.classList.add('hidden');
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

function goHome() {
  closeJessMessage();
  leaveRoom();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
        const challengeButton = word.canChallenge && !room.ended && !room.pendingVote
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

function renderPlayOptions(words) {
  const options = ['<option value="">Claim from middle</option>'];
  for (const word of words) {
    options.push(`<option value="${word.id}">${word.text.toUpperCase()} · ${word.ownerName}</option>`);
  }
  elements.playSource.innerHTML = options.join('');
}

function renderTurnState(room) {
  if (room.ended) {
    elements.turnIndicator.textContent = 'Round over';
    elements.flipTile.textContent = 'Flip tile';
    return;
  }
  if (room.pendingVote) {
    elements.turnIndicator.textContent = 'Vote pending';
    elements.flipTile.textContent = 'Vote pending';
    return;
  }

  const isYourTurn = room.currentTurnPlayerId === state.playerId;
  elements.turnIndicator.textContent = isYourTurn ? 'You' : room.currentTurnPlayerName || 'Waiting...';
  elements.flipTile.textContent = isYourTurn ? 'Flip tile' : `${room.currentTurnPlayerName || 'Waiting'} is up`;
}

function renderVotePanel(room) {
  const pendingVote = room.pendingVote;
  if (!pendingVote) {
    elements.votePanel.classList.add('hidden');
    return;
  }

  elements.votePanel.classList.remove('hidden');
  elements.voteTitle.textContent = pendingVote.title;
  elements.voteDescription.textContent = pendingVote.description;

  const myVote = pendingVote.votes.find((vote) => vote.playerId === state.playerId)?.decision || null;
  const canVote = pendingVote.votes.some((vote) => vote.playerId === state.playerId);
  elements.voteApprove.textContent = pendingVote.approveLabel;
  elements.voteReject.textContent = pendingVote.rejectLabel;
  elements.voteApprove.disabled = !canVote;
  elements.voteReject.disabled = !canVote;
  elements.voteApprove.classList.toggle('selected', myVote === 'approve');
  elements.voteReject.classList.toggle('selected', myVote === 'reject');

  elements.voteList.innerHTML = pendingVote.votes.map((vote) => {
    const label = vote.decision ? vote.decision : 'waiting';
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
  elements.endRound.disabled = !bagEmpty || room.ended || Boolean(room.pendingVote);

  if (room.ended) {
    const winnerCopy = room.winners.length > 1
      ? `${room.winners.join(' and ')} tied for the win.`
      : `${room.winners[0] || 'Nobody'} wins the round.`;
    elements.finalCopy.textContent = winnerCopy;
    return;
  }
  if (room.pendingVote) {
    elements.finalCopy.textContent = 'Voting is open. Finish the vote before ending the round.';
    return;
  }
  if (room.bagRemaining === 0) {
    elements.finalCopy.textContent = 'The bag is empty. Resolve any votes, then end the round when ready.';
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
  const pausedForVote = Boolean(room.pendingVote);

  elements.roomCode.textContent = room.code;
  elements.bagCount.textContent = String(room.bagRemaining);
  elements.lastAction.textContent = room.lastAction || 'Waiting for the next move.';
  elements.flipTile.disabled = room.ended || room.bagRemaining === 0 || !isYourTurn || pausedForVote;
  elements.playWord.disabled = room.ended || pausedForVote;
  elements.playSource.disabled = room.ended || pausedForVote;
  elements.playForm.querySelector('button').disabled = room.ended || pausedForVote;
  renderTurnState(room);
  renderTiles(room.centerTiles);
  renderCompactWords(room);
  renderPlayers(room);
  renderPlayOptions(room.allWords);
  renderVotePanel(room);
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
    && !room.pendingVote
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
  if (room.lastEvent?.type === 'challenge_opened' || room.lastEvent?.type === 'word_vote_opened') {
    showToast('Vote opened. Everyone needs to vote.', 2200);
  }
  if (room.lastEvent?.type === 'challenge_resolved_keep' || room.lastEvent?.type === 'challenge_resolved_revert' || room.lastEvent?.type === 'word_vote_rejected' || room.lastEvent?.approvedByVote) {
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
    if (shouldShowJessMessage(name)) {
      showJessMessage(name);
    }
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
    if (shouldShowJessMessage(name)) {
      showJessMessage(name);
    }
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

elements.playForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const word = elements.playWord.value.trim();
  if (!word) {
    return;
  }
  try {
    await sendAction('play', {
      word,
      sourceWordId: elements.playSource.value || ''
    });
    elements.playWord.value = '';
    elements.playSource.value = '';
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

elements.voteApprove.addEventListener('click', async () => {
  try {
    await sendAction('vote', { decision: 'approve' });
  } catch (error) {
    showToast(error.message);
  }
});

elements.voteReject.addEventListener('click', async () => {
  try {
    await sendAction('vote', { decision: 'reject' });
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

elements.homeButton.addEventListener('click', () => {
  goHome();
});

elements.messageModalClose.addEventListener('click', () => {
  closeJessMessage();
});

elements.messageModal.addEventListener('click', (event) => {
  if (event.target === elements.messageModal) {
    closeJessMessage();
  }
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
