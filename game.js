const canvas = document.querySelector("#casino");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const $ = (s) => document.querySelector(s);
const moneyEl = $("#money"),
  goalEl = $("#goal"),
  timerEl = $("#timer"),
  roundEl = $("#round");
let money = 1000,
  goal = 1300,
  round = 1,
  timeLeft = 300,
  playing = false,
  modalOpen = false,
  last = performance.now();
let luckBoost = 0,
  luckTime = 0,
  moveModifier = 1,
  moveModifierTime = 0,
  effectName = "",
  pickup = null,
  spawnIn = 12 + Math.random() * 18;
const player = { x: 480, y: 440, w: 24, h: 30, speed: 190 };
const keys = {};
let socket = null,
  myId = null,
  currentRoom = null,
  lastNetworkSend = 0,
  lastSentX = 480,
  lastSentY = 440,
  selectedAvatar = 0,
  isReady = false,
  myName = "Player",
  faceX = 1,
  faceY = 0,
  punchTime = 0,
  punchCooldown = 0,
  punchCharge = 0,
  chargingPunch = false;
const remotePlayers = new Map();
const impacts = [],
  moneyParticles = [];
let playerKnock = null,
  teamCombo = 0,
  globalEvent = null,
  localEmote = null,
  pendingOutcomes = 0,
  bankruptcyTimer = null;
const missions = [
  { name: "Raccogli 2 misteri", type: "collect", goal: 2 },
  { name: "Colpisci 5 personaggi", type: "punch", goal: 5 },
  { name: "Ottieni 3 vincite", type: "win", goal: 3 },
];
let mission = { ...missions[0], progress: 0 };
const lobbyRoster = new Map(),
  avatarIcons = ["🎩", "👑", "🤠", "🤡"];
const npcColors = [
  "#ff4d8d",
  "#39e6d0",
  "#ffd166",
  "#8f6cff",
  "#ff7b39",
  "#70e05b",
  "#e8e8ff",
];
const npcs = Array.from({ length: 9 }, (_, i) => makeNpc(i, true));
let audioCtx = null,
  musicOn = true,
  musicTimer = null,
  musicStep = 0;
const stations = [
  {
    id: "blackjack",
    name: "BLACKJACK",
    x: 35,
    y: 90,
    w: 155,
    h: 115,
    color: "#0e785c",
    icon: "♠",
  },
  {
    id: "roulette",
    name: "ROULETTE",
    x: 280,
    y: 90,
    w: 155,
    h: 115,
    color: "#9e274a",
    icon: "◆",
  },
  {
    id: "dice",
    name: "DADI",
    x: 525,
    y: 90,
    w: 155,
    h: 115,
    color: "#d17832",
    icon: "⚄",
  },
  {
    id: "horses",
    name: "CORSA CAVALLI",
    x: 770,
    y: 90,
    w: 155,
    h: 115,
    color: "#295e8c",
    icon: "♞",
  },
  {
    id: "slots",
    name: "SLOT",
    x: 150,
    y: 350,
    w: 155,
    h: 115,
    color: "#8b3fa7",
    icon: "★",
  },
  {
    id: "plinko",
    name: "PLINKO",
    x: 402,
    y: 350,
    w: 155,
    h: 115,
    color: "#287b83",
    icon: "●",
  },
  {
    id: "fortune",
    name: "RUOTA FORTUNA",
    x: 655,
    y: 350,
    w: 155,
    h: 115,
    color: "#b24580",
    icon: "✦",
  },
];

function socketUrl() {
  if (location.protocol === "file:") return "ws://localhost:3000";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}
function renderLobby() {
  const box = $("#lobbyPlayers");
  box.innerHTML = [...lobbyRoster.values()]
    .map(
      (p) =>
        `<div class="lobby-player"><span>${avatarIcons[p.avatar] || "🎩"}</span><b>${p.name}${p.id === myId ? " (TU)" : ""}</b><span class="${p.ready ? "ready" : "not-ready"}">${p.ready ? "PRONTO" : "IN ATTESA"}</span></div>`,
    )
    .join("");
}
function setRole() {
  const roles = [
    "FORTUNATO +5%",
    "BANCHIERE +5%",
    "CORRIDORE +15%",
    "PICCHIATORE +25%",
  ];
  $("#roleName").textContent = roles[selectedAvatar];
}
function newMission() {
  mission = {
    ...missions[Math.floor(Math.random() * missions.length)],
    progress: 0,
  };
  $("#missionName").textContent = mission.name;
  $("#missionProgress").textContent = `0 / ${mission.goal}`;
  $(".mission-box").classList.remove("complete");
}
function trackMission(type) {
  if (mission.type !== type) return;
  mission.progress++;
  $("#missionProgress").textContent =
    `${Math.min(mission.progress, mission.goal)} / ${mission.goal}`;
  if (mission.progress >= mission.goal) {
    $(".mission-box").classList.add("complete");
    toast(`Missione completata! +${fmt(100 * round)}`);
    const reward = 100 * round;
    setTimeout(() => {
      newMission();
      changeMoney(reward);
    }, 700);
  }
}
function showEvent(event) {
  globalEvent = event;
  $("#eventName").textContent = event.name;
  $("#eventBanner").classList.remove("hidden");
  toast(`EVENTO: ${event.name}`);
  if (event.name === "PIOGGIA DI FICHES") spawnIn = 1;
}
function hideEvent() {
  globalEvent = null;
  $("#eventBanner").classList.add("hidden");
}
function spawnMoneyFx(amount) {
  for (
    let i = 0;
    i < Math.min(35, 10 + Math.floor(Math.abs(amount) / 100));
    i++
  )
    moneyParticles.push({
      x: 480 + (Math.random() - 0.5) * 160,
      y: 270,
      vx: (Math.random() - 0.5) * 120,
      vy: -80 - Math.random() * 150,
      ttl: 1 + Math.random(),
      text: Math.random() < 0.5 ? "$" : "◆",
    });
}
function applyEconomy(e, announce = false) {
  if (!e) return;
  const oldRound = round,
    oldCombo = teamCombo;
  money = e.money;
  round = e.round;
  goal = e.goal;
  teamCombo = e.combo || 0;
  $("#comboValue").textContent = `×${teamCombo}`;
  $("#comboFill").style.width = `${Math.min(100, teamCombo * 10)}%`;
  if (announce && e.delta > 0) {
    spawnMoneyFx(e.delta);
    if (e.outcome === "win") trackMission("win");
    if (teamCombo > oldCombo && teamCombo % 5 === 0)
      toast(`COMBO DI SQUADRA ×${teamCombo}!`);
    if (e.delta >= 500) {
      $(".casino-wrap").classList.remove("shake");
      void $(".casino-wrap").offsetWidth;
      $(".casino-wrap").classList.add("shake");
    }
  }
  if (e.levelUps > 0 || round > oldRound) {
    timeLeft = 300;
    if (announce)
      toast(`${e.actor || "La squadra"} ha raggiunto il livello ${round}!`);
  }
  sync();
  if (money > 0) {
    clearTimeout(bankruptcyTimer);
    bankruptcyTimer = null;
  } else if (playing && pendingOutcomes === 0 && !bankruptcyTimer) {
    bankruptcyTimer = setTimeout(() => {
      bankruptcyTimer = null;
      if (money <= 0 && pendingOutcomes === 0 && playing)
        end("Il budget condiviso è terminato. Il casinò vince.");
    }, 1200);
  }
}
function startRoom(players, economy) {
  remotePlayers.clear();
  players
    .filter((p) => p.id !== myId)
    .forEach((p) => {
      p.tx = p.x;
      p.ty = p.y;
      remotePlayers.set(p.id, p);
    });
  applyEconomy(economy);
  $("#lobby-screen").classList.add("hidden");
  $("#roomBar").classList.remove("hidden");
  playing = true;
  last = performance.now();
  toast(`Lobby ${currentRoom}: tutti pronti!`);
}
function connectMultiplayer() {
  const status = $("#lobbyStatus");
  status.textContent = "Connessione al casinò...";
  socket = new WebSocket(socketUrl());
  socket.onopen = () =>
    (status.textContent = "Connesso. Crea o raggiungi una lobby.");
  socket.onerror = () =>
    (status.textContent = "Server non raggiungibile. Avvia con: npm start");
  socket.onclose = () => {
    if (currentRoom) {
      playing = false;
      currentRoom = null;
      remotePlayers.clear();
      lobbyRoster.clear();
      hideEvent();
      $("#lobby-screen").classList.remove("hidden");
      $("#roomBar").classList.add("hidden");
      $("#lobbyEntry").classList.remove("hidden");
      $("#waitingRoom").classList.add("hidden");
      status.textContent = "Connessione persa. Riconnessione...";
    }
    setTimeout(connectMultiplayer, 2500);
  };
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "connected") myId = m.id;
    else if (m.type === "error") status.textContent = m.message;
    else if (m.type === "joined") {
      myId = m.id;
      currentRoom = m.code;
      isReady = false;
      applyEconomy(m.economy);
      lobbyRoster.clear();
      m.players.forEach((p) => lobbyRoster.set(p.id, p));
      $("#currentRoom").textContent = m.code;
      $("#waitingCode").textContent = m.code;
      $("#onlineCount").textContent = m.players.length;
      $("#lobbyEntry").classList.add("hidden");
      $("#waitingRoom").classList.remove("hidden");
      status.textContent = "Scegli Pronto quando vuoi iniziare.";
      renderLobby();
      if (m.event) showEvent(m.event);
    } else if (m.type === "playerJoined") {
      lobbyRoster.set(m.player.id, m.player);
      renderLobby();
      toast(`${m.player.name} è entrato nella lobby`);
    } else if (m.type === "roster") {
      lobbyRoster.clear();
      m.players.forEach((p) => lobbyRoster.set(p.id, p));
      renderLobby();
    } else if (m.type === "start") startRoom(m.players, m.economy);
    else if (m.type === "economy") applyEconomy(m, true);
    else if (m.type === "eventStart") showEvent(m.event);
    else if (m.type === "eventEnd") hideEvent();
    else if (m.type === "emote") {
      const until = performance.now() + 2200;
      if (m.id === myId) localEmote = { value: m.emote, until };
      else {
        const p = remotePlayers.get(m.id);
        if (p) p.emote = { value: m.emote, until };
      }
    } else if (m.type === "playerLeft") {
      remotePlayers.delete(m.id);
      lobbyRoster.delete(m.id);
      renderLobby();
    } else if (m.type === "knock") {
      const now = performance.now(),
        duration = 300 + (m.strength || 0) * 500,
        attacker = remotePlayers.get(m.attacker);
      if (attacker) {
        attacker.punchUntil = now + 340 + (m.strength || 0) * 180;
        attacker.faceX = m.dx;
        attacker.faceY = m.dy;
      }
      impacts.push({ x: m.fromX, y: m.fromY, ttl: 0.45 });
      if (m.target === myId)
        playerKnock = {
          x0: player.x,
          y0: player.y,
          x1: m.x,
          y1: m.y,
          start: now,
          duration,
        };
      else {
        const target = remotePlayers.get(m.target);
        if (target) {
          target.tx = m.x;
          target.ty = m.y;
          target.knock = {
            x0: target.x,
            y0: target.y,
            x1: m.x,
            y1: m.y,
            start: now,
            duration,
          };
        }
      }
    } else if (m.type === "move") {
      const p = remotePlayers.get(m.id);
      if (p && !p.knock) {
        p.tx = m.x;
        p.ty = m.y;
        if (m.fx || m.fy) {
          p.faceX = m.fx;
          p.faceY = m.fy;
        }
      }
    } else if (m.type === "count") $("#onlineCount").textContent = m.count;
  };
}
function lobbyAction(type) {
  if (!socket || socket.readyState !== WebSocket.OPEN)
    return ($("#lobbyStatus").textContent =
      "Connessione al server non disponibile");
  const name =
      $("#playerName").value.trim() ||
      `Player${Math.floor(Math.random() * 99)}`,
    code = $("#roomCode").value.trim().toUpperCase();
  if (type === "join" && !code)
    return ($("#lobbyStatus").textContent = "Inserisci il codice della lobby");
  myName = name;
  socket.send(JSON.stringify({ type, name, code, avatar: selectedAvatar }));
  $("#lobbyStatus").textContent =
    type === "create" ? "Creazione lobby..." : "Accesso alla lobby...";
}
$("#createRoom").onclick = () => lobbyAction("create");
$("#joinRoom").onclick = () => lobbyAction("join");
$("#roomCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") lobbyAction("join");
});
$("#copyRoom").onclick = async () => {
  if (!currentRoom) return;
  try {
    await navigator.clipboard.writeText(currentRoom);
    toast("Codice lobby copiato!");
  } catch {
    toast(`Codice lobby: ${currentRoom}`);
  }
};
document.querySelectorAll(".avatar-choice").forEach(
  (x) =>
    (x.onclick = () => {
      selectedAvatar = +x.dataset.avatar;
      setRole();
      document
        .querySelectorAll(".avatar-choice")
        .forEach((y) => y.classList.toggle("selected", y === x));
    }),
);
$("#readyButton").onclick = () => {
  if (!currentRoom) return;
  isReady = !isReady;
  $("#readyButton").textContent = isReady ? "ANNULLA PRONTO" : "SONO PRONTO";
  $("#readyButton").classList.toggle("is-ready", isReady);
  socket.send(JSON.stringify({ type: "ready", ready: isReady }));
};
setRole();
newMission();
connectMultiplayer();

