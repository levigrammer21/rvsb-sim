// Red vs Blue Battle Sim (Stable Rewrite)
// - PokéAPI caching
// - Battle sim with secrets + AI switching
// - Team renaming
// - 6 Pokéball "alive" indicators
// - Sports announcer narrator (TTS)

const POKEAPI = "https://pokeapi.co/api/v2";
const $ = (id) => document.getElementById(id);

// -------- Crash-to-screen (so you never get silent failures again) --------
window.addEventListener("error", (e) => {
  try {
    const s = $("status");
    const msg = e?.error?.message || e?.message || "Unknown error";
    if (s) s.textContent = `❌ JS Error: ${msg}`;
  } catch {}
});

// -------- Local cache (localStorage) --------
function cacheGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
function cacheSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

async function cachedFetchJson(url, cacheKey, maxAgeMs = 1000*60*60*24*30) {
  const cached = cacheGet(cacheKey);
  if (cached && cached.t && (Date.now() - cached.t) < maxAgeMs) return cached.v;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  cacheSet(cacheKey, { t: Date.now(), v: json });
  return json;
}

// -------- Utils --------
function cap(s){ return s ? s[0].toUpperCase()+s.slice(1) : s; }
function normName(s){ return (s||"").trim().toLowerCase().replace(/\s+/g,"-"); }
function roll(pct){ return Math.random()*100 < pct; }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// -------- Sports Announcer Narrator (TTS) --------
let TTS_ENABLED = cacheGet("ttsEnabled") ?? false;
let ttsQueue = [];
let ttsSpeaking = false;

function updateTtsButton(){
  const btn = $("ttsBtn");
  if (!btn) return;
  btn.textContent = TTS_ENABLED ? "🔊 Announcer: ON" : "🔊 Announcer: OFF";
}

