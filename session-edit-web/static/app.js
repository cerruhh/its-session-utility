// Frontend logic: menu actions, keyboard shortcuts, rendering

let state = {
  loaded: false,
  chunkIndex: null,
  data: null,
  showDisplayNames: false,
  fileCount: 0,
  imagesReloadKey: Date.now(),
};

let markMode = false;
let markedMessages = new Set();
let lastClickedIndex = null;
let dividerMode = false;
let pendingDivider = null;  // waiting for second divider
let groups = []; // [{start, end, group, color}]
let groupAssignments = new Map();   // key -> groupNum
let groupColors = {};               // groupNum -> color string
let groupNames = {}; // groupId -> name (optional)
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('canvas');
const bottombar = document.getElementById('bottombar');
const showDisplayCheckbox = document.getElementById('show-display-names');

// Helpers
function setBottomBar(text){ bottombar.textContent = text }

function formatDate(ts){
  try{
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }catch(e){ return ts }
}

function clearCanvas(){
  // Remove all children to avoid memory accumulation
  while(canvas.firstChild) canvas.removeChild(canvas.firstChild);
}



function renderMessage(msg) {
  let text = msg.content || "";

  // Make links clickable
  text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');

  // Handle db://attachments/... links
  text = text.replace(/db:\/\/attachments\/([A-Za-z0-9_-]+)/g,
    '<a href="/attachment/$1" target="_blank">[attachment]</a>');

  return `<div class="message">${text}</div>`;
}

function randomLightColor() {
  const r = Math.floor(150 + Math.random() * 105);
  const g = Math.floor(150 + Math.random() * 105);
  const b = Math.floor(150 + Math.random() * 105);
  return `rgb(${r},${g},${b})`;
}

function jumpToDivider(direction) {
  const keys = groups.flatMap(g => [g.start, g.end]);
  const currentPos = getCurrentVisibleMessageKey();
  const idx = keys.indexOf(currentPos);
  if (idx >= 0) {
    const target = keys[idx + direction];
    if (target) scrollToMessage(target);
  }
}


