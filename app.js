// Red vs Blue Battle Sim (MVP)
// - Uses PokéAPI for stats/types/moves and caches responses locally.
// - Simplified battle rules (fast + fun). Upgraded AI + switching.

const POKEAPI = "https://pokeapi.co/api/v2";
const $ = (id) => document.getElementById(id);

// --- Simple local cache (localStorage). Polite caching is recommended by PokéAPI docs. ---
function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function cacheSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
async function cachedFetchJson(url, cacheKey, maxAgeMs = 1000*60*60*24*30) { // 30 days
  const cached = cacheGet(cacheKey);
  if (cached && cached.t && (Date.now() - cached.t) < maxAgeMs) return cached.v;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  cacheSet(cacheKey, { t: Date.now(), v: json });
  return json;
}

// --- Type chart (Gen 6+ style effectiveness) ---
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

// --- Teams ---
const state = {
  red: [],
  blue: [],
  battle: null,
  secretsFound: cacheGet("secretsFound") || {}, // {key: true}
};

function cap(s){ return s ? s[0].toUpperCase()+s.slice(1) : s; }
function normName(s){ return (s||"").trim().toLowerCase().replace(/\s+/g,"-"); }

function logLine(msg){
  const el = $("log");
  const t = new Date();
  const stamp = `${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}:${t.getSeconds().toString().padStart(2,"0")}`;
  el.textContent += `[${stamp}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(msg){ $("status").textContent = msg; }
function setBattleStatus(msg){ $("battleStatus").textContent = msg; }

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
  const moveEntries = pokemonJson.moves?.slice(0, 60) || [];
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
    await new Promise(r => setTimeout(r, 60));
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

// --- UI render ---
function renderTeams(){
  const red = $("redList"), blue = $("blueList");
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
  $("redCount").textContent = `${state.red.length}/6`;
  $("blueCount").textContent = `${state.blue.length}/6`;

  const ready = state.red.length > 0 && state.blue.length > 0;
  $("simBtn").disabled = !ready;
  $("stepBtn").disabled = true;
}

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

// --- Battle sim (simplified, but fun) ---
function cloneMon(mon){
  return {
    ...mon,
    curHP: mon.stats.hp,
    fainted:false,
    boosts:{atk:0,def:0,spa:0,spd:0,spe:0},
    secret: null
  };
}

function roll(pct){ return Math.random()*100 < pct; }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }

function stab(moveType, userTypes){ return userTypes.includes(moveType) ? 1.5 : 1; }

function damageFormula(attacker, defender, move){
  const level = attacker.level;
  const A = (move.kind==="physical") ? attacker.stats.atk : attacker.stats.spa;
  const D = (move.kind==="physical") ? defender.stats.def : defender.stats.spd;

  const base = Math.floor((((2*level/5)+2) * move.power * (A/D)) / 50) + 2;
  const eff = typeEffect(move.type, defender.types);
  const s = stab(move.type, attacker.types);
  const crit = roll(6.25) ? 1.5 : 1;
  const random = randInt(85,100)/100;

  return { dmg: Math.max(1, Math.floor(base * eff * s * crit * random)), eff, crit: (crit>1) };
}

// --- Secret abilities ---
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
  }
}

// Battle object
function newBattle(){
  const b = {
    red: state.red.map(cloneMon),
    blue: state.blue.map(cloneMon),
    rIndex: 0,
    bIndex: 0,
    over: false,
    turn: 0
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

// -------- Better AI + Switching (works with your data model) --------
function hpPct(mon){ return mon.curHP / Math.max(1, mon.stats.hp); }

function expectedDamageSimple(attacker, defender, mv){
  // deterministic-ish "expected" damage using your damage formula ingredients (no crit/random)
  const level = attacker.level;
  const A = (mv.kind==="physical") ? attacker.stats.atk : attacker.stats.spa;
  const D = (mv.kind==="physical") ? defender.stats.def : defender.stats.spd;

  const power = mv.power || 40;
  const base = (((2*level/5)+2) * power * (A/Math.max(1, D))) / 50 + 2;

  const eff = typeEffect(mv.type, defender.types);
  const s = stab(mv.type, attacker.types);
  const acc = (mv.acc ?? 100) / 100;

  // expected roll average ~0.925, crit EV ~1.03125
  const rollEV = 0.925;
  const critEV = 1.03125;

  return base * eff * s * acc * rollEV * critEV;
}

function bestMove(attacker, defender){
  if (!attacker.moves?.length) return null;
  let best = attacker.moves[0];
  let bestScore = -Infinity;
  for (const mv of attacker.moves) {
    const score = expectedDamageSimple(attacker, defender, mv) + Math.random() * 2; // tiny variety
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
  return (out * speedEdge) - (inc * 0.9);
}

function chooseBestSwitch(list, activeIdx, enemyActive){
  let bestIdx = null;
  let best = -Infinity;
  for (let i=0;i<list.length;i++){
    if (i === activeIdx) continue;
    const cand = list[i];
    if (!cand || cand.fainted || cand.curHP <= 0) continue;

    const score = matchupScore(cand, enemyActive);

    // don't switch into obvious death
    const their = bestMove(enemyActive, cand);
    const danger = their ? expectedDamageSimple(enemyActive, cand, their) : 0;
    const finalScore = score - danger * 0.5;

    if (finalScore > best) { best = finalScore; bestIdx = i; }
  }
  return bestIdx;
}

function decideAIAction({ list, activeIndex, enemyActive }){
  const activeMon = list[activeIndex];
  if (!activeMon || activeMon.fainted || activeMon.curHP <= 0) {
    const forced = chooseBestSwitch(list, activeIndex, enemyActive);
    return forced !== null ? { type:"switch", to: forced } : { type:"struggle" };
  }

  const scoreNow = matchupScore(activeMon, enemyActive);
  const low = hpPct(activeMon) <= 0.35;
  const veryLow = hpPct(activeMon) <= 0.20;

  const bestIdx = chooseBestSwitch(list, activeIndex, enemyActive);
  if (bestIdx !== null) {
    const swScore = matchupScore(list[bestIdx], enemyActive);
    const should =
      (scoreNow < -12 && swScore > scoreNow + 6) ||
      (low && swScore > scoreNow + 4) ||
      (veryLow && swScore > scoreNow - 1);

    const bias = should ? 0.85 : 0.10;
    if (Math.random() < bias) return { type:"switch", to: bestIdx };
  }

  return { type:"move", move: bestMove(activeMon, enemyActive) };
}

function updateHud(){
  if (!state.battle) return;
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
}

function shake(team){
  const el = team==="red" ? $("hudRed") : $("hudBlue");
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function doAttack(atkTeam, atkMon, mv, defTeam, defMon){
  if (atkMon.fainted || defMon.fainted) return;

  // Accuracy
  if (!roll(mv.acc ?? 100)) {
    logLine(`${atkTeam.toUpperCase()} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}… and missed!`);
    atkMon._hitsInRow = 0;
    return;
  }

  // Secrets
  const ctx = { attacker: atkMon, defender: defMon, move: mv };
  if (defMon.secret && defMon.secret.when(ctx)) {
    const msg = defMon.secret.apply(ctx);
    logLine(`${defTeam.toUpperCase()} ${defMon.display}'s secret (${revealSecret(defMon.secret)}) stirs… ${msg}`);
    markSecretFound(defMon.secret);
  }
  if (atkMon.secret && atkMon.secret.when(ctx)) {
    const msg = atkMon.secret.apply(ctx);
    logLine(`${atkTeam.toUpperCase()} ${atkMon.display}'s secret (${revealSecret(atkMon.secret)}) awakens… ${msg}`);
    markSecretFound(atkMon.secret);
  }

  // Damage
  const powBoost = atkMon._powerBoost || 1;
  const critBoost = atkMon._critBoost || false;
  const shield = defMon._shield || 1;

  const mv2 = {...mv, power: Math.floor((mv.power||40)*powBoost)};
  const d = damageFormula(atkMon, defMon, mv2);

  let dmg = Math.floor(d.dmg * (1/shield));
  defMon._shield = 1; // consume shield
  if (critBoost) { dmg = Math.floor(dmg*1.5); atkMon._critBoost=false; }

  defMon.curHP = Math.max(0, defMon.curHP - dmg);
  atkMon._hitsInRow = (atkMon._hitsInRow||0) + 1;

  logLine(`${atkTeam.toUpperCase()} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}! (-${dmg} HP)`);

  if (d.crit) logLine(`  ➤ Critical hit!`);
  if (d.eff >= 2) logLine(`  ➤ It's super effective!`);
  if (d.eff > 0 && d.eff < 1) logLine(`  ➤ It's not very effective…`);
  if (d.eff === 0) logLine(`  ➤ It doesn't affect the target…`);

  shake(defTeam);
  updateHud();
}