function makeNpc(i, initial = false) {
  const mode = ["horizontal", "vertical", "diagonal"][
      Math.floor(Math.random() * 3)
    ],
    speed = 55 + Math.random() * 145,
    signX = Math.random() < 0.5 ? -1 : 1,
    signY = Math.random() < 0.5 ? -1 : 1;
  let x,
    y,
    vx = 0,
    vy = 0;
  if (initial) {
    x = Math.random() * 960;
    y = 75 + Math.random() * 420;
  } else if (mode === "horizontal") {
    x = signX > 0 ? -50 : 1010;
    y = 80 + Math.random() * 400;
  } else if (mode === "vertical") {
    x = 40 + Math.random() * 880;
    y = signY > 0 ? 45 : 535;
  } else {
    x = signX > 0 ? -50 : 1010;
    y = signY > 0 ? 45 : 535;
  }
  if (mode === "horizontal") vx = signX * speed;
  else if (mode === "vertical") vy = signY * speed;
  else {
    vx = signX * speed * 0.76;
    vy = signY * speed * 0.58;
  }
  return {
    x,
    y,
    vx,
    vy,
    speed,
    body: npcColors[Math.floor(Math.random() * npcColors.length)],
    hat: npcColors[Math.floor(Math.random() * npcColors.length)],
    style: Math.floor(Math.random() * 4),
    phase: Math.random() * 6.28,
    wait: 0,
    i,
  };
}
function respawnNpc(n) {
  Object.assign(n, makeNpc(n.i));
  n.wait = Math.random() * 3;
}
function updateNpcs(dt) {
  npcs.forEach((n) => {
    if (n.wait > 0) {
      n.wait -= dt;
      return;
    }
    n.x += n.vx * dt + (n.knockVX || 0) * dt;
    n.y += n.vy * dt + (n.knockVY || 0) * dt;
    n.knockVX = (n.knockVX || 0) * Math.pow(0.035, dt);
    n.knockVY = (n.knockVY || 0) * Math.pow(0.035, dt);
    n.hit = Math.max(0, (n.hit || 0) - dt);
    n.phase += dt * n.speed * 0.09;
    if (n.x > 1030 || n.x < -70 || n.y > 565 || n.y < 35) respawnNpc(n);
  });
}
function drawNpc(n) {
  if (n.wait > 0) return;
  const bob = Math.sin(n.phase) * 2,
    x = n.x,
    y = n.y + bob,
    leg = Math.sin(n.phase) * 5;
  ctx.save();
  ctx.translate(x, y);
  if (n.hit) ctx.rotate(Math.sin(n.hit * 24) * 0.22);
  if (n.vx < 0) ctx.scale(-1, 1);
  ctx.fillStyle = "#090711";
  ctx.fillRect(-8 + leg, 22, 6, 12);
  ctx.fillRect(3 - leg, 22, 6, 12);
  ctx.fillStyle = n.body;
  ctx.fillRect(-11, 3, 22, 22);
  ctx.fillRect(-16, 7 + leg * 0.3, 5, 14);
  ctx.fillRect(11, 7 - leg * 0.3, 5, 14);
  ctx.fillStyle = ["#f0ad8a", "#75452f", "#d8a36f"][n.i % 3];
  ctx.fillRect(-8, -10, 16, 14);
  ctx.fillStyle = n.hat;
  if (n.style === 0) {
    ctx.fillRect(-12, -15, 24, 6);
    ctx.fillRect(-6, -22, 13, 8);
  } else if (n.style === 1) {
    ctx.fillRect(-10, -14, 20, 5);
    ctx.fillRect(-14, -11, 6, 13);
  } else if (n.style === 2) {
    ctx.fillRect(-10, -17, 20, 9);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(-3, -25, 6, 8);
  } else {
    ctx.fillRect(-13, -15, 26, 5);
    ctx.fillRect(-11, -20, 5, 6);
    ctx.fillRect(6, -20, 5, 6);
  }
  ctx.fillStyle = "#111";
  ctx.fillRect(3, -5, 3, 3);
  ctx.restore();
}

function startMusic() {
  if (!musicOn) return;
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!musicTimer) musicTick();
}
function playTone(freq, dur, type = "triangle", vol = 0.035, delay = 0) {
  if (!audioCtx || !musicOn) return;
  const t = audioCtx.currentTime + delay,
    o = audioCtx.createOscillator(),
    g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}
function musicTick() {
  if (!musicOn || !audioCtx) {
    musicTimer = null;
    return;
  }
  const urgency = 1 - Math.min(timeLeft, 300) / 300,
    bpm = 74 + urgency * 86 + (globalEvent?.name === "MODALITÀ CAOS" ? 55 : 0),
    notes = [220, 261.63, 329.63, 392, 329.63, 261.63, 246.94, 293.66];
  playTone(notes[musicStep % notes.length], 0.22, "triangle", 0.028);
  if (musicStep % 4 === 0)
    playTone(notes[musicStep % notes.length] / 2, 0.38, "sine", 0.04);
  if (urgency > 0.45 && musicStep % 2 === 0)
    playTone(880, 0.045, "square", 0.012);
  if (urgency > 0.75) playTone(110, 0.06, "sawtooth", 0.018);
  musicStep++;
  musicTimer = setTimeout(musicTick, 60000 / bpm / 2);
}
$("#sound").onclick = () => {
  musicOn = !musicOn;
  $("#sound").textContent = musicOn ? "♪" : "×";
  $("#sound").classList.toggle("muted", !musicOn);
  if (musicOn) startMusic();
  else {
    clearTimeout(musicTimer);
    musicTimer = null;
    if (audioCtx) audioCtx.suspend();
  }
};
addEventListener("pointerdown", startMusic, { once: true });
addEventListener("keydown", startMusic, { once: true });

function fmt(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return "$∞";
  const sign = n < 0 ? "-" : "",
    value = Math.abs(n);
  if (value < 10000000)
    return `${sign}$${Math.floor(value).toLocaleString("it-IT")}`;
  const suffixes = [
      "m",
      "b",
      "t",
      "qa",
      "qi",
      "sx",
      "sp",
      "oc",
      "no",
      "dc",
      "ud",
      "dd",
      "td",
      "qd",
      "qid",
    ],
    group = Math.floor(Math.log10(value) / 3),
    suffix = suffixes[group - 2];
  if (!suffix) return `${sign}$${value.toExponential(2).replace(".", ",")}`;
  const compact = (value / Math.pow(1000, group)).toFixed(2).replace(".", ",");
  return `${sign}$${compact}${suffix}`;
}
function sync() {
  moneyEl.textContent = fmt(money);
  goalEl.textContent = fmt(goal);
  roundEl.textContent = round;
  timerEl.textContent = `${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(Math.floor(timeLeft % 60)).padStart(2, "0")}`;
  timerEl.style.color = timeLeft < 30 ? "#ef476f" : "#fff";
  const mini = $("#miniBalance");
  if (mini) mini.textContent = fmt(money);
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add("hidden"), 2200);
}
function changeMoney(n, outcome = null) {
  if (n > 0 && selectedAvatar === 1) n = Math.floor(n * 1.05);
  if (n > 0 && globalEvent?.name === "HAPPY HOUR") n = Math.floor(n * 1.25);
  if (currentRoom && socket?.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({ type: "money", delta: Math.floor(n), outcome }),
    );
    return;
  }
  money = Math.max(0, money + n);
  if (outcome === "win") teamCombo++;
  else if (outcome === "loss") teamCombo = 0;
  if (n > 0) {
    spawnMoneyFx(n);
    trackMission("win");
  }
  if (money >= goal) advanceLevel();
  sync();
  if (money <= 0) end("Hai perso tutto il tuo denaro. Il casinò vince.");
}
function betValue() {
  const el = $("#bet");
  const n = Math.floor(Number(el?.value));
  if (!n || n < 10 || n > money) {
    toast("Puntata non valida (minimo $10)");
    return null;
  }
  return n;
}

