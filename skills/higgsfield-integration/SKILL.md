---
name: higgsfield-integration
description: Connect Gemini Code to the official Higgsfield CLI and Skills for authorized image/video generation workflows. Use when the user explicitly asks for Higgsfield-generated media or wants to set up that integration.
version: 1.0.0
---

# Higgsfield CLI + Skills integration

## Purpose

Use the official Higgsfield integration through its CLI and Skills when the user explicitly requests image/video generation. This is an optional external creative provider, not a code execution engine and not a requirement for normal programming tasks.

## Before setup

1. Explain that authentication uses the user's Higgsfield account and that generated assets may consume account credits.
2. Ask for explicit authorization before installing global packages, starting an interactive login, or triggering any generation that may use credits.
3. Do not request or print passwords, session cookies, API secrets, or authentication codes in the chat.
4. Never claim connection is active merely because the CLI is installed. Verify it with the documented status/help command available in the installed CLI version.

## Official setup reference

The official Higgsfield help page currently documents CLI + Skills installation with `npm i -g @higgsfield/cli`, account login using `higgsfield auth login`, and Skills installation from `higgsfield-ai/skills` through the Skills CLI. Check the current official instructions before executing because package behavior and supported commands can change.

Official references:
- https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-access-higgsfield-via-cli
- https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent

## Execution policy

- Do not perform setup automatically as part of unrelated work.
- Do not generate images/videos or invoke paid API operations without the user's explicit request and awareness of credit use.
- Prefer the official CLI/Skills interface for agent workflows and inspect any third-party Skill before running it.
- Keep generated assets in the requested output folder and report exact paths, model/options if available, and any billing/credit uncertainty.
- If the binary is missing or unauthenticated, report that the integration is not connected; never fabricate an asset URL.