function handleFaint(defTeam, atkTeam){
  const b = state.battle;
  const defMon = active(b, defTeam);
  if (!defMon || defMon.curHP > 0) return false;

  defMon.fainted = true;
  logLine(`${defTeam.toUpperCase()} ${defMon.display} fainted!`);

  const list = defTeam==="red" ? b.red : b.blue;
  const idx = defTeam==="red" ? b.rIndex : b.bIndex;
  const next = nextAliveIndex(list, idx);

  if (next === -1) {
    b.over = true;
    logLine(`🏁 ${atkTeam.toUpperCase()} wins!`);
    setBattleStatus(`${atkTeam.toUpperCase()} wins!`);
    $("stepBtn").disabled = true;
    return true;
  } else {
    if (defTeam==="red") b.rIndex = next;
    else b.bIndex = next;
    const newActive = active(b, defTeam);
    logLine(`${defTeam.toUpperCase()} sends out ${newActive.display}!`);
    updateHud();
    return false;
  }
}

function stepBattle(){
  const b = state.battle;
  if (!b || b.over) return;

  b.turn++;
  setBattleStatus(`Turn ${b.turn}`);

  const r0 = active(b,"red");
  const u0 = active(b,"blue");
  if (!r0 || !u0) return;

  // Decide actions (move or switch)
  const redAction = decideAIAction({ list: b.red, activeIndex: b.rIndex, enemyActive: u0 });
  const blueAction = decideAIAction({ list: b.blue, activeIndex: b.bIndex, enemyActive: r0 });

  // Switches happen first
  if (redAction.type === "switch") {
    b.rIndex = redAction.to;
    logLine(`RED switched to ${active(b,"red").display}!`);
  }
  if (blueAction.type === "switch") {
    b.bIndex = blueAction.to;
    logLine(`BLUE switched to ${active(b,"blue").display}!`);
  }

  updateHud();

  // If both switched, end turn (no damage this step)
  if (redAction.type === "switch" && blueAction.type === "switch") return;

  const r = active(b,"red");
  const u = active(b,"blue");
  if (!r || !u) return;

  // Moves (if they chose move)
  const rMove = (redAction.type === "move" && redAction.move) ? redAction.move : bestMove(r, u) || r.moves[0];
  const uMove = (blueAction.type === "move" && blueAction.move) ? blueAction.move : bestMove(u, r) || u.moves[0];

  // If one switched and the other attacks: attacker hits the NEW active mon
  if (redAction.type !== "switch" && blueAction.type === "switch") {
    doAttack("red", r, rMove, "blue", u);
    if (handleFaint("blue", "red")) return;
    updateHud();
    return;
  }
  if (redAction.type === "switch" && blueAction.type !== "switch") {
    doAttack("blue", u, uMove, "red", r);
    if (handleFaint("red", "blue")) return;
    updateHud();
    return;
  }

  // Both attack: order by speed (random tiebreak)
  const rFirst = (r.stats.spe > u.stats.spe) || (r.stats.spe === u.stats.spe && roll(50));
  if (rFirst) {
    doAttack("red", r, rMove, "blue", u);
    if (handleFaint("blue", "red")) return;
    // If blue fainted and got replaced, refresh u
    const u2 = active(b,"blue");
    if (u2 && !u2.fainted) {
      doAttack("blue", u2, uMove, "red", active(b,"red"));
      if (handleFaint("red", "blue")) return;
    }
  } else {
    doAttack("blue", u, uMove, "red", r);
    if (handleFaint("red", "blue")) return;
    const r2 = active(b,"red");
    if (r2 && !r2.fainted) {
      doAttack("red", r2, rMove, "blue", active(b,"blue"));
      if (handleFaint("blue", "red")) return;
    }
  }

  updateHud();
}

