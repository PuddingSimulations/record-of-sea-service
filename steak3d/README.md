# Steak 3D

One cast iron pan, one gas burner, one steak, in a bare concrete room. Open `dist/index.html` in a browser (WebGL2). It is a single file and needs no network.

```
npm install      # dev tools only (three, esbuild)
npm run build    # src/ -> dist/index.html
npm test         # sim calibration, scoring, fuzz, soft-body physics
```

## Playing

| | |
|---|---|
| Light the burner | drag the knob on the cooktop sideways, or the slider, or the up/down arrow keys |
| Pick up the steak | click and hold it (tongs pinch it). Wheel changes height while holding |
| Flip | **Space** while holding it, then lay it back down. **Q** / **E** turn it |
| Baste | **B** |
| Rest | set the steak down on the cooktop beside the pan for a moment |
| Slice and score | **Enter** while resting |
| Look around | right-drag, or drag empty space. Wheel zooms |
| Time | **1 2 3** = 1x, 3x, 8x. **P** pauses. **R** puts the steak back on the cooktop |

## How it fits together

- `src/sim.js`, `src/score.js`: the cooking model and scoring from the 2D prototype. Only `place` was extended (yaw, face down) and two commands added (`lift`, `move`) so the sim can follow what the steak physically does.
- `src/physics.js`: soft-body steak. Position-based dynamics on a particle lattice: distance constraints, shape matching, pan floor/wall/rim, cooktop, room floor, tongs. Raw meat is floppy and drapes; cooked meat is firm, shrinks, thickens and curls toward the hot face. No DOM, runs in Node.
- `src/steakmesh.js`: the visible steak, skinned to the particles. Textures (colour, roughness) are repainted from the sim as it browns, greys, renders fat and loses surface water.
- `src/scene.js`: concrete room, brushed steel, cast iron, flames, smoke, steam, spitting oil. All procedural, no image files.
- `src/main.js`: glue. The steak settling in the pan issues `place`; lifting it issues `lift`; setting it down the other way up issues `flip` then `move`; leaving it on the cooktop issues `pull`.

Rule kept from the prototype: sim state changes only through `cook.cmd()` and `cook.step()`.

## Not verified

Developed headless (software GL), so frame rate, feel of the tongs and audio have not been checked on a real GPU and speakers. Tuning constants for the soft body live at the top of `SoftBody.setCooked` and `SoftBody.prototype.step`.
