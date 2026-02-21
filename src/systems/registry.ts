export interface FractalSystemDefinition {
  id: string;
  name: string;
  category: string;
  source: string;
}

export const SYSTEM_INCLUDE_MAP: Record<string, string> = {
  "common-camera-3d.frag": `
#camera 3D
#group Camera
uniform float FOV; slider[0.1,0.45,1.5]
uniform vec3 Eye; slider[(-20,-20,-20),(0.0,0.0,-6.0),(20,20,20)]
uniform vec3 Target; slider[(-20,-20,-20),(0.0,0.0,0.0),(20,20,20)]
uniform vec3 Up; slider[(-1,-1,-1),(0.0,1.0,0.0),(1,1,1)]
`,
  "common-primitives.frag": `
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

mat3 rotationMatrix(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;

  return mat3(
    oc * axis.x * axis.x + c,
    oc * axis.x * axis.y - axis.z * s,
    oc * axis.z * axis.x + axis.y * s,

    oc * axis.x * axis.y + axis.z * s,
    oc * axis.y * axis.y + c,
    oc * axis.y * axis.z - axis.x * s,

    oc * axis.z * axis.x - axis.y * s,
    oc * axis.y * axis.z + axis.x * s,
    oc * axis.z * axis.z + c
  );
}
`,
  "common-fractal-utils.frag": `
vec3 powN1(vec3 z, float power, inout float dr) {
  float r = length(z);
  float theta = acos(z.z / max(r, 1.0e-6));
  float phi = atan(z.y, z.x);
  dr = pow(r, power - 1.0) * power * dr + 1.0;

  float zr = pow(r, power);
  theta *= power;
  phi *= power;

  return zr * vec3(
    sin(theta) * cos(phi),
    sin(phi) * sin(theta),
    cos(theta)
  );
}
`
};

const boxCsgSystem = `
#include "common-camera-3d.frag"
#include "common-primitives.frag"
#define HAS_BASE_COLOR

#group Shape
uniform vec3 BoxSize; slider[(0.2,0.2,0.2),(1.2,1.2,1.2),(4,4,4)]
uniform float Roundness; slider[0.0,0.1,1.0]
uniform vec3 CutoutCenter; slider[(-3,-3,-3),(0.6,0.0,0.0),(3,3,3)]
uniform float CutoutRadius; slider[0.1,0.55,2.0]
uniform vec3 RotationAxis; slider[(0,0,0),(0,1,0),(1,1,1)]
uniform float RotationAngle; slider[-180.0,25.0,180.0]

#group Coloring
uniform vec3 BaseA; color[0.85,0.35,0.25]
uniform vec3 BaseB; color[0.2,0.75,0.95]
uniform float StripeScale; slider[0.5,3.0,12.0]

vec3 baseColor(vec3 p, vec3 n) {
  float stripes = 0.5 + 0.5 * sin((p.x + p.y + p.z) * StripeScale);
  float rim = pow(1.0 - max(dot(n, normalize(vec3(0.2, 0.6, 1.0))), 0.0), 2.0);
  return mix(BaseA, BaseB, stripes) + 0.15 * rim;
}

float DE(vec3 p) {
  vec3 axis = length(RotationAxis) > 1.0e-6 ? normalize(RotationAxis) : vec3(0.0, 1.0, 0.0);
  vec3 q = rotationMatrix(axis, radians(RotationAngle)) * p;
  float shell = sdRoundBox(q, BoxSize, Roundness);
  float hole = sdSphere(q - CutoutCenter, CutoutRadius);
  return max(shell, -hole);
}

#preset Default
FOV = 0.45
Eye = 0,0,-6
Target = 0,0,0
Up = 0,1,0
BoxSize = 1.2,1.2,1.2
Roundness = 0.1
CutoutCenter = 0.6,0.0,0.0
CutoutRadius = 0.55
RotationAxis = 0,1,0
RotationAngle = 25
BaseA = 0.85,0.35,0.25
BaseB = 0.2,0.75,0.95
StripeScale = 3.0
#endpreset

#preset Tilted
Eye = 1.8,1.2,-5.4
Target = 0.0,0.1,0.0
Up = 0,1,0
RotationAxis = 1,1,0
RotationAngle = 50
CutoutCenter = 0.0,0.4,0.0
CutoutRadius = 0.7
#endpreset
`;

