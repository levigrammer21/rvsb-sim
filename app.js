// app.js — Full battle sim + AI + secrets + TTS + bracket + leaderboard (stable/guarded)

const POKEAPI = "https://pokeapi.co/api/v2";
const $ = (id) => document.getElementById(id);

// ---------- Crash to status ----------
window.addEventListener("error", (e) => {
  try {
    const s = $("status");
    const msg = e?.error?.message || e?.message || "Unknown error";
    if (s) s.textContent = `❌ JS Error: ${msg}`;
    console.error(e?.error || e);
  } catch {}
});

// ---------- Cache ----------
function cacheGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
function cacheSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
async function cachedFetchJson(url, cacheKey, maxAgeMs) {
  const cached = cacheGet(cacheKey);
  if (cached && cached.t && (Date.now() - cached.t) < maxAgeMs) return cached.v;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  cacheSet(cacheKey, { t: Date.now(), v: json });
  return json;
}

// ---------- Utilities ----------
function cap(s){ return s ? s[0].toUpperCase()+s.slice(1) : s; }
function normName(s){ return (s||"").trim().toLowerCase().replace(/\s+/g,"-"); }
function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }
function roll(pct){ return Math.random()*100 < pct; }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// ---------- TTS Announcer ----------
let TTS_ENABLED = cacheGet("ttsEnabled") ?? false;
let TTS_VOICE_URI = cacheGet("ttsVoiceUri") ?? null;
let TTS_RATE = cacheGet("ttsRate") ?? 0.96;
let TTS_PITCH = cacheGet("ttsPitch") ?? 1.06;
let ttsQueue = [];
let ttsSpeaking = false;

function updateTtsBtn(){
  const btn = $("ttsBtn");
  if (btn) btn.textContent = TTS_ENABLED ? "🔊 Announcer: ON" : "🔊 Announcer: OFF";
}
function getVoices(){
  try { return speechSynthesis.getVoices() || []; } catch { return []; }
}
function getSelectedVoice(){
  const voices = getVoices();
  if (!voices.length) return null;
  if (TTS_VOICE_URI) {
    const v = voices.find(v => v.voiceURI === TTS_VOICE_URI);
    if (v) return v;
  }
  // prefer en-US
  return voices.find(v => /en-US/i.test(v.lang)) || voices.find(v => /en/i.test(v.lang)) || voices[0];
}
function speak(text){
  if (!TTS_ENABLED) return;
  if (!("speechSynthesis" in window)) return;
  const cleaned = (text||"").replace(/\s+/g," ").trim();
  if (!cleaned) return;
  ttsQueue.push(cleaned);
  if (!ttsSpeaking) speakNext();
}
function speakNext(){
  if (!ttsQueue.length) { ttsSpeaking = false; return; }
  ttsSpeaking = true;

  const u = new SpeechSynthesisUtterance(ttsQueue.shift());
  const v = getSelectedVoice();
  if (v) u.voice = v;
  u.rate = clamp(TTS_RATE, 0.75, 1.2);
  u.pitch = clamp(TTS_PITCH, 0.8, 1.35);
  u.volume = 1.0;
  u.onend = speakNext;
  u.onerror = speakNext;
  try { speechSynthesis.speak(u); } catch { speakNext(); }
}
function stopSpeaking(){
  try { speechSynthesis.cancel(); } catch {}
  ttsQueue = [];
  ttsSpeaking = false;
}

function populateVoiceSelect(){
  const sel = $("voiceSelect");
  if (!sel) return;
  const voices = getVoices();
  sel.innerHTML = "";
  if (!voices.length) {
    const opt = document.createElement("option");
    opt.textContent = "Voices loading…";
    opt.value = "";
    sel.appendChild(opt);
    return;
  }
  voices.forEach((v, idx) => {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    if (TTS_VOICE_URI && v.voiceURI === TTS_VOICE_URI) opt.selected = true;
    sel.appendChild(opt);
  });
  if (!TTS_VOICE_URI) {
    const chosen = getSelectedVoice();
    if (chosen) sel.value = chosen.voiceURI;
  }
}

// ---------- Flavor ----------
const FLAVOR = {
  turnStart: [
    "The crowd leans in — this turn matters!",
    "You can feel the momentum shifting!",
    "Both sides are locked in!",
    "The arena gets LOUD!",
    "Somebody’s about to make a mistake…"
  ],
  attackLead: [
    "without hesitation",
    "with a burst of speed",
    "digging deep",
    "with zero fear",
    "like it planned this all along"
  ],
  miss: [
    "…and it MISSES!",
    "…and it whiffs completely!",
    "…and it goes wide!",
    "…and the target slips it!",
    "…and it doesn’t connect!"
  ],
  crit: ["BANG — weak spot!", "That’s a clean crit!", "Brutal precision!", "OHHH that one hurt!", "Perfect placement!"],
  super: ["Super effective — HUGE!", "That matchup is nasty!", "Perfect type advantage!", "That hits like a truck!", "That’s the pain button!"],
  notVery: ["Not much doing…", "Barely moved the needle…", "Defense holds!", "Not very effective…", "That’s getting tanked."],
  immune: ["NO EFFECT!", "Denied — immune!", "Nothing happens!", "Total immunity!", "That does zero!"],
  faint: ["DOWN FOR THE COUNT!", "That’s a knockout!", "Lights out!", "It hits the turf!", "It can’t continue!"],
  sendOut: ["comes out fired up!", "hits the field ready!", "steps in confident!", "charges in!", "looks locked in!"],
  switchOut: ["tags out to regroup!", "backs off for a better matchup!", "retreats to safety!", "calls for backup!", "makes the smart pivot!"]
};

