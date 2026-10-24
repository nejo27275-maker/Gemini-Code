# Agent interoperability and design references

Gemini Code borrows design ideas from public documentation for several agentic developer tools. It does not include their proprietary code, and detecting an executable does not connect or authenticate it.

## Implemented in this repository

| Capability | Status | Implementation |
|---|---|---|
| Persistent session history | Implemented | `src/sessions.js`, `/session` commands |
| Project context conventions | Implemented | `src/knowledge.js` reads `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `.hermes.md`, `SOUL.md`, `.cursorrules`, `CODEX.md`, `ANTIGRAVITY.md`, `KIMI.md`, `KIMI_CODE.md`, and `SYSTEM.md` when present |
| Workspace checkpoints | Implemented | `src/checkpoints.js`, SHA-256 manifest, bounded snapshots and explicit restore confirmation |
| Result artifacts | Implemented | `src/artifacts.js`, report listing and integrity validation |
| Routine scheduling | Implemented locally | Persistent routine JSON + local service; actions `http-check` and `agente` (v0.44.0: the agent runs a task unattended, confirmations answered "no", read-only tools by default, optional system notification); cloud requires deployment |
| Bounded task profiles | Implemented | `gemini-code profiles list|show`; `run --profile coder|explore|plan|review|test`, with actual tool allowlists for limited profiles |
| Named subagent roles | Implemented | Portuguese roles plus `explore`, `plan`, `reviewer`, and `coder`; one delegation level, isolated context |
| Kimi-style project context | Implemented | Also reads `KIMI.md`, `KIMI_CODE.md`, and `SYSTEM.md` if present |
| Higgsfield creative integration guide | Prepared, not connected | `skills/higgsfield-integration/SKILL.md`; optional official CLI + Skills integration, requires user authentication and may consume credits |
| Read-only task profile | Implemented | `run --read-only` remains a backwards-compatible alias for `explore` |
| CLI detection | Implemented | `gemini-code doctor` detects local binaries; no external command is run except `which`/`where.exe` |
| CI workflow | Configured | `.github/workflows/ci.yml`; it becomes active only after committed/pushed to a GitHub repository |
| Secret pattern scan | Implemented | `gemini-code security scan [folder]`; heuristic only, does not print secret values |
| Reusable engineering Skill | Implemented | `skills/engenharia-agente/SKILL.md`; requires evidence-based completion and checkpoints |
| Kimi-style bounded workflow Skill | Implemented | `skills/kimi-agent-workflow/SKILL.md`; explore/plan/coder/reviewer procedure and isolation limits |
| Claude/Codex/Hermes/Antigravity/Kimi SDK integrations | Not implemented | CLI detection is diagnostic only; no external sessions, account logins, or agent APIs are invoked |
| Higgsfield generation | Not connected | Official CLI/Skills setup is documented; install/login/generation are not run automatically and require explicit authorization |
| Browser agent | Implemented (v0.44.0) | `browser` tool: local Chrome/Chromium/Edge over a CDP pipe, temporary profile, all traffic through a proxy that blocks the local network at connect time, per-site approval; see `src/navegador.js` |
| Visual recording of browser sessions | Not implemented | Screenshots only (`browser` action `print`) |
| True cloud orchestration across providers | Not implemented | Requires deployed workers, credentials, billing choices and a persistent runtime |

## Design references

- Hermes Agent: persistent memory, context files, Skills, checkpoints and scheduled tasks: <https://hermes-agent.nousresearch.com/docs/user-guide/features/overview/> and <https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/>
- Claude Code: terminal-based project operations and resumable CLI sessions: <https://docs.anthropic.com/en/docs/claude-code/getting-started> and <https://docs.anthropic.com/en/docs/claude-code/cli-usage>
- Codex CLI: local code changes and approval modes: <https://help.openai.com/en/articles/11096431>
- Codex sandboxing: distinction between filesystem/network sandbox limits and approval policy: <https://developers.openai.com/pt-BR/docs/sandboxing>
- Google Antigravity: asynchronous subagents, browser agent and verifiable artifacts: <https://www.antigravity.google/docs/ide/overview/>
- Kimi Code: isolated `coder`, `explore`, and `plan` subagents, with permission boundaries and resumable/background workflows: <https://www.kimi.ai/help/kimi-code/cli-agents> and <https://www.kimi.ai/help/kimi-code/code-docs-index>
- Higgsfield CLI + Skills: optional creative generation integration for coding agents; account/credits required: <https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-access-higgsfield-via-cli>

## Safety model

- Checkpoint snapshots skip common secret files, symbolic links, `.git`, dependency trees, and common generated directories. This is a defense-in-depth feature, not a guarantee that arbitrary secret material can be detected.
- Restore requires an explicit `--yes`, validates hashes before changing project files, and creates a safety checkpoint. It overwrites checkpointed files but does not delete files created after the snapshot.
- `run --profile explore|plan|review` limits available tools via allowlists; `test` additionally exposes only the recognized `run_checks` tool. These are application-level restrictions, not a formal OS sandbox. `coder` retains the session's normal allowed tools. `run --read-only` remains an alias for `explore`. For untrusted projects, run the agent inside an OS/container sandbox with restricted network and filesystem access.
- Artifacts and session histories may contain source code or private conversations. Keep `~/.gemini-code` private and out of public repositories.
