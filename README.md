# paneld

Lightweight storyboard panel sketching engine and infinite spatial canvas for React and TypeScript.

## Features

- **4-Layer Panel Sketcher (`StoryboardFrame`)**: Dedicated SVG layers for non-photo blue under-sketch (`pencil`), behind-ink shading marker (`tone`), velocity-tapered outlines (`ink`), and camera/action annotations (`notes`), plus previous-panel onion skinning.
- **Infinite Spatial Board (`InfiniteBoard`)**: Pan-and-zoom canvas hosting multiple panels and sequence connectors. Inactive panels render as static SVGs; only the focused panel mounts active pointer listeners.
- **Presets & Cinematography Guides**:
  - **Aspect Ratios**: `2.39:1`, `1.85:1`, `16:9`, `4:3`, `1:1`, `9:16`.
  - **Paper & Grids**: `Pure White`, `Warm Cream`, `Studio Dark`, `Blueprint` with `Blank`, `Dots`, `Grid`, or `Isometric` overlays.
  - **Camera Guides**: Rule of Thirds, Center Crosshair, SMPTE Safe Zones, 1-Point Perspective, and 2-Point Perspective.
- **Compact Vector Storage & Versioning**: Ramer-Douglas-Peucker simplification + `0.5px` flat coordinate quantization (`~2–4 KB` per panel), per-panel Undo/Redo, and immutable snapshots.
- **Pluggable Live Sync**: Built-in `BroadcastChannelSyncAdapter` and `CustomCallbackSyncAdapter` for real-time stroke and cursor synchronization.

## Quick Start

```bash
npm install
npm run dev
```

Build the library:

```bash
npm run build
```

## Usage

```tsx
import { StoryboardStudio } from "paneld";

export function App() {
  return <StoryboardStudio />;
}
```

## Inspiration & Credits

- Brush workflow and layered shading model inspired by [WonderUnit Storyboarder](https://github.com/wonderunit/storyboarder).
- Variable-width stroke contour math inspired by [perfect-freehand](https://github.com/steveruizok/perfect-freehand).
- Seeded PRNG hand-sketched frame geometry inspired by [Rough.js](https://github.com/rough-stuff/rough).

## License

MIT License — Copyright (c) 2026 [San-Shiro](https://github.com/San-Shiro/paneld).  
Free to fork, modify, and use in both **commercial and private projects**, provided attribution to the original repository is retained. See [LICENSE](./LICENSE) for details.
