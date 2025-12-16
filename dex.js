// dex.js — Pokédex tab (loads full list, search, detail modal)

const POKEAPI = "https://pokeapi.co/api/v2";
const $ = (id) => document.getElementById(id);

// Small cache helpers (share same localStorage space)
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

function cap(s){ return s ? s[0].toUpperCase()+s.slice(1) : s; }
function spriteUrl(p){
  return p.sprites?.other?.["official-artwork"]?.front_default
      || p.sprites?.front_default
      || "";
}
function openModal(title, html){
  const modal=$("modal"), body=$("modalBody"), t=$("modalTitle");
  if (!modal||!body||!t) return;
  t.textContent = title;
  body.innerHTML = html;
  modal.classList.remove("hidden");
}

let DEX_LIST = null; // [{name,url}]
let DEX_FILTERED = [];

function renderDex(list){
  const grid = $("dexGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const chunk = list.slice(0, 80); // show first 80 results for performance
  chunk.forEach((it)=>{
    const div=document.createElement("div");
    div.className="dexItem";
    div.innerHTML = `
      <div class="sprite">?</div>
      <div style="flex:1">
        <div><b>${cap(it.name.replace(/-/g," "))}</b> <span class="meta">${it.id ? "#"+it.id : ""}</span></div>
        <div class="dexDetails">${it.types ? it.types.map(cap).join(" / ") : "Tap to load details"}</div>
      </div>
      <button class="mini" data-dex="${it.name}">View</button>
    `;
    grid.appendChild(div);

    // load tiny preview (optional, non-blocking)
    if (!it.previewLoaded){
      it.previewLoaded = true;
      cachedFetchJson(`${POKEAPI}/pokemon/${it.name}`, `dexpoke:${it.name}`, 1000*60*60*24*30)
        .then(p=>{
          it.id = p.id;
          it.types = (p.types||[]).sort((a,b)=>a.slot-b.slot).map(t=>t.type.name);
          const img = spriteUrl(p);
          div.querySelector(".sprite").innerHTML = img ? `<img alt="" src="${img}">` : "?";
          div.querySelector(".dexDetails").textContent = it.types.map(cap).join(" / ");
          div.querySelector(".meta").textContent = "#"+it.id;
        })
        .catch(()=>{});
    }
  });

  if (list.length > 80){
    const more = document.createElement("div");
    more.className="meta";
    more.style.marginTop="8px";
    more.textContent = `Showing 80 of ${list.length}. Refine search to narrow.`;
    grid.appendChild(more);
  }
}

async function loadDex(){
  const status = $("dexStatus");
  if (status) status.textContent = "Loading…";

  // cache list for 30 days
  const data = await cachedFetchJson(`${POKEAPI}/pokemon?limit=2000&offset=0`, "dex:list", 1000*60*60*24*30);
  DEX_LIST = (data.results||[]).map(x=>({ name:x.name, url:x.url }));

  DEX_FILTERED = DEX_LIST;
  renderDex(DEX_FILTERED);

  if (status) status.textContent = `Loaded ${DEX_LIST.length} Pokémon`;
}

function applyDexSearch(q){
  q = (q||"").trim().toLowerCase();
  if (!DEX_LIST) return;
  if (!q){
    DEX_FILTERED = DEX_LIST;
    renderDex(DEX_FILTERED);
    return;
  }
  // allow searching by id (rough): if numeric, filter by matching the id once loaded; otherwise name contains
  if (/^\d+$/.test(q)){
    const n = parseInt(q,10);
    DEX_FILTERED = DEX_LIST.filter(x => x.id === n || x.name.includes(q));
  } else {
    DEX_FILTERED = DEX_LIST.filter(x => x.name.includes(q));
  }
  renderDex(DEX_FILTERED);
}

async function showDexDetails(name){
  const p = await cachedFetchJson(`${POKEAPI}/pokemon/${name}`, `dex:detail:${name}`, 1000*60*60*24*180);
  const types = (p.types||[]).sort((a,b)=>a.slot-b.slot).map(t=>t.type.name);
  const stats = {};
  (p.stats||[]).forEach(s => stats[s.stat.name] = s.base_stat);

  // Pick up to 4 damaging moves with power (quick)
  const movesOut = [];
  const moveEntries = (p.moves||[]).slice(0, 90);
  for (const entry of moveEntries){
    if (movesOut.length>=4) break;
    const mname = entry.move.name;
    const m = await cachedFetchJson(entry.move.url, `dex:move:${mname}`, 1000*60*60*24*180);
    if (!m || m.power == null) continue;
    if (m.damage_class?.name !== "physical" && m.damage_class?.name !== "special") continue;
    movesOut.push({
      name:mname,
      type:m.type?.name || "normal",
      power:m.power,
      acc:m.accuracy ?? 100,
      kind:m.damage_class.name
    });
    await new Promise(r=>setTimeout(r, 15));
  }

  const img = spriteUrl(p);
  openModal(cap(name.replace(/-/g," ")), `
    <div class="grid2">
      <div class="panel">
        <div class="teamHead"><span>Artwork</span></div>
        <div style="display:flex;justify-content:center;padding:10px">
          ${img ? `<img alt="" src="${img}" style="width:220px;height:220px;object-fit:contain">` : "No image"}
        </div>
        <div class="meta">Types: <b>${types.map(cap).join(" / ")}</b></div>
      </div>

      <div class="panel">
        <div class="teamHead"><span>Base Stats</span></div>
        <div class="meta">HP: <b>${stats.hp ?? "—"}</b></div>
        <div class="meta">ATK: <b>${stats.attack ?? "—"}</b></div>
        <div class="meta">DEF: <b>${stats.defense ?? "—"}</b></div>
        <div class="meta">Sp.Atk: <b>${stats["special-attack"] ?? "—"}</b></div>
        <div class="meta">Sp.Def: <b>${stats["special-defense"] ?? "—"}</b></div>
        <div class="meta">Speed: <b>${stats.speed ?? "—"}</b></div>
      </div>
    </div>

    <div class="panel" style="margin-top:10px">
      <div class="teamHead"><span>Suggested Moves (damaging)</span></div>
      <div class="meta" style="margin-top:6px">
        ${movesOut.length ? movesOut.map(m=>`• <b>${cap(m.name.replace(/-/g," "))}</b> (${cap(m.type)} / ${m.kind}, Pow ${m.power}, Acc ${m.acc})`).join("<br>") : "No damaging moves found quickly."}
      </div>
    </div>
  `);
}

document.addEventListener("DOMContentLoaded", ()=>{
  $("dexLoadBtn")?.addEventListener("click", async ()=>{
    try{
      await loadDex();
    }catch(e){
      console.error(e);
      $("dexStatus") && ($("dexStatus").textContent = "Dex failed (network?)");
    }
  });

  $("dexSearch")?.addEventListener("input", (e)=> applyDexSearch(e.target.value));

  // modal close already handled in app.js; safe anyway
  $("modalClose")?.addEventListener("click", ()=> $("modal")?.classList.add("hidden"));

  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if (!btn) return;
    const name = btn.dataset.dex;
    if (!name) return;
    showDexDetails(name).catch(console.error);
  });
});