const boxGridSystem = `
#include "common-camera-3d.frag"
#include "common-primitives.frag"
#define HAS_BASE_COLOR

#group Shape
uniform float CellSize; slider[0.8,1.8,4.0]
uniform vec3 BoxSize; slider[(0.1,0.1,0.1),(0.35,0.6,0.35),(2,2,2)]
uniform vec3 RepeatOffset; slider[(-2,-2,-2),(0.0,0.0,0.0),(2,2,2)]
uniform float Twist; slider[-4.0,1.1,4.0]

#group Coloring
uniform vec3 Warm; color[0.95,0.72,0.3]
uniform vec3 Cold; color[0.15,0.45,0.9]

vec3 baseColor(vec3 p, vec3 n) {
  float mixFactor = 0.5 + 0.5 * sin((p.x - p.z) * 2.0 + p.y * 1.2);
  vec3 tint = mix(Warm, Cold, mixFactor);
  float normalTint = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
  return tint * normalTint;
}

vec3 repeatCell(vec3 p) {
  return mod(p + 0.5 * CellSize, CellSize) - 0.5 * CellSize;
}

float DE(vec3 p) {
  vec3 q = p + RepeatOffset;
  float angle = Twist * q.y;
  q.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * q.xz;
  vec3 local = repeatCell(q);
  return sdBox(local, BoxSize);
}

#preset Default
FOV = 0.52
Eye = 3.0,2.5,-8.0
Target = 0,0,0
Up = 0,1,0
CellSize = 1.8
BoxSize = 0.35,0.6,0.35
RepeatOffset = 0,0,0
Twist = 1.1
Warm = 0.95,0.72,0.3
Cold = 0.15,0.45,0.9
#endpreset
`;

const mandelbulbSystem = `
#include "common-camera-3d.frag"
#include "common-primitives.frag"
#include "common-fractal-utils.frag"
#define HAS_BASE_COLOR

#group Mandelbulb
uniform int Iterations; slider[2,12,32]
uniform int ColorIterations; slider[1,8,32]
uniform float Power; slider[2.0,8.0,16.0]
uniform float Bailout; slider[2.0,6.5,32.0]
uniform bool Julia; checkbox[false]
uniform vec3 JuliaC; slider[(-2,-2,-2),(0,0,0),(2,2,2)]
uniform vec3 RotVector; slider[(0,0,0),(1,1,1),(1,1,1)]
uniform float RotAngle; slider[-180.0,0.0,180.0]

#group Coloring
uniform vec3 PaletteA; color[0.75,0.5,0.2]
uniform vec3 PaletteB; color[0.2,0.65,0.95]
uniform float PaletteShift; slider[-6.0,1.4,6.0]

vec4 orbitTrap = vec4(1000.0);

vec3 baseColor(vec3 p, vec3 n) {
  float tone = 0.5 + 0.5 * sin(PaletteShift + orbitTrap.x * 2.0 + orbitTrap.y * 3.0 + orbitTrap.z * 1.5);
  vec3 color = mix(PaletteA, PaletteB, tone);
  float fresnel = pow(1.0 - max(dot(n, normalize(vec3(0.1, 0.4, 1.0))), 0.0), 2.0);
  return color + 0.2 * fresnel;
}

float DE(vec3 pos) {
  vec3 z = pos;
  float dr = 1.0;
  float r = length(z);
  orbitTrap = vec4(1000.0);

  vec3 axis = length(RotVector) > 1.0e-6 ? normalize(RotVector) : vec3(1.0, 0.0, 0.0);
  mat3 rot = rotationMatrix(axis, radians(RotAngle));

  for (int i = 0; i < 64; i++) {
    if (i >= Iterations) {
      break;
    }
    if (r > Bailout) {
      break;
    }

    z = powN1(z, Power, dr);
    z += Julia ? JuliaC : pos;
    z = rot * z;
    r = length(z);

    if (i < ColorIterations) {
      orbitTrap = min(orbitTrap, abs(vec4(z, r * r)));
    }
  }

  return 0.5 * log(max(r, 1.0e-6)) * r / max(dr, 1.0e-6);
}

#preset Default
FOV = 0.62
Eye = 1.65,-1.23,0.27
Target = -0.1,0.1,0.0
Up = 0.4,0.37,-0.83
Iterations = 12
ColorIterations = 8
Power = 8
Bailout = 6.5
Julia = false
JuliaC = 0,0,0
RotVector = 1,1,1
RotAngle = 0
PaletteA = 0.75,0.5,0.2
PaletteB = 0.2,0.65,0.95
PaletteShift = 1.4
#endpreset

#preset Julia Variant
Eye = 1.2,0.9,-2.9
Target = 0.0,0.0,0.0
Up = 0,1,0
Iterations = 14
ColorIterations = 9
Power = 6
Bailout = 8
Julia = true
JuliaC = 0.2,0.2,0.1
RotVector = 0,1,0
RotAngle = 40
PaletteShift = 2.8
#endpreset
`;

export const FRACTAL_SYSTEMS: FractalSystemDefinition[] = [
  {
    id: "box-csg",
    name: "Box CSG",
    category: "Simple Systems",
    source: boxCsgSystem
  },
  {
    id: "box-grid",
    name: "Box Grid",
    category: "Simple Systems",
    source: boxGridSystem
  },
  {
    id: "mandelbulb",
    name: "Mandelbulb",
    category: "Fractals",
    source: mandelbulbSystem
  }
];

export function getSystemById(id: string): FractalSystemDefinition {
  const system = FRACTAL_SYSTEMS.find((entry) => entry.id === id);
  if (system === undefined) {
    throw new Error(`Unknown system id: ${id}`);
  }
  return system;
}
