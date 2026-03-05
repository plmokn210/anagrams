const state = {
  playerId: localStorage.getItem('anagrams-player-id') || crypto.randomUUID(),
  playerName: localStorage.getItem('anagrams-player-name') || '',
  room: null,
  eventSource: null
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
  lastAction: document.querySelector('#last-action'),
  centerTiles: document.querySelector('#center-tiles'),
  flipTile: document.querySelector('#flip-tile'),
  claimForm: document.querySelector('#claim-form'),
  claimWord: document.querySelector('#claim-word'),
  stealForm: document.querySelector('#steal-form'),
  stealSource: document.querySelector('#steal-source'),
  stealWord: document.querySelector('#steal-word'),
  playersGrid: document.querySelector('#players-grid'),
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

function connectEvents(roomCode) {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource(`/api/rooms/${roomCode}/events`);
  state.eventSource.addEventListener('state', (event) => {
    const payload = JSON.parse(event.data);
    state.room = payload;
    renderRoom();
  });
  state.eventSource.onerror = () => {
    showToast('Live connection dropped. Trying again...');
  };
}

function setRoom(room) {
  state.room = room;
  elements.lobbyPanel.classList.add('hidden');
  elements.gamePanel.classList.remove('hidden');
  history.replaceState({}, '', `/?room=${room.code}`);
  connectEvents(room.code);
  renderRoom();
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

function renderPlayers(room) {
  elements.playersGrid.innerHTML = room.players.map((player) => {
    const words = player.words.length
      ? player.words.map((word) => {
        const challengeButton = word.canChallenge && !room.ended
          ? `<button class="pill-action" data-action="challenge" data-word-id="${word.id}">Challenge</button>`
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

function renderFinalPanel(room) {
  const bagEmpty = room.bagRemaining === 0;
  elements.endRound.disabled = !bagEmpty || room.ended;

  if (room.ended) {
    const winnerCopy = room.winners.length > 1
      ? `${room.winners.join(' and ')} tied for the win.`
      : `${room.winners[0] || 'Nobody'} wins the round.`;
    elements.finalCopy.textContent = winnerCopy;
    return;
  }

  if (bagEmpty) {
    elements.finalCopy.textContent = 'The bag is empty. Resolve any challenges, then end the round when ready.';
  } else {
    elements.finalCopy.textContent = 'Resolve any challenges before you end the round.';
  }
}

function renderRoom() {
  const room = state.room;
  if (!room) {
    return;
  }

  elements.roomCode.textContent = room.code;
  elements.bagCount.textContent = String(room.bagRemaining);
  elements.lastAction.textContent = room.lastAction || 'Waiting for the next move.';
  elements.flipTile.disabled = room.ended || room.bagRemaining === 0;
  renderTiles(room.centerTiles);
  renderPlayers(room);
  renderStealOptions(room.allWords);
  renderFinalPanel(room);
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
  state.room = payload.room;
  renderRoom();
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

window.addEventListener('beforeunload', () => {
  if (state.eventSource) {
    state.eventSource.close();
  }
});
