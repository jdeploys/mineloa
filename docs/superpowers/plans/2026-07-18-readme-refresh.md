# Nnote README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Nnote README so users understand the product and release first, while developers can find accurate build and verification instructions later.

**Architecture:** Keep the documentation entry point in one `README.md`, ordered from product overview to advanced development details. Link to existing screenshots, release verification, and Mac App Store documents instead of duplicating them.

**Tech Stack:** GitHub-flavored Markdown, GitHub Releases, existing repository documentation

## Global Constraints

- Modify product documentation only; do not change application behavior or build configuration.
- Use only facts confirmed in the current code, package scripts, or `v0.0.1` GitHub prerelease.
- Put user guidance before developer guidance.
- State clearly that current release artifacts are unsigned prerelease builds.

---

### Task 1: Rewrite and verify the README

**Files:**
- Modify: `README.md`
- Reference: `package.json`
- Reference: `docs/screenshots/README.md`
- Reference: `docs/mac-app-store-publishing.md`
- Reference: `docs/release/acceptance-matrix.md`

**Interfaces:**
- Consumes: current feature set, package scripts, screenshot paths, and release URL
- Produces: the repository landing document used by GitHub visitors and contributors

- [x] **Step 1: Replace the old information hierarchy**

Order sections as introduction, representative screenshot, features, download warning, provider comparison, quick start, privacy/files, development, packaging, and related documents.

- [x] **Step 2: Correct outdated product claims**

Describe bundled Whisper/FFmpeg, downloadable base/small models, OpenAI transcription and summary, and optional Codex CLI summary. Remove the obsolete statement that FFmpeg is unsupported.

- [x] **Step 3: Add verified release guidance**

Link `https://github.com/jdeploys/NNote/releases/tag/v0.0.1`, label it prerelease, list Windows x64 and both macOS architectures, and warn about unsigned SmartScreen/Gatekeeper prompts.

- [x] **Step 4: Verify document integrity**

Run:

```powershell
$links = Select-String -Path README.md -Pattern '\]\((?!https?://|#)([^)]+)\)' -AllMatches
$links.Matches.Groups | Where-Object Name -eq 1 | ForEach-Object Value | ForEach-Object { if (-not (Test-Path $_)) { throw "Missing README link: $_" } }
rg -n "미정|나중에 작성|예시 도메인|FFmpeg는 지원하지" README.md
git diff --check
```

Expected: every relative path exists, the forbidden-content search returns no matches, and `git diff --check` exits successfully.

- [x] **Step 5: Commit**

```powershell
git add README.md docs/superpowers/plans/2026-07-18-readme-refresh.md
git commit -m "📝 docs: refresh project README"
```
