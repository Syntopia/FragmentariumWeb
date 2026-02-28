# Fragmentarium Web

Web-based Fragmentarium-inspired fractal renderer using React, TypeScript, and WebGL2.

An environment for exploring path traced 3D fractals.

## Live Demo

https://syntopia.github.io/FragmentariumWeb/

## Original Project

https://github.com/Syntopia/Fragmentarium

## Screenshot

![Fragmentarium Web Screenshot](./screenshot.png)

## Attributions

This is a port of my classic Fragmentarium desktop application:
https://github.com/Syntopia/Fragmentarium

Created by Mikael Hvidtfeldt Christensen (together with OpenAI's Codex and Claude Code)

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

Licensed and distributed under MIT license.

Notice: some fragments are copyrighted by other authors, and may carry other licenses. Please check the fragment file header before redistributing.

## Acknowledgement

Much of the inspiration and formulas for Fragmentarium came from the community at Fractal Forums, including Tom Beddard, Jan Kadlec, Iñigo Quilez, Buddhi, Jesse, and others. Special thanks goes out to Knighty and Kali for their great fragments. All fragments should include information about their origins - please notify me, if I made any mis-attributions.

## Importing Legacy Fragmentarium Fragments

Fragmentarium Web renders **fragments** (geometry + uniforms), while raytracing/pathtracing is handled by the built-in integrators in the UI (`Preview`, `Raytrace`, `Pathtrace`).

For old Fragmentarium sources, the preferred porting target is:
- Keep `float DE(vec3 p)` and uniforms/presets.
- Remove legacy renderer pipeline includes (`DE-Raytracer.frag`, `Fast-Raytracer.frag`, `Path-Raytracer.frag`, `IBL-Raytracer.frag`, `Sky-Pathtracer.frag`, etc.).
- Do not rely on legacy `main()` / `gl_FragColor` / `varying` pipeline code.
- Use includes only for math/helpers/camera setup.

### About `#define providesInit`

In Fragmentarium Web itself:
- If your fragment defines `void init() { ... }`, it is automatically called before rendering.
- So `#define providesInit` is usually optional unless a legacy include requires it.

### About `#define providesColor`

`#define providesColor` is a legacy include contract. Old renderer includes often do:

```glsl
#ifdef providesColor
vec3 baseColor(vec3 point, vec3 normal);
#endif
```

In Fragmentarium Web integrators:
- `baseColor(vec3 pos, vec3 normal)` is used directly if implemented.
- If not implemented, a default white base color is used: `vec3(1.0, 1.0, 1.0)`.

### `baseColor` and `orbitTrap` relationship

Recommended coloring model:
- Implement `vec3 baseColor(vec3 pos, vec3 normal)` for material/base color.
- Optionally maintain `vec4 orbitTrap` inside `DE(...)` for trap-based coloring controls.

How this works in Fragmentarium Web:
- If `orbitTrap` exists, the composer captures/restores it around DE sampling.
- `baseColor(...)` can safely read `orbitTrap`.
- Integrator controls can blend orbit-trap hue/palette on top of `baseColor` (`Use Orbit Trap`, `Trap Palette`, `Trap Mix`, etc.).
- If orbit trap is disabled in UI, shading falls back to base-color-driven material response.

### Preferred include strategy (modern)

For new/ported fragments, prefer minimal helper includes, for example:

```glsl
#include "common-camera-3d.frag"
#include "common-primitives.frag"
#include "common-fractal-utils.frag"
#include "MathUtils.frag"   // optional
#include "QuilezLib.frag"   // optional

vec4 orbitTrap = vec4(1.0e20); // optional
vec3 baseColor(vec3 pos, vec3 normal) { ... } // optional but recommended
void init() { ... } // optional

float DE(vec3 p) { ... }
```