function renderChunk(data) {
  clearCanvas();
  if (!data || !data.messages) {
    setBottomBar(
        "Chunk " + (state.chunkIndex ?? "-") + " | messageCount: " + (data ? data.messageCount ?? 0 : 0)
    );
    return;
  }

  // defensive: ensure state.chunkIndex is a number
  if (typeof state.chunkIndex !== "number") {
    state.chunkIndex = Number(state.chunkIndex) || 0;
  }

  const messages = data.messages;

  // restore per-chunk marks and groups
  messages.forEach((msg, i) => {
    const key = `${state.chunkIndex}:${i}`;
    if (msg.marked) {
      markedMessages.add(key);
    } else {
      markedMessages.delete(key);
    }
    // restore group assignments if present in JSON
    if (msg.group && msg.group.id != null) {
      const gid = Number(msg.group.id);
      groupAssignments.set(key, gid);
      if (!groupColors[gid]) {
        groupColors[gid] = msg.group.color || randomLightColor();
      }
      if (msg.group.name) groupNames[gid] = msg.group.name;
    } else {
      groupAssignments.delete(key);
    }
  });

  // render each message DOM
  messages.forEach((msg, i) => {
    const el = document.createElement("div");
    el.className = "message";
    const key = `${state.chunkIndex}:${i}`;

    // Marked visual
    if (markedMessages.has(key)) el.classList.add("marked");

    // Group color if assigned
    if (groupAssignments.has(key)) {
      const groupNum = groupAssignments.get(key);
      const color = groupColors[groupNum] || randomLightColor();
      groupColors[groupNum] = color;
      el.style.borderLeft = `4px solid ${color}`;
      el.dataset.group = groupNum;
      if (groupNames[groupNum]) el.title = groupNames[groupNum];
    }

    // date
    const dateEl = document.createElement("div");
    dateEl.className = "msg-date";
    dateEl.textContent = formatDate(msg.timestamp || "");

    // content & author
    const contentEl = document.createElement("div");
    contentEl.className = "msg-content";
    const author = document.createElement("div");
    author.className = "msg-author";
    const name = state.showDisplayNames ? msg.author?.nickname || msg.author?.name : msg.author?.name || msg.author?.nickname || "";
    author.textContent = `${name}:`;
    const text = document.createElement("div");
    text.className = "msg-text";
    // Use marked.parse if available; fallback to safe text
    try { text.innerHTML = marked.parse(msg.content || ""); } catch (e) { text.textContent = msg.content || ""; }
    contentEl.appendChild(author);
    contentEl.appendChild(text);

    // attachments (handle string or object)
    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      const acont = document.createElement("div");
      acont.className = "attachment";
      msg.attachments.forEach((att) => {
        const ref = attachmentRef(att); // NEW safe accessor
        if (!ref) return;
        // strip db:// or attachments/ prefixes if present
        let id = ref.replace(/^db:\/\//, "");
        if (id.startsWith("attachments/")) id = id.split("/", 1)[1] || id; // take last segment if prefixed
        const url = "/attachment/" + encodeURIComponent(id) + "?v=" + state.imagesReloadKey;
        const img = document.createElement("img");
        img.style.maxWidth = "300px";
        img.style.display = "block";
        img.style.marginTop = "6px";
        img.src = url;
        img.onerror = () => { img.style.display = "none"; };
        acont.appendChild(img);
      });
      contentEl.appendChild(acont);
    }

    el.appendChild(dateEl);
    el.appendChild(contentEl);

    // --- Interactions
    el.addEventListener("click", (ev) => {
      if (markMode) {
        // multi-select by shift
        if (ev.shiftKey && lastClickedIndex !== null) {
          const start = Math.min(lastClickedIndex, i);
          const end = Math.max(lastClickedIndex, i);
          for (let j = start; j <= end; j++) {
            const k = `${state.chunkIndex}:${j}`;
            markedMessages.add(k);
            const msgEl = canvas.children[j];
            if (msgEl) msgEl.classList.add("marked");
          }
        } else {
          if (markedMessages.has(key)) { markedMessages.delete(key); el.classList.remove("marked"); }
          else { markedMessages.add(key); el.classList.add("marked"); }
        }
        lastClickedIndex = i;
        ev.stopPropagation();
        updateBottomBar();
      } else if (dividerMode) {
        // divider mode → place start/end; allow group naming/reuse
        if (!pendingDivider) {
          pendingDivider = key;
          updateBottomBar();
        } else {
          // finish divider pair
          // prompt for group name (enter existing name to reuse)
          const inputName = prompt("Enter group name (leave blank to auto-name):");
          // find existing group with same name
          let groupNum = null;
          if (inputName) {
            for (const [gid, gname] of Object.entries(groupNames)) {
              if (gname === inputName) { groupNum = Number(gid); break; }
            }
          }
          if (groupNum === null) {
            // create new numeric id
            const existingIds = Object.keys(groupColors).map(Number);
            groupNum = existingIds.length === 0 ? 1 : Math.max(...existingIds) + 1;
          }
          const color = groupColors[groupNum] || randomLightColor();
          groupColors[groupNum] = color;
          if (inputName) groupNames[groupNum] = inputName;

          const [cidx1, mi1] = pendingDivider.split(":").map(Number);
          const [cidx2, mi2] = key.split(":").map(Number);
          // support cross-chunk by assigning each message key explicitly
          if (cidx1 === cidx2 && cidx1 === state.chunkIndex) {
            const start = Math.min(mi1, mi2);
            const end = Math.max(mi1, mi2);
            for (let j = start; j <= end; j++) {
              const k = `${state.chunkIndex}:${j}`;
              groupAssignments.set(k, groupNum);
              const msgEl = canvas.children[j];
              if (msgEl) { msgEl.style.borderLeft = `4px solid ${color}`; msgEl.dataset.group = groupNum; msgEl.title = groupNames[groupNum] || ""; }
            }
          } else {
            // if across chunks, we still store assignment keys, but only update DOM for current chunk
            const [startIdx, startMi] = [cidx1, mi1];
            const [endIdx, endMi] = [cidx2, mi2];
            // iterate across affected chunks in numeric order
            const idxStart = Math.min(startIdx, endIdx);
            const idxEnd = Math.max(startIdx, endIdx);
            for (let chunk = idxStart; chunk <= idxEnd; chunk++) {
              // determine start/end message indexes for this chunk
              const s = (chunk === startIdx) ? Math.min(startMi, endMi) : 0;
              const e = (chunk === endIdx) ? Math.max(startMi, endMi) : 999999;
              // we don't have DOM for other chunks; but we still persist assignments keyed by `${chunk}:${j}`
              for (let j = s; j <= e; j++) {
                const k = `${chunk}:${j}`;
                groupAssignments.set(k, groupNum);
              }
            }
            // update DOM only for active chunk messages inside range
            // (already done above if same chunk)
            if (state.chunkIndex >= idxStart && state.chunkIndex <= idxEnd) {
              // try a re-render to pick up new assignments visually
              renderChunk(state.data);
            }
          }
          pendingDivider = null;
          updateBottomBar();
        }
      }
    });

    el.addEventListener("contextmenu", (ev) => {
      if (markMode) {
        markedMessages.delete(key);
        el.classList.remove("marked");
        ev.preventDefault();
        updateBottomBar();

      } else if (dividerMode && groupAssignments.has(key)) {
        const groupNum = groupAssignments.get(key);

        // Remove divider assignment from this element
        groupAssignments.delete(key);
        el.style.borderLeft = "";
        el.removeAttribute("data-group");
        ev.preventDefault();
        updateBottomBar();

        // Ask if the whole group should be removed
        if (confirm(`Remove entire group "${groupNames[groupNum] || groupNum}"?`)) {
          removeGroup(groupNum);   // calls the helper we added earlier
        }
      }
    });


    canvas.appendChild(el);
  });

  // Show which JSON filename is loaded in console (helpful)
  try {
    const files = window.__lastJsonFilesList || null;
    if (files && files[state.chunkIndex]) {
      console.log("Loaded JSON:", files[state.chunkIndex]);
    }
  } catch (e) { /* ignore */ }

  updateBottomBar();
}

