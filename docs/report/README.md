# Report sections 5–7

Sources for the final report's Component-level design, Interface design and Testing sections.

- `figures-src/` — one HTML page per figure (hand-placed diagrams use `diagram.js`; UML state/sequence
  diagrams that Mermaid lays out well use `mermaid-page.js`, loaded from jsDelivr, so rendering needs internet).
- `screens.mjs` — renders the real webview pages in `media/` with sample data (Section 6 screenshots);
  `screens-src/` holds HTML reconstructions of the native sidebar and status bar.
- `content/` — the text and tables of each section.
- `figures/` and `BluePrint-report-sections-5-7.docx` — generated.

Rebuild (needs `puppeteer-core` and `docx` installed somewhere, and Chrome; `BROWSER=<path>` picks another browser):

```sh
REPORT_TOOLS=<path to node_modules> node render.mjs          # all figures, or: node render.mjs 5-1-layers
REPORT_TOOLS=<path to node_modules> node screens.mjs         # panel screenshots
REPORT_TOOLS=<path to node_modules> node build-report.mjs
```

Open the .docx in Google Drive with "Open with Google Docs".
