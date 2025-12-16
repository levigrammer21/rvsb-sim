// dex.js - Pokédex UI (safe add-on; does not touch battle logic)
(() => {
  const $ = (id) => document.getElementById(id);

  // We rely on these existing globals from app.js:
  // - POKEAPI
  // - cachedFetchJson
  // - cap

  let dexListCache = null;

  function ensureDexUI() {
    // Add button if it doesn't exist
    const controls = document.querySelector("#controls") || document.body;
    if (!$("dexBtn")) {
      const btn = document.createElement("button");
      btn.id = "dexBtn";
      btn.textContent = "📖 Pokédex";
      btn.style.marginLeft = "6px";
      // Put it near the Sim/Clear buttons if possible
      (document.querySelector("#simBtn")?.parentElement || controls).appendChild(btn);
    }

    // Add modal if it doesn't exist
    if (!$("dexModal")) {
      const modal = document.createElement("div");
      modal.id = "dexModal";
      modal.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:9999;
        display:none; align-items:center; justify-content:center; padding:10px;
      `;

      modal.innerHTML = `
        <div style="
          width:95%; max-width:520px; max-height:85vh; overflow:hidden;
          background:#111; color:#fff; border-radius:14px; padding:10px;
          display:flex; flex-direction:column; gap:8px;
          box-shadow:0 12px 40px rgba(0,0,0,.5);
        ">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <strong>Pokédex</strong>
            <button id="dexClose" style="font-size:16px;">✕</button>
          </div>

          <input id="dexSearch" placeholder="Search Pokémon…" style="
            padding:8px; border-radius:8px; border:none; outline:none;
          "/>

          <div style="display:grid; grid-template-columns: 1fr; gap:8px; overflow:auto;">
            <div id="dexList" style="border-top:1px solid #222; padding-top:8px;"></div>
            <div id="dexDetails" style="border-top:1px solid #222; padding-top:8px;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // close on background click
      modal.addEventListener("click", (e) => {
        if (e.target === modal) hideDex();
      });
    }

    // Wire events
    $("dexBtn").onclick = showDex;
    $("dexClose").onclick = hideDex;

    $("dexSearch").oninput = () => {
      if (!dexListCache) return;
      const q = ($("dexSearch").value || "").trim().toLowerCase();
      const filtered = dexListCache.filter(x => x.name.includes(q));
      renderDexList(filtered);
    };
  }

  function showDex() {
    ensureDexUI();
    $("dexModal").style.display = "flex";
    $("dexDetails").innerHTML = "";
    $("dexList").textContent = "Loading list…";
    $("dexSearch").value = "";
    loadDexList().then(list => renderDexList(list));
  }

  function hideDex() {
    $("dexModal").style.display = "none";
  }

  async function loadDexList() {
    if (dexListCache) return dexListCache;

    // Gen 1 list for speed/stability (you can change to 1025 later)
    const res = await fetch(`${POKEAPI}/pokemon?limit=151`);
    const json = await res.json();
    dexListCache = json.results || [];
    return dexListCache;
  }

  function renderDexList(list) {
    const el = $("dexList");
    el.innerHTML = "";
    const frag = document.createDocumentFragment();

    list.forEach(p => {
      const row = document.createElement("div");
      row.textContent = cap(p.name.replace(/-/g, " "));
      row.style.cssText = `
        padding:8px; border-bottom:1px solid #1b1b1b;
        cursor:pointer; user-select:none;
      `;
      row.onmouseenter = () => row.style.background = "#1f1f1f";
      row.onmouseleave = () => row.style.background = "transparent";
      row.onclick = () => showDexDetails(p.name);
      frag.appendChild(row);
    });

    el.appendChild(frag);
  }

  async function showDexDetails(name) {
    const details = $("dexDetails");
    details.textContent = "Loading details…";

    const p = await cachedFetchJson(`${POKEAPI}/pokemon/${name}`, `dex:${name}`, 1000*60*60*24*180);

    const types = (p.types || []).sort((a,b)=>a.slot-b.slot).map(t=>cap(t.type.name)).join(" / ");
    const stats = (p.stats || []).map(s => {
      const n = s.stat?.name || "";
      return `${cap(n.replace(/-/g," "))}: ${s.base_stat}`;
    }).join("<br>");

    // Show 8 example moves (names only) + note
    const moves = (p.moves || []).slice(0, 8).map(m => cap(m.move.name.replace(/-/g," "))).join(", ");

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

      <div style="margin-top:8px; line-height:1.35;">
        ${stats}
      </div>

      <div style="margin-top:10px; opacity:.9;">
        <strong>Example moves:</strong><br>
        ${moves || "—"}
        <div style="opacity:.7; margin-top:6px; font-size:12px;">
          (Battle sim uses its own move-picking logic for each loaded Pokémon.)
        </div>
      </div>
    `;
  }

  // Make sure UI exists after page load
  window.addEventListener("DOMContentLoaded", ensureDexUI);
})();