// --- Buttons ---
$("addBtn").addEventListener("click", async ()=>{
  const name = $("searchName").value;
  const team = $("teamPick").value;
  const level = parseInt($("levelPick").value,10);

  if (!name) return;
  if (state[team].length >= 6) { setStatus("That team already has 6."); return; }

  setStatus("Loading…");
  try {
    const mon = await loadPokemon(name, level);
    state[team].push(mon);
    renderTeams();
    logLine(`Added ${mon.display} to ${team.toUpperCase()} (Lv ${level}).`);
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
      await new Promise(r=>setTimeout(r, 60));
    }
    setStatus("Ready");
    logLine("Random teams generated.");
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
});

$("simBtn").addEventListener("click", ()=>{
  $("log").textContent = "";
  $("secretBox").style.display="none";
  state.battle = newBattle();
  setBattleStatus("Battle started");
  logLine("⚔️ Battle start!");
  updateHud();
  $("stepBtn").disabled = false;

  let safety = 0;
  const tick = () => {
    if (!state.battle || state.battle.over) return;
    stepBattle();
    safety++;
    if (safety < 500 && !state.battle.over) setTimeout(tick, 160);
  };
  tick();
});

$("stepBtn").addEventListener("click", ()=>{
  if (!state.battle) return;
  stepBattle();
});

