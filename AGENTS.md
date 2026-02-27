# AGENTS.md

## Purpose

This repository is a WebGL2/React application for browsing and rendering Fragmentarium-style fractal shaders in the browser.

The app parses Fragmentarium `.frag` files, builds a composed scene shader (geometry + integrator GLSL + bridge code), and renders progressively in a WebGL2 canvas.

Terminology: refer to shader source code assets as "fragments" (not "definitions" or "systems").

## Setup

## Prerequisites

- Node.js (recommended: current LTS)
- `npm`
- A browser/GPU with WebGL2 support

Notes:

- Normal app development is Node/TypeScript-based.
- Python is only needed for utility scripts in `scripts/` (for example, Fragmentarium porting helpers).

## Install

```bash
npm install
```

## Run (development)

```bash
npm run dev
```

This starts the Vite dev server.

## Test

```bash
npm test
```

Target specific tests:

```bash
npm test -- tests/sceneShaderComposer.test.ts
```

## Typecheck

```bash
npm run typecheck
```

## Build

```bash
npm run build
```

This runs TypeScript typechecking (`tsc --noEmit`) and then a Vite production build.

## Optional utility scripts

```bash
npm run port:fragmentarium-3d
```

This runs `scripts/port_fragmentarium_3d.py` to help port legacy Fragmentarium 3D sources.

## Overall Structure

## Top level

- `src/`: application source code
- `tests/`: Vitest unit/component tests
- `scripts/`: Python utilities for shader source transformation/formatting
- `dist/`: build output (generated)
- `reports/`: generated reports/artifacts
- `package.json`: npm scripts and dependencies

## `src/` layout

## App/UI layer

- `src/main.tsx`: app entry point
- `src/app/App.tsx`: main application shell and state orchestration
- `src/components/`: React UI components (viewport, editors, dialogs, trees, panels)
- `src/styles/global.css`: global styling

## Rendering pipeline

- `src/core/render/renderer.ts`
  - WebGL2 renderer lifecycle
  - progressive accumulation
  - render targets
  - uniform upload
  - offline still rendering/export
- `src/core/render/shaderComposer.ts`
  - builds composed GLSL shaders from geometry source + integrator GLSL
  - injects camera helpers, Fragmentarium bridge functions, and compatibility shims
- `src/core/render/glUtils.ts`
  - WebGL2 setup/program compilation/framebuffer helpers
- `src/core/render/shaderDiagnostics.ts`
  - compiler log parsing and source-line mapping for shader errors

## Integrators (raytracers/raymarchers)

- `src/core/integrators/definitions.ts`
  - built-in integrator GLSL strings
  - integrator option definitions (UI-exposed controls)
  - option grouping and cross-integrator value transfer
- `src/core/integrators/types.ts`
  - integrator type definitions

Current built-in integrator IDs include:

- `fast-raymarch`
- `de-raytracer`
- `de-pathtracer-physical`

## Parsing and Fragmentarium compatibility

- `src/core/parser/fragmentParser.ts`: parses Fragmentarium-style shader sources
- `src/core/parser/types.ts`: parser/uniform/preset types
- `src/core/parser/uniformState.ts`: preset/uniform state resolution
- `src/core/parser/fragmentFormatter.ts`: formatting utilities for shader source

## Geometry and camera math

- `src/core/geometry/camera.ts`: camera controller/state logic
- `src/core/geometry/vector.ts`: vector math helpers
- `src/core/geometry/quaternion.ts`: quaternion helpers

## Built-in fragments/content

- `src/systems/registry.ts`: fragment registry
- `src/systems/fragmentarium/manifest.json`: source manifest
- `src/systems/fragmentarium/examples/`: bundled Fragmentarium examples
- `src/systems/fragmentarium/include/`: legacy Fragmentarium include files (reference/source material)

## Utilities

- `src/utils/`: persistence, zip/session storage, color UI helpers, WebM/export helpers

## Testing layout

- `tests/*`
  - parser and compatibility tests
  - shader composer/integrator tests
  - renderer-adjacent logic tests
  - React component tests (Testing Library + jsdom)

When changing shader composition, integrator options, parsing, or UI state transfer, update/add tests in `tests/` in the same area.

## Practical navigation tips

- If a UI control exists but rendering does not change, inspect:
  - `src/core/integrators/definitions.ts` (option key and defaults)
  - `src/core/render/renderer.ts` (uniform upload)
  - `src/core/render/shaderComposer.ts` (composed shader wiring)
- If shader compile errors are hard to map back to user geometry, inspect:
  - `src/core/render/shaderDiagnostics.ts`
  - `tests/sceneShaderComposer.test.ts`
- If a Fragmentarium preset/uniform behaves differently than expected, inspect:
  - `src/core/parser/fragmentParser.ts`
  - `src/core/parser/uniformState.ts`
  - `tests/fragmentariumCompatibility.test.ts`
