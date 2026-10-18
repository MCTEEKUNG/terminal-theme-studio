---
name: "Theme Studio — Impeccable B"
description: "A monochrome dark glass workspace for terminal appearance."
colors:
  primary: "#eeeeee"
  primary-hover: "#ffffff"
  selected: "#ffffff12"
  header: "rgba(14, 14, 14, 0.68)"
  ground: "#090909"
  surface: "rgba(25, 25, 25, 0.76)"
  preview-surface: "rgba(18, 18, 18, 0.52)"
  elevated: "#242424"
  elevated-hover: "#303030"
  inset: "#151515"
  border: "#ffffff24"
  border-soft: "#ffffff14"
  border-strong: "#777777"
  ink: "#f5f5f5"
  secondary-ink: "#b8b8b8"
  muted-ink: "#a4a4a4"
  on-primary: "#111111"
  success: "#d4d4d4"
  danger: "#eeeeee"
  status-ink: "#bcbcbc"
  text-selection: "#dddddd"
  opaque-surface: "#171717"
  playlist-track: "#121212"
  conversion-ink: "#dedede"
typography:
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  supporting:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  headline-mobile:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  brand-mobile:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  metadata:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "11px"
  readout:
    fontFamily: "JetBrains Mono, Consolas, monospace"
    fontSize: "11px"
rounded:
  specimen: "3px"
  badge: "5px"
  control: "6px"
  button: "7px"
  terminal: "12px"
  workspace: "18px"
spacing:
  step-1: "4px"
  step-2: "8px"
  step-3: "12px"
  step-4: "16px"
  step-6: "24px"
  step-8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  theme-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  theme-row-selected:
    backgroundColor: "{colors.selected}"
  count-badge:
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.badge}"
    padding: "1px 7px"
  glass-inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.workspace}"
  glass-preview:
    backgroundColor: "{colors.preview-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.workspace}"
---

# Design System: Theme Studio — Impeccable B

## Overview

**Creative North Star: "The Monochrome Glass Workspace"**

The user-selected B design is a dark, black-and-white glass workspace. Translucent neutral panels, thin white boundaries and compact readable controls frame the terminal; authentic palette colors and user media remain expressive content. This explicit direction supersedes the earlier light archive expression.

This system defines the main Dark Glass interface. The A/B comparison and alternate design routing have been removed. Sources are `src/impeccable.css`, shared primitives in `src/index.css`, and the unchanged component structure in `src/components/ImpeccableStudio.tsx`. Shared loading/error screens and native terminal styling are outside this system.

**Key Characteristics:**
- Dark monochrome chrome with real colored terminal content.
- Translucent glass work areas with restrained neutral illumination.
- Settings left and terminal preview right; settings first on mobile.

## Colors

The frontmatter records the neutral source palette, including alpha colors that create the glass layers.

### Primary

- **Silver Action / White Hover** (`primary`, `primary-hover`): primary actions, active category text and keyboard focus. Their legacy source aliases are `--amber` and `--amber-bright`; those names do not imply hue in B.
- **Selected Veil** (`selected`): selected palette and playlist rows.

### Neutral

- **Black Ground / Header Glass** (`ground`, `header`): the canvas and translucent header.
- **Inspector Glass / Preview Glass** (`surface`, `preview-surface`): the two work areas.
- **Graphite / Inset Black** (`elevated`, `elevated-hover`, `inset`): controls and nested surfaces.
- **White Rules** (`border`, `border-soft`, `border-strong`): fine boundaries and stronger hover strokes.
- **White Ink / Supporting Grey / Muted Grey** (`ink`, `secondary-ink`, `muted-ink`): readable hierarchy. `on-primary` is dark action text.

Status text uses `status-ink`, text selection uses `text-selection`, opaque panel/option fallbacks use `opaque-surface`, playlist tab tracks use `playlist-track`, and conversion-in-progress uses `conversion-ink`. These are source roles, not extra accents.

Success and danger also resolve to neutral values. Text, borders and state labels distinguish outcomes; color is not their sole signal.

**The Specimen Boundary Rule.** Keep Web UI chrome achromatic; retain the true colors of terminal schemes, swatches and user media.

## Typography

**Product Font:** Hanken Grotesk, system-ui, sans-serif. **Readout Font:** JetBrains Mono, Consolas, monospace. The user-selected terminal font is content.

The compact hierarchy gives the terminal room: headline for the active theme, title for inspector headings, body for explanations, label for tabs/actions, and mono readouts for values. Frontmatter owns their desktop sizes and weights. Inspector explanations use (13px, 1.6); metadata uses (11px). At widths up to (800px), the preview heading becomes (24px) and brand becomes (18px). Actions and active tabs use weight (600).

**The Product Type Rule.** Use Hanken Grotesk for product UI; keep terminal font choice inside the preview and numeric readouts in the mono stack.