$("installHintBtn").addEventListener("click", ()=>{
  alert("On Android (Chrome): open this app URL ➜ tap ⋮ menu ➜ 'Add to Home screen' / 'Install app'.\n\nPWAs install best when served over HTTPS (not file://).");
});

// --- Service worker registration ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  });
}

// Initial render
renderTeams();
logLine("Ready. Add Pokémon to Red and Blue, then Sim Battle.");
function normName(s){ return (s||"").trim().toLowerCase().replace(/\s+/g,"-"); }

function logLine(msg){
  const el = $("log");
  const t = new Date();
  const stamp = `${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}:${t.getSeconds().toString().padStart(2,"0")}`;
  el.textContent += `[${stamp}] ${msg// ---------- AI + Switching Helpers ----------

// Basic Gen-ish type chart (covers common types). Missing combos default to 1.
const TYPE_CHART = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ground: 2, flying: 2, dragon: 2, steel: 0.5, ice: 0.5 },
  fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, ghost: 0, fairy: 0.5 },
  poison: { grass: 2, fairy: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { grass: 2, electric: 0.5, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
  bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ghost: { psychic: 2, ghost: 2, dark: 0.5, normal: 0 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { psychic: 2, ghost: 2, fighting: 0.5, dark: 0.5, fairy: 0.5 },
  steel: { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 }
};

function typeEffectiveness(moveType, defenderTypes) {
  const chartRow = TYPE_CHART[moveType] || {};
  let mult = 1;
  for (const t of defenderTypes) {
    const m = chartRow[t] ?? 1;
    mult *= m;
  }
  return mult;
}

function stabBonus(moveType, attackerTypes) {
  return attackerTypes.includes(moveType) ? 1.5 : 1;
}

// Expected damage proxy (fast, not perfect)
function expectedDamage({ attacker, defender, move }) {
  // move fields we try to use: power, type, accuracy, damage_class
  const power = move.power ?? 60;
  const acc = (move.accuracy ?? 100) / 100;
  const eff = typeEffectiveness(move.type, defender.types);
  const stab = stabBonus(move.type, attacker.types);

  // Pick atk/def based on physical/special; fallback to atk/def
  const atkStat = move.damage_class === "special" ? attacker.stats.spAtk : attacker.stats.atk;
  const defStat = move.damage_class === "special" ? defender.stats.spDef : defender.stats.def;

  // Very simplified damage core
  const base = ((atkStat / Math.max(1, defStat)) * power);
  const critChance = 0.0625; // ~1/16
  const critMult = 1.5;
  const critEV = (1 - critChance) * 1 + critChance * critMult;

  // Random roll EV ~0.925 average (0.85-1.0)
  const rollEV = 0.925;

  // Add a small “luck” noise so AI isn’t robotic
  const styleNoise = 0.95 + Math.random() * 0.1;

  return base * eff * stab * acc * critEV * rollEV * styleNoise;
}

// Choose best move (by expected damage)
function bestMove(attacker, defender) {
  if (!attacker.moves?.length) return null;
  let best = attacker.moves[0];
  let bestScore = -Infinity;
  for (const mv of attacker.moves) {
    const score = expectedDamage({ attacker, defender, move: mv });
    if (score > bestScore) {
      bestScore = score;
      best = mv;
    }
  }
  return best;
}

// Evaluate matchup: higher = better for attacker
function matchupScore(attacker, defender) {
  const mv = bestMove(attacker, defender);
  const out = mv ? expectedDamage({ attacker, defender, move: mv }) : 0;

  // Approximate incoming threat: assume defender uses its best move too
  const incomingMv = bestMove(defender, attacker);
  const inc = incomingMv ? expectedDamage({ attacker: defender, defender: attacker, move: incomingMv }) : 0;

  // Prefer being faster a bit
  const speedEdge = attacker.stats.spd >= defender.stats.spd ? 1.1 : 0.95;

  return (out * speedEdge) - (inc * 0.9);
}

function hpPct(p) {
  return p.currentHP / Math.max(1, p.maxHP);
}

// Choose switch target if switching is smart
function chooseBestSwitch(team, activeIndex, enemyActive) {
  let bestIdx = null;
  let best = -Infinity;

  for (let i = 0; i < team.length; i++) {
    if (i === activeIndex) continue;
    const cand = team[i];
    if (cand.currentHP <= 0) continue;

    const score = matchupScore(cand, enemyActive);

    // Avoid switching into a big hit (soft penalty)
    const incomingMv = bestMove(enemyActive, cand);
    const danger = incomingMv ? expectedDamage({ attacker: enemyActive, defender: cand, move: incomingMv }) : 0;
    const dangerPenalty = danger * 0.5;

    const finalScore = score - dangerPenalty;
    if (finalScore > best) {
      best = finalScore;
      bestIdx = i;
    }
  }

  return bestIdx;
}
}\n`;
  el.scrollTop = el.scrollHeight;
}
function decideAIAction({ team, activeIndex, enemyActive }) {
  const active = team[activeIndex];

  // If fainted, must switch
  if (active.currentHP <= 0) {
    const forced = chooseBestSwitch(team, activeIndex, enemyActive);
    return forced !== null ? { type: "switch", to: forced } : { type: "struggle" };
  }

  // Check how bad the matchup is
  const scoreNow = matchupScore(active, enemyActive);

  // If low HP and matchup is bad, switching becomes more likely
  const lowHP = hpPct(active) <= 0.35;
  const veryLowHP = hpPct(active) <= 0.20;

  // Evaluate best switch option
  const bestSwitchIdx = chooseBestSwitch(team, activeIndex, enemyActive);
  if (bestSwitchIdx !== null) {
    const switchScore = matchupScore(team[bestSwitchIdx], enemyActive);

    // Switch rules (tuned to "feels smart" without being perfect)
    const shouldSwitch =
      (scoreNow < -15 && switchScore > scoreNow + 8) ||        // clearly losing
      (lowHP && switchScore > scoreNow + 5) ||                 // low HP, better option exists
      (veryLowHP && switchScore > scoreNow - 2);               // emergency switch

    // Add small randomness so it doesn't always do the same thing
    const rng = Math.random();
    const switchBias = shouldSwitch ? 0.85 : 0.10;

    if (rng < switchBias) {
      return { type: "switch", to: bestSwitchIdx };
    }
  }

  // Otherwise, attack with best move
  const mv = bestMove(active, enemyActive);
  return { type: "move", move: mv };
}

