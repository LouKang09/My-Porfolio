(() => {
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const bind = (key, value) => document.querySelectorAll(`[data-bind="${key}"]`).forEach(el => el.textContent = value ?? '');
  let data = null;
  let expanded = false;
  let searchIndex = [];
  let searchMatches = [];
  let searchActive = -1;

  function safeUrl(url) {
    const v = String(url || '').trim();
    if (!v || v === '#') return '#';
    if (/^(https?:\/\/|mailto:|\/)/i.test(v)) return v;
    return `https://${v}`;
  }
  function setImage(el, url) {
    const v = String(url || '').trim();
    if (!v) { el.classList.remove('has-photo'); el.style.backgroundImage = ''; return; }
    el.style.backgroundImage = `url("${v.replace(/"/g, '%22')}")`; el.classList.add('has-photo');
  }
  function render() {
    const p = data.profile || {};
    Object.entries(p).forEach(([key, value]) => { if (typeof value === 'string') bind(key, value); });
    document.title = `${p.name || 'Resume'} | Resume & Portfolio`;
    document.getElementById('coverEyebrow').textContent = p.coverEyebrow || '';
    document.getElementById('coverTitle').textContent = p.coverTitle || '';
    setImage(document.getElementById('avatar'), p.profilePhoto);
    const cover = document.getElementById('cover');
    if (p.coverPhoto) { cover.style.backgroundImage = `url("${String(p.coverPhoto).replace(/"/g,'%22')}")`; cover.classList.add('has-photo'); } else { cover.style.backgroundImage=''; cover.classList.remove('has-photo'); }
    document.getElementById('githubLink').href = safeUrl(p.social?.github);
    document.getElementById('linkedinLink').href = safeUrl(p.social?.linkedin);
    document.getElementById('facebookLink').href = safeUrl(p.social?.facebook);
    document.getElementById('emailLink').href = `mailto:${p.email || ''}`;
    const resumeButton = document.getElementById('downloadResume');
    const resumeUrl = String(p.resumeFile || '').trim();
    if (resumeUrl) {
      resumeButton.href = resumeUrl;
      resumeButton.setAttribute('download', p.resumeFileName || 'Resume');
      resumeButton.classList.remove('disabled');
      resumeButton.setAttribute('aria-disabled', 'false');
      resumeButton.title = p.resumeFileName ? `Download ${p.resumeFileName}` : 'Download resume';
    } else {
      resumeButton.href = '#';
      resumeButton.removeAttribute('download');
      resumeButton.classList.add('disabled');
      resumeButton.setAttribute('aria-disabled', 'true');
      resumeButton.title = 'Resume has not been uploaded yet.';
    }

    document.getElementById('skillsContainer').innerHTML = Object.entries(data.skills || {}).map(([group, list], gi) => `<div class="skill-group" data-search-key="skill-${gi}"><h3>${esc(group)}</h3><div class="chips">${(list || []).map(s => `<span>${esc(s)}</span>`).join('')}</div></div>`).join('') || '<p>No skills added yet.</p>';
    document.getElementById('educationContainer').innerHTML = (data.education || []).map((item, i) => `<div class="education-item" data-search-key="education-${i}"><div class="edu-icon">🎓</div><div><strong>${esc(item.school)}</strong><p>${esc(item.course)}</p><span>${esc(item.period)}</span><small>${esc(item.note)}</small></div></div>`).join('') || '<p>No education entries yet.</p>';
    document.getElementById('certContainer').innerHTML = (data.certifications || []).map((c, i) => `<li data-search-key="certification-${i}"><span class="check">✓</span>${esc(c)}</li>`).join('') || '<li>No certifications added yet.</li>';

    document.getElementById('projectGrid').innerHTML = (data.projects || []).map((pj, i) => {
      const hasImage = !!String(pj.image || '').trim();
      const link = safeUrl(pj.link);
      const sourceLink = safeUrl(pj.sourceLink);
      const visual = `<div class="project-visual ${esc(pj.accent || 'blue')} ${hasImage?'has-image':''}" ${hasImage?`style="background-image:url('${esc(pj.image).replace(/'/g,'&#39;')}')"`:''}><span class="project-icon">${esc(pj.icon || '◆')}</span><div class="fake-window"><i></i><i></i><i></i><div class="fake-sidebar"></div><div class="fake-content"><b></b><b></b><b></b></div></div></div>`;
      const visualHtml = link !== '#' ? `<a href="${esc(link)}" target="_blank" rel="noreferrer" aria-label="Open ${esc(pj.title)}">${visual}</a>` : visual;
      const actions = [
        link !== '#' ? `<a class="project-visit" href="${esc(link)}" target="_blank" rel="noreferrer">View live site ↗</a>` : '',
        sourceLink !== '#' ? `<a class="project-source" href="${esc(sourceLink)}" target="_blank" rel="noreferrer">Source code ↗</a>` : ''
      ].join('');
      return `<article class="project-card" data-search-key="project-${i}">${visualHtml}<div class="project-body"><span class="project-type">${esc(pj.type)}</span><h3>${esc(pj.title)}</h3><p>${esc(pj.description)}</p><div class="chips compact">${(pj.stack || []).map(s => `<span>${esc(s)}</span>`).join('')}</div><div class="project-footer"><span><b>✓</b>${esc(pj.status)}</span><div class="project-actions">${actions}</div></div></div></article>`;
    }).join('') || '<p>No projects added yet.</p>';

    document.getElementById('experience').innerHTML = (data.experiences || []).map((exp, i) => `<article class="feed-post card" data-search-key="experience-${i}"><div class="post-header"><div class="post-avatar">▣</div><div><strong>${esc(exp.role)}</strong><span>${esc(exp.company)} • ${esc(exp.period)}</span></div><span></span></div><p class="post-copy">${esc(exp.description)}</p><div class="experience-panel"><div class="experience-banner"><strong>▣</strong><span>WORK EXPERIENCE</span></div><ul>${(exp.bullets || []).map(b => `<li><span class="check">✓</span>${esc(b)}</li>`).join('')}</ul></div><div class="engagement"><span>✓ Professional experience</span><span>${(exp.bullets || []).length} core responsibilities</span></div></article>`).join('') || '<article class="card"><p>No experience entries yet.</p></article>';

    renderTimeline();
    const gallery = data.gallery || [];
    document.getElementById('galleryGrid').innerHTML = gallery.length ? gallery.map((g,i) => `<div class="gallery-item g${(i%6)+1} ${g.image?'has-image':''}" ${g.image?`style="background-image:url('${esc(g.image).replace(/'/g,'&#39;')}')"`:''}><span>${esc(g.title)}</span></div>`).join('') : '<div class="gallery-empty">No gallery images yet.</div>';
    buildSearchIndex();
  }
  function renderTimeline() {
    const items = data?.timeline || []; const list = expanded ? items : items.slice(0, 2);
    document.getElementById('timelineContainer').innerHTML = list.map((item, index) => `<div class="timeline-item" data-search-key="timeline-${index}"><div class="timeline-line"><span>${index + 1}</span></div><div class="timeline-content"><div class="timeline-meta"><span>${esc(item.tag)}</span><small>${esc(item.date)}</small></div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div></div>`).join('') || '<p>No timeline entries yet.</p>';
    const btn = document.getElementById('timelineToggle'); btn.hidden = items.length <= 2; btn.textContent = expanded ? 'Show less' : 'See more milestones';
  }
  function normalize(value='') { return String(value).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function buildSearchIndex() {
    if (!data) return;
    const p = data.profile || {};
    searchIndex = [
      { category:'Profile', title:p.headline || p.name || 'About me', subtitle:p.location || '', body:p.about || '', key:'overview', section:'overview' },
      ...(data.experiences || []).map((x,i)=>({category:'Experience', title:x.role || 'Experience', subtitle:[x.company,x.period].filter(Boolean).join(' • '), body:[x.description,...(x.bullets||[])].join(' '), key:`experience-${i}`, section:'experience'})),
      ...(data.projects || []).map((x,i)=>({category:'Project', title:x.title || 'Project', subtitle:x.type || '', body:[x.description,x.status,...(x.stack||[])].join(' '), key:`project-${i}`, section:'projects'})),
      ...Object.entries(data.skills || {}).map(([group,list],i)=>({category:'Skills', title:group, subtitle:(list||[]).slice(0,4).join(' • '), body:(list||[]).join(' '), key:`skill-${i}`, section:'skills'})),
      ...(data.timeline || []).map((x,i)=>({category:'Timeline', title:x.title || 'Milestone', subtitle:[x.tag,x.date].filter(Boolean).join(' • '), body:x.text || '', key:`timeline-${i}`, section:'timeline'})),
      ...(data.education || []).map((x,i)=>({category:'Education', title:x.school || 'Education', subtitle:[x.course,x.period].filter(Boolean).join(' • '), body:x.note || '', key:`education-${i}`, section:'education'})),
      ...(data.certifications || []).map((x,i)=>({category:'Certification', title:String(x), subtitle:'Certification & training', body:String(x), key:`certification-${i}`, section:'education'}))
    ].map(item => ({...item, haystack:normalize([item.category,item.title,item.subtitle,item.body].join(' '))}));
  }
  function searchScore(item, query) {
    const q = normalize(query);
    if (!q) return 0;
    const title = normalize(item.title), subtitle = normalize(item.subtitle), category = normalize(item.category);
    let score = 0;
    if (title === q) score += 120;
    else if (title.startsWith(q)) score += 90;
    else if (title.includes(q)) score += 70;
    if (subtitle.includes(q)) score += 35;
    if (category.includes(q)) score += 25;
    if (item.haystack.includes(q)) score += 20;
    for (const term of q.split(' ').filter(Boolean)) if (item.haystack.includes(term)) score += 8;
    return score;
  }
  function closeSearch() {
    const box = document.getElementById('searchResults'), input = document.getElementById('siteSearch');
    searchMatches = []; searchActive = -1; box.hidden = true; box.innerHTML = ''; input.setAttribute('aria-expanded','false');
  }
  function renderSearchResults(query) {
    const box = document.getElementById('searchResults'), input = document.getElementById('siteSearch'), clear = document.getElementById('searchClear');
    const q = query.trim(); clear.hidden = !q;
    if (!q) { closeSearch(); return; }
    searchMatches = searchIndex.map(item=>({item,score:searchScore(item,q)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.item);
    searchActive = -1;
    box.innerHTML = searchMatches.length ? searchMatches.map((item,i)=>`<button type="button" class="search-result" role="option" data-search-result="${i}" aria-selected="false"><span class="search-result-kind">${esc(item.category)}</span><strong>${esc(item.title)}</strong>${item.subtitle?`<small>${esc(item.subtitle)}</small>`:''}</button>`).join('') : `<div class="search-no-results"><strong>No matching résumé item</strong><span>Try a project name, technology, role, school, or certification.</span></div>`;
    box.hidden = false; input.setAttribute('aria-expanded','true');
    box.querySelectorAll('[data-search-result]').forEach(btn=>btn.addEventListener('click',()=>openSearchResult(searchMatches[+btn.dataset.searchResult])));
  }
  function openSearchResult(item) {
    if (!item) return;
    if (item.section === 'timeline') { expanded = true; renderTimeline(); }
    closeSearch();
    const input = document.getElementById('siteSearch'); input.blur();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const byKey = document.querySelector(`[data-search-key="${CSS.escape(item.key)}"]`);
      const target = byKey || document.getElementById(item.section) || document.getElementById('overview');
      target?.scrollIntoView({behavior:'smooth', block:'center'});
      if (byKey) { byKey.classList.remove('search-flash'); void byKey.offsetWidth; byKey.classList.add('search-flash'); setTimeout(()=>byKey.classList.remove('search-flash'),1800); }
    }));
  }
  function updateSearchActive(next) {
    const buttons = [...document.querySelectorAll('[data-search-result]')]; if (!buttons.length) return;
    searchActive = (next + buttons.length) % buttons.length;
    buttons.forEach((b,i)=>{const on=i===searchActive;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false');});
    buttons[searchActive].scrollIntoView({block:'nearest'});
  }
  function initSearch() {
    const input=document.getElementById('siteSearch'), clear=document.getElementById('searchClear'), wrap=document.getElementById('searchWrap');
    input.addEventListener('input',()=>renderSearchResults(input.value));
    input.addEventListener('focus',()=>{ if(input.value.trim()) renderSearchResults(input.value); });
    input.addEventListener('keydown',e=>{
      if (e.key==='ArrowDown'){e.preventDefault();updateSearchActive(searchActive+1);}
      else if(e.key==='ArrowUp'){e.preventDefault();updateSearchActive(searchActive-1);}
      else if(e.key==='Enter'){if(searchMatches.length){e.preventDefault();openSearchResult(searchMatches[searchActive>=0?searchActive:0]);}}
      else if(e.key==='Escape'){closeSearch();input.blur();}
    });
    clear.addEventListener('click',()=>{input.value='';clear.hidden=true;closeSearch();input.focus();});
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))closeSearch();});
  }

  async function load() {
    try {
      const r = await fetch('/api/content', {cache:'no-store'});
      if (!r.ok) throw new Error('Could not load resume content.');
      data = await r.json();
    } catch (e) {
      document.body.innerHTML = `<main style="max-width:700px;margin:80px auto;font-family:system-ui;padding:20px"><h1>Website backend is not running</h1><p>${esc(e.message)}</p><p>Start the website with <code>npm start</code>, then open the localhost address shown in the terminal.</p></main>`;
      return;
    }

    try {
      render();
    } catch (e) {
      console.error('Resume render error:', e);
      document.body.innerHTML = `<main style="max-width:700px;margin:80px auto;font-family:system-ui;padding:20px"><h1>Website failed to render</h1><p>${esc(e.message)}</p><p>The backend responded correctly, but the public page encountered a JavaScript error. Check the browser console or restore the previous <code>public/app.js</code>.</p></main>`;
    }
  }

  document.getElementById('timelineToggle').addEventListener('click', () => { expanded = !expanded; renderTimeline(); });
  document.querySelectorAll('.nav-target').forEach(btn => btn.addEventListener('click', () => { const el = document.getElementById(btn.dataset.target || 'overview'); if (el) el.scrollIntoView({behavior:'smooth', block:'start'}); document.getElementById('mobileBackdrop').hidden = true; }));
  const themeToggle = document.getElementById('themeToggle'); if (localStorage.getItem('resume-theme') === 'dark') document.documentElement.dataset.theme = 'dark';
  const syncThemeIcon = () => themeToggle.textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'; syncThemeIcon();
  themeToggle.addEventListener('click', () => { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? 'light' : 'dark'; localStorage.setItem('resume-theme', dark ? 'light' : 'dark'); syncThemeIcon(); });
  const backdrop = document.getElementById('mobileBackdrop'); document.getElementById('menuOpen').addEventListener('click', () => backdrop.hidden = false); document.getElementById('menuClose').addEventListener('click', () => backdrop.hidden = true); backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.hidden = true; });
  document.getElementById('downloadResume').addEventListener('click', e => {
    if (e.currentTarget.classList.contains('disabled')) {
      e.preventDefault();
      alert('A downloadable resume has not been uploaded yet.');
    }
  });
  document.getElementById('contactForm').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget; const status = document.getElementById('formStatus'); status.className=''; status.textContent='Sending…'; form.classList.add('form-loading');
    const payload = Object.fromEntries(new FormData(form).entries());
    try { const r = await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const result = await r.json(); if (!r.ok) throw new Error(result.error || 'Could not send message.'); status.className='success'; status.textContent='Message sent successfully.'; form.reset(); }
    catch(err){status.className='form-error';status.textContent=err.message;} finally {form.classList.remove('form-loading');}
  });
  initSearch();
  load();
})();
