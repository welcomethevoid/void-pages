# void-pages

Motor del sitio estático para VOID apuntes.

## Estructura

```
void-pages/
├── build.js          ← generador del sitio
├── package.json
├── assets/
│   ├── style.css     ← design system VOID
│   └── script.js     ← TOC, search, lightbox, tree
└── README.md
```

## Uso local

```bash
CONTENT_DIR=../void-notes OUTPUT_DIR=./dist node build.js
```

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CONTENT_DIR` | Path al checkout de `void-notes` |
| `OUTPUT_DIR` | Path donde se genera el sitio (`dist/`) |

## Lo que genera `build.js`

- `index.html` — grid de materias
- `/{materia}/index.html` — lista de notas y cuadernos
- `/{materia}/{subcarpeta}/index.html` — subcarpetas recursivas
- `/{materia}/{uuid}/index.html` — página de cada nota
- `/{materia}/{cuaderno}/index.html` — galería del cuaderno
- `search-index.json` — índice para búsqueda client-side
- `assets/` — CSS y JS copiados

## Estructura esperada en `void-notes`

```
void-notes/
├── notas/
│   └── {materia-slug}/
│       └── {uuid}.md        ← frontmatter + contenido markdown
├── cuadernos/
│   └── {materia-slug}/
│       └── {nombre}/
│           ├── index.md     ← frontmatter con title, pages, updated
│           └── pagina-N.png
└── _config/
    └── materias.json        ← { "slug": "Nombre legible" }
```

## Parte del ecosistema VOID

- [`void-notes`](https://github.com/{usuario}/void-notes) — contenido de cada usuario (creado por la app)
- [`void-landing`](https://github.com/welcomethevoid/void-landing) — landing page de VOID
- [`void-pages`](https://github.com/welcomethevoid/void-pages) — este repo