function setStatus(msg){ $("status").textContent = msg; }
function setBattleStatus(msg){ $("battleStatus").textContent = msg; }

function spriteUrl(p){
  // Prefer official artwork if present, fallback to front_default
  return p.sprites?.other?.["official-artwork"]?.front_default
      || p.sprites?.front_default
      || "";
}

function calcStats(baseStats, level){
  // Simple-ish Pokémon stat calc (IV=31, EV=0, neutral nature)
  // HP: floor(((2*base+31+0)*level)/100)+level+10
  // Others: floor(((2*base+31+0)*level)/100)+5
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
  // Find up to 4 damaging moves with a known power.
  const out = [];
  const moveEntries = pokemonJson.moves?.slice(0, 60) || [];
  for (const entry of moveEntries) {
    if (out.length >= 4) break;
    const murl = entry.move.url;
    const mname = entry.move.name;
    const m = await cachedFetchJson(murl, `move:${mname}`, 1000*60*60*24*180); // 180 days
    if (!m || m.power == null) continue; // skip status/unknown power
    if (m.damage_class?.name !== "physical" && m.damage_class?.name !== "special") continue;
    out.push({
      name: mname,
      type: m.type?.name || "normal",
      power: m.power || 40,
      acc: m.accuracy ?? 100,
      kind: m.damage_class.name
    });
    // tiny delay to be gentle even though PokéAPI has no hard rate limit
    await new Promise(r => setTimeout(r, 60));
  }
  if (out.length === 0) {
    out.push({name:"tackle", type:"normal", power:40, acc:100, kind:"physical"});
  }
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

// --- UI render ---
function renderTeams(){
  const red = $("redList"), blue = $("blueList");
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
  $("redCount").textContent = `${state.red.length}/6`;
  $("blueCount").textContent = `${state.blue.length}/6`;

  const ready = state.red.length > 0 && state.blue.length > 0;
  $("simBtn").disabled = !ready;
  $("stepBtn").disabled = true;
}

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

// --- Battle sim (simplified, but fun) ---
function cloneMon(mon){
  return {
    ...mon,
    curHP: mon.stats.hp,
    fainted:false,
    boosts:{atk:0,def:0,spa:0,spd:0,spe:0},
    secret: null
  };
}

function roll(pct){ return Math.random()*100 < pct; }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }

