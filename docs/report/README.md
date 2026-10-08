# Report sections 5–7

Sources for the final report's Component-level design, Interface design and Testing sections.

- `figures-src/` — one HTML page per figure (hand-placed diagrams use `diagram.js`; UML state/sequence
  diagrams that Mermaid lays out well use `mermaid-page.js`, loaded from jsDelivr, so rendering needs internet).
- `content/` — the text and tables of each section.
- `figures/` and `BluePrint-report-sections-5-7.docx` — generated.

Rebuild (needs `puppeteer-core` and `docx` installed somewhere, and Microsoft Edge):

```sh
REPORT_TOOLS=<path to node_modules> node render.mjs          # all figures, or: node render.mjs 5-1-layers
REPORT_TOOLS=<path to node_modules> node build-report.mjs
```

Open the .docx in Google Drive with "Open with Google Docs".
