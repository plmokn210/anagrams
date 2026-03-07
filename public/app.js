const state = {
  playerId: localStorage.getItem('anagrams-player-id') || crypto.randomUUID(),
  playerName: '',
  room: null,
  eventSource: null,
  soundEnabled: localStorage.getItem('anagrams-sound-enabled') !== 'false',
  audioContext: null,
  shownJessRoomKey: null,
  selectedSourceWordId: '',
  voteCountdownTimer: null,
  endCountdownTimer: null,
  lastVoteCountdownSecond: null,
  currentVoteId: null,
  inviteRoomCode: ''
};

localStorage.setItem('anagrams-player-id', state.playerId);

const elements = {
  lobbyPanel: document.querySelector('#lobby-panel'),
  gamePanel: document.querySelector('#game-panel'),
  heroHome: document.querySelector('#hero-home'),
  lobbyTitle: document.querySelector('#lobby-title'),
  lobbyCopy: document.querySelector('#lobby-copy'),
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
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  chatFlash: document.querySelector('#chat-flash'),
  votePanel: document.querySelector('#vote-panel'),
  presencePanel: document.querySelector('#presence-panel'),
  homeButton: document.querySelector('#home-button'),
  voteTitle: document.querySelector('#vote-title'),
  voteDescription: document.querySelector('#vote-description'),
  voteTimer: document.querySelector('#vote-timer'),
  voteList: document.querySelector('#vote-list'),
  voteApprove: document.querySelector('#vote-approve'),
  voteReject: document.querySelector('#vote-reject'),
  presenceTitle: document.querySelector('#presence-title'),
  presenceDescription: document.querySelector('#presence-description'),
  presenceResume: document.querySelector('#presence-resume'),
  soundToggle: document.querySelector('#sound-toggle'),
  copyLink: document.querySelector('#copy-link'),
  leaveRoom: document.querySelector('#leave-room'),
  messageModal: document.querySelector('#message-modal'),
  messageModalBody: document.querySelector('#message-modal-body'),
  messageModalClose: document.querySelector('#message-modal-close'),
  toast: document.querySelector('#toast'),
  finalCopy: document.querySelector('#final-copy'),
  finalTimer: document.querySelector('#final-timer'),
  finalVisual: document.querySelector('#final-visual'),
  endRound: document.querySelector('#end-round')
};

const params = new URLSearchParams(window.location.search);
const prefilledRoom = (params.get('room') || '').toUpperCase();
state.inviteRoomCode = prefilledRoom;
if (prefilledRoom) {
  elements.joinCode.value = prefilledRoom;
}

function updateLobbyMode() {
  const inviteMode = Boolean(state.inviteRoomCode);
  elements.lobbyPanel.classList.toggle('invite-only', inviteMode);
  elements.createForm.classList.toggle('hidden', inviteMode);
  elements.lobbyTitle.textContent = inviteMode ? 'Join this room' : 'Start or join a room';
  elements.lobbyCopy.textContent = inviteMode
    ? 'Enter your name and join with the room code from the invite link.'
    : 'Room links are private. Share the code or URL with one other player.';
  elements.joinCode.value = state.inviteRoomCode || elements.joinCode.value;
}

function showToast(message, timeout = 2500) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, timeout);
}

function hideChatFlash() {
  elements.chatFlash.classList.add('hidden');
  elements.chatFlash.textContent = '';
}

function showChatFlash(actorName, message) {
  elements.chatFlash.textContent = `${actorName}: ${message}`;
  elements.chatFlash.classList.remove('hidden');
  clearTimeout(showChatFlash.timer);
  showChatFlash.timer = setTimeout(() => {
    hideChatFlash();
  }, 4200);
}

function setSelectedSourceWord(wordId = '') {
  state.selectedSourceWordId = wordId || '';
  elements.playSource.value = state.selectedSourceWordId;

  if (state.room) {
    renderCompactWords(state.room);
    renderPlayers(state.room);
  }
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
  elements.messageModal.hidden = false;
  elements.messageModal.setAttribute('aria-hidden', 'false');
  elements.messageModal.classList.remove('hidden');
}