function drawFloor() {
  ctx.fillStyle = "#171029";
  ctx.fillRect(0, 0, 960, 540);
  for (let y = 0; y < 540; y += 32)
    for (let x = 0; x < 960; x += 32) {
      ctx.fillStyle = (x / 32 + y / 32) % 2 ? "#1d1435" : "#241742";
      ctx.fillRect(x, y, 32, 32);
      ctx.fillStyle = "#2e1d50";
      ctx.fillRect(x + 14, y + 14, 4, 4);
    }
  ctx.fillStyle = "#3f2252";
  ctx.fillRect(350, 55, 260, 430);
  ctx.fillStyle = "#6f3158";
  ctx.fillRect(366, 55, 228, 430);
  for (let y = 70; y < 480; y += 30) {
    ctx.fillStyle = "#e5ad4c";
    ctx.fillRect(478, y, 5, 5);
  }
  ctx.fillStyle = "#0a0812";
  ctx.fillRect(0, 0, 960, 55);
  ctx.fillStyle = "#33274d";
  ctx.fillRect(0, 51, 960, 4);
  if (round >= 2) {
    ctx.fillStyle = "#ffd166";
    for (let x = 25; x < 960; x += 75) ctx.fillRect(x, 58, 3, 425);
  }
  if (round >= 3) {
    for (let x = 40; x < 940; x += 90) {
      ctx.shadowColor = "#39e6d0";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#39e6d0";
      ctx.fillRect(x, 70, 6, 6);
    }
    ctx.shadowBlur = 0;
  }
  if (round >= 4) {
    ctx.strokeStyle = "#ffd16655";
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 65, 936, 425);
  }
  neon("NEON FORTUNE", 480, 34, "#ffd166", 18);
}
function neon(text, x, y, color, size = 12) {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = "center";
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}
function drawStation(s) {
  const cx = s.x + s.w / 2;
  ctx.fillStyle = "#080711";
  ctx.fillRect(s.x - 7, s.y + 8, s.w + 14, s.h + 15);
  ctx.fillStyle = s.color;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.fillStyle = "#171020";
  ctx.fillRect(s.x + 7, s.y + 7, s.w - 14, s.h - 28);
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = 3;
  ctx.strokeRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
  ctx.fillStyle = "#090711";
  ctx.fillRect(cx - 22, s.y + s.h - 18, 44, 18);
  if (s.id === "blackjack") {
    ctx.fillStyle = "#126e52";
    ctx.beginPath();
    ctx.ellipse(cx, s.y + 49, 50, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff8df";
    ctx.fillRect(cx - 22, s.y + 31, 19, 28);
    ctx.fillRect(cx + 6, s.y + 28, 19, 28);
  } else if (s.id === "roulette") {
    ctx.fillStyle = "#6e451f";
    ctx.beginPath();
    ctx.arc(cx, s.y + 46, 39, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#be3150";
    ctx.beginPath();
    ctx.arc(cx, s.y + 46, 29, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 5;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (s.id === "dice") {
    ctx.fillStyle = "#fff8df";
    ctx.fillRect(cx - 48, s.y + 24, 42, 42);
    ctx.fillRect(cx + 8, s.y + 32, 42, 42);
    ctx.fillStyle = "#23162e";
    [
      [cx - 37, s.y + 35],
      [cx - 17, s.y + 55],
      [cx + 19, s.y + 43],
      [cx + 39, s.y + 63],
      [cx + 39, s.y + 43],
      [cx + 19, s.y + 63],
    ].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (s.id === "horses") {
    ctx.fillStyle = "#b77b3e";
    ctx.fillRect(s.x + 15, s.y + 18, s.w - 30, 58);
    ctx.font = "24px serif";
    ctx.fillText("🏇", cx - 27, s.y + 50);
    ctx.fillText("🏇", cx + 22, s.y + 72);
  } else if (s.id === "slots") {
    ctx.fillStyle = "#d1aa47";
    ctx.fillRect(cx - 45, s.y + 15, 90, 68);
    ctx.fillStyle = "#fff7d4";
    ctx.fillRect(cx - 36, s.y + 27, 72, 36);
    ctx.fillStyle = "#281832";
    ctx.font = "bold 19px monospace";
    ctx.fillText("7 ◆ ★", cx, s.y + 52);
  } else if (s.id === "plinko") {
    ctx.fillStyle = "#173c47";
    ctx.fillRect(cx - 52, s.y + 14, 104, 72);
    ctx.fillStyle = "#ffd166";
    for (let r = 0; r < 5; r++)
      for (let i = 0; i <= r; i++) {
        ctx.beginPath();
        ctx.arc(cx + (i - r / 2) * 18, s.y + 25 + r * 12, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    ctx.fillStyle = "#ef476f";
    ctx.beginPath();
    ctx.arc(cx, s.y + 19, 6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(cx, s.y + 47, 39, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b24580";
    ctx.beginPath();
    ctx.arc(cx, s.y + 47, 31, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, s.y + 47);
      ctx.lineTo(
        cx + 31 * Math.cos((i * Math.PI) / 4),
        s.y + 47 + 31 * Math.sin((i * Math.PI) / 4),
      );
      ctx.stroke();
    }
  }
  neon(s.name, cx, s.y + 99, "#fff", 10);
}
function drawSkin(x, y, avatar, name, punch = false, fx = 1, fy = 0) {
  const suits = ["#39e6d0", "#8f6cff", "#b86b32", "#ef476f"],
    hats = ["#241337", "#ffd166", "#8b552e", "#39e6d0"],
    skin = ["#f1b58f", "#9a633f", "#d89b69", "#f1b58f"][avatar] || "#f1b58f";
  ctx.save();
  ctx.fillStyle = "#171020";
  ctx.fillRect(x - 12, y + 8, 24, 22);
  ctx.fillStyle = skin;
  ctx.fillRect(x - 9, y - 7, 18, 17);
  ctx.fillStyle = suits[avatar] || suits[0];
  ctx.fillRect(x - 12, y + 8, 24, 12);
  ctx.fillStyle = "#080712";
  ctx.fillRect(x - 8, y + 30, 7, 8);
  ctx.fillRect(x + 2, y + 30, 7, 8);
  ctx.fillStyle = hats[avatar] || hats[0];
  if (avatar === 0) {
    ctx.fillRect(x - 12, y - 12, 24, 5);
    ctx.fillRect(x - 7, y - 20, 14, 9);
  } else if (avatar === 1) {
    ctx.fillRect(x - 10, y - 13, 20, 5);
    ctx.fillRect(x - 9, y - 21, 5, 9);
    ctx.fillRect(x - 2, y - 24, 5, 12);
    ctx.fillRect(x + 5, y - 21, 5, 9);
  } else if (avatar === 2) {
    ctx.fillRect(x - 14, y - 13, 28, 5);
    ctx.fillRect(x - 9, y - 20, 18, 8);
  } else {
    ctx.fillStyle = "#ef476f";
    ctx.fillRect(x - 11, y - 14, 9, 7);
    ctx.fillStyle = "#39e6d0";
    ctx.fillRect(x + 2, y - 14, 9, 7);
    ctx.fillStyle = "#ef476f";
    ctx.fillRect(x - 4, y - 3, 8, 5);
  }
  ctx.fillStyle = skin;
  if (punch) {
    ctx.fillRect(x + fx * 17 - 5, y + 9 + fy * 17, 10, 9);
    ctx.fillRect(x + fx * 31 - 6, y + 8 + fy * 29, 15, 10);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + fx * 39 - 3, y + 10 + fy * 34, 6, 6);
  } else {
    ctx.fillRect(x - 16, y + 9, 5, 13);
    ctx.fillRect(x + 11, y + 9, 5, 13);
  }
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#080712";
  ctx.fillText(name, x + 1, y - 25);
  ctx.fillStyle = "#fff";
  ctx.fillText(name, x, y - 26);
  ctx.restore();
}
function drawEmote(x, y, e) {
  if (!e || e.until < performance.now()) return;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(x - 18, y - 65, 36, 28, 7);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.font = "20px serif";
  ctx.textAlign = "center";
  ctx.fillText(e.value, x, y - 44);
}
function drawPlayer() {
  drawSkin(
    player.x,
    player.y,
    selectedAvatar,
    myName,
    punchTime > 0,
    faceX,
    faceY,
  );
  drawEmote(player.x, player.y, localEmote);
}
function drawRemotePlayer(p) {
  drawSkin(
    p.x,
    p.y,
    p.avatar,
    p.name,
    (p.punchUntil || 0) > performance.now(),
    p.faceX || 1,
    p.faceY || 0,
  );
  drawEmote(p.x, p.y, p.emote);
}
function punch(strength = 0) {
  if (!playing || modalOpen || punchCooldown > 0) return;
  strength = Math.max(0, Math.min(1, strength));
  punchTime = 0.28 + strength * 0.18;
  punchCooldown = 0.48 + strength * 0.28;
  let closest = null,
    dist = 68 + strength * 20;
  remotePlayers.forEach((p) => {
    const d = Math.hypot(p.x - player.x, p.y - player.y),
      dot = (p.x - player.x) * faceX + (p.y - player.y) * faceY;
    if (d < dist && dot > 0) {
      closest = p;
      dist = d;
    }
  });
  if (closest && socket?.readyState === WebSocket.OPEN)
    socket.send(
      JSON.stringify({
        type: "punch",
        target: closest.id,
        dx: faceX,
        dy: faceY,
        strength,
      }),
    );
  let bot = null;
  dist = 67 + strength * 20;
  npcs.forEach((n) => {
    const d = Math.hypot(n.x - player.x, n.y - player.y),
      dot = (n.x - player.x) * faceX + (n.y - player.y) * faceY;
    if (d < dist && dot > 0) {
      bot = n;
      dist = d;
    }
  });
  if (bot) {
    const role = selectedAvatar === 3 ? 1.25 : 1,
      power = (320 + strength * 780) * role;
    bot.knockVX = faceX * power;
    bot.knockVY = faceY * power;
    bot.hit = 0.55 + strength * 0.35;
    impacts.push({ x: bot.x, y: bot.y, ttl: 0.45 });
    if (strength > 0.85) {
      $(".casino-wrap").classList.remove("shake");
      void $(".casino-wrap").offsetWidth;
      $(".casino-wrap").classList.add("shake");
    }
    if (Math.random() < 0.1) {
      pickup = {
        x: Math.max(35, Math.min(925, bot.x)),
        y: Math.max(85, Math.min(485, bot.y)),
        ttl: 18,
      };
      toast("Il bot ha lasciato cadere un oggetto misterioso!");
    }
  }
  if (bot || closest) trackMission("punch");
}
function updateKnockAnimations(now, dt) {
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  if (playerKnock) {
    const t = Math.min(
        1,
        (now - playerKnock.start) / (playerKnock.duration || 460),
      ),
      e = ease(t);
    player.x = playerKnock.x0 + (playerKnock.x1 - playerKnock.x0) * e;
    player.y = playerKnock.y0 + (playerKnock.y1 - playerKnock.y0) * e;
    if (t >= 1) playerKnock = null;
  }
  remotePlayers.forEach((p) => {
    if (!p.knock) return;
    const t = Math.min(1, (now - p.knock.start) / (p.knock.duration || 460)),
      e = ease(t);
    p.x = p.knock.x0 + (p.knock.x1 - p.knock.x0) * e;
    p.y = p.knock.y0 + (p.knock.y1 - p.knock.y0) * e;
    if (t >= 1) p.knock = null;
  });
  for (let i = impacts.length - 1; i >= 0; i--) {
    impacts[i].ttl -= dt;
    if (impacts[i].ttl <= 0) impacts.splice(i, 1);
  }
}
function updateRemoteInterpolation(dt) {
  const blend = 1 - Math.exp(-dt * 22);
  remotePlayers.forEach((p) => {
    if (p.knock) return;
    if (Number.isFinite(p.tx)) p.x += (p.tx - p.x) * blend;
    if (Number.isFinite(p.ty)) p.y += (p.ty - p.y) * blend;
  });
}
function drawImpacts() {
  impacts.forEach((v) => {
    const p = 1 - v.ttl / 0.45;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(v.x, v.y, 8 + p * 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${22 + p * 12}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("✦", v.x, v.y + 7);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.fillRect(
        v.x + Math.cos(a) * (14 + p * 28) - 2,
        v.y + Math.sin(a) * (14 + p * 28) - 2,
        5,
        5,
      );
    }
    ctx.restore();
  });
}
function updateMoneyFx(dt) {
  for (let i = moneyParticles.length - 1; i >= 0; i--) {
    const p = moneyParticles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 190 * dt;
    p.ttl -= dt;
    if (p.ttl <= 0) moneyParticles.splice(i, 1);
  }
}
function drawMoneyFx() {
  ctx.save();
  ctx.font = "bold 16px monospace";
  ctx.textAlign = "center";
  moneyParticles.forEach((p) => {
    ctx.globalAlpha = Math.min(1, p.ttl);
    ctx.fillStyle = p.text === "$" ? "#39e6d0" : "#ffd166";
    ctx.fillText(p.text, p.x, p.y);
  });
  ctx.restore();
}
function drawLuck() {
  if (!pickup) return;
  const pulse = 3 + Math.sin(performance.now() / 160) * 2;
  ctx.shadowColor = "#ffd166";
  ctx.shadowBlur = 14 + pulse;
  ctx.fillStyle = "#6f42a5";
  ctx.fillRect(pickup.x - 14, pickup.y - 14, 28, 28);
  ctx.fillStyle = "#241337";
  ctx.fillRect(pickup.x - 9, pickup.y - 9, 18, 18);
  ctx.fillStyle = "#ffd166";
  ctx.font = "bold 19px monospace";
  ctx.textAlign = "center";
  ctx.fillText("?", pickup.x, pickup.y + 7);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#080712dd";
  ctx.fillRect(pickup.x - 28, pickup.y + 18, 56, 17);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px monospace";
  ctx.fillText(`${Math.ceil(pickup.ttl)}s`, pickup.x, pickup.y + 30);
}
function drawPressure() {
  if (timeLeft > 60 || !playing) return;
  const p = 1 - timeLeft / 60,
    pulse = (Math.sin(performance.now() * (0.004 + p * 0.016)) + 1) / 2,
    alpha = p * (0.025 + pulse * 0.085);
  ctx.fillStyle = `rgba(220,10,35,${alpha})`;
  ctx.fillRect(0, 0, 960, 540);
  if (p > 0.55 && pulse > 0.86) {
    ctx.fillStyle = `rgba(255,30,30,${p * 0.035})`;
    ctx.fillRect(0, 0, 960, 540);
  }
}
function collectLuck() {
  trackMission("collect");
  const effects = [
      "luck",
      "luck",
      "curse",
      "cash",
      "cashloss",
      "time",
      "timeloss",
      "speed",
      "slow",
    ],
    type = effects[Math.floor(Math.random() * effects.length)];
  let msg = "";
  if (type === "luck") {
    luckBoost = 0.3 + Math.random() * 0.2;
    luckTime = 30 + Math.random() * 30;
    effectName = "FORTUNA";
    msg = `FORTUNA +${Math.round(luckBoost * 100)}% per ${Math.round(luckTime)}s`;
  } else if (type === "curse") {
    luckBoost = -(0.25 + Math.random() * 0.2);
    luckTime = 25 + Math.random() * 25;
    effectName = "SFORTUNA";
    msg = `SFORTUNA ${Math.round(luckBoost * 100)}% per ${Math.round(luckTime)}s`;
  } else if (type === "cash") {
    const scale = 1 + (round - 1) * 0.35,
      v = Math.floor((100 + Math.random() * 201) * scale);
    changeMoney(v);
    msg = `DONAZIONE LIVELLO ${round} +${fmt(v)}`;
  } else if (type === "cashloss") {
    const scale = 1 + (round - 1) * 0.35,
      raw = Math.floor((50 + Math.random() * 151) * scale),
      v = Math.max(0, Math.min(money - 1, raw));
    changeMoney(-v);
    msg = `RAZZIA LIVELLO ${round} -${fmt(v)}`;
  } else if (type === "time") {
    const v = 20 + Math.floor(Math.random() * 26);
    timeLeft += v;
    msg = `TEMPO EXTRA +${v}s`;
  } else if (type === "timeloss") {
    const v = 15 + Math.floor(Math.random() * 16);
    timeLeft = Math.max(1, timeLeft - v);
    msg = `TEMPO RUBATO -${v}s`;
  } else {
    moveModifier = type === "speed" ? 1.65 : 0.55;
    moveModifierTime = 20 + Math.random() * 21;
    effectName = type === "speed" ? "TURBO" : "LENTEZZA";
    msg = `${effectName} per ${Math.round(moveModifierTime)}s`;
  }
  pickup = null;
  spawnIn =
    globalEvent?.name === "PIOGGIA DI FICHES" ? 5 : 38 + Math.random() * 50;
  toast(`? ${msg}!`);
}
function lucky() {
  return (
    luckTime > 0 &&
    luckBoost > 0 &&
    Math.random() <
      Math.min(0.95, luckBoost + (selectedAvatar === 0 ? 0.05 : 0))
  );
}
function unlucky() {
  return luckTime > 0 && luckBoost < 0 && Math.random() < -luckBoost;
}
function luckyCard(hand, dk) {
  const current = handValue(hand);
  if (unlucky()) {
    const bad = dk
      .map((c, i) => ({ c, i, v: handValue([...hand, c]) }))
      .filter((x) => x.v > 21);
    if (bad.length) {
      const chosen = bad[Math.floor(Math.random() * bad.length)];
      dk.splice(chosen.i, 1);
      return chosen.c;
    }
  }
  if (!lucky()) return dk.pop();
  const choices = dk
    .map((c, i) => ({ c, i, v: handValue([...hand, c]) }))
    .filter((x) => x.v <= 21 && x.v >= Math.max(17, current));
  if (!choices.length) return dk.pop();
  const chosen = choices[Math.floor(Math.random() * choices.length)];
  dk.splice(chosen.i, 1);
  return chosen.c;
}
function isNearStation(s) {
  return (
    player.x > s.x - 30 &&
    player.x < s.x + s.w + 30 &&
    player.y > s.y - 45 &&
    player.y < s.y + s.h + 45
  );
}
function nearby() {
  return stations.find(isNearStation);
}
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  updateKnockAnimations(now, dt);
  updateRemoteInterpolation(dt);
  updateMoneyFx(dt);
  if (globalEvent) {
    const left = Math.max(
      0,
      Math.ceil((globalEvent.endsAt - Date.now()) / 1000),
    );
    $("#eventTime").textContent = `${left}s`;
    if (globalEvent.name === "PIOGGIA DI FICHES" && !pickup)
      spawnIn = Math.min(spawnIn, 5);
  }
  if (playing) {
    updateNpcs(dt * (globalEvent?.name === "MODALITÀ CAOS" ? 1.8 : 1));
    punchTime = Math.max(0, punchTime - dt);
    punchCooldown = Math.max(0, punchCooldown - dt);
    if (chargingPunch) {
      punchCharge = Math.min(1.5, punchCharge + dt);
      $("#chargeFill").style.width = `${(punchCharge / 1.5) * 100}%`;
    }
    if (luckTime > 0) luckTime = Math.max(0, luckTime - dt);
    if (moveModifierTime > 0) {
      moveModifierTime = Math.max(0, moveModifierTime - dt);
      if (!moveModifierTime) moveModifier = 1;
    }
    if (!pickup) {
      spawnIn -= dt;
      if (spawnIn <= 0)
        pickup = {
          x: 370 + Math.random() * 220,
          y: 100 + Math.random() * 350,
          ttl: 18,
        };
    } else {
      pickup.ttl -= dt;
      if (pickup.ttl <= 0) {
        pickup = null;
        spawnIn = 25 + Math.random() * 35;
      }
    }
    const activeTime = Math.max(luckTime, moveModifierTime),
      lh = $("#luckHud");
    lh.classList.toggle("hidden", activeTime <= 0);
    if (activeTime > 0) {
      $("#effectLabel").textContent = effectName;
      $("#luckValue").textContent =
        luckTime > 0
          ? `${luckBoost > 0 ? "+" : ""}${Math.round(luckBoost * 100)}%`
          : moveModifier > 1
            ? "VELOCE"
            : "LENTO";
      $("#luckTimer").textContent = `${Math.ceil(activeTime)}s`;
    }
    updateMiniEffect();
  }
  if (playing && !modalOpen) {
    let dx =
        (keys.ArrowRight || keys.d ? 1 : 0) -
        (keys.ArrowLeft || keys.a ? 1 : 0),
      dy =
        (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    if (dx || dy) {
      faceX = dx / len;
      faceY = dy / len;
    }
    const roleSpeed = selectedAvatar === 2 ? 1.15 : 1;
    player.x = Math.max(
      20,
      Math.min(
        940,
        player.x + (dx / len) * player.speed * moveModifier * roleSpeed * dt,
      ),
    );
    player.y = Math.max(
      75,
      Math.min(
        495,
        player.y + (dy / len) * player.speed * moveModifier * roleSpeed * dt,
      ),
    );
    const movedSinceSend = Math.hypot(
      player.x - lastSentX,
      player.y - lastSentY,
    );
    if (
      movedSinceSend > 0.35 &&
      now - lastNetworkSend > 50 &&
      socket?.readyState === WebSocket.OPEN
    ) {
      socket.send(
        JSON.stringify({
          type: "move",
          x: Math.round(player.x * 10) / 10,
          y: Math.round(player.y * 10) / 10,
          fx: Math.round(faceX * 100) / 100,
          fy: Math.round(faceY * 100) / 100,
        }),
      );
      lastNetworkSend = now;
      lastSentX = player.x;
      lastSentY = player.y;
    }
    if (pickup && Math.hypot(player.x - pickup.x, player.y - pickup.y) < 30)
      collectLuck();
    timeLeft -= dt;
    if (timeLeft <= 0) checkGoal();
    sync();
  }
  drawFloor();
  stations.forEach(drawStation);
  npcs
    .slice()
    .sort((a, b) => a.y - b.y)
    .forEach(drawNpc);
  remotePlayers.forEach(drawRemotePlayer);
  drawLuck();
  drawPlayer();
  drawImpacts();
  drawMoneyFx();
  if (globalEvent?.name === "BLACKOUT") {
    ctx.globalCompositeOperation = "source-over";
    const darkness = ctx.createRadialGradient(
      player.x,
      player.y,
      8,
      player.x,
      player.y,
      58,
    );
    darkness.addColorStop(0, "rgba(0,0,0,0.12)");
    darkness.addColorStop(0.45, "rgba(0,0,0,0.45)");
    darkness.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = darkness;
    ctx.fillRect(0, 0, 960, 540);
    // Keep the local player and name readable inside the small light radius.
    drawPlayer();
  } else drawPressure();
  $("#prompt").classList.toggle(
    "hidden",
    !nearby() || modalOpen || globalEvent?.name === "BLACKOUT",
  );
  requestAnimationFrame(safeLoop);
}
function safeLoop(now) {
  try {
    loop(now);
  } catch (error) {
    console.error("Frame recovered:", error);
    last = now;
    requestAnimationFrame(safeLoop);
  }
}
function advanceLevel() {
  let passed = 0;
  while (money >= goal) {
    const growth = 1.38 + (round - 1) * 0.05;
    goal = Math.ceil((goal * growth) / 50) * 50;
    round++;
    passed++;
    if (!Number.isFinite(goal)) break;
  }
  if (passed) {
    timeLeft = 300;
    toast(`Livello ${round}! Nuovo obiettivo: ${fmt(goal)}`);
    sync();
  }
}
function checkGoal() {
  if (money >= goal) advanceLevel();
  else end(`Tempo scaduto: servivano ${fmt(goal)}, hai ${fmt(money)}.`);
}
function end(reason) {
  playing = false;
  closeGame();
  $("#end-reason").textContent = reason;
  $("#end-screen").classList.remove("hidden");
}

addEventListener("keydown", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[key] = true;
  if (e.code === "Space" && !e.repeat && !modalOpen && punchCooldown <= 0) {
    e.preventDefault();
    chargingPunch = true;
    punchCharge = 0;
    $("#chargeMeter").classList.remove("hidden");
  }
  if (/^[1-5]$/.test(e.key) && socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ type: "emote", emote: +e.key - 1 }));
  if ((e.key === "e" || e.key === "E") && nearby() && !modalOpen)
    openGame(nearby().id);
});
addEventListener("keyup", (e) => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys[key] = false;
  if (e.code === "Space" && chargingPunch) {
    chargingPunch = false;
    $("#chargeMeter").classList.add("hidden");
    punch(punchCharge / 1.5);
    punchCharge = 0;
    $("#chargeFill").style.width = "0%";
  }
});
canvas.addEventListener("click", (e) => {
  const r = canvas.getBoundingClientRect(),
    x = ((e.clientX - r.left) * 960) / r.width,
    y = ((e.clientY - r.top) * 540) / r.height;
  const s = stations.find(
    (s) => x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h,
  );
  if (s) {
    if (isNearStation(s)) openGame(s.id);
    else toast(`Avvicinati a ${s.name} per giocare`);
  }
});
$("#close").onclick = closeGame;
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeGame();
});
function closeGame() {
  modalOpen = false;
  $("#modal").classList.add("hidden");
}
function openGame(id) {
  if (!playing) return;
  modalOpen = true;
  $("#modal").classList.remove("hidden");
  ({ blackjack, roulette, horses, slots, fortune, dice, plinko })[id]();
}
function base(title, sub, body) {
  const activeEffect = effectSummary();
  $("#game-content").innerHTML =
    `<div class="mini-balance"><span>SALDO DISPONIBILE</span><strong id="miniBalance">${fmt(money)}</strong></div><div id="miniEffect" class="mini-effect ${activeEffect ? "" : "hidden"}"><span>EFFETTI ATTIVI</span><strong>${activeEffect}</strong></div><h2 class="game-title">${title}</h2><p class="subtitle">${sub}</p>${body}`;
}
function effectSummary() {
  const effects = [];
  if (luckTime > 0)
    effects.push(
      `${effectName} ${luckBoost > 0 ? "+" : ""}${Math.round(luckBoost * 100)}% · ${Math.ceil(luckTime)}s`,
    );
  if (moveModifierTime > 0)
    effects.push(
      `${moveModifier > 1 ? "TURBO" : "LENTEZZA"} · ${Math.ceil(moveModifierTime)}s`,
    );
  if (globalEvent) {
    const seconds = Math.max(0, Math.ceil((globalEvent.endsAt - Date.now()) / 1000));
    effects.push(`${globalEvent.name} · ${seconds}s`);
  }
  return effects.join(" | ");
}
function updateMiniEffect() {
  const badge = $("#miniEffect");
  if (!badge) return;
  const summary = effectSummary();
  badge.classList.toggle("hidden", !summary);
  if (summary) badge.querySelector("strong").textContent = summary;
}
function cardHTML(c) {
  if (c === "?") return '<div class="card back">◆</div>';
  return `<div class="card ${/[♥♦]/.test(c) ? "red" : ""}">${c}</div>`;
}
const suits = ["♠", "♥", "♦", "♣"],
  ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
function deck() {
  return suits
    .flatMap((s) =>
      ranks.map((r, i) => ({ r, s, v: Math.min(i + 1, 10), text: r + s })),
    )
    .sort(() => Math.random() - 0.5);
}
function handValue(h) {
  let n = h.reduce((a, c) => a + c.v, 0),
    aces = h.filter((c) => c.r === "A").length;
  while (aces-- && n + 10 <= 21) n += 10;
  return n;
}

function blackjack() {
  base(
    "BLACKJACK",
    "Arriva a 21 senza superarlo. Il blackjack paga 3:2.",
    `<div class="table"><div>DEALER <span id="dv"></span></div><div id="dealer" class="cards"></div><div>LA TUA MANO <span id="pv"></span></div><div id="playercards" class="cards"></div><p id="result" class="result">Scegli la puntata e gioca.</p></div><div class="actions"><input id="bet" class="bet-input" type="number" min="10" value="50"><button id="deal" class="action">GIOCA</button><button id="hit" class="action alt" disabled>CARTA</button><button id="double" class="action" disabled>RADDOPPIA</button><button id="stand" class="action redbtn" disabled>STAI</button></div>`,
  );
  let d,
    h,
    b,
    active = false,
    dealerTurn = false,
    doubled = false;
  const root = $("#game-content"),
    q = (s) => root.querySelector(s);
  const render = (hide = true) => {
    if (!q("#dealer")) return;
    q("#dealer").innerHTML = d
      .map((c, i) => cardHTML(hide && i === 1 ? "?" : c.text))
      .join("");
    q("#playercards").innerHTML = h.map((c) => cardHTML(c.text)).join("");
    q("#dv").textContent = hide ? "" : `· ${handValue(d)}`;
    q("#pv").textContent = `· ${handValue(h)}`;
  };
  const resolve = () => {
    if (!q("#result")) return;
    let pv = handValue(h),
      dv = handValue(d),
      win = pv <= 21 && (dv > 21 || pv > dv),
      push = pv === dv && pv <= 21;
    if (push) {
      changeMoney(b, "push");
      q("#result").textContent = "Pareggio: puntata restituita.";
    } else if (win) {
      let pay =
        !doubled && h.length === 2 && pv === 21 ? Math.floor(b * 2.5) : b * 2;
      changeMoney(pay, "win");
      q("#result").textContent = `Hai vinto ${fmt(pay - b)}!`;
    } else {
      changeMoney(0, "loss");
      q("#result").textContent = "Il banco vince.";
    }
    dealerTurn = false;
    q("#deal").disabled = false;
  };
  const dealerDraw = () => {
    if (!q("#dealer")) return;
    if (handValue(d) < 17) {
      d.push(dk.pop());
      render(false);
      q("#result").textContent = `Il banco pesca... totale ${handValue(d)}`;
      setTimeout(dealerDraw, 1000);
    } else resolve();
  };
  const finish = () => {
    if (dealerTurn) return;
    active = false;
    q("#hit").disabled = q("#double").disabled = q("#stand").disabled = true;
    if (handValue(h) > 21) {
      changeMoney(0, "loss");
      q("#result").textContent =
        "Hai sballato. Il banco vince senza scoprire le carte.";
      q("#deal").disabled = false;
      return;
    }
    dealerTurn = true;
    q("#result").textContent = "Il banco scopre la sua carta...";
    setTimeout(() => {
      if (!q("#dealer")) return;
      render(false);
      q("#result").textContent = `Banco: ${handValue(d)}.`;
      setTimeout(dealerDraw, 1000);
    }, 1000);
  };
  let dk;
  q("#deal").onclick = () => {
    b = betValue();
    if (!b) return;
    changeMoney(-b);
    dk = deck();
    h = [dk.pop()];
    h.push(luckyCard(h, dk));
    d = [dk.pop(), dk.pop()];
    active = true;
    doubled = false;
    render();
    q("#result").textContent = "Carta, raddoppia o stai?";
    q("#hit").disabled = q("#stand").disabled = false;
    q("#double").disabled = money < b;
    q("#deal").disabled = true;
    if (handValue(h) === 21) finish();
  };
  q("#hit").onclick = () => {
    if (!active) return;
    h.push(luckyCard(h, dk));
    q("#double").disabled = true;
    render();
    if (handValue(h) >= 21) finish();
  };
  q("#double").onclick = () => {
    if (!active || h.length !== 2 || money < b) return;
    changeMoney(-b);
    b *= 2;
    doubled = true;
    h.push(luckyCard(h, dk));
    render();
    q("#result").textContent =
      `Puntata raddoppiata a ${fmt(b)}. Una sola carta.`;
    finish();
  };
  q("#stand").onclick = finish;
}

function roulette() {
  const reds = [
      1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
    ],
    wheelOrder = [
      0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
      24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
    ];
  base(
    "ROULETTE EUROPEA",
    "Scegli una fiche, piazzala sul tabellone e gira.",
    `<div class="roulette-layout"><div class="full-wheel"><div class="wheel-pockets">${wheelOrder.map((n, i) => `<span data-pocket="${n}" class="${n === 0 ? "green-pocket" : reds.includes(n) ? "red-pocket" : "black-pocket"}" style="--a:${(i * 360) / 37}deg">${n}</span>`).join("")}</div><div id="ball" class="roulette-ball"></div><div id="wheelNum">◆</div></div><div><div id="rouletteBoard" class="roulette-board"><button class="zero" data-bet="n0">0</button>${Array.from(
      { length: 36 },
      (_, i) => {
        const n = i + 1;
        return `<button class="${reds.includes(n) ? "rednum" : "blacknum"}" data-bet="n${n}">${n}</button>`;
      },
    ).join(
      "",
    )}<button class="outside rednum" data-bet="rosso">ROSSO</button><button class="outside blacknum" data-bet="nero">NERO</button><button class="outside" data-bet="pari">PARI</button><button class="outside" data-bet="dispari">DISPARI</button></div><div class="chip-row">${[10, 25, 50, 100, 250].map((v, i) => `<button class="chip ${i === 0 ? "selected" : ""}" data-chip="${v}">$${v}</button>`).join("")}</div></div></div><p id="result" class="result">Fiches piazzate: $0</p><div id="placed" class="placed-bets"></div><div class="actions"><button id="clearBets" class="action alt">RITIRA FICHES</button><button id="spinRoulette" class="action">GIRA</button></div>`,
  );
  let chip = 10,
    bets = {},
    total = 0,
    spinning = false;
  const labels = (k) => (k[0] === "n" ? k.slice(1) : k.toUpperCase());
  const refresh = () => {
    $("#placed").textContent = Object.entries(bets)
      .map(([k, v]) => `${labels(k)}: $${v}`)
      .join(" · ");
    $("#result").textContent = `Fiches piazzate: ${fmt(total)}`;
    document.querySelectorAll("#rouletteBoard button").forEach((x) => {
      const v = bets[x.dataset.bet] || 0;
      x.dataset.amount = v ? `$${v}` : "";
    });
  };
  document.querySelectorAll(".chip").forEach(
    (x) =>
      (x.onclick = () => {
        chip = +x.dataset.chip;
        document
          .querySelectorAll(".chip")
          .forEach((c) => c.classList.toggle("selected", c === x));
      }),
  );
  document.querySelectorAll("#rouletteBoard button").forEach(
    (x) =>
      (x.onclick = () => {
        if (spinning) return;
        if (money - total < chip)
          return toast("Saldo insufficiente per questa fiche");
        bets[x.dataset.bet] = (bets[x.dataset.bet] || 0) + chip;
        total += chip;
        refresh();
      }),
  );
  $("#clearBets").onclick = () => {
    if (spinning) return;
    bets = {};
    total = 0;
    refresh();
  };
  $("#spinRoulette").onclick = () => {
    if (spinning || !total) return toast("Piazza almeno una fiche");
    spinning = true;
    changeMoney(-total);
    let n = Math.floor(Math.random() * 37);
    if (lucky()) {
      const k =
        Object.keys(bets)[Math.floor(Math.random() * Object.keys(bets).length)];
      if (k[0] === "n") n = +k.slice(1);
      else {
        const pool = Array.from({ length: 37 }, (_, i) => i).filter((v) =>
          k === "rosso"
            ? reds.includes(v)
            : k === "nero"
              ? v > 0 && !reds.includes(v)
              : k === "pari"
                ? v > 0 && v % 2 === 0
                : v % 2 === 1,
        );
        n = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    const isRed = reds.includes(n),
      color = n === 0 ? "verde" : isRed ? "rosso" : "nero",
      wheel = $(".wheel-pockets"),
      ball = $("#ball"),
      landing = (wheelOrder.indexOf(n) * 360) / 37;
    document
      .querySelectorAll(".wheel-pockets span")
      .forEach((x) => x.classList.remove("winning-pocket"));
    ball.style.setProperty("--land", `${landing}deg`);
    wheel.classList.add("wheel-spinning");
    ball.classList.add("ball-spinning");
    $("#result").textContent = "Rien ne va plus!";
    document
      .querySelectorAll(".roulette-layout button,.actions button")
      .forEach((x) => (x.disabled = true));
    setTimeout(() => {
      wheel.classList.remove("wheel-spinning");
      ball.classList.remove("ball-spinning");
      ball.style.transform = `rotate(${landing}deg) translateY(-68px)`;
      document
        .querySelector(`[data-pocket="${n}"]`)
        .classList.add("winning-pocket");
      $("#wheelNum").textContent = n;
      let pay = 0;
      Object.entries(bets).forEach(([k, v]) => {
        if (k === `n${n}`) pay += v * 36;
        else if (k === color) pay += v * 2;
        else if (k === "pari" && n > 0 && n % 2 === 0) pay += v * 2;
        else if (k === "dispari" && n % 2 === 1) pay += v * 2;
      });
      changeMoney(pay, pay > total ? "win" : pay < total ? "loss" : "push");
      bets = {};
      total = 0;
      refresh();
      $("#result").textContent =
        `${n} ${color.toUpperCase()} — ${pay ? `pagamento ${fmt(pay)}` : "nessuna vincita"}`;
      document
        .querySelectorAll(".roulette-layout button,.actions button")
        .forEach((x) => (x.disabled = false));
      spinning = false;
    }, 3200);
  };
}

function slots() {
  base(
    "SLOT MACHINE",
    "I tre rulli girano e si fermano uno alla volta.",
    `<div class="table"><div class="slot-reels"><div class="reel">★</div><div class="reel">7</div><div class="reel">◆</div></div><p id="result" class="result">Tenta la fortuna!</p><div class="payout">7 7 7 = 12x · ★ ★ ★ = 8x · altri tris = 5x</div></div><div class="actions"><input id="bet" class="bet-input" type="number" min="10" value="50"><button id="spin" class="action">GIRA</button></div>`,
  );
  const syms = ["🍒", "◆", "★", "7"],
    btn = $("#spin");
  btn.onclick = () => {
    const b = betValue();
    if (!b || btn.disabled) return;
    changeMoney(-b);
    btn.disabled = true;
    $("#result").textContent = "I rulli stanno girando...";
    const result = [0, 0, 0].map(
        () => syms[Math.floor(Math.random() * syms.length)],
      ),
      reels = [...document.querySelectorAll(".reel")];
    if (lucky()) {
      const win = syms[Math.floor(Math.random() * syms.length)];
      result.fill(win);
    } else if (unlucky()) {
      result[0] = syms[0];
      result[1] = syms[1];
      result[2] = syms[2];
    }
    reels.forEach((reel, i) => {
      reel.classList.add("reel-spinning");
      const ticker = setInterval(
        () =>
          (reel.textContent = syms[Math.floor(Math.random() * syms.length)]),
        70,
      );
      setTimeout(
        () => {
          clearInterval(ticker);
          reel.textContent = result[i];
          reel.classList.remove("reel-spinning");
          if (i === 2) {
            const counts = Math.max(
                ...syms.map((s) => result.filter((x) => x === s).length),
              ),
              mult =
                counts === 3
                  ? result[0] === "7"
                    ? 12
                    : result[0] === "★"
                      ? 8
                      : 5
                  : counts === 2
                    ? 2
                    : 0;
            changeMoney(mult ? b * mult : 0, mult > 1 ? "win" : "loss");
            $("#result").textContent = mult
              ? `Vittoria! ${mult}x — guadagni ${fmt(b * (mult - 1))}.`
              : "Nessuna combinazione.";
            btn.disabled = false;
          }
        },
        900 + i * 650,
      );
    });
  };
}

function fortune() {
  const prizes = [
      0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.2, 1.2, 1.2,
      2, 2, 5, 15, 150,
    ].sort(() => Math.random() - 0.5),
    short = (p) => (p === 150 ? "J" : String(p)),
    full = (p) => (p === 150 ? "JACKPOT 150×" : `${p}×`),
    step = 18,
    pos = (i) => {
      const a = (i * step * Math.PI) / 180,
        r = 124;
      return `--label-angle:${i * step}deg;left:${143 + Math.sin(a) * r}px;top:${153 - Math.cos(a) * r}px`;
    };
  base(
    "RUOTA DELLA FORTUNA",
    "40% favorevole al giocatore · 60% favorevole al banco.",
    `<div class="table"><div class="fortune-wheel-wrap"><div id="fortuneDisc" class="fortune-disc">${prizes.map((p, i) => `<span data-wheel-index="${i}" style="${pos(i)}">${short(p)}</span>`).join("")}<div class="fortune-center">×</div></div></div><p id="result" class="result">12 spicchi banco · 8 spicchi giocatore · J = Jackpot.</p></div><div class="actions"><input id="bet" class="bet-input" type="number" min="10" value="100"><button id="fortuneSpin" class="action">GIRA</button></div>`,
  );
  let rotation = 0;
  $("#fortuneSpin").onclick = () => {
    const btn = $("#fortuneSpin"),
      b = betValue();
    if (!b || btn.disabled) return;
    changeMoney(-b);
    btn.disabled = true;
    document
      .querySelectorAll("[data-wheel-index]")
      .forEach((x) => x.classList.remove("wheel-winner"));
    let index = Math.floor(Math.random() * prizes.length);
    if (lucky()) {
      const good = prizes.map((p, i) => (p > 1 ? i : -1)).filter((i) => i >= 0);
      index = good[Math.floor(Math.random() * good.length)];
    }
    if (unlucky()) {
      const low = prizes.map((p, i) => (p < 1 ? i : -1)).filter((i) => i >= 0);
      index = low[Math.floor(Math.random() * low.length)];
    }
    const prize = prizes[index],
      disc = $("#fortuneDisc"),
      nextFullTurn = Math.floor(rotation / 360) + 6;
    rotation = nextFullTurn * 360 - index * step;
    disc.style.transform = `rotate(${rotation}deg)`;
    document.querySelectorAll("[data-wheel-index]").forEach((label) => {
      label.style.setProperty("--counter-rotation", `${-rotation}deg`);
    });
    $("#result").textContent = "La ruota sta girando...";
    setTimeout(() => {
      const pay = Math.max(1, Math.floor(b * prize));
      changeMoney(pay, pay > b ? "win" : pay < b ? "loss" : "push");
      document
        .querySelector(`[data-wheel-index="${index}"]`)
        .classList.add("wheel-winner");
      $("#result").textContent =
        `Estratto ${full(prize)} · puntata ${fmt(b)} · restituzione ${fmt(pay)}.`;
      btn.disabled = false;
    }, 4200);
  };
}

function dice() {
  base(
    "TAVOLO DEI DADI",
    "Punta sulla somma di due dadi: basso, sette oppure alto.",
    `<div class="table dice-table"><div class="dice-pair"><div id="die1" class="pixel-die">⚀</div><div id="die2" class="pixel-die">⚀</div></div><p id="result" class="result">Scegli un risultato e lancia.</p><div class="payout">BASSO 2–6 paga 2× · SETTE paga 5× · ALTO 8–12 paga 2×</div></div><div class="actions"><input id="bet" class="bet-input" type="number" min="10" value="50"><button class="action dice-pick" data-dice="low">BASSO</button><button class="action dice-pick" data-dice="seven">SETTE</button><button class="action dice-pick" data-dice="high">ALTO</button><button id="rollDice" class="action redbtn" disabled>LANCIA</button></div>`,
  );
  let pick = null,
    rolling = false;
  const faces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"],
    wins = (sum, p) =>
      p === "low" ? sum <= 6 : p === "seven" ? sum === 7 : sum >= 8;
  document.querySelectorAll(".dice-pick").forEach(
    (x) =>
      (x.onclick = () => {
        if (rolling) return;
        pick = x.dataset.dice;
        document
          .querySelectorAll(".dice-pick")
          .forEach((y) => y.classList.toggle("selected", y === x));
        $("#rollDice").disabled = false;
      }),
  );
  $("#rollDice").onclick = () => {
    const b = betValue();
    if (!b || !pick || rolling) return;
    rolling = true;
    changeMoney(-b);
    document
      .querySelectorAll(".dice-pick,#rollDice")
      .forEach((x) => (x.disabled = true));
    let a = 1 + Math.floor(Math.random() * 6),
      d = 1 + Math.floor(Math.random() * 6);
    if (lucky()) {
      for (let i = 0; i < 50 && !wins(a + d, pick); i++) {
        a = 1 + Math.floor(Math.random() * 6);
        d = 1 + Math.floor(Math.random() * 6);
      }
    } else if (unlucky()) {
      for (let i = 0; i < 50 && wins(a + d, pick); i++) {
        a = 1 + Math.floor(Math.random() * 6);
        d = 1 + Math.floor(Math.random() * 6);
      }
    }
    const timer = setInterval(() => {
      $("#die1").textContent = faces[Math.floor(Math.random() * 6)];
      $("#die2").textContent = faces[Math.floor(Math.random() * 6)];
    }, 75);
    setTimeout(() => {
      clearInterval(timer);
      $("#die1").textContent = faces[a - 1];
      $("#die2").textContent = faces[d - 1];
      const sum = a + d,
        win = wins(sum, pick),
        mult = pick === "seven" ? 5 : 2;
      changeMoney(win ? b * mult : 0, win ? "win" : "loss");
      $("#result").textContent =
        `${a} + ${d} = ${sum} — ${win ? `vinci ${fmt(b * mult)}` : "il banco vince"}.`;
      rolling = false;
      document
        .querySelectorAll(".dice-pick")
        .forEach((x) => (x.disabled = false));
      $("#rollDice").disabled = false;
    }, 1700);
  };
}

function plinko() {
  const levels = {
    easy: {
      name: "FACILE",
      mults: [2.5, 1.8, 1.4, 0.9, 0.78, 0.9, 1.4, 1.8, 2.5],
    },
    medium: {
      name: "MEDIO",
      mults: [8, 3.2, 1.3, 0.8, 0.3, 0.8, 1.3, 3.2, 8],
    },
    hard: {
      name: "DIFFICILE",
      mults: [30, 9, 0.9, 0.4, 0.2, 0.4, 0.9, 9, 30],
    },
  };
  base(
    "PLINKO",
    "Ogni clic lancia una nuova pallina. Più rischio significa premi maggiori e centro peggiore.",
    `<div class="table plinko-table"><canvas id="plinkoCanvas" class="plinko-canvas" width="520" height="285"></canvas><p id="result" class="result">FACILE · clicca più volte per lanciare più palline.</p></div><div class="actions"><button class="action risk-pick selected" data-risk="easy">FACILE</button><button class="action risk-pick" data-risk="medium">MEDIO</button><button class="action risk-pick redbtn" data-risk="hard">DIFFICILE</button><input id="bet" class="bet-input" type="number" min="10" value="50"><button id="dropBall" class="action">LANCIA PALLINA</button></div>`,
  );
  const c = $("#plinkoCanvas"),
    g = c.getContext("2d"),
    btn = $("#dropBall"),
    resultEl = $("#result"),
    balls = [];
  let risk = "easy",
    rafId = null,
    localAvailable = money,
    lastLaunch = 0;
  const draw = () => {
    if (!c.isConnected) return;
    const mults = levels[risk].mults;
    g.fillStyle = "#082b30";
    g.fillRect(0, 0, 520, 285);
    for (let r = 0; r < 8; r++)
      for (let i = 0; i <= r; i++) {
        const x = 260 + (i - r / 2) * 48,
          y = 28 + r * 28;
        g.fillStyle = "#ffd166";
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
      }
    mults.forEach((m, i) => {
      g.fillStyle = m >= 2 ? "#ef476f" : m < 1 ? "#382b59" : "#287b83";
      g.fillRect(42 + i * 48, 252, 45, 29);
      g.fillStyle = "#fff";
      g.font = "bold 11px monospace";
      g.textAlign = "center";
      g.fillText(`${m}×`, 64 + i * 48, 271);
    });
    balls.forEach((ball) => {
      g.shadowColor = ball.color;
      g.shadowBlur = 12;
      g.fillStyle = ball.color;
      g.beginPath();
      g.arc(ball.x, ball.y, 8, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    });
  };
  const animate = (now) => {
    rafId = null;
    for (let n = balls.length - 1; n >= 0; n--) {
      const ball = balls[n],
        t = Math.min(1, (now - ball.start) / ball.duration),
        scaled = t * (ball.points.length - 1),
        i = Math.min(ball.points.length - 2, Math.floor(scaled)),
        f = scaled - i,
        p0 = ball.points[i],
        p1 = ball.points[i + 1];
      ball.x = p0.x + (p1.x - p0.x) * f;
      ball.y = p0.y + (p1.y - p0.y) * f - Math.sin(f * Math.PI) * 8;
      if (t >= 1) {
        const pay = Math.floor(ball.bet * ball.mult);
        localAvailable += pay;
        changeMoney(
          pay,
          pay > ball.bet ? "win" : pay < ball.bet ? "loss" : "push",
        );
        if (resultEl.isConnected)
          resultEl.textContent =
            `${ball.level}: ${ball.mult}× · ${pay ? `restituzione ${fmt(pay)}` : "pallina persa"}.`;
        balls.splice(n, 1);
        pendingOutcomes = Math.max(0, pendingOutcomes - 1);
        if (pendingOutcomes === 0 && money <= 0 && !bankruptcyTimer) {
          bankruptcyTimer = setTimeout(() => {
            bankruptcyTimer = null;
            if (money <= 0 && pendingOutcomes === 0 && playing)
              end("Il budget condiviso è terminato. Il casinò vince.");
          }, 1500);
        }
      }
    }
    draw();
    if (balls.length) rafId = requestAnimationFrame(animate);
    else {
      if (c.isConnected)
        document
          .querySelectorAll(".risk-pick")
          .forEach((x) => (x.disabled = false));
    }
  };
  const ensureAnimation = () => {
    if (rafId === null && balls.length) rafId = requestAnimationFrame(animate);
  };
  const watchdog = setInterval(() => {
    if (balls.length && rafId === null) ensureAnimation();
    if (!c.isConnected && balls.length === 0) clearInterval(watchdog);
  }, 200);
  const beginLaunchCooldown = () => {
    lastLaunch = performance.now();
    btn.disabled = true;
    const cooldown = setInterval(() => {
      const remaining = Math.max(0, 500 - (performance.now() - lastLaunch));
      if (btn.isConnected)
        btn.textContent = remaining > 0 ? `ATTENDI ${(remaining / 1000).toFixed(1)}s` : "LANCIA PALLINA";
      if (remaining <= 0 || !btn.isConnected) {
        clearInterval(cooldown);
        if (btn.isConnected) btn.disabled = false;
      }
    }, 100);
  };
  document.querySelectorAll(".risk-pick").forEach(
    (x) =>
      (x.onclick = () => {
        if (balls.length) return toast("Attendi che le palline atterrino");
        risk = x.dataset.risk;
        document
          .querySelectorAll(".risk-pick")
          .forEach((y) => y.classList.toggle("selected", y === x));
        resultEl.textContent = `${levels[risk].name}: moltiplicatori aggiornati.`;
        draw();
      }),
  );
  btn.onclick = () => {
    const requested = Math.floor(Number($("#bet").value));
    localAvailable = Math.min(localAvailable, money);
    if (!requested || requested < 10)
      return toast("Puntata non valida (minimo $10)");
    if (requested > localAvailable)
      return toast(`Saldo insufficiente: disponibili ${fmt(localAvailable)}`);
    const b = requested;
    if (performance.now() - lastLaunch < 500)
      return toast("Puoi lanciare una pallina ogni mezzo secondo");
    if (balls.length >= 10)
      return toast("Massimo 10 palline contemporaneamente");
    localAvailable -= b;
    pendingOutcomes++;
    beginLaunchCooldown();
    changeMoney(-b);
    document.querySelectorAll(".risk-pick").forEach((x) => (x.disabled = true));
    let dirs = Array.from({ length: 8 }, () => (Math.random() < 0.5 ? -1 : 1));
    if (lucky()) {
      const side = Math.random() < 0.5 ? -1 : 1;
      dirs = dirs.map(() => side);
    } else if (unlucky()) dirs = [-1, 1, -1, 1, -1, 1, -1, 1];
    const points = [{ x: 260, y: 8 }];
    let x = 260;
    dirs.forEach((dir, r) => {
      x += dir * 24;
      points.push({ x, y: 28 + r * 28 });
    });
    const index = dirs.filter((v) => v > 0).length,
      mult = levels[risk].mults[index],
      colors = ["#39e6d0", "#ffd166", "#ef476f", "#a778e8"];
    balls.push({
      x: 260,
      y: 8,
      points,
      start: performance.now(),
      duration: 2600 + Math.random() * 700,
      index,
      mult,
      bet: b,
      level: levels[risk].name,
      color: colors[balls.length % colors.length],
    });
    resultEl.textContent =
      `${balls.length} pallin${balls.length === 1 ? "a" : "e"} in gioco...`;
    ensureAnimation();
  };
  draw();
}

function rankFive(h) {
  const vals = h
      .map((c) => (c.r === "A" ? 14 : ranks.indexOf(c.r) + 1))
      .sort((a, b) => b - a),
    groups = Object.entries(
      vals.reduce((o, n) => ((o[n] = (o[n] || 0) + 1), o), {}),
    )
      .map(([v, n]) => [n, +v])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]),
    flush = h.every((c) => c.s === h[0].s),
    uniq = [...new Set(vals)],
    straightHigh =
      uniq.length === 5 &&
      (uniq[0] - uniq[4] === 4
        ? uniq[0]
        : uniq.join() === "14,5,4,3,2"
          ? 5
          : 0);
  let score, name;
  if (flush && straightHigh) {
    score = [8, straightHigh];
    name = straightHigh === 14 ? "SCALA REALE" : "SCALA COLORE";
  } else if (groups[0][0] === 4) {
    score = [7, groups[0][1], groups[1][1]];
    name = "POKER";
  } else if (groups[0][0] === 3 && groups[1][0] === 2) {
    score = [6, groups[0][1], groups[1][1]];
    name = "FULL";
  } else if (flush) {
    score = [5, ...vals];
    name = "COLORE";
  } else if (straightHigh) {
    score = [4, straightHigh];
    name = "SCALA";
  } else if (groups[0][0] === 3) {
    score = [
      3,
      groups[0][1],
      ...groups
        .slice(1)
        .map((x) => x[1])
        .sort((a, b) => b - a),
    ];
    name = "TRIS";
  } else if (groups[0][0] === 2 && groups[1][0] === 2) {
    score = [
      2,
      Math.max(groups[0][1], groups[1][1]),
      Math.min(groups[0][1], groups[1][1]),
      groups[2][1],
    ];
    name = "DOPPIA COPPIA";
  } else if (groups[0][0] === 2) {
    score = [
      1,
      groups[0][1],
      ...groups
        .slice(1)
        .map((x) => x[1])
        .sort((a, b) => b - a),
    ];
    name = "COPPIA";
  } else {
    score = [0, ...vals];
    name = "CARTA ALTA";
  }
  return { score, name };
}
function bestHand(seven) {
  let best = null;
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 4; b++)
      for (let c = b + 1; c < 5; c++)
        for (let d = c + 1; d < 6; d++)
          for (let e = d + 1; e < 7; e++) {
            const r = rankFive([
              seven[a],
              seven[b],
              seven[c],
              seven[d],
              seven[e],
            ]);
            if (!best || compareScore(r.score, best.score) > 0) best = r;
          }
  return best;
}
function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}
function poker() {
  base(
    "TEXAS HOLD’EM",
    "Sfida il banco: la migliore mano di cinque carte vince.",
    `<div class="table"><div class="holdem-label">CARTE DEL BANCO</div><div id="dealerPoker" class="cards community"></div><div class="holdem-label">CARTE COMUNI</div><div id="community" class="cards community"></div><div class="holdem-label">LE TUE CARTE</div><div id="pokerCards" class="cards community"></div><p id="result" class="result">Scegli la puntata e gioca.</p></div><div class="actions"><input id="bet" class="bet-input" type="number" min="10" value="50"><button id="pdeal" class="action">GIOCA</button><button id="nextStreet" class="action alt" disabled>FLOP</button><button id="fold" class="action redbtn" disabled>PASSA</button></div>`,
  );
  let hero,
    dealer,
    common,
    dk,
    b,
    street = 0,
    active = false;
  const render = (reveal = false) => {
    $("#pokerCards").innerHTML = (hero || [])
      .map((c) => cardHTML(c.text))
      .join("");
    $("#dealerPoker").innerHTML = (dealer || [])
      .map((c) => cardHTML(reveal ? c.text : "?"))
      .join("");
    $("#community").innerHTML = (common || [])
      .map((c) => cardHTML(c.text))
      .join("");
  };
  const finish = () => {
    while (common.length < 5) common.push(dk.pop());
    render(true);
    const ph = bestHand([...hero, ...common]),
      dh = bestHand([...dealer, ...common]),
      cmp = compareScore(ph.score, dh.score);
    if (cmp > 0) {
      changeMoney(b * 2, "win");
      $("#result").textContent = `Hai vinto con ${ph.name}! Banco: ${dh.name}.`;
    } else if (cmp === 0) {
      changeMoney(b, "push");
      $("#result").textContent = `Pareggio: ${ph.name}. Puntata restituita.`;
    } else {
      changeMoney(0, "loss");
      $("#result").textContent =
        `Il banco vince con ${dh.name}. Tu: ${ph.name}.`;
    }
    active = false;
    $("#nextStreet").disabled = $("#fold").disabled = true;
    $("#pdeal").disabled = false;
  };
  $("#pdeal").onclick = () => {
    b = betValue();
    if (!b) return;
    changeMoney(-b);
    dk = deck();
    hero = [dk.pop(), dk.pop()];
    dealer = [dk.pop(), dk.pop()];
    common = [];
    street = 0;
    active = true;
    render();
    $("#result").textContent = "Le carte sono servite. Scopri il flop.";
    $("#pdeal").disabled = true;
    $("#nextStreet").disabled = $("#fold").disabled = false;
    $("#nextStreet").textContent = "FLOP";
  };
  $("#nextStreet").onclick = () => {
    if (!active) return;
    if (street === 0) {
      common.push(dk.pop(), dk.pop(), dk.pop());
      street = 1;
      $("#nextStreet").textContent = "TURN";
      $("#result").textContent = "Flop scoperto.";
    } else if (street === 1) {
      common.push(dk.pop());
      street = 2;
      $("#nextStreet").textContent = "RIVER";
      $("#result").textContent = "Turn scoperto.";
    } else if (street === 2) {
      common.push(dk.pop());
      street = 3;
      $("#nextStreet").textContent = "SHOWDOWN";
      $("#result").textContent = "River scoperto.";
    } else finish();
    render();
  };
  $("#fold").onclick = () => {
    if (!active) return;
    active = false;
    render(true);
    $("#result").textContent = "Hai passato. Il banco prende la puntata.";
    $("#nextStreet").disabled = $("#fold").disabled = true;
    $("#pdeal").disabled = false;
  };
}

