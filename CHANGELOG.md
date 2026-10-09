# Changelog

## 0.1.0 (first release)

- **Initialize:** a setup wizard (LLM provider and key, team roles, system description, guided constraint questions with one follow-up each) generates `docs/ARCH.md` and the first ADRs.
- **Compliance review** of uncommitted changes: violations of accepted decisions and new components, checked in parallel. Each is resolved on its own: Modify Code, Update Architecture, register or dismiss a component. Components move from Planned to Implemented when their code appears.
- **Prompt pre-check** against the most relevant decisions, with a suggested revised prompt and "Copy prompt with context".
- **Add Decision:** plain-text decision → editable ADR draft, which can supersede an existing decision.
- **Living ARCH.md:** targeted patches that keep manual edits, version history with revert, a viewer that highlights recent changes, and regeneration from the codebase (Architect-only).
- **Teams:** Architect and Developer roles in `.blueprint/roles.json`, with an approval queue for Developers' decisions.
- **ADR browser** with search and filter, and a searchable **audit trail**.
- **Providers:** Google Gemini, Groq, OpenRouter, Anthropic and OpenAI, with your own API key kept in VS Code's SecretStorage.
- Local ADR retrieval (TF-IDF plus the `all-MiniLM-L6-v2` embedding model); Tree-sitter change summaries for TypeScript, JavaScript, Python, Java, Go, C# and Rust.
- **Settings:** auto-review on new files, model per provider, number of ADRs sent as context (`blueprint.retrieval.topK`).
