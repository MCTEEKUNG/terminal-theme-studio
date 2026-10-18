# Terminal Theme Studio

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner uses this local application to personalize their own terminal. Confirmed in the Impeccable comparison request.

## Product Purpose

Choose a color theme, adjust typography, transparency and backgrounds, inspect the preview, and see the settings applied to the actual terminal. Dark Glass is the selected main application design, with all appearance features preserved.

## Operating Context

A React and TypeScript frontend served locally with Vite and a Bun backend. The current environment is Ubuntu with Ptyxis and Studio Terminal integration. The frontend also supports Windows Terminal.

## Capabilities and Constraints

24 preset palettes, saved looks, font family/size/weight, opacity, glass blur, image/video backgrounds and a playback playlist. Changes save automatically. Preview output is a sample, not an interactive shell. Studio Terminal launches through the existing local API.

Use the Impeccable Dark Glass design as the sole main interface. The user removed the A/B comparison toolbar and design switching. Existing design query parameters do not select another interface. Preserve terminal settings and backend integrations.

## Brand Commitments

Keep the Theme Studio name. The user delegated the alternative design direction after confirming the task and preserved functionality. The user subsequently chose B and pinned dark mode, a black-and-white monochrome Web UI, modern glassmorphism, and a right-hand terminal preview with settings on the left. Terminal palette swatches and media remain authentic user content.

## Evidence on Hand

The running frontend, src components and hooks, docs/screenshots/ux-refresh-desktop.png, and existing backend and native integration code. No user study or measured usability improvement is claimed.

## Product Principles

- Let users compare a palette and its actual terminal output together.
- Keep core settings findable and preserve feature access.
- Distinguish saving, saved, failed, and connection states.
- Keep application styling separate from terminal preferences.