function stab(moveType, userTypes){ return userTypes.includes(moveType) ? 1.5 : 1; }

function damageFormula(attacker, defender, move){
  // Simplified damage based on level, power, and relevant stats.
  const level = attacker.level;
  const A = (move.kind==="physical") ? attacker.stats.atk : attacker.stats.spa;
  const D = (move.kind==="physical") ? defender.stats.def : defender.stats.spd;

  const base = Math.floor((((2*level/5)+2) * move.power * (A/D)) / 50) + 2;
  const eff = typeEffect(move.type, defender.types);
  const s = stab(move.type, attacker.types);
  const crit = roll(6.25) ? 1.5 : 1; // classic-ish crit chance
  const random = randInt(85,100)/100;

  return { dmg: Math.max(1, Math.floor(base * eff * s * crit * random)), eff, crit: (crit>1) };
}

// --- Secret abilities ---
// We keep them "found through playing": show ??? until discovered, then log the name.
const SECRET_POOL = [
  {
    key:"last-stand",
    name:"Last Stand",
    hint:"Triggers when a Pokémon drops very low and refuses to fall.",
    when:(ctx)=> ctx.defender.curHP <= Math.floor(ctx.defender.stats.hp*0.12) && !ctx.defender._lastStandUsed,
    apply:(ctx)=>{
      ctx.defender._lastStandUsed = true;
      // Reduce next incoming damage once
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
  // 20% chance to have a secret in a battle.
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
  }
}

// Battle object
function newBattle(){
  const b = {
    red: state.red.map(cloneMon),
    blue: state.blue.map(cloneMon),
    rIndex: 0,
    bIndex: 0,
    over: false,
    turn: 0
  };
  // Assign possible secrets
  b.red.forEach(maybeAssignSecret);
  b.blue.forEach(maybeAssignSecret);
  return b;
}

function active(b, team){ return team==="red" ? b.red[b.rIndex] : b.blue[b.bIndex]; }
function livingCount(list){ return list.filter(m=>!m.fainted).length; }

function nextAliveIndex(list, start){
  for (let i=start;i<list.length;i++) if (!list[i].fainted) return i;
  for (let i=0;i<start;i++) if (!list[i].fainted) return i;
  return -1;
}

function chooseMove(mon){
  // Simple AI: choose move with best expected effectiveness, break ties by power
  let best = mon.moves[0];
  let bestScore = -1;
  for (const mv of mon.moves) {
    const eff = typeEffect(mv.type, state.battle ? active(state.battle, mon._team==="red"?"blue":"red").types : ["normal"]);
    const score = (eff* (mv.power||40)) + (Math.random()*5);
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  return best;
}

function updateHud(){
  if (!state.battle) return;
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
}

function shake(team){
  const el = team==="red" ? $("hudRed") : $("hudBlue");
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function stepBattle(){
  const b = state.battle;
  if (!b || b.over) return;

  b.turn++;
  setBattleStatus(`Turn ${b.turn}`);

  const r = active(b,"red");
  const u = active(b,"blue");
  if (!r || !u) return;

  // Tag teams for secret logic / move selection
  r._team="red"; u._team="blue";

  // Select moves
  const rMove = chooseMove(r);
  const uMove = chooseMove(u);

  // Order by speed (random tiebreak)
  const rFirst = (r.stats.spe > u.stats.spe) || (r.stats.spe === u.stats.spe && roll(50));
  const order = rFirst ? [["red", r, rMove, "blue", u], ["blue", u, uMove, "red", r]] :
                         [["blue", u, uMove, "red", r], ["red", r, rMove, "blue", u]];

  for (const [atkTeam, atkMon, mv, defTeam, defMon] of order) {
    if (atkMon.fainted || defMon.fainted) continue;

    // Accuracy check
    if (!roll(mv.acc ?? 100)) {
      logLine(`${atkTeam.toUpperCase()} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}… and missed!`);
      atkMon._hitsInRow = 0;
      continue;
    }

    // Secret triggers (attacker/defender)
    const ctx = { attacker: atkMon, defender: defMon, move: mv };
    if (defMon.secret && defMon.secret.when(ctx)) {
      const msg = defMon.secret.apply(ctx);
      logLine(`${defTeam.toUpperCase()} ${defMon.display}'s secret (${revealSecret(defMon.secret)}) stirs… ${msg}`);
      markSecretFound(defMon.secret);
    }
    if (atkMon.secret && atkMon.secret.when(ctx)) {
      const msg = atkMon.secret.apply(ctx);
      logLine(`${atkTeam.toUpperCase()} ${atkMon.display}'s secret (${revealSecret(atkMon.secret)}) awakens… ${msg}`);
      markSecretFound(atkMon.secret);
    }

    // Damage
    const powBoost = atkMon._powerBoost || 1;
    const critBoost = atkMon._critBoost || false;
    const shield = defMon._shield || 1;

    const mv2 = {...mv, power: Math.floor((mv.power||40)*powBoost)};
    const d = damageFormula(atkMon, defMon, mv2);

    let dmg = Math.floor(d.dmg * (1/shield));
    defMon._shield = 1; // consume shield
    if (critBoost) { dmg = Math.floor(dmg*1.5); atkMon._critBoost=false; }

    defMon.curHP = Math.max(0, defMon.curHP - dmg);
    atkMon._hitsInRow = (atkMon._hitsInRow||0) + 1;

    logLine(`${atkTeam.toUpperCase()} ${atkMon.display} used ${cap(mv.name.replace(/-/g," "))}! (-${dmg} HP)`);

    if (d.crit) logLine(`  ➤ Critical hit!`);
    if (d.eff >= 2) logLine(`  ➤ It's super effective!`);
    if (d.eff > 0 && d.eff < 1) logLine(`  ➤ It's not very effective…`);
    if (d.eff === 0) logLine(`  ➤ It doesn't affect the target…`);

    shake(defTeam);
    updateHud();

    if (defMon.curHP <= 0) {
      defMon.fainted = true;
      logLine(`${defTeam.toUpperCase()} ${defMon.display} fainted!`);

      // Switch to next alive
      const list = defTeam==="red" ? b.red : b.blue;
      const next = nextAliveIndex(list, defTeam==="red" ? b.rIndex : b.bIndex);
      if (next === -1) {
        b.over = true;
        logLine(`🏁 ${atkTeam.toUpperCase()} wins!`);
        setBattleStatus(`${atkTeam.toUpperCase()} wins!`);
        $("stepBtn").disabled = true;
        break;
      } else {
        if (defTeam==="red") b.rIndex = next;
        else b.bIndex = next;
        const newActive = defTeam==="red" ? b.red[b.rIndex] : b.blue[b.bIndex];
        logLine(`${defTeam.toUpperCase()} sends out ${newActive.display}!`);
      }
    }
  }
  updateHud();
}

// --- Buttons ---
function initApp(){
  // --- Buttons ---
  $("addBtn")?.addEventListener("click", async ()=>{
    const name = $("searchName").value;
    const team = $("teamPick").value;
    const level = parseInt($("levelPick").value,10);

    if (!name) return;
    if (state[team].length >= 6) { setStatus("That team already has 6."); return; }

    setStatus("Loading…");
    try {
      const mon = await loadPokemon(name, level);
      state[team].push(mon);
      renderTeams();
      logLine(`Added ${mon.display} to ${team.toUpperCase()} (Lv ${level}).`);
      setStatus("Ready");
      $("searchName").value = "";
    } catch (e) {
      console.error(e);
      setStatus("Couldn’t find that Pokémon. Try a different spelling.");
    }
  });

  $("randomBtn")?.addEventListener("click", async ()=>{
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
        await new Promise(r=>setTimeout(r, 60));
      }
      setStatus("Ready");
      logLine("Random teams generated.");
    } catch (e) {
      console.error(e);
      setStatus("Random team failed (network?). Try again.");
    }
  });

  $("clearBtn")?.addEventListener("click", ()=>{
    state.red=[]; state.blue=[];
    state.battle=null;
    $("log").textContent="";
    $("secretBox").style.display="none";
    setBattleStatus("No battle yet");
    renderTeams();
  });

  $("simBtn")?.addEventListener("click", ()=>{
    $("log").textContent = "";
    $("secretBox").style.display="none";
    state.battle = newBattle();
    setBattleStatus("Battle started");
    logLine("⚔️ Battle start!");
    updateHud();
    $("stepBtn").disabled = false;

    let safety = 0;
    const tick = () => {
      if (!state.battle || state.battle.over) return;
      stepBattle();
      safety++;
      if (safety < 500 && !state.battle.over) setTimeout(tick, 160);
    };
    tick();
  });

  $("stepBtn")?.addEventListener("click", ()=>{
    if (!state.battle) return;
    stepBattle();
  });

  $("installHintBtn")?.addEventListener("click", ()=>{
    alert("On Android (Chrome): open this app URL ➜ tap ⋮ menu ➜ 'Add to Home screen' / 'Install app'.\n\nPWAs install best when served over HTTPS (not file://).");
  });

  // --- Service worker registration ---
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try { await navigator.serviceWorker.register("./sw.js"); } catch {}
    });
  }

  // Initial render
  renderTeams();
  logLine("Ready. Add Pokémon to Red and Blue, then Sim Battle.");
}