function speak(text){
  if (!TTS_ENABLED) return;
  if (!("speechSynthesis" in window)) return;

  // Keep it “announcer” style: speak only meaningful lines, not every tiny marker.
  const cleaned = (text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return;

  ttsQueue.push(cleaned);
  if (!ttsSpeaking) speakNext();
}

function speakNext(){
  if (ttsQueue.length === 0) { ttsSpeaking = false; return; }
  ttsSpeaking = true;

  const u = new SpeechSynthesisUtterance(ttsQueue.shift());
  u.rate = 1.05;
  u.pitch = 1.08;
  u.volume = 1.0;

  // Pick an English voice if available (best effort)
  const voices = speechSynthesis.getVoices?.() || [];
  const best = voices.find(v => /en-US/i.test(v.lang)) || voices.find(v => /en/i.test(v.lang));
  if (best) u.voice = best;

  u.onend = speakNext;
  u.onerror = speakNext;
  speechSynthesis.speak(u);
}

function stopSpeaking(){
  try { speechSynthesis.cancel(); } catch {}
  ttsQueue = [];
  ttsSpeaking = false;
}

// -------- Flavor text (battle log) --------
const FLAVOR = {
  turnStart: [
    "The crowd leans in — here we go!",
    "You can feel the momentum shifting!",
    "Both sides look locked in!",
    "The arena gets loud — this turn matters!",
    "Something big is coming…"
  ],
  attackLead: [
    "fires off",
    "launches",
    "swings with",
    "goes for",
    "rushes in with"
  ],
  miss: [
    "…and misses! The crowd groans!",
    "…and it whiffs! That was a big chance!",
    "…and it goes wide!",
    "…and the target slips it!",
    "…and that one doesn’t connect!"
  ],
  crit: [
    "BANG — right on the button!",
    "That’s a clean critical!",
    "OHHH it found the weak spot!",
    "That one HURT!",
    "Brutal precision!"
  ],
  super: [
    "That matchup is nasty!",
    "Super effective — HUGE damage!",
    "Perfect type advantage!",
    "That’s the pain button!",
    "It hits like a truck!"
  ],
  notVery: [
    "Not much doing there…",
    "That barely moved the needle…",
    "The defense holds up!",
    "Not very effective…",
    "That one gets shrugged off."
  ],
  immune: [
    "NO EFFECT! Stuffed at the line!",
    "Denied — completely immune!",
    "Nothing happens!",
    "Total immunity!",
    "That does zero!"
  ],
  faint: [
    "DOWN FOR THE COUNT!",
    "That’s a knockout!",
    "It can’t continue!",
    "Lights out!",
    "And it hits the turf!"
  ],
  sendOut: [
    "comes out fired up!",
    "hits the field ready!",
    "steps in with confidence!",
    "charges in!",
    "looks locked in!"
  ],
  switchOut: [
    "tags out to regroup!",
    "backs off for a better matchup!",
    "retreats to safety!",
    "calls for backup!",
    "makes the smart pivot!"
  ]
};

// -------- Type chart (Gen 6+ style effectiveness) --------
const TYPE_MULT = (() => {
  const types = ["normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];
  const m = {};
  for (const a of types) { m[a] = {}; for (const d of types) m[a][d] = 1; }

  const set = (atk, defs, val) => defs.forEach(d => m[atk][d] = val);

  set("normal", ["rock","steel"], 0.5); set("normal", ["ghost"], 0);
  set("fire", ["grass","ice","bug","steel"], 2); set("fire", ["fire","water","rock","dragon"], 0.5);
  set("water", ["fire","ground","rock"], 2); set("water", ["water","grass","dragon"], 0.5);
  set("electric", ["water","flying"], 2); set("electric", ["electric","grass","dragon"], 0.5); set("electric", ["ground"], 0);
  set("grass", ["water","ground","rock"], 2); set("grass", ["fire","grass","poison","flying","bug","dragon","steel"], 0.5);
  set("ice", ["grass","ground","flying","dragon"], 2); set("ice", ["fire","water","ice","steel"], 0.5);
  set("fighting", ["normal","ice","rock","dark","steel"], 2); set("fighting", ["poison","flying","psychic","bug","fairy"], 0.5); set("fighting", ["ghost"], 0);
  set("poison", ["grass","fairy"], 2); set("poison", ["poison","ground","rock","ghost"], 0.5); set("poison", ["steel"], 0);
  set("ground", ["fire","electric","poison","rock","steel"], 2); set("ground", ["grass","bug"], 0.5); set("ground", ["flying"], 0);
  set("flying", ["grass","fighting","bug"], 2); set("flying", ["electric","rock","steel"], 0.5);
  set("psychic", ["fighting","poison"], 2); set("psychic", ["psychic","steel"], 0.5); set("psychic", ["dark"], 0);
  set("bug", ["grass","psychic","dark"], 2); set("bug", ["fire","fighting","poison","flying","ghost","steel","fairy"], 0.5);
  set("rock", ["fire","ice","flying","bug"], 2); set("rock", ["fighting","ground","steel"], 0.5);
  set("ghost", ["psychic","ghost"], 2); set("ghost", ["dark"], 0.5); set("ghost", ["normal"], 0);
  set("dragon", ["dragon"], 2); set("dragon", ["steel"], 0.5); set("dragon", ["fairy"], 0);
  set("dark", ["psychic","ghost"], 2); set("dark", ["fighting","dark","fairy"], 0.5);
  set("steel", ["ice","rock","fairy"], 2); set("steel", ["fire","water","electric","steel"], 0.5);
  set("fairy", ["fighting","dragon","dark"], 2); set("fairy", ["fire","poison","steel"], 0.5);

  return m;
})();

function typeEffect(atkType, defTypes) {
  let mult = 1;
  for (const t of defTypes) mult *= (TYPE_MULT[atkType]?.[t] ?? 1);
  return mult;
}

// -------- App State --------
const state = {
  red: [],
  blue: [],
  battle: null,
  secretsFound: cacheGet("secretsFound") || {},
  teamNames: cacheGet("teamNames") || { red: "Red", blue: "Blue" },
};

// -------- Logger --------
function logLine(msg, speakIt = false){
  const el = $("log");
  const t = new Date();
  const stamp = `${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}:${t.getSeconds().toString().padStart(2,"0")}`;
  if (el) {
    el.textContent += `[${stamp}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }
  if (speakIt) speak(msg);
}

function setStatus(msg){ const s = $("status"); if (s) s.textContent = msg; }
function setBattleStatus(msg){ const s = $("battleStatus"); if (s) s.textContent = msg; }

function spriteUrl(p){
  return p.sprites?.other?.["official-artwork"]?.front_default
      || p.sprites?.front_default
      || "";
}

function calcStats(baseStats, level){
  const get = (name) => baseStats.find(s => s.stat.name === name)?.base_stat ?? 50;
  const hp = Math.floor(((2*get("hp")+31)*level)/100)+level+10;
  const atk = Math.floor(((2*get("attack")+31)*level)/100)+5;
  const def = Math.floor(((2*get("defense")+31)*level)/100)+5;
  const spa = Math.floor(((2*get("special-attack")+31)*level)/100)+5;
  const spd = Math.floor(((2*get("special-defense")+31)*level)/100)+5;
  const spe = Math.floor(((2*get("speed")+31)*level)/100)+5;
  return {hp, atk, def, spa, spd, spe};
}

async function pickMoves(pokemonJson){
  const out = [];
  const moveEntries = pokemonJson.moves?.slice(0, 80) || [];
  for (const entry of moveEntries) {
    if (out.length >= 4) break;
    const murl = entry.move.url;
    const mname = entry.move.name;
    const m = await cachedFetchJson(murl, `move:${mname}`, 1000*60*60*24*180);
    if (!m || m.power == null) continue;
    if (m.damage_class?.name !== "physical" && m.damage_class?.name !== "special") continue;

    out.push({
      name: mname,
      type: m.type?.name || "normal",
      power: m.power || 40,
      acc: m.accuracy ?? 100,
      kind: m.damage_class.name
    });

    await new Promise(r => setTimeout(r, 40));
  }

  if (out.length === 0) out.push({name:"tackle", type:"normal", power:40, acc:100, kind:"physical"});
  while (out.length < 4) out.push(out[out.length-1]);
  return out;
}

async function loadPokemon(name, level){
  const n = normName(name);
  const p = await cachedFetchJson(`${POKEAPI}/pokemon/${n}`, `pokemon:${n}`, 1000*60*60*24*180);
  const types = (p.types||[]).sort((a,b)=>a.slot-b.slot).map(t=>t.type.name);
  const stats = calcStats(p.stats || [], level);
  const moves = await pickMoves(p);

  return {
    id: p.id,
    name: p.name,
    display: cap(p.name.replace(/-/g," ")),
    level,
    types,
    stats,
    moves,
    sprite: spriteUrl(p),
  };
}

// -------- UI: Pokéballs --------
function ensureBalls(elId){
  const el = $(elId);
  if (!el) return;
  if (el.children.length === 6) return;
  el.innerHTML = "";
  for (let i=0;i<6;i++){
    const d = document.createElement("div");
    d.className = "ball empty";
    el.appendChild(d);
  }
}

function setBalls(elId, total, alive){
  ensureBalls(elId);
  const el = $(elId);
  if (!el) return;
  const nodes = Array.from(el.children);
  for (let i=0;i<6;i++){
    const node = nodes[i];
    const slotExists = i < total;
    if (!slotExists) {
      node.className = "ball empty";
      continue;
    }
    const isAlive = i < alive;
    node.className = isAlive ? "ball" : "ball fainted";
  }
}

// -------- UI: Team lists --------
function renderTeams(){
  const red = $("redList"), blue = $("blueList");
  if (!red || !blue) return;

  red.innerHTML = ""; blue.innerHTML = "";

  for (const [team, el] of [["red", red], ["blue", blue]]) {
    for (let i=0;i<state[team].length;i++){
      const mon = state[team][i];
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="mon">
          <div class="sprite">${mon.sprite ? `<img alt="" src="${mon.sprite}"/>` : "?"}</div>
          <div>
            <div class="name">${mon.display} <span class="meta">Lv ${mon.level}</span></div>
            <div class="meta">${mon.types.map(cap).join(" / ")}</div>
            <div class="meta">Moves: ${mon.moves.map(m=>cap(m.name.replace(/-/g," "))).slice(0,4).join(", ")}</div>
          </div>
        </div>
        <div class="actions">
          <button class="mini" data-team="${team}" data-i="${i}" data-act="up">↑</button>
          <button class="mini" data-team="${team}" data-i="${i}" data-act="down">↓</button>
          <button class="mini" data-team="${team}" data-i="${i}" data-act="del">✕</button>
        </div>
      `;
      el.appendChild(li);
    }
  }

  $("redPill").textContent = `${state.red.length} Pokémon`;
  $("bluePill").textContent = `${state.blue.length} Pokémon`;

  // builder view = alive==total
  $("redCount").textContent = `${state.red.length}/${state.red.length}`;
  $("blueCount").textContent = `${state.blue.length}/${state.blue.length}`;

  setBalls("redBalls", state.red.length, state.red.length);
  setBalls("blueBalls", state.blue.length, state.blue.length);

  const ready = state.red.length > 0 && state.blue.length > 0;
  $("simBtn").disabled = !ready;
  $("stepBtn").disabled = true;
}

// -------- Battle Core --------
function cloneMon(mon){
  return {
    ...mon,
    curHP: mon.stats.hp,
    fainted:false,
    secret: null,
    _hitsInRow: 0,
    _shield: 1,
    _powerBoost: 1,
    _critBoost: false
  };
}

// Secrets (discoverable)
const SECRET_POOL = [
  {
    key:"last-stand",
    name:"Last Stand",
    hint:"Triggers when a Pokémon drops very low and refuses to fall.",
    when:(ctx)=> ctx.defender.curHP <= Math.floor(ctx.defender.stats.hp*0.12) && !ctx.defender._lastStandUsed,
    apply:(ctx)=>{
      ctx.defender._lastStandUsed = true;
      ctx.defender._shield = 0.5;
      return "A strange courage flares up… damage is softened once!";
    }
  },
  {
    key:"momentum",
    name:"Momentum",
    hint:"Triggers after landing hits back-to-back.",
    when:(ctx)=> (ctx.attacker._hitsInRow||0) >= 2 && !ctx.attacker._momentumUsed,
    apply:(ctx)=>{
      ctx.attacker._momentumUsed = true;
      ctx.attacker._powerBoost = 1.25;
      return "It rides the momentum! One attack gets stronger!";
    }
  },
  {
    key:"wild-luck",
    name:"Wild Luck",
    hint:"Sometimes luck just… happens.",
    when:(ctx)=> roll(8) && !ctx.attacker._wildLuckUsed,
    apply:(ctx)=>{
      ctx.attacker._wildLuckUsed = true;
      ctx.attacker._critBoost = true;
      return "Luck crackles in the air… a critical strike is guaranteed once!";
    }
  }
];

function maybeAssignSecret(mon){
  if (mon.secret) return;
  if (!roll(20)) return;
  mon.secret = SECRET_POOL[randInt(0, SECRET_POOL.length-1)];
}
function revealSecret(secret){
  if (!secret) return "???";
  if (state.secretsFound[secret.key]) return secret.name;
  return "???";
}
function markSecretFound(secret){
  if (!secret) return;
  if (!state.secretsFound[secret.key]) {
    state.secretsFound[secret.key] = true;
    cacheSet("secretsFound", state.secretsFound);
    $("secretBox").style.display = "block";
    $("secretBox").textContent = `Secret discovered: ${secret.name} — ${secret.hint}`;
    speak(`Secret discovered: ${secret.name}.`);
  }
}

function newBattle(){
  const b = {
    red: state.red.map(cloneMon),
    blue: state.blue.map(cloneMon),
    rIndex: 0,
    bIndex: 0,
    over: false,
    turn: 0,
  };
  b.red.forEach(maybeAssignSecret);
  b.blue.forEach(maybeAssignSecret);
  return b;
}
function active(b, team){ return team==="red" ? b.red[b.rIndex] : b.blue[b.bIndex]; }
function nextAliveIndex(list, start){
  for (let i=start;i<list.length;i++) if (!list[i].fainted) return i;
  for (let i=0;i<start;i++) if (!list[i].fainted) return i;
  return -1;
}
function aliveCount(list){ return list.filter(m=>!m.fainted && m.curHP > 0).length; }
function hpPct(mon){ return mon.curHP / Math.max(1, mon.stats.hp); }
function stab(moveType, userTypes){ return userTypes.includes(moveType) ? 1.5 : 1; }

function damageFormula(attacker, defender, move){
  const level = attacker.level;
  const A = (move.kind==="physical") ? attacker.stats.atk : attacker.stats.spa;
  const D = (move.kind==="physical") ? defender.stats.def : defender.stats.spd;

  const base = Math.floor((((2*level/5)+2) * move.power * (A/Math.max(1,D))) / 50) + 2;
  const eff = typeEffect(move.type, defender.types);
  const s = stab(move.type, attacker.types);
  const crit = roll(6.25) ? 1.5 : 1;
  const random = randInt(85,100)/100;

  return { dmg: Math.max(1, Math.floor(base * eff * s * crit * random)), eff, crit:(crit>1) };
}

// AI (expected damage for switching decisions)
function expectedDamageSimple(attacker, defender, mv){
  const level = attacker.level;
  const A = (mv.kind==="physical") ? attacker.stats.atk : attacker.stats.spa;
  const D = (mv.kind==="physical") ? defender.stats.def : defender.stats.spd;

  const power = mv.power || 40;
  const base = (((2*level/5)+2) * power * (A/Math.max(1,D))) / 50 + 2;

  const eff = typeEffect(mv.type, defender.types);
  const s = stab(mv.type, attacker.types);
  const acc = (mv.acc ?? 100)/100;

  const rollEV = 0.925;
  const critEV = 1.03125;
  return base * eff * s * acc * rollEV * critEV;
}
function bestMove(attacker, defender){
  if (!attacker.moves?.length) return null;
  let best = attacker.moves[0];
  let bestScore = -Infinity;
  for (const mv of attacker.moves) {
    const score = expectedDamageSimple(attacker, defender, mv) + Math.random()*2;
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  return best;
}
function matchupScore(attacker, defender){
  const my = bestMove(attacker, defender);
  const their = bestMove(defender, attacker);
  const out = my ? expectedDamageSimple(attacker, defender, my) : 0;
  const inc = their ? expectedDamageSimple(defender, attacker, their) : 0;
  const speedEdge = attacker.stats.spe >= defender.stats.spe ? 1.1 : 0.95;
  return (out*speedEdge) - (inc*0.9);
}
function chooseBestSwitch(list, activeIdx, enemyActive){
  let bestIdx = null;
  let best = -Infinity;
  for (let i=0;i<list.length;i++){
    if (i===activeIdx) continue;
    const cand = list[i];
    if (!cand || cand.fainted || cand.curHP<=0) continue;

    const score = matchupScore(cand, enemyActive);
    const their = bestMove(enemyActive, cand);
    const danger = their ? expectedDamageSimple(enemyActive, cand, their) : 0;
    const finalScore = score - danger*0.5;

    if (finalScore > best) { best = finalScore; bestIdx = i; }
  }
  return bestIdx;
}
function decideAIAction({ list, activeIndex, enemyActive }){
  const me = list[activeIndex];
  if (!me || me.fainted || me.curHP<=0) {
    const forced = chooseBestSwitch(list, activeIndex, enemyActive);
    return forced !== null ? { type:"switch", to:forced } : { type:"struggle" };
  }

  const scoreNow = matchupScore(me, enemyActive);
  const low = hpPct(me) <= 0.35;
  const veryLow = hpPct(me) <= 0.20;

  const bestIdx = chooseBestSwitch(list, activeIndex, enemyActive);
  if (bestIdx !== null) {
    const swScore = matchupScore(list[bestIdx], enemyActive);
    const should =
      (scoreNow < -12 && swScore > scoreNow + 6) ||
      (low && swScore > scoreNow + 4) ||
      (veryLow && swScore > scoreNow - 1);

    const bias = should ? 0.85 : 0.10;
    if (Math.random() < bias) return { type:"switch", to:bestIdx };
  }

  return { type:"move", move: bestMove(me, enemyActive) };
}

// HUD
function updateHud(){
  if (!state.battle) {
    // builder view
    $("redActiveName").textContent = "";
    $("blueActiveName").textContent = "";
    $("redHpText").textContent = "HP: —";
    $("blueHpText").textContent = "HP: —";
    $("redHpFill").style.width = "0%";
    $("blueHpFill").style.width = "0%";
    $("redTypes").textContent = "";
    $("blueTypes").textContent = "";
    return;
  }

  const b = state.battle;
  const r = active(b,"red");
  const u = active(b,"blue");

  $("redActiveName").textContent = r ? `— ${r.display}` : "";
  $("blueActiveName").textContent = u ? `— ${u.display}` : "";

  const rPct = r ? clamp((r.curHP / r.stats.hp)*100,0,100) : 0;
  const uPct = u ? clamp((u.curHP / u.stats.hp)*100,0,100) : 0;
  $("redHpFill").style.width = `${rPct}%`;
  $("blueHpFill").style.width = `${uPct}%`;

  $("redHpText").textContent = r ? `HP: ${r.curHP}/${r.stats.hp}` : "HP: —";
  $("blueHpText").textContent = u ? `HP: ${u.curHP}/${u.stats.hp}` : "HP: —";

  $("redTypes").textContent = r ? r.types.map(cap).join(" / ") : "";
  $("blueTypes").textContent = u ? u.types.map(cap).join(" / ") : "";

  const rAlive = aliveCount(b.red);
  const bAlive = aliveCount(b.blue);
  $("redCount").textContent = `${rAlive}/${b.red.length}`;
  $("blueCount").textContent = `${bAlive}/${b.blue.length}`;

  setBalls("redBalls", b.red.length, rAlive);
  setBalls("blueBalls", b.blue.length, bAlive);
}

function shake(team){
  const el = team==="red" ? $("hudRed") : $("hudBlue");
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function doAttack(atkTeam, atkMon, mv, defTeam, defMon){
  if (atkMon.fainted || defMon.fainted) return;

  const atkName = state.teamNames[atkTeam] || atkTeam.toUpperCase();
  const defName = state.teamNames[defTeam] || defTeam.toUpperCase();

  // Accuracy
  if (!roll(mv.acc ?? 100)) {
    logLine(`${atkName} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}${pick(FLAVOR.miss)}`, true);
    atkMon._hitsInRow = 0;
    return;
  }

  // Secrets
  const ctx = { attacker: atkMon, defender: defMon, move: mv };
  if (defMon.secret && defMon.secret.when(ctx)) {
    const msg = defMon.secret.apply(ctx);
    logLine(`${defName} ${defMon.display}'s secret (${revealSecret(defMon.secret)}) stirs… ${msg}`, true);
    markSecretFound(defMon.secret);
  }
  if (atkMon.secret && atkMon.secret.when(ctx)) {
    const msg = atkMon.secret.apply(ctx);
    logLine(`${atkName} ${atkMon.display}'s secret (${revealSecret(atkMon.secret)}) awakens… ${msg}`, true);
    markSecretFound(atkMon.secret);
  }

  // Damage modifiers
  const powBoost = atkMon._powerBoost || 1;
  const critBoost = atkMon._critBoost || false;
  const shield = defMon._shield || 1;

  const mv2 = {...mv, power: Math.floor((mv.power||40)*powBoost)};
  const d = damageFormula(atkMon, defMon, mv2);

  let dmg = Math.floor(d.dmg * (1/shield));
  defMon._shield = 1;
  if (critBoost) { dmg = Math.floor(dmg*1.5); atkMon._critBoost=false; }

  defMon.curHP = Math.max(0, defMon.curHP - dmg);
  atkMon._hitsInRow = (atkMon._hitsInRow||0) + 1;

  logLine(`${atkName} ${atkMon.display} ${pick(FLAVOR.attackLead)} ${cap(mv.name.replace(/-/g," "))}! (-${dmg} HP)`, true);

  if (d.crit) logLine(`  ➤ Critical hit! ${pick(FLAVOR.crit)}`, true);
  if (d.eff >= 2) logLine(`  ➤ Super effective! ${pick(FLAVOR.super)}`, true);
  if (d.eff > 0 && d.eff < 1) logLine(`  ➤ Not very effective… ${pick(FLAVOR.notVery)}`, false);
  if (d.eff === 0) logLine(`  ➤ No effect… ${pick(FLAVOR.immune)}`, true);

  shake(defTeam);
  updateHud();
}

function handleFaint(defTeam, atkTeam){
  const b = state.battle;
  const defMon = active(b, defTeam);
  if (!defMon || defMon.curHP > 0) return false;

  const defName = state.teamNames[defTeam] || defTeam.toUpperCase();
  const atkName = state.teamNames[atkTeam] || atkTeam.toUpperCase();

  defMon.fainted = true;
  logLine(`${defName} ${defMon.display} fainted! ${pick(FLAVOR.faint)}`, true);

  const list = defTeam==="red" ? b.red : b.blue;
  const idx = defTeam==="red" ? b.rIndex : b.bIndex;
  const next = nextAliveIndex(list, idx);

  if (next === -1) {
    b.over = true;
    logLine(`🏁 ${atkName} wins the match!`, true);
    setBattleStatus(`${atkName} wins!`);
    $("stepBtn").disabled = true;
    return true;
  } else {
    if (defTeam==="red") b.rIndex = next;
    else b.bIndex = next;
    const newActive = active(b, defTeam);
    logLine(`${defName} sends out ${newActive.display} — it ${pick(FLAVOR.sendOut)}`, true);
    updateHud();
    return false;
  }
}

function stepBattle(){
  const b = state.battle;
  if (!b || b.over) return;

  b.turn++;
  setBattleStatus(`Turn ${b.turn}`);

  if (b.turn === 1 || roll(35)) {
    logLine(`✨ ${pick(FLAVOR.turnStart)}`, true);
  }

  const r0 = active(b,"red");
  const u0 = active(b,"blue");
  if (!r0 || !u0) return;

  const redAction = decideAIAction({ list: b.red, activeIndex: b.rIndex, enemyActive: u0 });
  const blueAction = decideAIAction({ list: b.blue, activeIndex: b.bIndex, enemyActive: r0 });

  // Switches first
  if (redAction.type === "switch") {
    b.rIndex = redAction.to;
    const rNow = active(b,"red");
    logLine(`${state.teamNames.red} ${pick(FLAVOR.switchOut)} ➜ ${rNow.display}!`, true);
  }
  if (blueAction.type === "switch") {
    b.bIndex = blueAction.to;
    const bNow = active(b,"blue");
    logLine(`${state.teamNames.blue} ${pick(FLAVOR.switchOut)} ➜ ${bNow.display}!`, true);
  }

  updateHud();

  if (redAction.type === "switch" && blueAction.type === "switch") return;

  const r = active(b,"red");
  const u = active(b,"blue");
  if (!r || !u) return;

  const rMove = (redAction.type === "move" && redAction.move) ? redAction.move : bestMove(r,u) || r.moves[0];
  const uMove = (blueAction.type === "move" && blueAction.move) ? blueAction.move : bestMove(u,r) || u.moves[0];

  // If one switched and the other attacks
  if (redAction.type !== "switch" && blueAction.type === "switch") {
    doAttack("red", r, rMove, "blue", u);
    if (handleFaint("blue","red")) return;
    updateHud();
    return;
  }
  if (redAction.type === "switch" && blueAction.type !== "switch") {
    doAttack("blue", u, uMove, "red", r);
    if (handleFaint("red","blue")) return;
    updateHud();
    return;
  }

  // Both attack: speed order
  const rFirst = (r.stats.spe > u.stats.spe) || (r.stats.spe === u.stats.spe && roll(50));
  if (rFirst) {
    doAttack("red", r, rMove, "blue", u);
    if (handleFaint("blue","red")) return;

    const u2 = active(b,"blue");
    if (u2 && !u2.fainted) {
      doAttack("blue", u2, uMove, "red", active(b,"red"));
      if (handleFaint("red","blue")) return;
    }
  } else {
    doAttack("blue", u, uMove, "red", r);
    if (handleFaint("red","blue")) return;

    const r2 = active(b,"red");
    if (r2 && !r2.fainted) {
      doAttack("red", r2, rMove, "blue", active(b,"blue"));
      if (handleFaint("blue","red")) return;
    }
  }

  updateHud();
}

// -------- Events / Init --------
document.addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.dataset.act;
  if (!act) return;
  const team = btn.dataset.team;
  const i = parseInt(btn.dataset.i,10);
  if (!Number.isFinite(i)) return;

  if (act==="del") state[team].splice(i,1);
  if (act==="up" && i>0) [state[team][i-1], state[team][i]] = [state[team][i], state[team][i-1]];
  if (act==="down" && i<state[team].length-1) [state[team][i+1], state[team][i]] = [state[team][i], state[team][i+1]];
  renderTeams();
});

document.addEventListener("DOMContentLoaded", async () => {
  // Load saved team names
  $("redName").value = state.teamNames.red || "Red";
  $("blueName").value = state.teamNames.blue || "Blue";
  updateTtsButton();

  $("redName").addEventListener("input", () => {
    state.teamNames.red = $("redName").value.trim() || "Red";
    cacheSet("teamNames", state.teamNames);
    $("teamPick").querySelector('option[value="red"]').textContent = state.teamNames.red;
  });
  $("blueName").addEventListener("input", () => {
    state.teamNames.blue = $("blueName").value.trim() || "Blue";
    cacheSet("teamNames", state.teamNames);
    $("teamPick").querySelector('option[value="blue"]').textContent = state.teamNames.blue;
  });

  // Reflect names into team picker labels
  $("teamPick").querySelector('option[value="red"]').textContent = state.teamNames.red;
  $("teamPick").querySelector('option[value="blue"]').textContent = state.teamNames.blue;

  $("ttsBtn").addEventListener("click", () => {
    TTS_ENABLED = !TTS_ENABLED;
    cacheSet("ttsEnabled", TTS_ENABLED);
    updateTtsButton();
    if (!TTS_ENABLED) stopSpeaking();
    else speak("Announcer is on. Let's battle!");
  });

  $("addBtn").addEventListener("click", async ()=>{
    const name = $("searchName").value;
    const team = $("teamPick").value === state.teamNames.red ? "red" : ($("teamPick").value === state.teamNames.blue ? "blue" : $("teamPick").value);
    // In case the select option text was changed, we still keep value="red"/"blue"
    const teamKey = $("teamPick").value === "red" || $("teamPick").value === "blue" ? $("teamPick").value : (team === "red" ? "red" : "blue");
    const level = parseInt($("levelPick").value,10);

    if (!name) return;
    if (state[teamKey].length >= 6) { setStatus("That team already has 6."); return; }

    setStatus("Loading…");
    try {
      const mon = await loadPokemon(name, level);
      state[teamKey].push(mon);
      renderTeams();
      logLine(`Added ${mon.display} to ${state.teamNames[teamKey]} (Lv ${level}).`, false);
      setStatus("Ready");
      $("searchName").value = "";
    } catch (e) {
      console.error(e);
      setStatus("Couldn’t find that Pokémon. Try a different spelling.");
    }
  });

  $("randomBtn").addEventListener("click", async ()=>{
    const randId = () => randInt(1, 1010);
    state.red = []; state.blue = [];
    renderTeams();
    $("log").textContent = "";
    setStatus("Loading random teams…");
    try {
      for (let i=0;i<6;i++){
        const level = 50;
        const rid = randId(), bid = randId();
        const r = await cachedFetchJson(`${POKEAPI}/pokemon/${rid}`, `pokemonid:${rid}`, 1000*60*60*24*180);
        const b = await cachedFetchJson(`${POKEAPI}/pokemon/${bid}`, `pokemonid:${bid}`, 1000*60*60*24*180);
        state.red.push(await loadPokemon(r.name, level));
        state.blue.push(await loadPokemon(b.name, level));
        renderTeams();
        await new Promise(r=>setTimeout(r, 40));
      }
      setStatus("Ready");
      logLine("Random teams generated.", true);
    } catch (e) {
      console.error(e);
      setStatus("Random team failed (network?). Try again.");
    }
  });

  $("clearBtn").addEventListener("click", ()=>{
    state.red=[]; state.blue=[];
    state.battle=null;
    $("log").textContent="";
    $("secretBox").style.display="none";
    setBattleStatus("No battle yet");
    renderTeams();
    updateHud();
    stopSpeaking();
  });

  $("simBtn").addEventListener("click", ()=>{
    $("log").textContent = "";
    $("secretBox").style.display="none";
    stopSpeaking();

    state.battle = newBattle();
    setBattleStatus("Battle started");
    logLine(`⚔️ ${state.teamNames.red} vs ${state.teamNames.blue} — FIGHT!`, true);

    updateHud();
    $("stepBtn").disabled = false;

    // Auto sim speed
    const TICK_MS = 800;
    let safety = 0;

    const tick = () => {
      if (!state.battle || state.battle.over) return;
      stepBattle();
      safety++;
      if (safety < 700 && !state.battle.over) setTimeout(tick, TICK_MS);
    };
    tick();
  });

  $("stepBtn").addEventListener("click", ()=>{
    if (!state.battle) return;
    stepBattle();
  });

  $("installHintBtn").addEventListener("click", ()=>{
    alert("On Android (Chrome): open this app URL ➜ tap ⋮ menu ➜ 'Install app' / 'Add to Home screen'.");
  });

  // Service worker registration
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try { await navigator.serviceWorker.register("./sw.js"); } catch {}
    });
  }

  renderTeams();
  logLine("Ready. Add Pokémon to Red and Blue, then Sim Battle.", false);
  setStatus("Ready");
});
