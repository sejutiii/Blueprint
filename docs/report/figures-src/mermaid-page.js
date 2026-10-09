// Shared loader for Mermaid figures: renders the <pre class="mermaid"> in #fig with report
// styling (portrait page width, print-friendly colours), then sets window.figReady for render.mjs.
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  securityLevel: "loose",
  fontFamily: "Segoe UI, Arial, sans-serif",
  themeVariables: {
    fontSize: "22px",
    primaryColor: "#eef3fb",
    primaryBorderColor: "#3a6db5",
    primaryTextColor: "#1b2433",
    lineColor: "#4a5568",
    secondaryColor: "#f3eee6",
    tertiaryColor: "#ffffff",
    noteBkgColor: "#fff7d6",
    noteBorderColor: "#c9a227",
    actorBkg: "#eef3fb",
    actorBorder: "#3a6db5",
    signalColor: "#1b2433",
    signalTextColor: "#1b2433",
    labelBoxBkgColor: "#eef3fb",
    labelBoxBorderColor: "#3a6db5",
    activationBkgColor: "#dbe6f7",
    activationBorderColor: "#3a6db5",
  },
  class: { useMaxWidth: false },
  state: { useMaxWidth: false },
  sequence: {
    useMaxWidth: false, mirrorActors: false, wrap: true,
    messageFontSize: 22.5, actorFontSize: 21, noteFontSize: 20,
    actorMargin: 22, width: 128, height: 62, boxMargin: 6, messageMargin: 34,
    ...(window.SEQUENCE_OVERRIDES ?? {}),
  },
});

await mermaid.run({ querySelector: "#fig .mermaid" });
const svg = document.querySelector("#fig svg");
const natural = svg.getBBox();
// Fill the page width: narrower drawings are scaled up (larger text), wider ones down.
svg.removeAttribute("height");
svg.style.maxWidth = "none";
svg.style.width = "100%";
svg.style.height = "auto";
console.log(`natural size ${Math.round(natural.width)}x${Math.round(natural.height)}`);
window.figReady = true;