## Layout

Below the header (minimum 72px), the desktop workspace places a settings inspector LEFT (384px) and flexible terminal preview RIGHT, with gutters and gap (24px). At widths up to (1150px), the inspector is (352px), gutters/gap (20px), preview padding (24px) and inspector padding (20px). Desktop work areas scroll independently. Four category tabs stay above inspector content.

At widths up to (800px), natural page flow stacks settings then preview with jump links, gutters/gap (16px), and visible labels. Up to (420px), header status takes its own row and tabs tighten. This is the current editor composition, not a universal composition for every future screen.

Theme rows remain at least (44px) high. Ordered swatches are (100px × 16px), (88px) wide at the medium breakpoint, (132px × 18px) on mobile and (100px) wide on narrow phones. Preview ribbons are (160px × 12px), reducing to (120px). The terminal keeps minimum dimensions and scroll access rather than shrinking its sample text.

## Elevation & Depth

Modern glassmorphism comes from translucent black panels, backdrop blur (24px), thin alpha-white borders and two static white radial light washes on the black ground. The inspector and preview use distinct alpha fills. An unsupported-backdrop-filter fallback makes both panels opaque (`#171717`) and the header opaque (`#101010`). There are no panel drop shadows; palette rows and terminal windows explicitly remove inherited shadows and translation. The slider thumb retains its thin white ring.

**The Glass Boundary Rule.** Apply backdrop blur to the header and two work areas; preserve opaque fallbacks and legible controls.

Keyboard focus uses a white outline (2px), offset (4px), or (2px) for fields. Buttons transition background, border and text over (160ms, ease-out); toggle translation uses (150ms). Reduced-motion preferences remove transitions and inherited animations. User-adjustable terminal blur and opacity remain independent content settings.

## Shapes

The two glass work areas use generous rounded corners (`workspace`); controls and buttons remain compact, with smaller specimen and badge corners. Frontmatter records these radii. Thin rules divide groups, joined palette cells preserve their eight-color order, and clipping contains the terminal silhouette. Status dots and toggle thumbs are circular functional exceptions.

## Components

### Buttons

Primary actions use silver fill with dark text, becoming white on hover. Secondary actions use dark inset fill, light text and thin white borders; hover adds the selected veil and stronger stroke. Shared buttons use (8px 12px) padding and minimum height (36px); the full-width save-look action uses (40px). Disabled actions use opacity (0.5) and a not-allowed cursor. Focus remains visible.

### Chips

Saved-look counts use a white alpha fill (`#ffffff0d`), supporting grey text and compact badge rounding. Mono numeric readouts use a related alpha fill (`#ffffff0c`). These communicate values rather than actions.

### Cards / Containers

Inspector and preview are the glass containers. Palette choices are flat button rows: transparent at rest, white veil on hover (`#ffffff0a`), selected veil and stronger alpha border (`#ffffff40`) when active, with a small SVG check. Saved looks use inset neutral rows and distinct apply/delete targets.

### Inputs / Fields

Text/select fields use dark inset fill, light text, thin neutral borders, compact rounding and minimum height (40px). Search uses the inspector glass fill and grouped focus-within outline. Placeholders use muted grey. Inline errors stay neutral and retain textual meaning.

### Navigation

Four labeled SVG icon tabs span the inspector. Active state uses white text, weight (600) and bottom rule (2px), with `aria-current="page"`; hover adds a white alpha veil (`#ffffff08`). Mobile tabs are at least (56px) high. Icons use rounded SVG strokes rather than icon fonts.

### Palette specimens

Choices and preview use the same eight-color order: background, red, green, yellow, blue, purple, cyan, foreground. They are authentic data, outside the monochrome chrome palette. The terminal preview is sample output, not an interactive shell.

## Do's and Don'ts

### Do:
- **Do** scope this system to B and retain A as an independent visual baseline.
- **Do** preserve the ordered background, red, green, yellow, blue, purple, cyan, foreground specimen ribbon.
- **Do** use labeled native controls and visible keyboard focus for product interactions.
- **Do** respect reduced motion and preserve textual saving, failure and connection states.

### Don't:
- **Don't** introduce chromatic accents into the Web UI chrome.
- **Don't** desaturate terminal palettes, swatches or user media to match the chrome.
- **Don't** apply B’s scoped tokens to A or change terminal preferences when switching designs.
- **Don't** reuse carried glyph icons as a pattern for new product controls.

Not canonized or repaired by this documentation pass: the inherited search magnifier is a text glyph and simulated terminal controls carry textual symbols. These are existing implementation details, not reusable product icon rules. Documentation reflects source inspection; no measured usability or whole-surface validation claim is made.

Input and search outlines use `--border-strong` (#777777) to distinguish editable bounds from the translucent pane; decorative panel boundaries keep the softer glass border.
