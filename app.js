// --- Simple PWA card game with deck-mode + unique names per card ---
// Persists players + deck state in localStorage so it continues after closing.

const STORAGE_KEY = "korttraekker_v1";

const elCardText = document.getElementById("cardText");
const btnDraw = document.getElementById("btnDraw");
const btnShuffle = document.getElementById("btnShuffle");
const btnPlayers = document.getElementById("btnPlayers");

const playersPanel = document.getElementById("playersPanel");
const btnClosePlayers = document.getElementById("btnClosePlayers");
const playerInput = document.getElementById("playerInput");
const btnAddPlayer = document.getElementById("btnAddPlayer");
const playersList = document.getElementById("playersList");

let cards = [];
let state = loadState();

registerServiceWorker();

// Load cards and init
(async function init() {
  cards = await fetch("cards.json").then(r => r.json());
  // Ensure deck exists
  if (!state.deck || !Array.isArray(state.deck) || state.deck.length !== cards.length) {
    reshuffleDeck(true);
  }
  renderPlayers();
  renderCardHint();
})();

btnDraw.addEventListener("click", () => {
  if (!cards.length) return;

  const required = nextCardRequiredPlaceholders();
  if (state.players.length < required) {
    elCardText.textContent = `Dette kort kræver ${required} unikke spillere. Tilføj flere spillere.`;
    openPlayers();
    return;
  }

  const text = drawCardText();
  elCardText.textContent = text;
  saveState();
});

btnShuffle.addEventListener("click", () => {
  reshuffleDeck(true);
  elCardText.textContent = "Bunken er blandet. Træk et kort!";
});

btnPlayers.addEventListener("click", openPlayers);
btnClosePlayers.addEventListener("click", closePlayers);

btnAddPlayer.addEventListener("click", addPlayerFromInput);
playerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPlayerFromInput();
});

function openPlayers() {
  playersPanel.classList.remove("hidden");
  playersPanel.setAttribute("aria-hidden", "false");
  playerInput.focus();
}
function closePlayers() {
  playersPanel.classList.add("hidden");
  playersPanel.setAttribute("aria-hidden", "true");
}

function addPlayerFromInput() {
  const name = (playerInput.value || "").trim();
  if (!name) return;
  if (state.players.some(p => p.toLowerCase() === name.toLowerCase())) {
    playerInput.value = "";
    return;
  }
  state.players.push(name);
  playerInput.value = "";
  renderPlayers();
  saveState();
}

function removePlayer(idx) {
  state.players.splice(idx, 1);
  renderPlayers();
  saveState();
}

function renderPlayers() {
  playersList.innerHTML = "";
  state.players.forEach((name, idx) => {
    const li = document.createElement("li");
    li.className = "playerRow";

    const span = document.createElement("span");
    span.className = "playerName";
    span.textContent = name;

    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = "Fjern";
    btn.addEventListener("click", () => removePlayer(idx));

    li.appendChild(span);
    li.appendChild(btn);
    playersList.appendChild(li);
  });
}

function renderCardHint() {
  if (state.players.length === 0) elCardText.textContent = "Tilføj spillere og træk et kort.";
}

// --- Deck logic ---
function reshuffleDeck(resetPointer = false) {
  state.deck = shuffle([...Array(cards.length).keys()]);
  if (resetPointer) state.deckIndex = 0;
  saveState();
}

function drawCardText() {
  // Auto-reshuffle when deck ends
  if (state.deckIndex >= state.deck.length) {
    reshuffleDeck(true);
  }

  const cardIdx = state.deck[state.deckIndex];
  state.deckIndex += 1;

  const template = cards[cardIdx];
  return fillPlaceholders(template);
}

function fillPlaceholders(template) {
  // Find placeholders used: {{A}}, {{B}}, {{C}} ...
  const placeholders = [...new Set((template.match(/\{\{[A-Z]\}\}/g) || []))];
  const needed = placeholders.length;

  if (needed === 0) return template;

  const picks = pickUniquePlayers(needed);
  const map = {};
  placeholders.forEach((ph, i) => (map[ph] = picks[i]));

  let out = template;
  for (const [ph, name] of Object.entries(map)) {
    out = out.split(ph).join(name);
  }
  return out;
}

function pickUniquePlayers(n) {
  // Choose n distinct players
  const pool = [...state.players];
  // Fisher-Yates shuffle of pool
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

function nextCardRequiredPlaceholders() {
  // Look at NEXT card in deck to give a better error if too few players.
  if (!cards.length) return 0;
  if (state.deckIndex >= state.deck.length) return 1; // will reshuffle; assume at least 1
  const cardIdx = state.deck[state.deckIndex];
  const template = cards[cardIdx];
  const placeholders = [...new Set((template.match(/\{\{[A-Z]\}\}/g) || []))];
  return placeholders.length || 1;
}

// --- Utils ---
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { players: [], deck: null, deckIndex: 0 };
  try {
    const s = JSON.parse(raw);
    return {
      players: Array.isArray(s.players) ? s.players : [],
      deck: Array.isArray(s.deck) ? s.deck : null,
      deckIndex: Number.isFinite(s.deckIndex) ? s.deckIndex : 0
    };
  } catch {
    return { players: [], deck: null, deckIndex: 0 };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");

      // Hvis en ny version allerede ligger klar (waiting)
      if (reg.waiting) showUpdateBanner(reg);

      // Når en ny SW findes (installing -> installed)
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          // installed + der var allerede en controller => opdatering
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });

      // Når den nye SW tager kontrol, reload én gang
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch {
      // ignore
    }
  });
}


function showUpdateBanner(reg) {
  // Undgå flere bannere
  if (document.getElementById("updateBanner")) return;

  const banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.style.position = "fixed";
  banner.style.left = "12px";
  banner.style.right = "12px";
  banner.style.bottom = "12px";
  banner.style.zIndex = "100000";
  banner.style.background = "#15151e";
  banner.style.border = "1px solid #242434";
  banner.style.borderRadius = "16px";
  banner.style.padding = "12px";
  banner.style.boxShadow = "0 10px 30px rgba(0,0,0,.45)";
  banner.style.display = "flex";
  banner.style.alignItems = "center";
  banner.style.justifyContent = "space-between";
  banner.style.gap = "12px";

  const text = document.createElement("div");
  text.textContent = "Ny version klar";
  text.style.fontSize = "14px";
  text.style.opacity = "0.95";

  const btn = document.createElement("button");
  btn.textContent = "Opdatér";
  btn.className = "primary"; // bruger din eksisterende knap-styling
  btn.style.padding = "10px 12px";
  btn.style.borderRadius = "14px";

  btn.addEventListener("click", () => {
    // Fortæl SW at den skal aktivere den nye version NU
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  });

  banner.appendChild(text);
  banner.appendChild(btn);
  document.body.appendChild(banner);
}