function logLine(msg, say=false){
  const el = $("log");
  const t = new Date();
  const stamp = `${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}:${t.getSeconds().toString().padStart(2,"0")}`;
  if (el) {
    el.textContent += `[${stamp}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }
  if (say) speak(msg);
}
function setStatus(msg){ const s=$("status"); if(s) s.textContent = msg; }
function setBattleStatus(msg){ const s=$("battleStatus"); if(s) s.textContent = msg; }

// ---------- Type chart ----------
const TYPE_MULT = (() => {
  const types = ["normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"];
  const m = {}; for (const a of types){ m[a] = {}; for (const d of types) m[a][d]=1; }
  const set=(atk,defs,val)=>defs.forEach(d=>m[atk][d]=val);

  set("normal",["rock","steel"],0.5); set("normal",["ghost"],0);
  set("fire",["grass","ice","bug","steel"],2); set("fire",["fire","water","rock","dragon"],0.5);
  set("water",["fire","ground","rock"],2); set("water",["water","grass","dragon"],0.5);
  set("electric",["water","flying"],2); set("electric",["electric","grass","dragon"],0.5); set("electric",["ground"],0);
  set("grass",["water","ground","rock"],2); set("grass",["fire","grass","poison","flying","bug","dragon","steel"],0.5);
  set("ice",["grass","ground","flying","dragon"],2); set("ice",["fire","water","ice","steel"],0.5);
  set("fighting",["normal","ice","rock","dark","steel"],2); set("fighting",["poison","flying","psychic","bug","fairy"],0.5); set("fighting",["ghost"],0);
  set("poison",["grass","fairy"],2); set("poison",["poison","ground","rock","ghost"],0.5); set("poison",["steel"],0);
  set("ground",["fire","electric","poison","rock","steel"],2); set("ground",["grass","bug"],0.5); set("ground",["flying"],0);
  set("flying",["grass","fighting","bug"],2); set("flying",["electric","rock","steel"],0.5);
  set("psychic",["fighting","poison"],2); set("psychic",["psychic","steel"],0.5); set("psychic",["dark"],0);
  set("bug",["grass","psychic","dark"],2); set("bug",["fire","fighting","poison","flying","ghost","steel","fairy"],0.5);
  set("rock",["fire","ice","flying","bug"],2); set("rock",["fighting","ground","steel"],0.5);
  set("ghost",["psychic","ghost"],2); set("ghost",["dark"],0.5); set("ghost",["normal"],0);
  set("dragon",["dragon"],2); set("dragon",["steel"],0.5); set("dragon",["fairy"],0);
  set("dark",["psychic","ghost"],2); set("dark",["fighting","dark","fairy"],0.5);
  set("steel",["ice","rock","fairy"],2); set("steel",["fire","water","electric","steel"],0.5);
  set("fairy",["fighting","dragon","dark"],2); set("fairy",["fire","poison","steel"],0.5);
  return m;
})();
function typeEffect(atkType, defTypes){
  let mult=1;
  for (const t of defTypes) mult *= (TYPE_MULT[atkType]?.[t] ?? 1);
  return mult;
}
function stab(moveType, userTypes){ return userTypes.includes(moveType) ? 1.5 : 1; }

// ---------- Trainer traits ----------
const TRAITS = [
  { key:"aggressive", name:"Aggressive", desc:"Hits harder, switches less.", mods:{ dmgMult:1.06, switchBias:-0.12, critBonus:1.0 } },
  { key:"tactician", name:"Tactician", desc:"Switches smart and often.", mods:{ dmgMult:1.00, switchBias:+0.18, critBonus:1.0 } },
  { key:"lucky", name:"Lucky", desc:"More crits and chaos.", mods:{ dmgMult:1.00, switchBias:+0.02, critBonus:2.4 } },
  { key:"bulwark", name:"Bulwark", desc:"Takes slightly reduced damage.", mods:{ dmgMult:1.00, switchBias:+0.05, critBonus:1.0, incomingMult:0.95 } },
  { key:"momentum-coach", name:"Momentum Coach", desc:"Snowballs a bit after KOs.", mods:{ dmgMult:1.00, switchBias:-0.02, critBonus:1.0 } }
];
function pickTrait(){ return TRAITS[randInt(0, TRAITS.length-1)]; }

// ---------- Leaderboard ----------
const LB_KEY = "rvsbLeaderboardV2";
function lbLoad(){ return cacheGet(LB_KEY) || {}; }
function lbSave(obj){ cacheSet(LB_KEY, obj); }
function lbKey(name){ return (name||"").trim().toLowerCase(); }
function lbEnsure(lb, name){
  const k = lbKey(name);
  if (!k) return null;
  if (!lb[k]) lb[k] = { name, wins:0, losses:0, titles:0, matches:0, turns:0 };
  return lb[k];
}
function lbRecordMatch(winnerName, loserName, turns){
  const lb = lbLoad();
  const w = lbEnsure(lb, winnerName);
  const l = lbEnsure(lb, loserName);
  if (w){ w.wins++; w.matches++; w.turns += (turns||0); }
  if (l){ l.losses++; l.matches++; l.turns += (turns||0); }
  lbSave(lb);
}
function lbRecordTitle(teamName){
  const lb = lbLoad();
  const t = lbEnsure(lb, teamName);
  if (t) t.titles++;
  lbSave(lb);
}
function renderLeaderboard(){
  const body = $("leaderboardBody");
  if (!body) return;
  const lb = lbLoad();
  const rows = Object.values(lb);
  rows.sort((a,b)=> (b.titles-a.titles) || (b.wins-a.wins) || ((a.turns/a.matches||999) - (b.turns/b.matches||999)));

  if (!rows.length){
    body.innerHTML = `<div class="meta">No matches recorded yet.</div>`;
    return;
  }
  body.innerHTML = rows.map((r,i)=>{
    const avg = r.matches ? (r.turns/r.matches).toFixed(1) : "—";
    return `
      <div class="panel" style="margin:8px 0">
        <div class="teamHead">
          <span>#${i+1} ${r.name}</span>
          <span class="badge">Titles: ${r.titles}</span>
        </div>
        <div class="meta">W-L: <b>${r.wins}-${r.losses}</b> • Matches: <b>${r.matches}</b> • Avg turns: <b>${avg}</b></div>
      </div>
    `;
  }).join("");
}

// ---------- Saved teams ----------
const SAVED_KEY = "rvsbSavedTeamsV2";
function savedLoad(){ return cacheGet(SAVED_KEY) || []; } // [{id,name,red,blue,createdAt}]
function savedSave(list){ cacheSet(SAVED_KEY, list); }
function deepCopy(x){ return JSON.parse(JSON.stringify(x)); }
function fillSavedSelect(){
  const sel = $("savedTeamsSelect");
  if (!sel) return;
  const list = savedLoad();
  sel.innerHTML = `<option value="">Saved teams…</option>` + list.map(t =>
    `<option value="${t.id}">${t.name} (${(t.red||[]).length}+${(t.blue||[]).length})</option>`
  ).join("");
}

// ---------- State ----------
const state = {
  red: [],
  blue: [],
  battle: null,
  secretsFound: cacheGet("secretsFound") || {},
  teamNames: cacheGet("teamNames") || { red:"Red", blue:"Blue" },
  tickMs: cacheGet("tickMs") ?? 700,
  tournamentLive: cacheGet("tournamentLive") ?? true
};

// ---------- Pokéballs UI ----------
function ensureBalls(elId){
  const el = $(elId);
  if (!el) return;
  if (el.children.length === 6) return;
  el.innerHTML = "";
  for (let i=0;i<6;i++){
    const d=document.createElement("div");
    d.className="ball empty";
    el.appendChild(d);
  }
}
function setBalls(elId, total, alive){
  ensureBalls(elId);
  const el=$(elId);
  if (!el) return;
  const nodes=[...el.children];
  for (let i=0;i<6;i++){
    const slotExists = i < total;
    if (!slotExists){ nodes[i].className="ball empty"; continue; }
    nodes[i].className = (i < alive) ? "ball" : "ball fainted";
  }
}

// ---------- Pokémon loading ----------
function spriteUrl(p){
  return p.sprites?.other?.["official-artwork"]?.front_default
    || p.sprites?.front_default
    || "";
}
function calcStats(baseStats, level){
  const get = (name) => baseStats.find(s => s.stat.name === name)?.base_stat ?? 50;
  const hp  = Math.floor(((2*get("hp")+31)*level)/100)+level+10;
  const atk = Math.floor(((2*get("attack")+31)*level)/100)+5;
  const def = Math.floor(((2*get("defense")+31)*level)/100)+5;
  const spa = Math.floor(((2*get("special-attack")+31)*level)/100)+5;
  const spd = Math.floor(((2*get("special-defense")+31)*level)/100)+5;
  const spe = Math.floor(((2*get("speed")+31)*level)/100)+5;
  return {hp, atk, def, spa, spd, spe};
}
async function pickMoves(pokemonJson){
  const out=[];
  const moveEntries = pokemonJson.moves?.slice(0, 90) || [];
  for (const entry of moveEntries){
    if (out.length >= 4) break;
    const murl = entry.move.url;
    const mname = entry.move.name;
    const m = await cachedFetchJson(murl, `move:${mname}`, 1000*60*60*24*180);
    if (!m || m.power == null) continue;
    if (m.damage_class?.name !== "physical" && m.damage_class?.name !== "special") continue;
    out.push({
      name:mname,
      type:m.type?.name || "normal",
      power:m.power || 40,
      acc:m.accuracy ?? 100,
      kind:m.damage_class.name
    });
    await new Promise(r=>setTimeout(r, 20));
  }
  if (!out.length) out.push({name:"tackle", type:"normal", power:40, acc:100, kind:"physical"});
  while (out.length<4) out.push(out[out.length-1]);
  return out;
}
async function loadPokemon(name, level){
  const n = normName(name);
  const p = await cachedFetchJson(`${POKEAPI}/pokemon/${n}`, `pokemon:${n}`, 1000*60*60*24*180);
  const types = (p.types||[]).sort((a,b)=>a.slot-b.slot).map(t=>t.type.name);
  const stats = calcStats(p.stats||[], level);
  const moves = await pickMoves(p);
  return {
    id:p.id,
    name:p.name,
    display:cap(p.name.replace(/-/g," ")),
    level,
    types,
    stats,
    moves,
    sprite:spriteUrl(p)
  };
}

// ---------- Team render ----------
function renderTeams(){
  const red=$("redList"), blue=$("blueList");
  if (!red || !blue) return;

  red.innerHTML=""; blue.innerHTML="";
  for (const [team, el] of [["red",red],["blue",blue]]){
    for (let i=0;i<state[team].length;i++){
      const mon = state[team][i];
      const li=document.createElement("li");
      li.innerHTML = `
        <div class="mon">
          <div class="sprite">${mon.sprite ? `<img alt="" src="${mon.sprite}">` : "?"}</div>
          <div>
            <div><b>${mon.display}</b> <span class="meta">Lv ${mon.level}</span></div>
            <div class="meta">${mon.types.map(cap).join(" / ")}</div>
            <div class="meta">Moves: ${mon.moves.map(m=>cap(m.name.replace(/-/g," "))).join(", ")}</div>
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

  $("redPill") && ($("redPill").textContent = `${state.red.length} Pokémon`);
  $("bluePill") && ($("bluePill").textContent = `${state.blue.length} Pokémon`);

  // builder view counts show x/x
  $("redCount") && ($("redCount").textContent = `${state.red.length}/${state.red.length}`);
  $("blueCount") && ($("blueCount").textContent = `${state.blue.length}/${state.blue.length}`);

  setBalls("redBalls", state.red.length, state.red.length);
  setBalls("blueBalls", state.blue.length, state.blue.length);

  $("simBtn") && ($("simBtn").disabled = !(state.red.length && state.blue.length));
  $("stepBtn") && ($("stepBtn").disabled = true);

  // titles
  $("redTitle") && ($("redTitle").textContent = state.teamNames.red);
  $("blueTitle") && ($("blueTitle").textContent = state.teamNames.blue);
  $("hudRedName") && ($("hudRedName").textContent = state.teamNames.red);
  $("hudBlueName") && ($("hudBlueName").textContent = state.teamNames.blue);
}

// ---------- Battle engine ----------
function cloneMon(mon){
  return {
    ...mon,
    curHP: mon.stats.hp,
    fainted:false,
    secret:null,
    _hitsInRow:0,
    _shield:1,
    _powerBoost:1,
    _critBoost:false,
    dmgDealt:0,
    kos:0,
    crits:0,
    switchesIn:0
  };
}

const SECRET_POOL = [
  {
    key:"last-stand", name:"Last Stand", hint:"Triggers when very low; softens damage once.",
    when:(ctx)=> ctx.defender.curHP <= Math.floor(ctx.defender.stats.hp*0.12) && !ctx.defender._lastStandUsed,
    apply:(ctx)=>{ ctx.defender._lastStandUsed=true; ctx.defender._shield=0.5; return "Courage flares… damage is softened once!"; }
  },
  {
    key:"momentum", name:"Momentum", hint:"After back-to-back hits; one strike stronger.",
    when:(ctx)=> (ctx.attacker._hitsInRow||0) >= 2 && !ctx.attacker._momentumUsed,
    apply:(ctx)=>{ ctx.attacker._momentumUsed=true; ctx.attacker._powerBoost=1.25; return "Momentum surges! Next attack gets stronger!"; }
  },
  {
    key:"wild-luck", name:"Wild Luck", hint:"Sometimes luck happens; a crit is guaranteed once.",
    when:(ctx)=> roll(8) && !ctx.attacker._wildLuckUsed,
    apply:(ctx)=>{ ctx.attacker._wildLuckUsed=true; ctx.attacker._critBoost=true; return "Luck crackles… a critical strike is guaranteed once!"; }
  }
];

function maybeAssignSecret(mon){
  if (mon.secret) return;
  if (!roll(20)) return;
  mon.secret = SECRET_POOL[randInt(0, SECRET_POOL.length-1)];
}
function revealSecret(secret){
  if (!secret) return "???";
  return state.secretsFound[secret.key] ? secret.name : "???";
}
function markSecretFound(secret){
  if (!secret) return;
  if (!state.secretsFound[secret.key]){
    state.secretsFound[secret.key] = true;
    cacheSet("secretsFound", state.secretsFound);
    const box=$("secretBox");
    if (box){
      box.classList.remove("hidden");
      box.textContent = `Secret discovered: ${secret.name} — ${secret.hint}`;
    }
    speak(`Secret discovered: ${secret.name}.`);
  }
}

function active(b, team){ return team==="red" ? b.red[b.rIndex] : b.blue[b.bIndex]; }
function aliveCount(list){ return list.filter(m=>!m.fainted && m.curHP>0).length; }
function nextAliveIndex(list, start){
  for (let i=start;i<list.length;i++) if (!list[i].fainted) return i;
  for (let i=0;i<start;i++) if (!list[i].fainted) return i;
  return -1;
}
function hpPct(mon){ return mon.curHP / Math.max(1, mon.stats.hp); }

function newBattleFromTeams(redTeam, blueTeam, names){
  const b = {
    red: redTeam.map(cloneMon),
    blue: blueTeam.map(cloneMon),
    rIndex:0,
    bIndex:0,
    over:false,
    turn:0,
    names: { red: names.red, blue: names.blue },
    traits: { red: pickTrait(), blue: pickTrait() },
    meta: { winner:null, turns:0 }
  };
  b.red.forEach(maybeAssignSecret);
  b.blue.forEach(maybeAssignSecret);
  return b;
}

// --- AI switching ---
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
  let best = attacker.moves[0], bestScore=-Infinity;
  for (const mv of attacker.moves){
    const score = expectedDamageSimple(attacker, defender, mv) + Math.random()*2;
    if (score > bestScore){ bestScore=score; best=mv; }
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
  let bestIdx=null, best=-Infinity;
  for (let i=0;i<list.length;i++){
    if (i===activeIdx) continue;
    const cand=list[i];
    if (!cand || cand.fainted || cand.curHP<=0) continue;
    const score = matchupScore(cand, enemyActive);
    const their = bestMove(enemyActive, cand);
    const danger = their ? expectedDamageSimple(enemyActive, cand, their) : 0;
    const finalScore = score - danger*0.5;
    if (finalScore > best){ best=finalScore; bestIdx=i; }
  }
  return bestIdx;
}
function decideAIAction({ b, teamKey, list, activeIndex, enemyActive }){
  const me = list[activeIndex];
  const trait = b.traits[teamKey];
  const switchBias = trait?.mods?.switchBias ?? 0;

  if (!me || me.fainted || me.curHP<=0){
    const forced = chooseBestSwitch(list, activeIndex, enemyActive);
    return forced!==null ? { type:"switch", to:forced } : { type:"struggle" };
  }

  const scoreNow = matchupScore(me, enemyActive);
  const low = hpPct(me) <= 0.35;
  const veryLow = hpPct(me) <= 0.20;

  const bestIdx = chooseBestSwitch(list, activeIndex, enemyActive);
  if (bestIdx!==null){
    const swScore = matchupScore(list[bestIdx], enemyActive);
    const should =
      (scoreNow < -12 && swScore > scoreNow + 6) ||
      (low && swScore > scoreNow + 4) ||
      (veryLow && swScore > scoreNow - 1);

    const baseBias = should ? 0.85 : 0.10;
    const finalBias = clamp(baseBias + switchBias, 0.02, 0.95);
    if (Math.random() < finalBias) return { type:"switch", to:bestIdx };
  }
  return { type:"move", move: bestMove(me, enemyActive) };
}

// --- Damage ---
function damageFormula(attacker, defender, move, b, atkTeamKey, defTeamKey){
  const level=attacker.level;
  const A=(move.kind==="physical") ? attacker.stats.atk : attacker.stats.spa;
  const D=(move.kind==="physical") ? defender.stats.def : defender.stats.spd;

  const base = Math.floor((((2*level/5)+2) * move.power * (A/Math.max(1,D))) / 50) + 2;
  const eff = typeEffect(move.type, defender.types);
  const s = stab(move.type, attacker.types);

  const atkTrait = b.traits[atkTeamKey];
  const defTrait = b.traits[defTeamKey];
  const dmgMult = atkTrait?.mods?.dmgMult ?? 1.0;
  const incomingMult = defTrait?.mods?.incomingMult ?? 1.0;

  const critChance = clamp(6.25 * (atkTrait?.mods?.critBonus ?? 1.0), 1, 30);
  const crit = roll(critChance) ? 1.5 : 1;
  const random = randInt(85,100)/100;

  const dmg = Math.max(1, Math.floor(base * eff * s * crit * random * dmgMult * incomingMult));
  return { dmg, eff, crit:(crit>1) };
}

// --- HUD updates ---
function updateHud(){
  if (!state.battle){
    setBalls("redBalls", state.red.length, state.red.length);
    setBalls("blueBalls", state.blue.length, state.blue.length);
    return;
  }
  const b=state.battle;
  const r=active(b,"red");
  const u=active(b,"blue");

  $("redActiveName") && ($("redActiveName").textContent = r ? `— ${r.display}` : "");
  $("blueActiveName") && ($("blueActiveName").textContent = u ? `— ${u.display}` : "");
  $("redTypes") && ($("redTypes").textContent = r ? r.types.map(cap).join(" / ") : "");
  $("blueTypes") && ($("blueTypes").textContent = u ? u.types.map(cap).join(" / ") : "");

  const rPct = r ? clamp((r.curHP/r.stats.hp)*100,0,100) : 0;
  const uPct = u ? clamp((u.curHP/u.stats.hp)*100,0,100) : 0;
  $("redHpFill") && ($("redHpFill").style.width = `${rPct}%`);
  $("blueHpFill") && ($("blueHpFill").style.width = `${uPct}%`);
  $("redHpText") && ($("redHpText").textContent = r ? `HP: ${r.curHP}/${r.stats.hp}` : "HP: —");
  $("blueHpText") && ($("blueHpText").textContent = u ? `HP: ${u.curHP}/${u.stats.hp}` : "HP: —");

  const rAlive = aliveCount(b.red);
  const bAlive = aliveCount(b.blue);
  $("redCount") && ($("redCount").textContent = `${rAlive}/${b.red.length}`);
  $("blueCount") && ($("blueCount").textContent = `${bAlive}/${b.blue.length}`);
  setBalls("redBalls", b.red.length, rAlive);
  setBalls("blueBalls", b.blue.length, bAlive);
}

function shake(teamKey){
  const el = teamKey==="red" ? $("hudRed") : $("hudBlue");
  if (!el) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

// --- Attack + faint handling ---
function doAttack(b, atkTeamKey, atkMon, mv, defTeamKey, defMon){
  if (atkMon.fainted || defMon.fainted) return;

  const atkName = b.names[atkTeamKey];
  const defName = b.names[defTeamKey];

  if (!roll(mv.acc ?? 100)){
    logLine(`${atkName} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}${pick(FLAVOR.miss)}`, true);
    atkMon._hitsInRow=0;
    return;
  }

  // Secrets
  const ctx={ attacker:atkMon, defender:defMon, move:mv };
  if (defMon.secret && defMon.secret.when(ctx)){
    const msg=defMon.secret.apply(ctx);
    logLine(`${defName} ${defMon.display}'s secret (${revealSecret(defMon.secret)}) stirs… ${msg}`, true);
    markSecretFound(defMon.secret);
  }
  if (atkMon.secret && atkMon.secret.when(ctx)){
    const msg=atkMon.secret.apply(ctx);
    logLine(`${atkName} ${atkMon.display}'s secret (${revealSecret(atkMon.secret)}) awakens… ${msg}`, true);
    markSecretFound(atkMon.secret);
  }

  // Damage + modifiers
  const powBoost = atkMon._powerBoost || 1;
  const critBoost = atkMon._critBoost || false;
  const shield = defMon._shield || 1;

  const mv2 = { ...mv, power: Math.floor((mv.power||40)*powBoost) };
  const d = damageFormula(atkMon, defMon, mv2, b, atkTeamKey, defTeamKey);

  let dmg = Math.floor(d.dmg * (1/shield));
  defMon._shield = 1;
  if (critBoost){ dmg = Math.floor(dmg*1.5); atkMon._critBoost=false; }

  defMon.curHP = Math.max(0, defMon.curHP - dmg);
  atkMon.dmgDealt += dmg;
  atkMon._hitsInRow = (atkMon._hitsInRow||0) + 1;

  logLine(`${atkName} ${atkMon.display} ${pick(FLAVOR.attackLead)} used ${cap(mv.name.replace(/-/g," "))}! (-${dmg} HP)`, true);
  if (d.crit){ atkMon.crits++; logLine(`  ➤ Critical hit! ${pick(FLAVOR.crit)}`, true); }
  if (d.eff >= 2) logLine(`  ➤ Super effective! ${pick(FLAVOR.super)}`, true);
  if (d.eff > 0 && d.eff < 1) logLine(`  ➤ Not very effective… ${pick(FLAVOR.notVery)}`);
  if (d.eff === 0) logLine(`  ➤ No effect… ${pick(FLAVOR.immune)}`, true);

  shake(defTeamKey);
  updateHud();
}

function handleFaint(b, defTeamKey, atkTeamKey){
  const defMon = active(b, defTeamKey);
  if (!defMon || defMon.curHP > 0) return false;

  const defName=b.names[defTeamKey];
  const atkName=b.names[atkTeamKey];

  defMon.fainted = true;
  logLine(`${defName} ${defMon.display} fainted! ${pick(FLAVOR.faint)}`, true);

  const atkMon = active(b, atkTeamKey);
  if (atkMon && !atkMon.fainted) atkMon.kos++;

  // Momentum coach small snowball
  if (b.traits[atkTeamKey]?.key === "momentum-coach" && atkMon){
    atkMon._powerBoost = Math.max(atkMon._powerBoost||1, 1.12);
  }

  const list = defTeamKey==="red" ? b.red : b.blue;
  const idx  = defTeamKey==="red" ? b.rIndex : b.bIndex;
  const next = nextAliveIndex(list, idx);

  if (next === -1){
    b.over = true;
    b.meta.winner = atkTeamKey;
    b.meta.turns = b.turn;
    logLine(`🏁 ${atkName} wins the match!`, true);
    setBattleStatus(`${atkName} wins!`);
    $("stepBtn") && ($("stepBtn").disabled = true);
    return true;
  } else {
    if (defTeamKey==="red") b.rIndex = next;
    else b.bIndex = next;
    const newActive = active(b, defTeamKey);
    newActive.switchesIn++;
    logLine(`${defName} sends out ${newActive.display} — it ${pick(FLAVOR.sendOut)}`, true);
    return false;
  }
}

// --- Battle step ---
function stepBattle(b){
  if (!b || b.over) return;

  b.turn++;
  setBattleStatus(`Turn ${b.turn}`);
  if (b.turn===1 || roll(35)) logLine(`✨ ${pick(FLAVOR.turnStart)}`, true);

  const r0 = active(b,"red");
  const u0 = active(b,"blue");
  if (!r0 || !u0) return;

  const redAction  = decideAIAction({ b, teamKey:"red",  list:b.red,  activeIndex:b.rIndex, enemyActive:u0 });
  const blueAction = decideAIAction({ b, teamKey:"blue", list:b.blue, activeIndex:b.bIndex, enemyActive:r0 });

  // switches first
  if (redAction.type==="switch"){
    b.rIndex = redAction.to;
    logLine(`${b.names.red} ${pick(FLAVOR.switchOut)} ➜ ${active(b,"red").display}!`, true);
  }
  if (blueAction.type==="switch"){
    b.bIndex = blueAction.to;
    logLine(`${b.names.blue} ${pick(FLAVOR.switchOut)} ➜ ${active(b,"blue").display}!`, true);
  }
  updateHud();

  if (redAction.type==="switch" && blueAction.type==="switch") return;

  const r = active(b,"red");
  const u = active(b,"blue");
  if (!r || !u) return;

  const rMove = (redAction.type==="move" && redAction.move) ? redAction.move : bestMove(r,u) || r.moves[0];
  const uMove = (blueAction.type==="move" && blueAction.move) ? blueAction.move : bestMove(u,r) || u.moves[0];

  // one switched
  if (redAction.type!=="switch" && blueAction.type==="switch"){
    doAttack(b,"red",r,rMove,"blue",u);
    if (handleFaint(b,"blue","red")) return;
    updateHud();
    return;
  }
  if (redAction.type==="switch" && blueAction.type!=="switch"){
    doAttack(b,"blue",u,uMove,"red",r);
    if (handleFaint(b,"red","blue")) return;
    updateHud();
    return;
  }

  // both attack by speed
  const rFirst = (r.stats.spe > u.stats.spe) || (r.stats.spe===u.stats.spe && roll(50));
  if (rFirst){
    doAttack(b,"red",r,rMove,"blue",u);
    if (handleFaint(b,"blue","red")) return;
    const u2 = active(b,"blue");
    if (u2 && !u2.fainted){
      doAttack(b,"blue",u2,uMove,"red",active(b,"red"));
      if (handleFaint(b,"red","blue")) return;
    }
  } else {
    doAttack(b,"blue",u,uMove,"red",r);
    if (handleFaint(b,"red","blue")) return;
    const r2 = active(b,"red");
    if (r2 && !r2.fainted){
      doAttack(b,"red",r2,rMove,"blue",active(b,"blue"));
      if (handleFaint(b,"blue","red")) return;
    }
  }

  updateHud();
}

// MVP summary
function computeMvp(b){
  const all = [...b.red.map(m=>({team:"red", m})), ...b.blue.map(m=>({team:"blue", m}))];
  all.sort((a,bx)=> bx.m.dmgDealt - a.m.dmgDealt);
  return all[0];
}

// ---------- Tournament engine + bracket UI ----------
function isPowerOfTwo(n){ return n && (n & (n-1)) === 0; }

async function randomTeamPack(teamName){
  const team=[];
  for (let i=0;i<6;i++){
    const id = randInt(1, 1010);
    const p = await cachedFetchJson(`${POKEAPI}/pokemon/${id}`, `pokemonid:${id}`, 1000*60*60*24*180);
    team.push(await loadPokemon(p.name, 50));
  }
  return { name: teamName, mons: team };
}

async function buildTournamentTeams(size){
  const saved = savedLoad();
  const pool = [];

  for (const s of saved){
    if (s.red?.length) pool.push({ name: `${s.name} (Red)`, mons: deepCopy(s.red) });
    if (s.blue?.length) pool.push({ name: `${s.name} (Blue)`, mons: deepCopy(s.blue) });
  }
  if (state.red.length) pool.push({ name: state.teamNames.red, mons: deepCopy(state.red) });
  if (state.blue.length) pool.push({ name: state.teamNames.blue, mons: deepCopy(state.blue) });

  while (pool.length < size){
    const cpuName = `CPU Team ${pool.length+1}`;
    pool.push(await randomTeamPack(cpuName));
    const ts = $("tournamentStatus"); if (ts) ts.textContent = `Building… ${pool.length}/${size}`;
  }

  // shuffle
  for (let i=pool.length-1;i>0;i--){
    const j = randInt(0,i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0,size);
}

function makePairs(list){
  const pairs=[];
  for (let i=0;i<list.length;i+=2) pairs.push([list[i], list[i+1]]);
  return pairs;
}

function bracketRoundsCount(size){
  let r=0; while(size>1){ size/=2; r++; } return r;
}

function renderBracket(bracketModel){
  const root = $("bracket");
  if (!root) return;
  root.innerHTML = "";

  bracketModel.rounds.forEach((round, rIdx)=>{
    const col = document.createElement("div");
    col.className = "round";
    col.innerHTML = `<div class="roundTitle">Round ${rIdx+1}</div>`;
    round.matches.forEach((m, mIdx)=>{
      const div = document.createElement("div");
      div.className = "match";

      const a = m.a?.name || "TBD";
      const b = m.b?.name || "TBD";
      const w = m.winner?.name || "";

      div.innerHTML = `
        <div class="line"><span>${a}</span><span class="meta">${m.a ? "" : ""}</span></div>
        <div class="line"><span>${b}</span><span class="meta">${m.b ? "" : ""}</span></div>
        ${w ? `<div class="winner" style="margin-top:6px">Winner: ${w}</div>` : `<div class="meta" style="margin-top:6px">Not played yet</div>`}
        ${m.a && m.b ? `<div class="row" style="margin-top:8px">
          <button class="watch mini" data-watch="${rIdx}:${mIdx}">🎥 Watch</button>
          <span class="meta">${m.played ? "Played" : "Unplayed"}</span>
        </div>` : ``}
      `;
      col.appendChild(div);
    });
    root.appendChild(col);
  });
}

function buildEmptyBracket(teams){
  const rounds = [];
  let current = teams.map(t => ({ ...t }));
  const rCount = bracketRoundsCount(current.length);

  for (let r=0;r<rCount;r++){
    const pairs = makePairs(current);
    rounds.push({
      matches: pairs.map(([a,b])=>({ a, b, winner:null, played:false }))
    });
    // placeholder winners list for next round
    current = pairs.map(()=>null);
  }

  return { rounds, size: teams.length };
}

function getMatch(bracketModel, rIdx, mIdx){
  return bracketModel.rounds?.[rIdx]?.matches?.[mIdx] || null;
}

function setNextRoundSlot(bracketModel, rIdx, mIdx, winnerTeam){
  const nextRound = bracketModel.rounds?.[rIdx+1];
  if (!nextRound) return;
  const nextMatchIdx = Math.floor(mIdx/2);
  const slot = (mIdx % 2 === 0) ? "a" : "b";
  nextRound.matches[nextMatchIdx][slot] = winnerTeam;
}

// headless simulate to end (fast)
function simToEndHeadless(b, maxTurns=650){
  let safety=0;
  while(!b.over && safety<maxTurns){
    // silent, no TTS
    const prevTTS=TTS_ENABLED;
    TTS_ENABLED=false;
    stepBattle(b);
    TTS_ENABLED=prevTTS;
    safety++;
  }
  if (!b.meta.winner){
    const rAlive = aliveCount(b.red);
    const bAlive = aliveCount(b.blue);
    b.over = true;
    b.meta.winner = (rAlive>=bAlive) ? "red" : "blue";
    b.meta.turns = b.turn;
  }
  return b;
}

// Live watch a match in a modal (uses real battle log)
function openModal(title, html){
  const modal=$("modal"), body=$("modalBody"), t=$("modalTitle");
  if (!modal||!body||!t) return;
  t.textContent = title;
  body.innerHTML = html;
  modal.classList.remove("hidden");
}
function closeModal(){
  const modal=$("modal");
  if (modal) modal.classList.add("hidden");
}

async function watchMatchLive(aTeam, bTeam){
  // reset log in modal
  openModal(`🎥 ${aTeam.name} vs ${bTeam.name}`, `
    <div class="grid2">
      <div class="panel">
        <div class="teamHead"><span>${aTeam.name}</span><span class="meta">Live</span></div>
        <div class="meta">6 Pokémon</div>
      </div>
      <div class="panel">
        <div class="teamHead"><span>${bTeam.name}</span><span class="meta">Live</span></div>
        <div class="meta">6 Pokémon</div>
      </div>
    </div>
    <div class="panel" style="margin-top:10px">
      <div class="teamHead"><span>Match Log</span><span class="meta" id="modalTurn">—</span></div>
      <div id="modalLog" style="white-space:pre-wrap;font-family:ui-monospace,monospace;background:#000;border-radius:12px;padding:10px;height:260px;overflow:auto;border:1px solid #111"></div>
    </div>
  `);

  const modalLog = document.getElementById("modalLog");
  const modalTurn = document.getElementById("modalTurn");

  // create separate battle so it doesn't disturb main state
  const b = newBattleFromTeams(aTeam.mons, bTeam.mons, { red:aTeam.name, blue:bTeam.name });
  // disable main log spam
  const originalLog = $("log");
  const originalText = originalLog ? originalLog.textContent : "";

  // hijack logLine temporarily (local)
  const _logLine = (msg, say=false) => {
    const t = new Date();
    const stamp = `${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}:${t.getSeconds().toString().padStart(2,"0")}`;
    if (modalLog){
      modalLog.textContent += `[${stamp}] ${msg}\n`;
      modalLog.scrollTop = modalLog.scrollHeight;
    }
    if (say) speak(msg);
  };

  // run loop with small delay
  let safety=0;
  while(!b.over && safety<900){
    b.turn++;
    modalTurn && (modalTurn.textContent = `Turn ${b.turn}`);

    // simplified step using our functions but routed log to modal
    // We'll call the same step logic but temporarily swap global logger:
    // easiest safe method: just duplicate minimal step with _logLine.
    // So: manual stepBattleModal:
    const stepBattleModal = () => {
      if (b.over) return;

      if (b.turn===1 || roll(35)) _logLine(`✨ ${pick(FLAVOR.turnStart)}`, true);

      const r0 = active(b,"red");
      const u0 = active(b,"blue");
      if (!r0 || !u0) return;

      const redAction  = decideAIAction({ b, teamKey:"red",  list:b.red,  activeIndex:b.rIndex, enemyActive:u0 });
      const blueAction = decideAIAction({ b, teamKey:"blue", list:b.blue, activeIndex:b.bIndex, enemyActive:r0 });

      if (redAction.type==="switch"){ b.rIndex = redAction.to; _logLine(`${b.names.red} ${pick(FLAVOR.switchOut)} ➜ ${active(b,"red").display}!`, true); }
      if (blueAction.type==="switch"){ b.bIndex = blueAction.to; _logLine(`${b.names.blue} ${pick(FLAVOR.switchOut)} ➜ ${active(b,"blue").display}!`, true); }
      if (redAction.type==="switch" && blueAction.type==="switch") return;

      const r = active(b,"red");
      const u = active(b,"blue");
      if (!r || !u) return;

      const rMove = (redAction.type==="move" && redAction.move) ? redAction.move : bestMove(r,u) || r.moves[0];
      const uMove = (blueAction.type==="move" && blueAction.move) ? blueAction.move : bestMove(u,r) || u.moves[0];

      const doAttackModal = (atkTeamKey, atkMon, mv, defTeamKey, defMon) => {
        if (atkMon.fainted || defMon.fainted) return;
        const atkName = b.names[atkTeamKey];
        const defName = b.names[defTeamKey];

        if (!roll(mv.acc ?? 100)){ _logLine(`${atkName} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}${pick(FLAVOR.miss)}`, true); atkMon._hitsInRow=0; return; }

        const ctx={ attacker:atkMon, defender:defMon, move:mv };
        if (defMon.secret && defMon.secret.when(ctx)){ const msg=defMon.secret.apply(ctx); _logLine(`${defName} ${defMon.display}'s secret (${revealSecret(defMon.secret)}) stirs… ${msg}`, true); markSecretFound(defMon.secret); }
        if (atkMon.secret && atkMon.secret.when(ctx)){ const msg=atkMon.secret.apply(ctx); _logLine(`${atkName} ${atkMon.display}'s secret (${revealSecret(atkMon.secret)}) awakens… ${msg}`, true); markSecretFound(atkMon.secret); }

        const powBoost = atkMon._powerBoost || 1;
        const critBoost = atkMon._critBoost || false;
        const shield = defMon._shield || 1;

        const mv2 = { ...mv, power: Math.floor((mv.power||40)*powBoost) };
        const d = damageFormula(atkMon, defMon, mv2, b, atkTeamKey, defTeamKey);

        let dmg = Math.floor(d.dmg * (1/shield));
        defMon._shield=1;
        if (critBoost){ dmg=Math.floor(dmg*1.5); atkMon._critBoost=false; }

        defMon.curHP = Math.max(0, defMon.curHP - dmg);
        atkMon.dmgDealt += dmg;
        atkMon._hitsInRow = (atkMon._hitsInRow||0)+1;

        _logLine(`${atkName} ${atkMon.display} ${pick(FLAVOR.attackLead)} used ${cap(mv.name.replace(/-/g," "))}! (-${dmg} HP)`, true);
        if (d.crit) _logLine(`  ➤ Critical hit! ${pick(FLAVOR.crit)}`, true);
        if (d.eff >= 2) _logLine(`  ➤ Super effective! ${pick(FLAVOR.super)}`, true);
        if (d.eff > 0 && d.eff < 1) _logLine(`  ➤ Not very effective… ${pick(FLAVOR.notVery)}`);
        if (d.eff === 0) _logLine(`  ➤ No effect… ${pick(FLAVOR.immune)}`, true);
      };

      const handleFaintModal = (defTeamKey, atkTeamKey) => {
        const defMon = active(b, defTeamKey);
        if (!defMon || defMon.curHP>0) return false;

        const defName=b.names[defTeamKey];
        const atkName=b.names[atkTeamKey];
        defMon.fainted=true;
        _logLine(`${defName} ${defMon.display} fainted! ${pick(FLAVOR.faint)}`, true);

        const atkMon = active(b, atkTeamKey);
        if (atkMon && !atkMon.fainted) atkMon.kos++;

        const list = defTeamKey==="red" ? b.red : b.blue;
        const idx  = defTeamKey==="red" ? b.rIndex : b.bIndex;
        const next = nextAliveIndex(list, idx);

        if (next===-1){
          b.over=true;
          b.meta.winner=atkTeamKey;
          b.meta.turns=b.turn;
          _logLine(`🏁 ${atkName} wins the match!`, true);
          return true;
        } else {
          if (defTeamKey==="red") b.rIndex=next; else b.bIndex=next;
          const newActive = active(b, defTeamKey);
          _logLine(`${defName} sends out ${newActive.display} — it ${pick(FLAVOR.sendOut)}`, true);
          return false;
        }
      };

      // one switched
      if (redAction.type!=="switch" && blueAction.type==="switch"){ doAttackModal("red",r,rMove,"blue",u); if(handleFaintModal("blue","red")) return; return; }
      if (redAction.type==="switch" && blueAction.type!=="switch"){ doAttackModal("blue",u,uMove,"red",r); if(handleFaintModal("red","blue")) return; return; }

      const rFirst = (r.stats.spe > u.stats.spe) || (r.stats.spe===u.stats.spe && roll(50));
      if (rFirst){
        doAttackModal("red",r,rMove,"blue",u);
        if (handleFaintModal("blue","red")) return;
        const u2=active(b,"blue");
        if (u2 && !u2.fainted){
          doAttackModal("blue",u2,uMove,"red",active(b,"red"));
          if (handleFaintModal("red","blue")) return;
        }
      } else {
        doAttackModal("blue",u,uMove,"red",r);
        if (handleFaintModal("red","blue")) return;
        const r2=active(b,"red");
        if (r2 && !r2.fainted){
          doAttackModal("red",r2,rMove,"blue",active(b,"blue"));
          if (handleFaintModal("blue","red")) return;
        }
      }
    };

    stepBattleModal();

    safety++;
    if (!b.over) await new Promise(r=>setTimeout(r, state.tickMs));
  }

  const winnerName = b.names[b.meta.winner];
  const loserName = b.names[b.meta.winner==="red" ? "blue" : "red"];
  lbRecordMatch(winnerName, loserName, b.meta.turns);
  const mvp = computeMvp(b);
  _logLine(`🏅 MVP: ${b.names[mvp.team]} ${mvp.m.display} (Damage: ${mvp.m.dmgDealt})`, true);

  // restore main log (no change)
  if (originalLog) originalLog.textContent = originalText;
  return { winnerName, loserName, turns:b.meta.turns, battle:b };
}

async function runTournament(){
  const size = parseInt($("tournamentSize")?.value || "8", 10);
  if (!isPowerOfTwo(size)){ setStatus("Tournament size must be 4/8/16."); return; }

  stopSpeaking();
  $("bracket") && ($("bracket").innerHTML = "");
  $("tournamentStatus") && ($("tournamentStatus").textContent = "Building teams…");
  setStatus("Building tournament…");

  const teams = await buildTournamentTeams(size);
  const bracketModel = buildEmptyBracket(teams);
  renderBracket(bracketModel);

  const live = !!state.tournamentLive;
  $("tournamentStatus") && ($("tournamentStatus").textContent = live ? "Live mode" : "Fast mode");

  logLine(`🏆 Tournament begins! (${size} teams)`, true);

  // play rounds
  for (let r=0; r<bracketModel.rounds.length; r++){
    for (let m=0; m<bracketModel.rounds[r].matches.length; m++){
      const match = bracketModel.rounds[r].matches[m];
      if (!match.a || !match.b) continue;

      if (!live){
        // fast sim
        const battle = newBattleFromTeams(match.a.mons, match.b.mons, { red:match.a.name, blue:match.b.name });
        simToEndHeadless(battle, 650);
        const winKey = battle.meta.winner;
        const winner = { name: battle.names[winKey], mons: (winKey==="red" ? match.a.mons : match.b.mons) };

        match.winner = winner;
        match.played = true;
        setNextRoundSlot(bracketModel, r, m, winner);
        renderBracket(bracketModel);

        const loserName = battle.names[winKey==="red"?"blue":"red"];
        lbRecordMatch(winner.name, loserName, battle.meta.turns);

        logLine(`✅ ${match.a.name} vs ${match.b.name} → Winner: ${winner.name} (${battle.meta.turns} turns)`, true);
      } else {
        // live watch (auto)
        const res = await watchMatchLive(match.a, match.b);
        const winnerName = res.winnerName;
        const winner = (winnerName === match.a.name) ? match.a : match.b;
        match.winner = { name: winner.name, mons: winner.mons };
        match.played = true;
        setNextRoundSlot(bracketModel, r, m, match.winner);
        renderBracket(bracketModel);

        logLine(`✅ Winner: ${winnerName} (${res.turns} turns)`, true);
      }
    }
  }

  // champion
  const lastRound = bracketModel.rounds[bracketModel.rounds.length-1];
  const champ = lastRound.matches[0].winner;
  if (champ){
    logLine(`🏆 TOURNAMENT CHAMPION: ${champ.name}!`, true);
    lbRecordTitle(champ.name);
    $("tournamentStatus") && ($("tournamentStatus").textContent = `Champion: ${champ.name}`);
    setStatus("Tournament complete!");
  } else {
    setStatus("Tournament ended (no champion?)");
  }
  renderLeaderboard();
}

// ---------- Tabs ----------
function setTab(tabName){
  document.querySelectorAll(".tabBtn").forEach(b=>{
    b.classList.toggle("active", b.dataset.tab===tabName);
  });
  const sections = ["battle","tournament","pokedex","leaderboard"];
  sections.forEach(n=>{
    const el = document.getElementById(`tab-${n}`);
    if (el) el.classList.toggle("hidden", n!==tabName);
  });
}

// ---------- Global click for team list controls + bracket watch ----------
document.addEventListener("click", async (e)=>{
  const btn = e.target.closest("button");
  if (!btn) return;

  // Team list actions
  const act = btn.dataset.act;
  if (act){
    const team = btn.dataset.team;
    const i = parseInt(btn.dataset.i,10);
    if (!team || !Number.isFinite(i)) return;

    if (act==="del") state[team].splice(i,1);
    if (act==="up" && i>0) [state[team][i-1], state[team][i]] = [state[team][i], state[team][i-1]];
    if (act==="down" && i<state[team].length-1) [state[team][i+1], state[team][i]] = [state[team][i], state[team][i+1]];
    renderTeams();
    return;
  }

  // Bracket "Watch" buttons
  const watchKey = btn.dataset.watch;
  if (watchKey){
    const [rIdxS, mIdxS] = watchKey.split(":");
    const rIdx = parseInt(rIdxS,10);
    const mIdx = parseInt(mIdxS,10);
    if (!window.__BRACKET_MODEL__) return;
    const match = getMatch(window.__BRACKET_MODEL__, rIdx, mIdx);
    if (!match || !match.a || !match.b) return;
    await watchMatchLive(match.a, match.b);
  }
});

// ---------- Wire UI ----------
document.addEventListener("DOMContentLoaded", ()=>{
  setStatus("✅ app.js loaded");
  setBattleStatus("No battle yet");

  // Tabs
  document.querySelectorAll(".tabBtn").forEach(b=>{
    b.addEventListener("click", ()=> setTab(b.dataset.tab));
  });

  // Modal
  $("modalClose")?.addEventListener("click", closeModal);
  $("modal")?.addEventListener("click", (e)=>{ if (e.target?.id==="modal") closeModal(); });

  // Restore names
  $("redName") && ($("redName").value = state.teamNames.red);
  $("blueName") && ($("blueName").value = state.teamNames.blue);

  const updateNames = ()=>{
    state.teamNames.red = $("redName")?.value?.trim() || "Red";
    state.teamNames.blue = $("blueName")?.value?.trim() || "Blue";
    cacheSet("teamNames", state.teamNames);

    const redOpt = $("teamPick")?.querySelector('option[value="red"]');
    const bluOpt = $("teamPick")?.querySelector('option[value="blue"]');
    if (redOpt) redOpt.textContent = state.teamNames.red;
    if (bluOpt) bluOpt.textContent = state.teamNames.blue;

    renderTeams();
  };
  $("redName")?.addEventListener("input", updateNames);
  $("blueName")?.addEventListener("input", updateNames);
  updateNames();

  // TTS
  updateTtsBtn();
  populateVoiceSelect();
  if ("speechSynthesis" in window){
    speechSynthesis.onvoiceschanged = ()=> populateVoiceSelect();
  }
  $("ttsBtn")?.addEventListener("click", ()=>{
    TTS_ENABLED = !TTS_ENABLED;
    cacheSet("ttsEnabled", TTS_ENABLED);
    updateTtsBtn();
    if (!TTS_ENABLED) stopSpeaking();
    else speak("Announcer online. Let's battle!");
  });
  $("voiceSelect")?.addEventListener("change", (e)=>{
    const uri = e.target.value;
    TTS_VOICE_URI = uri;
    cacheSet("ttsVoiceUri", TTS_VOICE_URI);
  });

  // Speed
  $("speedSelect") && ($("speedSelect").value = String(state.tickMs));
  $("speedSelect")?.addEventListener("change", (e)=>{
    state.tickMs = parseInt(e.target.value,10);
    cacheSet("tickMs", state.tickMs);
  });

  // Clear log
  $("clearLogBtn")?.addEventListener("click", ()=>{
    $("log") && ($("log").textContent = "");
  });

  // Add mon
  $("addBtn")?.addEventListener("click", async ()=>{
    const name = $("searchName")?.value;
    const team = $("teamPick")?.value || "red";
    const level = parseInt($("levelPick")?.value || "50",10);
    if (!name) return;
    if (state[team].length >= 6){ setStatus("That team already has 6."); return; }

    setStatus("Loading…");
    try{
      const mon = await loadPokemon(name, level);
      state[team].push(mon);
      renderTeams();
      logLine(`Added ${mon.display} to ${state.teamNames[team]} (Lv ${level}).`);
      setStatus("Ready");
      $("searchName") && ($("searchName").value="");
    }catch(err){
      console.error(err);
      setStatus("Couldn’t find that Pokémon. Try a different spelling.");
    }
  });

  // Random teams
  $("randomBtn")?.addEventListener("click", async ()=>{
    const randId = () => randInt(1, 1010);
    state.red=[]; state.blue=[];
    renderTeams();
    $("log") && ($("log").textContent="");
    setStatus("Loading random teams…");
    try{
      for (let i=0;i<6;i++){
        const rid=randId(), bid=randId();
        const r = await cachedFetchJson(`${POKEAPI}/pokemon/${rid}`, `pokemonid:${rid}`, 1000*60*60*24*180);
        const b = await cachedFetchJson(`${POKEAPI}/pokemon/${bid}`, `pokemonid:${bid}`, 1000*60*60*24*180);
        state.red.push(await loadPokemon(r.name, 50));
        state.blue.push(await loadPokemon(b.name, 50));
        renderTeams();
        await new Promise(r=>setTimeout(r, 20));
      }
      setStatus("Ready");
      logLine("Random teams generated.", true);
    }catch(err){
      console.error(err);
      setStatus("Random team failed (network?). Try again.");
    }
  });

  // Clear
  $("clearBtn")?.addEventListener("click", ()=>{
    state.red=[]; state.blue=[];
    state.battle=null;
    $("log") && ($("log").textContent="");
    $("secretBox") && ($("secretBox").classList.add("hidden"));
    setBattleStatus("No battle yet");
    renderTeams();
    updateHud();
    stopSpeaking();
  });

  // Sim battle
  $("simBtn")?.addEventListener("click", ()=>{
    $("log") && ($("log").textContent="");
    $("secretBox") && ($("secretBox").classList.add("hidden"));
    stopSpeaking();

    state.battle = newBattleFromTeams(state.red, state.blue, { red:state.teamNames.red, blue:state.teamNames.blue });

    const rt = state.battle.traits.red;
    const bt = state.battle.traits.blue;

    setBattleStatus("Battle started");
    logLine(`⚔️ ${state.teamNames.red} vs ${state.teamNames.blue} — FIGHT!`, true);
    logLine(`${state.teamNames.red} trait: ${rt.name}. ${rt.desc}`, true);
    logLine(`${state.teamNames.blue} trait: ${bt.name}. ${bt.desc}`, true);

    updateHud();
    $("stepBtn") && ($("stepBtn").disabled=false);

    let safety=0;
    const tick=()=>{
      const b = state.battle;
      if (!b || b.over){
        if (b?.over){
          const winName = b.names[b.meta.winner];
          const loseName = b.names[b.meta.winner==="red" ? "blue" : "red"];
          lbRecordMatch(winName, loseName, b.meta.turns || b.turn || 0);
          const mvp = computeMvp(b);
          logLine(`🏅 MVP: ${b.names[mvp.team]} ${mvp.m.display} (Damage: ${mvp.m.dmgDealt})`, true);
          setStatus("Battle complete!");
          renderLeaderboard();
        }
        return;
      }
      stepBattle(b);
      safety++;
      if (safety<900 && !b.over) setTimeout(tick, state.tickMs);
    };
    tick();
  });

  // Step
  $("stepBtn")?.addEventListener("click", ()=>{
    if (!state.battle) return;
    stepBattle(state.battle);
    updateHud();
    if (state.battle.over){
      const winName = state.battle.names[state.battle.meta.winner];
      const loseName = state.battle.names[state.battle.meta.winner==="red" ? "blue" : "red"];
      lbRecordMatch(winName, loseName, state.battle.meta.turns || state.battle.turn || 0);
      renderLeaderboard();
    }
  });

  // Save/Load teams
  fillSavedSelect();
  $("saveTeamBtn")?.addEventListener("click", ()=>{
    if (!state.red.length && !state.blue.length){ setStatus("Nothing to save."); return; }
    const list = savedLoad();
    const id = `${Date.now()}`;
    const name = prompt("Name this saved set (includes BOTH Red+Blue rosters):", `Saved ${new Date().toLocaleString()}`);
    if (!name) return;
    list.unshift({ id, name, red: deepCopy(state.red), blue: deepCopy(state.blue), createdAt: Date.now() });
    savedSave(list);
    fillSavedSelect();
    setStatus("Saved!");
  });

  $("loadSavedBtn")?.addEventListener("click", ()=>{
    const id = $("savedTeamsSelect")?.value;
    if (!id) return;
    const list = savedLoad();
    const found = list.find(x=>x.id===id);
    if (!found) return;
    state.red = deepCopy(found.red||[]);
    state.blue = deepCopy(found.blue||[]);
    renderTeams();
    setStatus(`Loaded: ${found.name}`);
  });

  $("deleteSavedBtn")?.addEventListener("click", ()=>{
    const id = $("savedTeamsSelect")?.value;
    if (!id) return;
    savedSave(savedLoad().filter(x=>x.id!==id));
    fillSavedSelect();
    setStatus("Deleted saved set.");
  });

  // Tournament
  $("tournamentLiveBtn") && ($("tournamentLiveBtn").textContent = state.tournamentLive ? "🎥 Live Watch Matches: ON" : "🎥 Live Watch Matches: OFF");
  $("tournamentLiveBtn")?.addEventListener("click", ()=>{
    state.tournamentLive = !state.tournamentLive;
    cacheSet("tournamentLive", state.tournamentLive);
    $("tournamentLiveBtn").textContent = state.tournamentLive ? "🎥 Live Watch Matches: ON" : "🎥 Live Watch Matches: OFF";
  });

  $("tournamentBtn")?.addEventListener("click", async ()=>{
    try{
      setTab("tournament");
      setStatus("Running tournament…");
      const teams = await buildTournamentTeams(parseInt($("tournamentSize")?.value || "8", 10));
      window.__BRACKET_MODEL__ = buildEmptyBracket(teams);
      renderBracket(window.__BRACKET_MODEL__);
      await runTournament();
    }catch(err){
      console.error(err);
      setStatus("Tournament failed (see console).");
    }
  });

  // Leaderboard
  $("leaderboardRefreshBtn")?.addEventListener("click", renderLeaderboard);
  $("leaderboardResetBtn")?.addEventListener("click", ()=>{
    if (!confirm("Reset leaderboard?")) return;
    localStorage.removeItem(LB_KEY);
    renderLeaderboard();
  });
  renderLeaderboard();

  // Install hint
  $("installHintBtn")?.addEventListener("click", ()=>{
    alert("Android (Chrome): open this URL ➜ tap ⋮ ➜ Install app / Add to Home screen.\n\nIf things act weird after updates, hard refresh: open ⋮ ➜ Settings ➜ Site settings ➜ Storage ➜ Clear.");
  });

  // Service worker
  if ("serviceWorker" in navigator){
    window.addEventListener("load", async ()=>{
      try{ await navigator.serviceWorker.register("./sw.js"); }catch{}
    });
  }

  renderTeams();
  updateHud();
  fillSavedSelect();
  setStatus("Ready");
  logLine("Ready. Add Pokémon to Red and Blue, then Sim Battle.");
});
