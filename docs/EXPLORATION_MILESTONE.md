# Exploration polish, first milestone

Implemented motion interpolation between fixed simulation steps, exponential movement acceleration/braking, frame-rate-independent camera smoothing, and camera resets at dungeon entry/teleport. Camera offsets track floating-origin changes. Pause and climbing clear residual movement.

Suncrest has an illuminated plaza seal. Four sanctum styles have distinct ring patterns and stone palettes, plus illuminated routes to the arena. Inlays are flush decorative surfaces, not new solid obstacles. Marks use instanced meshes. Treasure remains sealed until every dungeon guardian is defeated; the interaction prompt explains the requirement.

## Validation

- `npm test`: movement acceleration/braking, dungeon bounds, 30/144 Hz render cadence, pause, treasure lock and duplicate reward prevention, all four inlay geometries.
- `npm run lint`: TypeScript check.
- `npm run build`: production bundle and PWA generation.
- This checkout has an existing Vite/esbuild peer dependency conflict. Local dependencies were installed with `npm install --ignore-scripts --legacy-peer-deps --package-lock=false`; dependency versions and the Bun lockfile are unchanged.

## Browser checks still required

Start with `npm run dev` (or `node --import tsx server.ts` if the host blocks the tsx CLI IPC socket). Play at low and high graphics settings. Walk, sprint, reverse direction, release movement, dodge, climb, sail, pause, and resume. Enter and exit each sanctum; verify no camera flight across the map. Approach a chest before and after clearing guardians. Confirm the plaza inlays lie on the surface and remain readable in day and night lighting.

The build host prevented Chromium from starting because its process socket was denied. No visual acceptance or GPU frame-time measurement is claimed. Added static inlays cost 4–6 draw calls per visible seal, with no animation or added shadow lights. Actual GPU cost must be measured in a browser.

## Next milestone

Playable branching dungeon layouts and regional encounters need solid collider coverage and browser acceptance first. This patch does not replace the custom physics solver with Rapier or implement the complete gameplay rules document. New worlds, character asset replacement, and a full Suncrest rebuild remain future work.
