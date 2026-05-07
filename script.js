/* ─── VOID PAGES — script.js ─── */

// ── TREE TOGGLE ──────────────────────────────────────────────────────────────
function toggleNode(row) {
  const children = row.nextElementSibling;
  if (!children || !children.classList.contains('tree-children')) return;
  const isOpen = children.classList.toggle('open');
  const chevron = row.querySelector('.tree-chevron');
  if (chevron) chevron.classList.toggle('open', isOpen);
}

// ── TOC SCROLL HIGHLIGHT ─────────────────────────────────────────────────────
(function initToc() {
  const tocLinks = document.querySelectorAll('.toc-item');
  if (!tocLinks.length) return;

  const headings = Array.from(
    document.querySelectorAll('.note-content h2[id], .note-content h3[id]')
  );

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id   = entry.target.getAttribute('id');
      const link = document.querySelector(`.toc-item[href="#${id}"]`);
      if (link) link.classList.toggle('active', entry.isIntersecting);
    }
  }, { rootMargin: '-10% 0px -80% 0px' });

  headings.forEach(h => observer.observe(h));
})();

// ── SEARCH ───────────────────────────────────────────────────────────────────
let searchIndex = null;

async function loadSearchIndex() {
  if (searchIndex) return searchIndex;
  try {
    const res = await fetch('/search-index.json');
    searchIndex = await res.json();
  } catch {
    searchIndex = [];
  }
  return searchIndex;
}

async function handleSearch(query) {
  const resultsEl = document.getElementById('search-results');
  const gridEl    = document.getElementById('subjects-grid');
  if (!resultsEl) return;

  if (!query.trim()) {
    resultsEl.style.display = 'none';
    if (gridEl) gridEl.style.display = 'grid';
    resultsEl.innerHTML = '';
    return;
  }

  if (gridEl) gridEl.style.display = 'none';
  resultsEl.style.display = 'block';

  const index = await loadSearchIndex();
  const q = query.toLowerCase();

  const results = index.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.excerpt.toLowerCase().includes(q) ||
    (item.tags || []).some(t => t.toLowerCase().includes(q))
  );

  if (!results.length) {
    resultsEl.innerHTML = `<div style="padding:24px 0; color:var(--dim); font-size:12px; letter-spacing:0.08em">// sin resultados para "${escapeHtml(query)}"</div>`;
    return;
  }

  resultsEl.innerHTML = results.map(r => `
    <a class="search-result-item" href="${r.url}">
      <div class="search-result-subject">${escapeHtml(r.subject.toUpperCase())}</div>
      <div class="search-result-title">${escapeHtml(r.title)}</div>
      <div class="search-result-excerpt">${escapeHtml(r.excerpt)}...</div>
    </a>
  `).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── LIGHTBOX ─────────────────────────────────────────────────────────────────
let lbImages = [];
let lbCurrent = 0;

function openLightbox(index) {
  lbImages = Array.from(document.querySelectorAll('.notebook-img'));
  lbCurrent = index;
  updateLightbox();
  document.getElementById('lightbox')?.classList.add('open');
  document.addEventListener('keydown', handleLightboxKey);
}

function closeLightbox() {
  document.getElementById('lightbox')?.classList.remove('open');
  document.removeEventListener('keydown', handleLightboxKey);
}

function moveLightbox(dir) {
  lbCurrent = (lbCurrent + dir + lbImages.length) % lbImages.length;
  updateLightbox();
}

function updateLightbox() {
  const img     = document.getElementById('lb-img');
  const counter = document.getElementById('lb-counter');
  if (img && lbImages[lbCurrent]) {
    img.src = lbImages[lbCurrent].src;
  }
  if (counter) {
    counter.textContent = `${lbCurrent + 1} / ${lbImages.length}`;
  }
}

function handleLightboxKey(e) {
  if (e.key === 'ArrowLeft')  moveLightbox(-1);
  if (e.key === 'ArrowRight') moveLightbox(1);
  if (e.key === 'Escape')     closeLightbox();
}
