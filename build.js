#!/usr/bin/env node
/**
 * void-pages/build.js
 * Static site generator for VOID apuntes.
 *
 * Environment variables (set by GitHub Actions):
 *   CONTENT_DIR  — path to void-notes checkout
 *   OUTPUT_DIR   — path to dist/ output directory
 *
 * Local usage:
 *   CONTENT_DIR=../void-notes OUTPUT_DIR=./dist node build.js
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { marked } = require('marked');

// Configure marked
marked.setOptions({ gfm: true, breaks: false });

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONTENT_DIR = process.env.CONTENT_DIR || path.resolve(__dirname, '../void-notes');
const OUTPUT_DIR  = process.env.OUTPUT_DIR  || path.resolve(__dirname, 'dist');
const ASSETS_DIR  = path.resolve(__dirname, 'assets');

// GitHub Pages sirve el sitio en /{repo-name}/ — hay que usar paths relativos
// Para uso local o dominio custom, dejar BASE_PATH vacío
const BASE_PATH = process.env.BASE_PATH || '';

const NOTES_DIR     = path.join(CONTENT_DIR, 'notas');
const NOTEBOOKS_DIR = path.join(CONTENT_DIR, 'cuadernos');
const CONFIG_FILE   = path.join(CONTENT_DIR, '_config', 'materias.json');

// ─── UTILS ───────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function readFileOrNull(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

// ─── FRONTMATTER PARSER ──────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (!key || !rest.length) continue;
    const value = rest.join(':').trim();

    // Parse arrays like [parcial, resumen]
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key.trim()] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      meta[key.trim()] = value;
    }
  }

  return { meta, content: match[2].trim() };
}

// ─── TOC BUILDER ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildToc(markdownContent) {
  const headings = [];
  for (const line of markdownContent.split('\n')) {
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    if (h2) headings.push({ level: 2, text: h2[1], id: slugify(h2[1]) });
    if (h3) headings.push({ level: 3, text: h3[1], id: slugify(h3[1]) });
  }
  return headings;
}

function renderToc(headings) {
  if (!headings.length) return '';
  const items = headings.map(h => `
    <a class="toc-item toc-h${h.level}" href="#${h.id}" data-target="${h.id}">
      ${escapeHtml(h.text)}
    </a>`).join('');
  return `<nav class="toc" aria-label="Índice">${items}</nav>`;
}

// ─── GIT HISTORY ─────────────────────────────────────────────────────────────

function getCommitHistory(filePath) {
  try {
    const log = execSync(
      `git -C "${CONTENT_DIR}" log --follow --pretty=format:"%H|%s|%ad" --date=format:"%d %b %Y · %H:%M" -- "${filePath}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!log) return [];

    return log.split('\n').map((line, i) => {
      const [hash, message, date] = line.split('|');
      return { hash: hash?.slice(0, 7), message, date, isLatest: i === 0 };
    });
  } catch {
    return [];
  }
}

function renderCommits(commits) {
  if (!commits.length) return '';
  const items = commits.map(c => `
    <div class="commit-item">
      <div class="commit-dot ${c.isLatest ? 'latest' : ''}"></div>
      <div>
        <div class="commit-msg">${escapeHtml(c.message || '')}</div>
        <div class="commit-hash">commit <span>${c.hash || ''}</span></div>
      </div>
      <div class="commit-date">${c.date || ''}</div>
    </div>`).join('');

  return `
    <div class="commit-section">
      <div class="commit-section-title">// Historial de versiones</div>
      <div class="commit-list">${items}</div>
    </div>`;
}

// ─── TREE BUILDER ────────────────────────────────────────────────────────────

function buildTree(dir, relBase = '') {
  const node = { folders: [], notes: [], notebooks: [] };
  if (!fs.existsSync(dir)) return node;

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath  = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Check if it's a notebook (has index.md + PNGs)
      const indexFile = path.join(fullPath, 'index.md');
      const hasPngs   = fs.readdirSync(fullPath).some(f => f.endsWith('.png'));

      if (fs.existsSync(indexFile) && hasPngs) {
        const raw = readFileOrNull(indexFile) || '';
        const { meta } = parseFrontmatter(raw);
        node.notebooks.push({
          name: meta.title || entry.name,
          slug: entry.name,
          path: relPath,
          meta
        });
      } else {
        node.folders.push({
          name: entry.name,
          slug: entry.name,
          path: relPath,
          children: buildTree(fullPath, relPath)
        });
      }
    } else if (entry.name.endsWith('.md') && entry.name !== 'index.md') {
      const raw = readFileOrNull(fullPath) || '';
      const { meta, content } = parseFrontmatter(raw);
      const uuid = entry.name.replace('.md', '');
      node.notes.push({
        uuid,
        name: meta.title || uuid,
        slug: uuid,
        path: relPath,
        meta,
        content,
        filePath: fullPath
      });
    }
  }

  return node;
}

function countAll(node) {
  let count = node.notes.length + node.notebooks.length;
  for (const f of node.folders) count += countAll(f.children);
  return count;
}

// ─── SIDEBAR TREE RENDERER ───────────────────────────────────────────────────

function renderSidebarTree(node, basePath, activeNotePath = '', depth = 0) {
  let html = '';
  const indent = depth * 14;

  for (const folder of node.folders) {
    const childHtml = renderSidebarTree(folder.children, `${basePath}/${folder.slug}`, activeNotePath, depth + 1);
    const isOpen = activeNotePath.includes(`/${folder.slug}/`);
    html += `
      <div class="tree-node">
        <div class="tree-row ${isOpen ? 'open-row' : ''}" style="padding-left:${16 + indent}px" onclick="toggleNode(this)">
          <span class="tree-chevron ${isOpen ? 'open' : ''}">▸</span>
          <span class="tree-name">${escapeHtml(folder.name)}</span>
          <span class="tree-count">${countAll(folder.children)}</span>
        </div>
        <div class="tree-children ${isOpen ? 'open' : ''}">${childHtml}</div>
      </div>`;
  }

  for (const note of node.notes) {
    const href    = `${BASE_PATH}${basePath}/${note.uuid}/`;
    const isActive = activeNotePath === href;
    html += `
      <a class="tree-leaf ${isActive ? 'active' : ''}"
         style="padding-left:${22 + indent}px"
         href="${href}">
        ${escapeHtml(note.name)}
      </a>`;
  }

  for (const nb of node.notebooks) {
    const href = `${BASE_PATH}${basePath}/${nb.slug}/`;
    html += `
      <a class="tree-leaf notebook-leaf ${activeNotePath === href ? 'active' : ''}"
         style="padding-left:${22 + indent}px"
         href="${href}">
        ✎ ${escapeHtml(nb.name)}
      </a>`;
  }

  return html;
}

function renderSidebar(materias, activeSubject = '', activeNotePath = '') {
  let html = '<div class="sidebar-section"><div class="sidebar-label">Materias</div>';

  for (const [slug, materia] of Object.entries(materias)) {
    const subjectTree = buildTree(path.join(NOTES_DIR, slug), slug);
    const total       = countAll(subjectTree);
    const isOpen      = activeSubject === slug;
    const childHtml   = renderSidebarTree(subjectTree, `/${slug}`, activeNotePath);

    html += `
      <div class="tree-node">
        <div class="tree-row ${isOpen ? 'active' : ''}" onclick="toggleNode(this)">
          <span class="tree-chevron ${isOpen ? 'open' : ''}">▸</span>
          <span class="tree-name">${escapeHtml(materia)}</span>
          <span class="tree-count">${total}</span>
        </div>
        <div class="tree-children ${isOpen ? 'open' : ''}">${childHtml}</div>
      </div>`;
  }

  html += '</div>';
  return html;
}

// ─── HTML SHELL ──────────────────────────────────────────────────────────────

function htmlShell({ title, sidebar, toc = '', content, bodyClass = '' }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — VOID Apuntes</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;700;900&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${BASE_PATH}/assets/style.css">
</head>
<body class="${bodyClass}">

<header class="topbar">
  <div class="topbar-left">
    <a href="${BASE_PATH}/" class="topbar-brand">VOID<span>//</span>APUNTES</a>
    <nav class="topbar-nav">
      <a href="${BASE_PATH}/">ÍNDICE</a>
    </nav>
  </div>
  <div class="topbar-right">
    <span class="status-dot"></span>
    <span class="topbar-meta">VOID APUNTES</span>
  </div>
</header>

<div class="layout">
  <aside class="sidebar">${sidebar}</aside>
  <main class="main">${content}</main>
</div>

${toc}

<script src="${BASE_PATH}/assets/script.js"></script>
</body>
</html>`;
}

// ─── PAGE GENERATORS ─────────────────────────────────────────────────────────

function generateIndex(materias) {
  const cards = Object.entries(materias).map(([slug, name], i) => {
    const tree  = buildTree(path.join(NOTES_DIR, slug), slug);
    const count = countAll(tree);
    return `
      <a class="subject-card" href="${BASE_PATH}/${slug}/">
        <div class="subject-id">// ${String(i + 1).padStart(2, '0')}</div>
        <div class="subject-name">${escapeHtml(name)}</div>
        <div class="subject-stats">${count} notas</div>
      </a>`;
  }).join('');

  const totalNotes = Object.keys(materias).reduce((acc, slug) => {
    return acc + countAll(buildTree(path.join(NOTES_DIR, slug), slug));
  }, 0);

  const content = `
    <div class="page-header">
      <div class="breadcrumb">VOID // <span>APUNTES</span></div>
      <h1 class="page-title">ÍNDICE</h1>
      <div class="page-meta">${totalNotes} notas publicadas · ${Object.keys(materias).length} materias</div>
    </div>
    <div class="search-bar">
      <span class="search-prefix">&gt;_</span>
      <input type="text" id="search-input" placeholder="buscar en todas las notas..." oninput="handleSearch(this.value)">
    </div>
    <div id="search-results" class="search-results" style="display:none"></div>
    <div class="subjects-grid" id="subjects-grid">${cards}</div>`;

  const sidebar = renderSidebar(materias);

  return htmlShell({ title: 'Índice', sidebar, content });
}

function generateSubjectPage(slug, name, tree, materias) {
  function renderNoteList(node, prefix = '') {
    let html = '';

    for (const folder of node.folders) {
      html += `
        <div class="folder-section">
          <div class="folder-header">${escapeHtml(folder.name)}</div>
          ${renderNoteList(folder.children, `${prefix}${folder.slug}/`)}
        </div>`;
    }

    for (const note of node.notes) {
      const tags = (note.meta.tags || []).map(t =>
        `<span class="tag">${escapeHtml(t)}</span>`).join('');
      html += `
        <a class="note-item" href="${BASE_PATH}/${slug}/${note.uuid}/">
          <div>
            <div class="note-date">${note.meta.updated || note.meta.created || ''}</div>
            <div class="note-title">${escapeHtml(note.name)}</div>
            <div class="note-excerpt">${escapeHtml(note.content.slice(0, 120).replace(/[#*`]/g, ''))}...</div>
            <div class="note-tags">${tags}</div>
          </div>
          <div class="note-arrow">→</div>
        </a>`;
    }

    for (const nb of node.notebooks) {
      html += `
        <a class="note-item" href="${BASE_PATH}/${slug}/${nb.slug}/">
          <div>
            <div class="note-date">${nb.meta.updated || ''}</div>
            <div class="note-title">✎ ${escapeHtml(nb.name)}</div>
            <div class="note-excerpt">Cuaderno dibujado · ${nb.meta.pages || '?'} páginas</div>
          </div>
          <div class="note-arrow">→</div>
        </a>`;
    }

    return html;
  }

  const content = `
    <div class="page-header">
      <div class="breadcrumb"><a href="${BASE_PATH}/">VOID // APUNTES</a> // <span>${escapeHtml(name)}</span></div>
      <h1 class="page-title">${escapeHtml(name.toUpperCase())}</h1>
      <div class="page-meta">${countAll(tree)} notas publicadas</div>
    </div>
    <div class="note-list">${renderNoteList(tree)}</div>`;

  const sidebar = renderSidebar(materias, slug);
  return htmlShell({ title: name, sidebar, content });
}

function generateNotePage(note, subjectSlug, subjectName, materias) {
  const toc     = buildToc(note.content);
  const tocHtml = renderToc(toc);
  const bodyHtml = marked(note.content);

  const relPath = path.relative(CONTENT_DIR, note.filePath);
  const commits = getCommitHistory(relPath);

  const tags = (note.meta.tags || []).map(t =>
    `<span class="tag highlight">${escapeHtml(t)}</span>`).join('');

  const notePath = `${BASE_PATH}/${subjectSlug}/${note.uuid}/`;

  const content = `
    <a class="backlink" href="${BASE_PATH}/${subjectSlug}/">← ${escapeHtml(subjectName)}</a>
    <div class="note-header">
      <div class="note-header-meta">
        <span class="subject-pill">${escapeHtml(subjectName.toUpperCase())}</span>
        <span>${note.meta.updated || note.meta.created || ''}</span>
      </div>
      <h1 class="page-title" style="font-size:42px">${escapeHtml(note.name)}</h1>
      <div class="note-tags" style="margin-top:16px">${tags}</div>
    </div>
    <div class="note-content">${bodyHtml}</div>
    ${renderCommits(commits)}`;

  const sidebar = renderSidebar(materias, subjectSlug, notePath);
  return htmlShell({ title: note.name, sidebar, toc: tocHtml, content });
}

function generateNotebookPage(notebook, subjectSlug, subjectName, materias) {
  const notebookDir = path.join(NOTEBOOKS_DIR, subjectSlug, notebook.slug);
  const pngs = fs.readdirSync(notebookDir)
    .filter(f => f.endsWith('.png'))
    .sort();

  const pages = pngs.map((png, i) => `
    <div class="notebook-page-item" data-index="${i}">
      <div class="page-number">// ${String(i + 1).padStart(2, '0')}</div>
      <img src="pagina-${i + 1}.png"
           alt="Página ${i + 1}"
           loading="lazy"
           onclick="openLightbox(${i})"
           class="notebook-img">
    </div>`).join('');

  const relPath = path.relative(CONTENT_DIR, path.join(notebookDir, 'index.md'));
  const commits = getCommitHistory(relPath);

  const content = `
    <a class="backlink" href="${BASE_PATH}/${subjectSlug}/">← ${escapeHtml(subjectName)}</a>
    <div class="note-header">
      <div class="note-header-meta">
        <span class="subject-pill">${escapeHtml(subjectName.toUpperCase())}</span>
        <span>${notebook.meta.updated || ''}</span>
        <span>·</span>
        <span>${pngs.length} páginas</span>
      </div>
      <h1 class="page-title" style="font-size:42px">✎ ${escapeHtml(notebook.name)}</h1>
    </div>
    <div class="notebook-pages">${pages}</div>
    ${renderCommits(commits)}

    <!-- Lightbox -->
    <div class="lightbox" id="lightbox" onclick="closeLightbox()">
      <div class="lightbox-counter" id="lb-counter"></div>
      <img class="lightbox-img" id="lb-img">
      <button class="lb-btn lb-prev" onclick="event.stopPropagation(); moveLightbox(-1)">←</button>
      <button class="lb-btn lb-next" onclick="event.stopPropagation(); moveLightbox(1)">→</button>
    </div>`;

  const sidebar = renderSidebar(materias, subjectSlug, `${BASE_PATH}/${subjectSlug}/${notebook.slug}/`);
  return htmlShell({ title: notebook.name, sidebar, content });
}

// ─── SEARCH INDEX ────────────────────────────────────────────────────────────

function buildSearchIndex(materias) {
  const index = [];

  for (const [slug, name] of Object.entries(materias)) {
    const tree = buildTree(path.join(NOTES_DIR, slug), slug);

    function walk(node, subjectSlug, subjectName) {
      for (const note of node.notes) {
        index.push({
          title:   note.name,
          subject: subjectName,
          tags:    note.meta.tags || [],
          excerpt: note.content.slice(0, 200).replace(/[#*`]/g, ''),
          url:     `${BASE_PATH}/${subjectSlug}/${note.uuid}/`
        });
      }
      for (const folder of node.folders) walk(folder.children, subjectSlug, subjectName);
    }

    walk(tree, slug, name);
  }

  return index;
}

// ─── MAIN BUILD ──────────────────────────────────────────────────────────────

function build() {
  console.log('▸ VOID Pages — starting build');
  console.log(`  content: ${CONTENT_DIR}`);
  console.log(`  output:  ${OUTPUT_DIR}`);

  // Load materias config
  let materias = {};
  if (fs.existsSync(CONFIG_FILE)) {
    materias = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } else {
    // Auto-discover from folder names if no config
    if (fs.existsSync(NOTES_DIR)) {
      for (const entry of fs.readdirSync(NOTES_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) materias[entry.name] = entry.name;
      }
    }
    console.warn('  ⚠ No _config/materias.json found — using folder names');
  }

  // Clean and prepare output
  if (fs.existsSync(OUTPUT_DIR)) fs.rmSync(OUTPUT_DIR, { recursive: true });
  ensureDir(OUTPUT_DIR);

  // Copy assets
  if (fs.existsSync(ASSETS_DIR)) {
    copyDir(ASSETS_DIR, path.join(OUTPUT_DIR, 'assets'));
    console.log('  ✓ Assets copied');
  }

  // Generate index
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), generateIndex(materias));
  console.log('  ✓ index.html');

  // Generate per-subject and per-note pages
  let noteCount = 0;
  let nbCount   = 0;

  for (const [slug, name] of Object.entries(materias)) {
    const subjectDir = path.join(NOTES_DIR, slug);
    if (!fs.existsSync(subjectDir)) continue;

    const tree = buildTree(subjectDir, slug);

    // Subject index page
    const subjectOut = path.join(OUTPUT_DIR, slug);
    ensureDir(subjectOut);
    fs.writeFileSync(
      path.join(subjectOut, 'index.html'),
      generateSubjectPage(slug, name, tree, materias)
    );

    // Walk tree and generate note pages
    function walkAndGenerate(node, subjectSlug, subjectName, outBase) {
      for (const note of node.notes) {
        const noteOut = path.join(outBase, note.uuid);
        ensureDir(noteOut);
        fs.writeFileSync(
          path.join(noteOut, 'index.html'),
          generateNotePage(note, subjectSlug, subjectName, materias)
        );
        noteCount++;
      }

      for (const folder of node.folders) {
        const folderOut = path.join(outBase, folder.slug);
        ensureDir(folderOut);
        // Folder index — redirect to subject page for now
        fs.writeFileSync(
          path.join(folderOut, 'index.html'),
          generateSubjectPage(slug, name, folder.children, materias)
        );
        walkAndGenerate(folder.children, subjectSlug, subjectName, folderOut);
      }
    }

    walkAndGenerate(tree, slug, name, subjectOut);

    // Notebooks
    const notebooksSubjectDir = path.join(NOTEBOOKS_DIR, slug);
    if (fs.existsSync(notebooksSubjectDir)) {
      for (const entry of fs.readdirSync(notebooksSubjectDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nbDir   = path.join(notebooksSubjectDir, entry.name);
        const indexMd = path.join(nbDir, 'index.md');
        if (!fs.existsSync(indexMd)) continue;

        const { meta } = parseFrontmatter(readFileOrNull(indexMd) || '');
        const notebook = { name: meta.title || entry.name, slug: entry.name, meta };

        const nbOut = path.join(subjectOut, entry.name);
        ensureDir(nbOut);

        // Copy PNGs
        for (const f of fs.readdirSync(nbDir).filter(f => f.endsWith('.png'))) {
          fs.copyFileSync(path.join(nbDir, f), path.join(nbOut, f));
        }

        fs.writeFileSync(
          path.join(nbOut, 'index.html'),
          generateNotebookPage(notebook, slug, name, materias)
        );
        nbCount++;
      }
    }
  }

  console.log(`  ✓ ${noteCount} notas generadas`);
  console.log(`  ✓ ${nbCount} cuadernos generados`);

  // Write search index
  const searchIndex = buildSearchIndex(materias);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'search-index.json'),
    JSON.stringify(searchIndex)
  );
  console.log('  ✓ search-index.json');

  console.log('▸ Build complete');
}

build();
