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
      "Chunk " +
        (state.chunkIndex ?? "-") +
        " | messageCount: " +
        (data ? data.messageCount ?? 0 : 0)
    );
    return;
  }

  const messages = data.messages;

  // ✅ clear marks for this chunk only
  messages.forEach((msg, i) => {
    const key = `${state.chunkIndex}:${i}`;
    if (msg.marked) {
      markedMessages.add(key);
    } else {
      markedMessages.delete(key);
    }

    // ✅ restore group assignments
    if (msg.group) {
      groupAssignments.set(key, msg.group);
      if (!groupColors[msg.group]) {
        groupColors[msg.group] = randomLightColor();
      }
    } else {
      groupAssignments.delete(key);
    }
  });

  messages.forEach((msg, i) => {
    const el = document.createElement("div");
    el.className = "message";

    const key = `${state.chunkIndex}:${i}`;

    // ✅ highlight if marked
    if (markedMessages.has(key)) {
      el.classList.add("marked");
    }

    // ✅ apply group color if assigned
    if (groupAssignments.has(key)) {
      const groupNum = groupAssignments.get(key);
      const color = groupColors[groupNum] || randomLightColor();
      groupColors[groupNum] = color;
      el.style.borderLeft = `4px solid ${color}`;
      el.dataset.group = groupNum;
    }

    // date
    const dateEl = document.createElement("div");
    dateEl.className = "msg-date";
    dateEl.textContent = formatDate(msg.timestamp || "");

    // content
    const contentEl = document.createElement("div");
    contentEl.className = "msg-content";

    const author = document.createElement("div");
    author.className = "msg-author";
    const name = state.showDisplayNames
      ? msg.author?.nickname || msg.author?.name
      : msg.author?.name || msg.author?.nickname || "";
    author.textContent = `${name}:`;

    const text = document.createElement("div");
    text.className = "msg-text";
    text.innerHTML = marked.parse(msg.content || "");

    contentEl.appendChild(author);
    contentEl.appendChild(text);

    // attachments
    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      const acont = document.createElement("div");
      acont.className = "attachment";
      msg.attachments.forEach((att) => {
        const url =
          "/attachment/" +
          encodeURIComponent(att.replace(/^db:\/\//, "")) +
          "?v=" +
          state.imagesReloadKey;
        const img = document.createElement("img");
        img.style.maxWidth = "300px";
        img.style.display = "block";
        img.style.marginTop = "6px";
        img.src = url;
        img.onerror = () => {
          img.style.display = "none";
        };
        acont.appendChild(img);
      });
      contentEl.appendChild(acont);
    }

    el.appendChild(dateEl);
    el.appendChild(contentEl);

    // ✅ Interactions
    el.addEventListener("click", (ev) => {
      if (markMode) {
        // mark/unmark
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
          if (markedMessages.has(key)) {
            markedMessages.delete(key);
            el.classList.remove("marked");
          } else {
            markedMessages.add(key);
            el.classList.add("marked");
          }
        }
        lastClickedIndex = i;
        ev.stopPropagation();
        updateBottomBar();
      } else if (dividerMode) {
        // divider mode → place start/end
        if (!pendingDivider) {
          pendingDivider = key;
        } else {
          const groupNum =
            Math.max(0, ...Object.keys(groupColors).map(Number)) + 1;
          const color = randomLightColor();
          groupColors[groupNum] = color;

          const [cidx1, mi1] = pendingDivider.split(":").map(Number);
          const [cidx2, mi2] = key.split(":").map(Number);

          if (cidx1 === cidx2 && cidx1 === state.chunkIndex) {
            const start = Math.min(mi1, mi2);
            const end = Math.max(mi1, mi2);
            for (let j = start; j <= end; j++) {
              const k = `${state.chunkIndex}:${j}`;
              groupAssignments.set(k, groupNum);
              const msgEl = canvas.children[j];
              if (msgEl) {
                msgEl.style.borderLeft = `4px solid ${color}`;
                msgEl.dataset.group = groupNum;
              }
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
        // remove divider assignment
        const groupNum = groupAssignments.get(key);
        groupAssignments.delete(key);
        el.style.borderLeft = "";
        el.removeAttribute("data-group");
        ev.preventDefault();
        updateBottomBar();
      }
    });

    canvas.appendChild(el);
  });

  updateBottomBar();
}




function updateBottomBar(){
  let text = 'No file loaded';
  if(state.loaded && state.data){
    const count = state.data.messageCount ?? state.data.messages.length;
    text = `Chunk ${state.chunkIndex} | messageCount: ${count}`;
  }
  if(markMode){
    text += ' | markmode enabled';
  }
  if(dividerMode){
    text += ' | dividermode enabled';
  }

  setBottomBar(text);
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
  renderChunk(state.data);
}

async function navigate(direction){
  if(!state.loaded){ alert('No file loaded'); return }
  const res = await fetch('/navigate', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({direction})});
  if(!res.ok){ const e = await res.json().catch(()=>({error:'nav failed'})); alert(e.error||'navigate failed'); return }
  const j = await res.json();
  state.chunkIndex = j.chunk_index;
  state.data = j.data;
  renderChunk(state.data);
}

async function reloadChunk(){
  if(!state.loaded){ alert('No file loaded'); return }
  const res = await fetch('/get_chunk');
  if(!res.ok){ const e = await res.json().catch(()=>({error:'reload failed'})); alert(e.error||'reload failed'); return }
  const j = await res.json();
  state.chunkIndex = j.chunk_index;
  state.data = j.data;
  renderChunk(state.data);
}

async function savePacked(){
  if(!state.loaded){
    alert('No file loaded');
    return;
  }

  const res = await fetch('/save_marked', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({marks: Object.fromEntries([...markedMessages].map(k=>[k,true]))})
  });

  if(!res.ok){
    const e = await res.json().catch(()=>({error:'save failed'}));
    alert(e.error||'Save failed');
    return;
  }

  const j = await res.json();
  alert('Marked messages saved to SAVE_FOLDER.');
}

async function exportMarked() {
  if (!state.loaded) { alert("No file loaded"); return; }

  const marks = {};
  markedMessages.forEach(k => { marks[k] = true; });

  const res = await fetch("/export_marked", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marks })
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
  // Just bump a cachebust key and rerender to force image reload
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