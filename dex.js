// dex.js - All Pokémon Pokédex with pagination
// Safe: does not affect battle logic.

const DEX = {
  list: [],
  next: `${POKEAPI}/pokemon?limit=200&offset=0`,
  loading: false,
};

function showDex(){
  $("dexModal").classList.remove("hidden");
  $("dexDetails").innerHTML = "";
  $("dexSearch").value = "";
  if (DEX.list.length === 0) {
    $("dexList").textContent = "Loading…";
    loadMoreDex().then(()=>renderDexList(DEX.list));
  } else {
    renderDexList(DEX.list);
  }
  updateDexMoreBtn();
}

function hideDex(){
  $("dexModal").classList.add("hidden");
}

async function loadMoreDex(){
  if (!DEX.next || DEX.loading) return;
  DEX.loading = true;
  updateDexMoreBtn();

  const res = await fetch(DEX.next);
  const json = await res.json();

  DEX.next = json.next;
  DEX.list = DEX.list.concat(json.results || []);

  DEX.loading = false;
  updateDexMoreBtn();
}

function updateDexMoreBtn(){
  const btn = $("dexMoreBtn");
  if (!btn) return;
  btn.disabled = DEX.loading || !DEX.next;
  btn.textContent = DEX.loading ? "Loading…" : (DEX.next ? "Load more" : "All loaded");
}

function renderDexList(list){
  const el = $("dexList");
  el.innerHTML = "";

  const q = ($("dexSearch").value || "").trim().toLowerCase();
  const filtered = q ? list.filter(p=>p.name.includes(q)) : list;

  for (const p of filtered) {
    const row = document.createElement("div");
    row.className = "dexItem";
    row.textContent = cap(p.name.replace(/-/g," "));
    row.onclick = () => showDexDetails(p.name);
    el.appendChild(row);
  }

  if (filtered.length === 0) {
    el.innerHTML = `<div style="opacity:.7;">No results yet. Try loading more.</div>`;
  }
}

async function showDexDetails(name){
  const details = $("dexDetails");
  details.textContent = "Loading details…";

  const p = await cachedFetchJson(`${POKEAPI}/pokemon/${name}`, `dex:${name}`, 1000*60*60*24*180);

  const types = (p.types || []).sort((a,b)=>a.slot-b.slot).map(t=>cap(t.type.name)).join(" / ");
  const stats = (p.stats || []).map(s => `${cap((s.stat?.name||"").replace(/-/g," "))}: ${s.base_stat}`).join("<br>");
  const moves = (p.moves || []).slice(0, 10).map(m => cap(m.move.name.replace(/-/g," "))).join(", ");

  details.innerHTML = `
    <div style="display:flex; gap:10px; align-items:center;">
      <div style="width:84px; height:84px; display:flex; align-items:center; justify-content:center; border:1px solid #222; border-radius:10px;">
        ${p.sprites?.front_default ? `<img src="${p.sprites.front_default}" alt="" style="width:80px; height:80px;">` : "?"}
      </div>
      <div>
        <div style="font-size:18px;"><strong>${cap(p.name.replace(/-/g," "))}</strong></div>
        <div style="opacity:.85;">${types}</div>
      </div>
    </div>

    <div style="margin-top:10px; line-height:1.4;">${stats}</div>

    <div style="margin-top:10px; opacity:.9;">
      <strong>Example moves:</strong><br>
      ${moves || "—"}
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  $("dexBtn").addEventListener("click", showDex);
  $("dexClose").addEventListener("click", hideDex);
  $("dexModal").addEventListener("click", (e) => { if (e.target.id === "dexModal") hideDex(); });

  $("dexSearch").addEventListener("input", () => renderDexList(DEX.list));
  $("dexMoreBtn").addEventListener("click", async () => {
    await loadMoreDex();
    renderDexList(DEX.list);
  });
});
