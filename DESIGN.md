---
version: alpha
colors:
  ink: "#151332"
  panel: "#1a2d47"
  line: "#d0d4e0"
  text: "#ffffff"
  accent: "#167ee8"
  caution: "#fea613"
  success: "#16a34a"
typography:
  body:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    lineHeight: 1.45
  heading:
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif"
    lineHeight: 1.18
  mono:
    fontFamily: "ui-monospace, Consolas, monospace"
rounded:
  sm: "8px"
  md: "14px"
  lg: "16px"
  pill: "999px"
spacing:
  compact: "8px"
  base: "12px"
  roomy: "16px"
components:
  panel:
    radius: "16px"
  button:
    radius: "999px"
  badge:
    radius: "999px"
---

## Overview

This product should feel like an operational dashboard used in a dim dispatch room: calm, readable, and slightly tactile. It is a product surface, not a marketing surface, so clarity and rhythm matter more than visual flourish.

The visual signature is the contrast between deep navy structural surfaces and brighter utility accents used only where action is needed. Most information should sit quietly until the user asks for more detail.

## Colors

Dark navy and softened blue panels carry the main layout. Bright blue is reserved for active controls and current-state emphasis. Amber marks caution, and green marks completion. Light mode keeps the same hierarchy rather than becoming a separate personality.

## Typography

System sans remains the right fit for this app because the surface is operational and information-dense. Hierarchy should come from spacing, scale, and contrast before weight. Monospace is reserved for compact status-style details when needed.

## Layout

Cards should read as compact command surfaces rather than long documents. Default views should reveal the next action first, then let the user expand into the full plan. Dense information should be grouped into short clusters: summary, current step, then optional detail.

## Elevation & Depth

Use the existing soft shadow and translucent panel treatment sparingly. Static content can stay close to the background; action areas may lift slightly through border contrast and subtle fill changes rather than larger shadows.

## Shapes

Rounded rectangles and pill controls are core to the product language. Informational chips should look quieter than buttons so labels never compete with actions.

## Components

Move-planning cards should separate informational metadata from interactive controls. Primary action buttons should use the accent color. Secondary actions should be outline or ghost treatments. Status pills should never resemble clickable controls.

## Do's and Don'ts

Do keep the first actionable step obvious.

Do let detail expand on demand instead of showing every instruction at once.

Don't style labels and badges so strongly that they compete with buttons.

Don't let stacked controls create visual noise when one next action would do.