function handleGroupOption(option) {
  if (option === "Next group") {
    navigateGroup(1);
  } else if (option === "Back group") {
    navigateGroup(-1);
  } else if (option === "Search for group by name") {
    const name = prompt("Enter group name:");
    if (name) {
      goToGroupByName(name.trim());
    }
  }
}

function navigateGroup(direction) {
  if (!groups.length) return;
  const current = state.chunkIndex;
  let targetGroup = null;

  if (direction > 0) {
    targetGroup = groups.find(g => g.start > current);
  } else {
    const reversed = [...groups].reverse();
    targetGroup = reversed.find(g => g.start < current);
  }
  if (targetGroup) {
    state.chunkIndex = targetGroup.start;
    renderChunk(state.data);
  }
}

function goToGroupByName(name) {
  const entry = Object.entries(groupNames).find(([id, n]) => n === name);
  if (!entry) {
    alert("Group not found: " + name);
    return;
  }
  const groupId = entry[0];
  const group = groups.find(g => g.group === parseInt(groupId));
  if (group) {
    state.chunkIndex = group.start;
    renderChunk(state.data);
  }
}




// --- helper: safe attachment ref (handles string or object attachments)
function attachmentRef(att){
  if(!att) return "";
  if(typeof att === "string") return att;
  // common object shapes: { id: "..."} or {url: "..."} or {file:"..."}
  return att.id || att.url || att.file || "";
}




// updateBottomBar improved to show filename if available
function updateBottomBar(){
  let text = 'No file loaded';
  if(state.loaded && state.data){
    const count = state.data.messageCount ?? state.data.messages.length;
    text = `Chunk ${state.chunkIndex} | messageCount: ${count}`;
    // show group/mark modes
    if(markMode) text += ' | markmode enabled';
    if(dividerMode) text += ' | dividermode enabled';
    if(pendingDivider) text += ' | pending divider: ' + pendingDivider;
    // show currently loaded filename if backend provided list (saved on load)
    if (window.__lastJsonFilesList && window.__lastJsonFilesList[state.chunkIndex]) {
      text += ' | ' + window.__lastJsonFilesList[state.chunkIndex];
    }
  }
  setBottomBar(text);
}

function setLastJsonFilesList(list){
  window.__lastJsonFilesList = list || null;
}


// Networking
async function doUploadFile(file){
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/upload', {method:'POST', body:fd});
  if(!res.ok){
    const err = await res.json().catch(()=>({error:'upload failed'}));
    alert('Upload error: ' + (err.error || 'unknown'));
    return;
  }
  const data = await res.json();
  state.loaded = true;
  state.chunkIndex = data.chunk_index;
  state.fileCount = data.file_count || 0;
  state.data = data.data;
  setLastJsonFilesList(data.json_files || null);
  renderChunk(state.data);
}


async function navigate(direction){
  if(!state.loaded){ alert('No file loaded'); return }
  const res = await fetch('/navigate', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({direction})});
  if(!res.ok){ const e = await res.json().catch(()=>({error:'nav failed'})); alert(e.error||'navigate failed'); return }
  const j = await res.json();
  state.chunkIndex = j.chunk_index;
  state.fileCount = j.file_count || state.fileCount;
  state.data = j.data;
  setLastJsonFilesList(j.json_files || null);
  renderChunk(state.data);
}

