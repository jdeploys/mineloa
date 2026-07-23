# Mineloa Support

Mineloa is a macOS meeting recorder that stores meeting data on your Mac by default.
This page explains how to get help, what information to include, and how to resolve
common issues.

## Ask a question or request support

Use the [Mineloa support request form](https://github.com/jdeploys/Mineloa/issues/new)
to ask a question, report a problem, or request help. Support requests are handled in
Korean or English.

Before submitting a request, include:

- Your macOS version and Mac model
- The Mineloa version and build number shown in the app
- The screen and action where the problem occurred
- The exact error message, with API keys and private meeting content removed
- Reproduction steps and whether the issue happens again after reopening the app

Do not attach recordings, transcripts, API keys, or other confidential meeting data
to a public support request.

## Common issues

### The main window was closed

Choose **Window → Mineloa** from the macOS menu bar, press **Command–0**, or click
Mineloa in the Dock to reopen the main window.

### Microphone recording does not start

Open **System Settings → Privacy & Security → Microphone**, allow Mineloa to use the
microphone, and then reopen the app.

### Transcription or summary does not start

Open Mineloa settings and check the selected processing provider. OpenAI processing
requires a valid API key and an Internet connection. Recording and local meeting
management remain available without an API key.

### A recording was interrupted

Reopen Mineloa and use the recovery prompt to restore or export the interrupted
recording. Keep the original file until recovery has completed.

## Privacy

Review the [Mineloa privacy policy](docs/privacy-policy.md) before sharing diagnostic
information. Mineloa support will never ask for your API key.