function horses() {
  const colors = ["#ef476f", "#39e6d0", "#ffd166", "#a778e8"];
  base(
    "CORSA DEI CAVALLI",
    "Scegli il vincitore. La gara dura 10 secondi su un rettilineo.",
    `<div class="race-track">${colors.map((c, i) => `<div class="race-lane"><span class="horse-number" style="background:${c}">${i + 1}</span><span class="horse" id="horse${i}">🏇</span><span class="finish-line"></span></div>`).join("")}</div><p id="result" class="result">Scegli un cavallo e avvia la corsa.</p><div class="actions"><input id="bet" class="bet-input" type="number" min="10" value="50">${colors.map((c, i) => `<button class="action horse-pick" data-horse="${i}" style="background:${c}">#${i + 1}</button>`).join("")}<button id="race" class="action" disabled>CORRI</button></div>`,
  );
  let pick = null,
    running = false;
  document.querySelectorAll(".horse-pick").forEach(
    (x) =>
      (x.onclick = () => {
        if (running) return;
        pick = +x.dataset.horse;
        document
          .querySelectorAll(".horse-pick")
          .forEach(
            (y) => (y.style.outline = y === x ? "4px solid white" : "none"),
          );
        $("#race").disabled = false;
        $("#result").textContent = `Cavallo #${pick + 1} selezionato.`;
      }),
  );
  $("#race").onclick = () => {
    if (running || pick === null) return;
    const b = betValue();
    if (!b) return;
    running = true;
    changeMoney(-b);
    document
      .querySelectorAll(".horse-pick,#race")
      .forEach((x) => (x.disabled = true));
    const horses = [0, 1, 2, 3].map((i) => ({
      i,
      pos: 0,
      speed: 0.75 + Math.random() * 0.35,
      el: $(`#horse${i}`),
    }));
    if (lucky()) horses[pick].speed = 1.5;
    else if (unlucky()) horses[pick].speed = 0.35;
    const maxSpeed = Math.max(...horses.map((h) => h.speed)),
      start = performance.now(),
      duration = 10000;
    horses.forEach((h) => (h.target = 0.78 + (0.2 * h.speed) / maxSpeed));
    $("#result").textContent = "Partiti! 10.0 secondi...";
    const tick = (now) => {
      const elapsed = now - start,
        t = Math.min(elapsed / duration, 1);
      horses.forEach((h) => {
        const surge =
          h.target * t +
          0.018 * Math.sin(t * Math.PI * 6 + h.i) * Math.sin(t * Math.PI);
        h.pos = Math.max(h.pos, Math.min(0.98, surge));
        h.el.style.left = `calc(${h.pos * 100}% - 34px)`;
      });
      $("#result").textContent =
        `Gara in corso: ${Math.max(0, (duration - elapsed) / 1000).toFixed(1)} secondi`;
      if (t < 1) return requestAnimationFrame(tick);
      horses.sort((a, b) => b.pos - a.pos);
      const winner = horses[0].i;
      if (winner === pick) {
        changeMoney(b * 4, "win");
        $("#result").textContent =
          `Vince il cavallo #${winner + 1}! Guadagni ${fmt(b * 3)}.`;
      } else {
        changeMoney(0, "loss");
        $("#result").textContent =
          `Vince il cavallo #${winner + 1}. La tua puntata è persa.`;
      }
      running = false;
      document
        .querySelectorAll(".horse-pick")
        .forEach((x) => (x.disabled = false));
      $("#race").disabled = false;
    };
    requestAnimationFrame(tick);
  };
}

$("#restart").onclick = () => {
  money = 1000;
  goal = 1300;
  round = 1;
  timeLeft = 300;
  luckBoost = 0;
  luckTime = 0;
  moveModifier = 1;
  moveModifierTime = 0;
  effectName = "";
  pickup = null;
  spawnIn = 12 + Math.random() * 18;
  playing = true;
  player.x = 480;
  player.y = 440;
  $("#end-screen").classList.add("hidden");
  sync();
};
sync();
requestAnimationFrame(safeLoop);