async function reloadChunk(){
  if(!state.loaded){ alert('No file loaded'); return }
  const res = await fetch('/get_chunk');
  if(!res.ok){ const e = await res.json().catch(()=>({error:'reload failed'})); alert(e.error||'reload failed'); return }
  const j = await res.json();
  state.chunkIndex = j.chunk_index;
  state.fileCount = j.file_count || state.fileCount;
  state.data = j.data;
  setLastJsonFilesList(data.json_files || null);
  renderChunk(state.data);
}


async function savePacked(){
  if(!state.loaded){ alert('No file loaded'); return; }

  // marks
  const marks = Object.fromEntries([...markedMessages].map(k => [k, true]));

  // groups: build mapping of key -> {id,name,color}
  const groupPayload = { assignments: {} };
  for (const [key, gid] of groupAssignments.entries()) {
    groupPayload.assignments[key] = {
      id: gid,
      name: groupNames[gid] || null,
      color: groupColors[gid] || null
    };
  }

  const res = await fetch('/save_marked', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({marks, groups: groupPayload})
  });

  if(!res.ok){
    const e = await res.json().catch(()=>({error:'save failed'}));
    alert(e.error||'Save failed');
    return;
  }

  const j = await res.json();
  alert('Marked messages & groups saved to SAVE_FOLDER.');
}


async function exportMarked() {
  if (!state.loaded) { alert("No file loaded"); return; }

  const marks = {};
  markedMessages.forEach(k => { marks[k] = true; });

  const groupsPayload = { assignments: {} };
  for (const [key, gid] of groupAssignments.entries()) {
    groupsPayload.assignments[key] = {
      id: gid,
      name: groupNames[gid] || null,
      color: groupColors[gid] || null
    };
  }

  const res = await fetch("/export_marked", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marks, groups: groupsPayload })
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: "Export failed" }));
    alert(e.error || "Export failed");
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "marked_export.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


// Assuming your button has an id="exportBtn"
const exportBtn = document.getElementById("menu-export-save");
if (exportBtn) {
  exportBtn.addEventListener("click", exportMarked);
}


function reloadImages(){
  state.imagesReloadKey = Date.now();
  if(state.data) renderChunk(state.data);
}

// UI wiring
// File menu
document.getElementById('menu-load').addEventListener('click', ()=> fileInput.click());
fileInput.addEventListener('change', async (ev)=>{
  const f = ev.target.files[0];
  if(f) await doUploadFile(f);
  fileInput.value = '';
});

document.getElementById('menu-save-marked').addEventListener('click', savePacked);

// View menu
document.getElementById('menu-reload-images').addEventListener('click', reloadImages);
showDisplayCheckbox.addEventListener('change', (e)=>{ state.showDisplayNames = e.target.checked; if(state.data) renderChunk(state.data); });

// Chunk menu actions
document.querySelectorAll('[data-action]').forEach(el=>{
  el.addEventListener('click', ()=>{
    const action = el.getAttribute('data-action');
    navigate(action);
  })
});

const menuLoadRecent = document.getElementById('menu-load-recent');

async function refreshRecentMenu(){
  const res = await fetch('/list_recents');
  if(!res.ok) return;
  const recents = await res.json();

  menuLoadRecent.innerHTML = '';

  if(recents.length === 0){
    const li = document.createElement('div');
    li.textContent = '(none)';
    li.className = 'menu-disabled';
    menuLoadRecent.appendChild(li);
    return;
  }

  recents.forEach(folder=>{
    const li = document.createElement('div');
    li.textContent = folder;
    li.className = 'menu-item';
    li.addEventListener('click', ()=> loadRecent(folder));
    menuLoadRecent.appendChild(li);
  });
}

async function loadRecent(folder){
  const res = await fetch('/load_recent', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({folder})
  });
  if(!res.ok){
    const e = await res.json().catch(()=>({error:'load recent failed'}));
    alert(e.error||'failed to load recent');
    return;
  }
  const j = await res.json();
  state.loaded = true;
  state.chunkIndex = j.chunk_index;
  state.data = j.data;
  setLastJsonFilesList(j.json_files || null);
  renderChunk(state.data);
}

// refresh submenu when app loads
refreshRecentMenu();

const menuLoadRecentSave = document.getElementById('menu-load-recent-save');

async function refreshRecentSaveMenu(){
  const res = await fetch('/list_recent_saves');
  if(!res.ok) return;
  const recents = await res.json();

  menuLoadRecentSave.innerHTML = '';

  if(recents.length === 0){
    const li = document.createElement('div');
    li.textContent = '(none)';
    li.className = 'menu-disabled';
    menuLoadRecentSave.appendChild(li);
    return;
  }

  recents.forEach(folder=>{
    const li = document.createElement('div');
    li.textContent = folder;
    li.className = 'menu-item';
    li.addEventListener('click', ()=> loadRecentSave(folder));
    menuLoadRecentSave.appendChild(li);
  });
}