// ✅ Wait until the page exists before wiring buttons
window.addEventListener("DOMContentLoaded", initApp);

  // Fill teams with random Pokémon IDs (1..1025-ish; we’ll just use 1..1010 to be safe)
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
      await new Promise(r=>setTimeout(r, 60));
    }
    setStatus("Ready");
    logLine("Random teams generated.");
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
});

$("simBtn").addEventListener("click", ()=>{
  $("log").textContent = "";
  $("secretBox").style.display="none";
  state.battle = newBattle();
  setBattleStatus("Battle started");
  logLine("⚔️ Battle start!");
  // Name quick display
  updateHud();
  $("stepBtn").disabled = false;

  // Auto-sim quickly
  let safety = 0;
  const tick = () => {
    if (!state.battle || state.battle.over) return;
    stepBattle();
    safety++;
    if (safety < 500 && !state.battle.over) setTimeout(tick, 160);
  };
  tick();
});

$("stepBtn").addEventListener("click", ()=>{
  if (!state.battle) return;
  stepBattle();
});

$("installHintBtn").addEventListener("click", ()=>{
  alert("On Android (Chrome): open this app URL ➜ tap ⋮ menu ➜ 'Add to Home screen' / 'Install app'.\n\nPWAs install best when served over HTTPS (not file://).");
});

// --- Service worker registration ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  });
}

// Initial render
renderTeams();
logLine("Ready. Add Pokémon to Red and Blue, then Sim Battle.");
