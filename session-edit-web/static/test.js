messages.forEach((msg, i) => {
  const el = document.createElement('div');
  el.className = 'message';

  // If marked already, highlight it
  if(msg.marked || markedMessages.has(`${state.chunkIndex}:${i}`)){
    el.classList.add('marked');
  }

  const dateEl = document.createElement('div');
  dateEl.className = 'msg-date';
  dateEl.textContent = formatDate(msg.timestamp || '');

  const contentEl = document.createElement('div');
  contentEl.className = 'msg-content';

  const author = document.createElement('div');
  author.className = 'msg-author';
  const name = state.showDisplayNames ? (msg.author?.nickname || msg.author?.name) : (msg.author?.name || msg.author?.nickname || '');
  author.textContent = `${name}:`;

  const text = document.createElement('div');
  text.className = 'msg-text';
  text.innerHTML = marked.parse(msg.content || '');

  contentEl.appendChild(author);
  contentEl.appendChild(text);

  // attachments (unchanged)
  if(Array.isArray(msg.attachments) && msg.attachments.length>0){
    const acont = document.createElement('div');
    acont.className = 'attachment';
    msg.attachments.forEach(att => {
      const url = '/attachment/' + encodeURIComponent(att.replace(/^db:\/\//, '')) + '?v=' + state.imagesReloadKey;
      const img = document.createElement('img');
      img.style.maxWidth = '300px';
      img.style.display = 'block';
      img.style.marginTop = '6px';
      img.src = url;
      img.onerror = () => { img.style.display='none' }
      acont.appendChild(img);
    })
    contentEl.appendChild(acont);
  }

  el.appendChild(dateEl);
  el.appendChild(contentEl);

  // ✅ Mark/unmark interactions
  el.addEventListener('click', (ev)=>{
    if(markMode){
      const key = `${state.chunkIndex}:${i}`;
      markedMessages.add(key);
      el.classList.add('marked');
      ev.stopPropagation();
    }
  });
  el.addEventListener('contextmenu', (ev)=>{
    if(markMode){
      const key = `${state.chunkIndex}:${i}`;
      markedMessages.delete(key);
      el.classList.remove('marked');
      ev.preventDefault();
    }
  });

  canvas.appendChild(el);
});