// Group menu actions
document.getElementById('menu-group-next').addEventListener('click', () => {
  navigateGroup(1);
});

document.getElementById('menu-group-back').addEventListener('click', () => {
  navigateGroup(-1);
});

document.getElementById('menu-group-search').addEventListener('click', () => {
  const name = prompt("Enter group name:");
  if (name && name.trim() !== "") {
    goToGroupByName(name.trim());
  }
});


//// Add in your topbar creation code
//const groupMenu = document.createElement("div");
//groupMenu.className = "menu group-menu";
//
//const groupBtn = document.createElement("button");
//groupBtn.textContent = "Group ▾";
//
//const menuList = document.createElement("ul");
//["Next group", "Back group", "Search for group by name"].forEach(opt => {
//  const li = document.createElement("li");
//  li.textContent = opt;
//  li.onclick = () => handleGroupOption(opt);
//  menuList.appendChild(li);
//});
//
//groupMenu.appendChild(groupBtn);
//groupMenu.appendChild(menuList);
//document.getElementById("topbar").appendChild(groupMenu);

function handleGroupOption(option) {
  if (option === "Next group") {
    navigateGroup(1);
  } else if (option === "Back group") {
    navigateGroup(-1);
  } else if (option === "Search for group by name") {
    const name = prompt("Enter group name:");
    if (name) {
      goToGroupByName(name.trim());
    }
  }
}



function handleDividerClick(idx, mi) {
  const key = `${idx}:${mi}`;
  if (!pendingDivider) {
    pendingDivider = key; // wait for second divider
  } else {
    // assign group
    const groupNum = groups.length + 1;
    const color = randomLightColor();
    groups.push({start: pendingDivider, end: key, group: groupNum, color});
    pendingDivider = null;
    renderChunk(state.data);
  }
}

function removeGroup(id) {
  if (!groups) groups = []; // make sure it's defined
  groups = groups.filter(g => g.group !== id);
  if (groupNames) delete groupNames[id];
  renderChunk(state.data);
}


async function loadRecentSave(folder){
  const path = folder; // backend will prepend SAVE_FOLDER
  const res = await fetch('/load_recent', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({folder: path, save_folder:true}) // optional flag
  });

  if(!res.ok){
    const e = await res.json().catch(()=>({error:'load recent save failed'}));
    alert(e.error||'Failed to load save');
    return;
  }

  const j = await res.json();
  state.loaded = true;
  state.chunkIndex = j.chunk_index;
  state.data = j.data;
  markedMessages.clear();  // reset marks when loading previous save
  setLastJsonFilesList(j.json_files || null); // ✅ use j instead of data
  renderChunk(state.data);
}


// call once on startup
refreshRecentSaveMenu();


// Keyboard shortcuts
window.addEventListener('keydown', (e)=>{
  if(e.ctrlKey && !e.altKey){
    // ctrl+l -> load
    if(e.key.toLowerCase()==='l'){
      e.preventDefault(); fileInput.click(); return;
    }
    // ctrl+s -> save
    if(e.key.toLowerCase()==='s'){
      e.preventDefault(); savePacked(); return;
    }
    // ctrl+ArrowUp -> first
    if(e.key === 'ArrowUp'){
      e.preventDefault(); navigate('first'); return;
    }
    // ctrl+ArrowDown -> last
    if(e.key === 'ArrowDown'){
      e.preventDefault(); navigate('last'); return;
    }
    // ctrl+ArrowRight -> forward
    if(e.key === 'ArrowRight'){
      e.preventDefault(); navigate('forward'); return;
    }
    // ctrl+ArrowLeft -> backward
    if(e.key === 'ArrowLeft'){
      e.preventDefault(); navigate('backward'); return;
    }
    // ctrl+r -> reload chunk
    if(e.key.toLowerCase()==='r' && !e.shiftKey){
      e.preventDefault(); reloadChunk(); return;
    }
    // ctrl+1 -> toggle mark mode
    if(e.ctrlKey && e.key === '1'){
      e.preventDefault();
      markMode = !markMode;
      updateBottomBar();
      return;
    }
    if (e.ctrlKey && e.key === "2") {
      markMode = false;
      dividerMode = !dividerMode;
      pendingDivider = null;
      updateBottomBar(); // show "Divider mode" in bottom right
    }
  }
  // ctrl+shift+r -> reload images
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='r'){
    e.preventDefault(); reloadImages(); return;
  }
});

// initial status
setBottomBar('No file loaded');