function closeJessMessage() {
  elements.messageModal.hidden = true;
  elements.messageModal.setAttribute('aria-hidden', 'true');
  elements.messageModal.classList.add('hidden');
}

function maybeShowJessMessage(roomCode) {
  if (!shouldShowJessMessage(state.playerName) || !roomCode) {
    return;
  }
  const roomKey = `${roomCode}:${normalizeNameForMessage(state.playerName)}`;
  if (state.shownJessRoomKey === roomKey) {
    return;
  }
  state.shownJessRoomKey = roomKey;
  showJessMessage(state.playerName);
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

function playVoteTickSound(secondsLeft) {
  const finalSecond = secondsLeft <= 1;
  playToneSequence([
    {
      offset: 0,
      duration: finalSecond ? 0.12 : 0.08,
      frequency: finalSecond ? 520 : 780,
      endFrequency: finalSecond ? 420 : 720,
      gain: finalSecond ? 0.05 : 0.03,
      type: finalSecond ? 'square' : 'triangle'
    }
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
  window.requestAnimationFrame(() => {
    maybeShowJessMessage(room.code);
  });
  window.setTimeout(() => {
    maybeShowJessMessage(room.code);
  }, 180);
  connectEvents(room.code);
}

function leaveRoom() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.room = null;
  clearVoteCountdown();
  clearEndCountdown();
  hideChatFlash();
  elements.chatInput.value = '';
  setSelectedSourceWord('');
  history.replaceState({}, '', '/');
  elements.gamePanel.classList.add('hidden');
  elements.lobbyPanel.classList.remove('hidden');
  updateLobbyMode();
}

function goHome() {
  closeJessMessage();
  if (state.room) {
    leaveRoom();
  }
  state.inviteRoomCode = '';
  elements.joinCode.value = '';
  updateLobbyMode();
  history.replaceState({}, '', '/');
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

function getStealTransition(room, wordId) {
  if (room.lastEvent?.type !== 'steal' || room.lastEvent.wordId !== wordId || !room.lastEvent.previousWord) {
    return null;
  }

  return {
    previous: room.lastEvent.previousWord.toUpperCase(),
    current: room.lastEvent.word.toUpperCase()
  };
}

function renderStealTransitionText(transition) {
  return `
    <span class="steal-text">
      <span class="steal-old">${transition.previous}</span>
      <span class="steal-new">${transition.current}</span>
    </span>
  `;
}

function renderCompactWords(room) {
  const freshWordId = ['claim', 'steal'].includes(room.lastEvent?.type) ? room.lastEvent.wordId : '';
  const words = room.allWords.map((word) => {
    const selectedClass = state.selectedSourceWordId === word.id ? ' selected' : '';
    const freshClass = freshWordId === word.id ? ' fresh' : '';
    const transition = getStealTransition(room, word.id);
    const revealClass = transition ? ' steal-reveal' : '';
    const label = transition ? renderStealTransitionText(transition) : word.text.toUpperCase();
    return `<button class="compact-word-chip${selectedClass}${freshClass}${revealClass}" data-action="pick-source" data-word-id="${word.id}" type="button">${label}</button>`;
  });

  elements.compactWords.innerHTML = words.length
    ? words.join('')
    : '<p class="hint">No words to steal yet.</p>';
}

function renderPlayers(room) {
  elements.playersGrid.innerHTML = room.players.map((player) => {
    const words = player.words.length
      ? player.words.map((word) => {
        const challengeButton = word.canChallenge && !room.ended && !room.pendingVote
          ? `<button class="pill-action" data-action="challenge" data-word-id="${word.id}" type="button">Challenge</button>`
          : '';
        const selectedClass = state.selectedSourceWordId === word.id ? ' selected' : '';

        const transition = getStealTransition(room, word.id);
        const revealClass = transition ? ' steal-reveal' : '';
        const label = transition
          ? renderStealTransitionText(transition)
          : `<strong>${word.text.toUpperCase()}</strong>`;

        return `
          <div class="word-pill">
            <button class="word-pick selectable-word${selectedClass}${revealClass}" data-action="pick-source" data-word-id="${word.id}" type="button">
              ${label}
              <span>+${word.score}</span>
            </button>
            ${challengeButton}
          </div>
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
  const hasSelection = words.some((word) => word.id === state.selectedSourceWordId);
  elements.playSource.value = hasSelection ? state.selectedSourceWordId : '';
  if (!hasSelection) {
    state.selectedSourceWordId = '';
  }
}

function renderTurnState(room) {
  if (room.ended) {
    elements.turnIndicator.textContent = 'Round over';
    elements.flipTile.textContent = 'Flip tile';
    return;
  }
  if (!room.started) {
    elements.turnIndicator.textContent = room.players.length < 2 ? 'Waiting for players' : 'Ready';
    elements.flipTile.textContent = room.players.length < 2 ? 'Waiting for players' : 'Start game';
    return;
  }
  if (room.presenceCheck) {
    elements.turnIndicator.textContent = 'Paused';
    elements.flipTile.textContent = 'Paused';
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

function renderPresencePanel(room) {
  const presenceCheck = room.presenceCheck;
  if (!presenceCheck) {
    elements.presencePanel.classList.add('hidden');
    return;
  }

  elements.presencePanel.classList.remove('hidden');
  elements.presenceTitle.textContent = presenceCheck.title;
  elements.presenceDescription.textContent = presenceCheck.description;
}

function clearVoteCountdown() {
  if (state.voteCountdownTimer) {
    clearInterval(state.voteCountdownTimer);
    state.voteCountdownTimer = null;
  }
  state.lastVoteCountdownSecond = null;
  state.currentVoteId = null;
}

function clearEndCountdown() {
  if (state.endCountdownTimer) {
    clearInterval(state.endCountdownTimer);
    state.endCountdownTimer = null;
  }
}

function updateEndCountdown() {
  const room = state.room;
  if (!room || room.ended || !room.endDeadlineAt || room.pendingVote || room.presenceCheck) {
    elements.finalTimer.textContent = '';
    clearEndCountdown();
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((room.endDeadlineAt - Date.now()) / 1000));
  elements.finalTimer.textContent = `Round ends automatically in ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}.`;
}

function ensureEndCountdown(room) {
  if (!room.endDeadlineAt || room.ended || room.pendingVote || room.presenceCheck) {
    elements.finalTimer.textContent = '';
    clearEndCountdown();
    return;
  }

  updateEndCountdown();
  if (!state.endCountdownTimer) {
    state.endCountdownTimer = window.setInterval(updateEndCountdown, 200);
  }
}

function updateVoteCountdown() {
  const pendingVote = state.room?.pendingVote;
  if (!pendingVote?.deadlineAt) {
    elements.voteTimer.textContent = '';
    clearVoteCountdown();
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((pendingVote.deadlineAt - Date.now()) / 1000));
  elements.voteTimer.textContent = `${secondsLeft} second${secondsLeft === 1 ? '' : 's'} left`;

  if (state.lastVoteCountdownSecond !== null && secondsLeft < state.lastVoteCountdownSecond && secondsLeft > 0) {
    playVoteTickSound(secondsLeft);
  }

  state.lastVoteCountdownSecond = secondsLeft;
}

function ensureVoteCountdown(pendingVote) {
  if (!pendingVote?.deadlineAt) {
    elements.voteTimer.textContent = '';
    clearVoteCountdown();
    return;
  }

  if (state.currentVoteId !== pendingVote.wordText + pendingVote.kind + pendingVote.deadlineAt) {
    clearVoteCountdown();
    state.currentVoteId = pendingVote.wordText + pendingVote.kind + pendingVote.deadlineAt;
    state.lastVoteCountdownSecond = null;
  }

  updateVoteCountdown();

  if (!state.voteCountdownTimer) {
    state.voteCountdownTimer = window.setInterval(updateVoteCountdown, 200);
  }
}

function renderVotePanel(room) {
  const pendingVote = room.pendingVote;
  if (!pendingVote) {
    elements.votePanel.classList.add('hidden');
    elements.voteTimer.textContent = '';
    clearVoteCountdown();
    return;
  }

  elements.votePanel.classList.remove('hidden');
  elements.voteTitle.textContent = pendingVote.title;
  elements.voteDescription.textContent = pendingVote.description;
  ensureVoteCountdown(pendingVote);

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

function renderPodium(room) {
  const leaders = room.players.slice(0, 3);
  if (!leaders.length) {
    elements.finalVisual.classList.add('hidden');
    elements.finalVisual.innerHTML = '';
    return;
  }

  const displayOrder = leaders.length === 1 ? [0] : leaders.length === 2 ? [0, 1] : [1, 0, 2];
  const placeLabels = ['1st', '2nd', '3rd'];
  const stepClasses = ['top', 'mid', 'low'];

  elements.finalVisual.classList.remove('hidden');
  elements.finalVisual.innerHTML = `
    <div class="podium-burst" aria-hidden="true">✦ ✦ ✦</div>
    <div class="podium">
      ${displayOrder.map((leaderIndex, orderIndex) => {
        const player = leaders[leaderIndex];
        const isWinner = room.winners.includes(player.name);
        return `
          <div class="podium-slot ${stepClasses[orderIndex]} ${isWinner ? 'winner' : ''}">
            <div class="podium-rank">${isWinner ? '👑' : '✦'} ${placeLabels[leaderIndex]}</div>
            <div class="podium-name">${player.name}</div>
            <div class="podium-score">${player.score} pts</div>
            <div class="podium-step"></div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderFinalPanel(room) {
  const bagEmpty = room.bagRemaining === 0;
  elements.endRound.textContent = room.ended ? 'Round ended' : 'End round now';
  elements.endRound.disabled = !room.started || !bagEmpty || room.ended || Boolean(room.pendingVote) || Boolean(room.presenceCheck);

  if (room.ended) {
    clearEndCountdown();
    const winnerCopy = room.winners.length > 1
      ? `${room.winners.join(' and ')} tied for the win.`
      : `${room.winners[0] || 'Nobody'} wins the round.`;
    elements.finalCopy.textContent = winnerCopy;
    elements.finalTimer.textContent = 'Final scores locked.';
    renderPodium(room);
    return;
  }

  elements.finalVisual.classList.add('hidden');
  elements.finalVisual.innerHTML = '';

  if (!room.started) {
    clearEndCountdown();
    elements.finalCopy.textContent = room.players.length < 2
      ? 'Invite one more player. The round will not start yet.'
      : 'Flip a tile to start the game.';
    elements.finalTimer.textContent = '';
    return;
  }
  if (room.pendingVote) {
    clearEndCountdown();
    elements.finalCopy.textContent = 'Voting is open. Finish the vote before ending the round.';
    elements.finalTimer.textContent = '';
    return;
  }
  if (room.presenceCheck) {
    clearEndCountdown();
    elements.finalCopy.textContent = 'Game paused. Confirm you are still playing before ending the round.';
    elements.finalTimer.textContent = '';
    return;
  }
  if (room.bagRemaining === 0) {
    elements.finalCopy.textContent = 'The bag is empty. You have 30 seconds for final steals before the round ends automatically.';
    ensureEndCountdown(room);
  } else {
    elements.finalCopy.textContent = 'Claims and steals reset who gets the next flip.';
    elements.finalTimer.textContent = '';
    clearEndCountdown();
  }
}

function renderRoom() {
  const room = state.room;
  if (!room) {
    return;
  }

  const isYourTurn = room.currentTurnPlayerId === state.playerId;
  const waitingToStart = !room.started;
  const pausedForVote = Boolean(room.pendingVote);
  const pausedForPresence = Boolean(room.presenceCheck);

  elements.roomCode.textContent = room.code;
  elements.bagCount.textContent = String(room.bagRemaining);
  elements.lastAction.textContent = room.lastAction || 'Waiting for the next move.';
  elements.flipTile.disabled = room.ended || room.bagRemaining === 0 || pausedForVote || pausedForPresence || (waitingToStart ? room.players.length < 2 : !isYourTurn);
  elements.playWord.disabled = waitingToStart || room.ended || pausedForVote || pausedForPresence;
  elements.playSource.disabled = waitingToStart || room.ended || pausedForVote || pausedForPresence;
  elements.playForm.querySelector('button').disabled = waitingToStart || room.ended || pausedForVote || pausedForPresence;
  elements.chatInput.disabled = false;
  elements.chatForm.querySelector('button').disabled = false;
  renderTurnState(room);
  renderTiles(room.centerTiles);
  renderPlayOptions(room.allWords);
  renderCompactWords(room);
  renderPlayers(room);
  renderVotePanel(room);
  renderPresencePanel(room);
  renderFinalPanel(room);
  renderSoundToggle();
}

function applyRoomUpdate(room, allowEffects) {
  const previousRoom = state.room;
  const previousEventId = previousRoom?.lastEvent?.id || 0;
  const nextEventId = room.lastEvent?.id || 0;

  if (nextEventId > previousEventId && ['claim', 'steal'].includes(room.lastEvent?.type)) {
    state.selectedSourceWordId = '';
  }

  const becameYourTurn = previousRoom
    && previousRoom.currentTurnPlayerId !== state.playerId
    && room.started
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
  if (room.lastEvent?.type === 'chat' && room.lastEvent.message) {
    showChatFlash(room.lastEvent.actorName || 'Player', room.lastEvent.message);
  }
  if (room.lastEvent?.type === 'challenge_opened' || room.lastEvent?.type === 'word_vote_opened') {
    showToast('Vote opened. Everyone needs to vote.', 2200);
  }
  if (room.lastEvent?.type === 'player_removed' && room.lastEvent?.reason === 'inactivity') {
    showToast(`${room.lastEvent.actorName || 'A player'} was removed for inactivity.`, 2400);
  }
  if (room.lastEvent?.type === 'end' && room.lastEvent?.autoEnded) {
    showToast('Time is up. Round ended automatically.', 2400);
  }
  if (room.lastEvent?.type === 'presence_check_opened') {
    showToast('Game paused. Confirm you are still playing.', 2400);
  }
  if (room.lastEvent?.type === 'presence_check_resolved') {
    showToast('Game resumed.', 1800);
  }
  if (room.lastEvent?.type === 'challenge_resolved_keep' || room.lastEvent?.type === 'challenge_resolved_revert' || room.lastEvent?.type === 'word_vote_rejected' || room.lastEvent?.approvedByVote) {
    showToast(room.lastEvent?.timedOut ? 'Vote timed out. Game resumed.' : 'Vote finished. Game resumed.', 1800);
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
    window.requestAnimationFrame(() => {
      if (state.room?.code) {
        maybeShowJessMessage(state.room.code);
      }
    });
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
    window.requestAnimationFrame(() => {
      if (state.room?.code) {
        maybeShowJessMessage(state.room.code);
      }
    });
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
      sourceWordId: state.selectedSourceWordId || ''
    });
    elements.playWord.value = '';
    setSelectedSourceWord('');
  } catch (error) {
    showToast(error.message);
  }
});

elements.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = elements.chatInput.value.trim();
  if (!message) {
    return;
  }
  try {
    await sendAction('chat', { message });
    elements.chatInput.value = '';
  } catch (error) {
    showToast(error.message);
  }
});

elements.playSource.addEventListener('change', () => {
  setSelectedSourceWord(elements.playSource.value || '');
});

elements.compactWords.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="pick-source"]');
  if (!button || !button.dataset.wordId) {
    return;
  }
  const nextWordId = button.dataset.wordId === state.selectedSourceWordId ? '' : button.dataset.wordId;
  setSelectedSourceWord(nextWordId);
  elements.playWord.focus();
});

elements.playersGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="challenge"]');
  if (button && button.dataset.wordId) {
    try {
      await sendAction('challenge', { sourceWordId: button.dataset.wordId });
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const word = event.target.closest('[data-action="pick-source"]');
  if (!word || !word.dataset.wordId) {
    return;
  }

  const nextWordId = word.dataset.wordId === state.selectedSourceWordId ? '' : word.dataset.wordId;
  setSelectedSourceWord(nextWordId);
  elements.playWord.focus();
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

elements.presenceResume.addEventListener('click', async () => {
  try {
    await sendAction('resume');
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

elements.heroHome.addEventListener('click', () => {
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
  clearVoteCountdown();
  clearEndCountdown();
  if (state.eventSource) {
    state.eventSource.close();
  }
});

renderSoundToggle();
closeJessMessage();
hideChatFlash();
updateLobbyMode();
