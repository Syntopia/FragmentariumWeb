export const INTEGRATOR_OPTION_HELP_TEXT: Readonly<Record<string, string>> = {
  detailExp:
    "Primary DE hit precision. Lower values resolve finer detail and edge features, but increase step count and can add shimmer/noise.",
  detailAOExp:
    "AO sampling precision. Lower values sample closer to the surface for tighter crevice shading, at higher cost and potential noise.",
  maxRaySteps:
    "Maximum DE march iterations per ray. Higher values can recover thin/complex geometry but cost more time per sample.",
  maxDistance:
    "Far clip distance for tracing. Rays stop after this distance, so too-low values can cut off distant geometry or lighting.",
  fudgeFactor:
    "Multiplier applied to DE step size. Below 1 is safer/more stable near surfaces; above 1 is faster but can skip thin features.",
  aoStrength:
    "Ambient occlusion intensity. Increases contact darkening in cavities and corners.",
  aoSamples:
    "Number of AO probe samples. More samples smooth AO and reduce noise at extra cost.",
  shadowStrength:
    "Blend amount for shadowing. 0 keeps full light, 1 applies full traced shadow visibility.",
  shadowSoftness:
    "Penumbra softness factor for distance-estimated shadows. Higher values give wider, softer shadow transitions.",
  fog:
    "Distance fog density. Higher values blend geometry into background more quickly with distance.",
  backgroundStrength:
    "Background/environment brightness multiplier when rays miss geometry.",
  sunDirectionX:
    "X component of the normalized sun direction vector.",
  sunDirectionY:
    "Y component of the normalized sun direction vector.",
  sunDirectionZ:
    "Z component of the normalized sun direction vector.",
  aperture:
    "Lens aperture size for depth of field. Higher values increase blur away from the focal distance.",
  focalDistance:
    "Focus plane distance from the camera for depth of field. You can also press F in the UI to focus at the cursor point.",
  aaJitter:
    "Sub-pixel sample jitter amount. Higher values improve anti-aliasing convergence but can increase perceived noise early.",
  slicePlaneEnabled:
    "Enables geometric clipping by a camera-linked slice plane.",
  slicePlaneDistance:
    "Distance of the slice plane from the camera anchor point.",
  slicePlaneLock:
    "Locks slice plane orientation and anchor to the captured camera frame instead of continuously updating.",
  slicePlaneKeepFarSide:
    "Choose which side of the slice plane to keep. Enabled keeps far side; disabled keeps near side.",
  diffuseColorR:
    "Red channel of the diffuse/base tint.",
  diffuseColorG:
    "Green channel of the diffuse/base tint.",
  diffuseColorB:
    "Blue channel of the diffuse/base tint.",
  useOrbitTrap:
    "Enables orbit-trap based color modulation from fractal orbit information. If disabled, orbit-trap hue blending is skipped and the renderer uses base color only. Define `vec3 baseColor(vec3 pos, vec3 normal)` to control that color; if it is not defined, the default is white `vec3(1.0, 1.0, 1.0)`.",
  orbitTrapPaletteIndex:
    "Selects the orbit-trap palette variant (0 uses HSV mode, higher values use predefined palettes based on Inigo Quilez palette definitions).",
  orbitTrapFalloff:
    "Falloff shaping for orbit-trap response. Higher values localize color influence around stronger trap regions.",
  orbitTrapHueOffset:
    "Adds a phase offset to orbit-trap hue before palette lookup.",
  orbitTrapHueScale:
    "Scales orbit-trap hue variation range. Larger magnitude increases color cycling frequency.",
  orbitTrapSaturation:
    "Orbit-trap color saturation amount.",
  orbitTrapValue:
    "Orbit-trap value/brightness contribution.",
  orbitTrapMix:
    "Blend weight between base surface color and orbit-trap color.",
  metalness:
    "PBR metalness amount (raytracer variant). Higher values shift reflection toward metallic behavior.",
  metallic:
    "PBR metallic amount (path tracer variant). Higher values shift reflection toward metallic behavior.",
  roughness:
    "Micro-surface roughness. Higher values broaden highlights and reflections.",
  reflectivity:
    "Overall reflection energy scaling for specular response.",
  sunStrength:
    "Sun/direct light intensity multiplier.",
  ambientStrength:
    "Ambient/sky fill light intensity multiplier.",
  specularStrength:
    "Specular lobe intensity multiplier.",
  sssStrength:
    "Subsurface scattering strength approximation.",
  sssRadius:
    "Subsurface scattering radius/blur distance.",
  bounceCount:
    "Maximum path-tracing bounce depth. Higher values allow more indirect light but increase cost and noise.",
  albedo:
    "Diffuse reflectance energy scale used by the path tracer.",
  directLight:
    "Enables direct sun/explicit lighting contribution in the path tracer.",
  skyStrength:
    "Environment sky radiance multiplier.",
  iblEnabled:
    "Enables image-based/environment lighting contribution.",
  iblStrength:
    "IBL intensity multiplier.",
  iblExposure:
    "IBL exposure compensation in stops.",
  iblZenithX:
    "X component of the normalized IBL zenith direction. This vector defines where the environment 'up' points.",
  iblZenithY:
    "Y component of the normalized IBL zenith direction. This vector defines where the environment 'up' points.",
  iblZenithZ:
    "Z component of the normalized IBL zenith direction. This vector defines where the environment 'up' points.",
  iblHorizonGlow:
    "Extra glow centered near the horizon band of the environment.",
  iblHotspotStrength:
    "Intensity of the synthetic directional hotspot in the environment.",
  iblHotspotSizeDeg:
    "Angular size of the IBL hotspot (degrees).",
  iblTopColorR:
    "Red channel of top hemisphere IBL tint.",
  iblTopColorG:
    "Green channel of top hemisphere IBL tint.",
  iblTopColorB:
    "Blue channel of top hemisphere IBL tint.",
  iblHorizonColorR:
    "Red channel of horizon IBL tint.",
  iblHorizonColorG:
    "Green channel of horizon IBL tint.",
  iblHorizonColorB:
    "Blue channel of horizon IBL tint.",
  iblGroundColorR:
    "Red channel of lower hemisphere/ground IBL tint.",
  iblGroundColorG:
    "Green channel of lower hemisphere/ground IBL tint.",
  iblGroundColorB:
    "Blue channel of lower hemisphere/ground IBL tint.",
  sunAngularDiameterDeg:
    "Apparent sun disk diameter in degrees. Larger values produce softer sun shadows/highlight spread.",
  areaLightEnabled:
    "Enables additional rectangular area light source.",
  areaLightIntensity:
    "Area light emitted intensity.",
  areaLightSize:
    "Half-size of the rectangular area light emitter.",
  areaLightOffsetX:
    "Area light position offset on X axis (relative light placement).",
  areaLightOffsetY:
    "Area light position offset on Y axis (relative light placement).",
  areaLightOffsetZ:
    "Area light position offset on Z axis (relative light placement).",
  areaLightColorR:
    "Red channel of the area light color.",
  areaLightColorG:
    "Green channel of the area light color.",
  areaLightColorB:
    "Blue channel of the area light color.",
  sampleClamp:
    "Clamps per-sample radiance to reduce fireflies/noisy outliers. Lower values are cleaner but can darken very bright highlights."
};

export const BUILTIN_PANE_CONTROL_HELP_TEXT = {
  colorIntensity:
    "Scales color brightness without changing hue. Useful for HDR colors where channel values can exceed 1.0.",
  moveResScale:
    "Interactive resolution scale while the camera is moving. Lower values are faster and noisier; 1.0 keeps full resolution.",
  maxSubframes:
    "Maximum progressive accumulation subframes. 0 means accumulate indefinitely.",
  tileCount:
    "Tile grid resolution for accumulation/export (N x N tiles). Higher values split work into smaller tiles.",
  tilesPerFrame:
    "How many tiles to render each display frame when tiling is enabled. Higher values converge faster but can reduce responsiveness.",
  aspectPreset:
    "Preset aspect-ratio targets for output framing.",
  aspectLock:
    "Locks render output to the selected aspect ratio instead of following the live viewport shape.",
  aspectRatio:
    "Manual output aspect ratio (X:Y) used when lock is enabled or preset is custom.",
  toneMapping:
    "Tone-mapping curve used to map HDR radiance to display range.",
  exposure:
    "Global exposure multiplier before tone mapping.",
  gamma:
    "Gamma correction applied in display/output stage.",
  brightness:
    "Post brightness gain after tone mapping.",
  contrast:
    "Post contrast adjustment around mid-tones.",
  saturation:
    "Post color saturation multiplier."
} as const;

export type BuiltinPaneControlHelpKey = keyof typeof BUILTIN_PANE_CONTROL_HELP_TEXT;

const INTEGRATOR_COLOR_TRIPLET_HELP_TEXT: Readonly<Record<string, string>> = {
  diffuseColor: "Base diffuse/albedo color tint used by the material shading.",
  iblTopColor: "Environment top hemisphere tint color.",
  iblHorizonColor: "Environment horizon band tint color.",
  iblGroundColor: "Environment ground/lower hemisphere tint color.",
  areaLightColor: "Emitted color of the rectangular area light."
};

export function getIntegratorOptionHelpText(optionKey: string): string {
  const helpText = INTEGRATOR_OPTION_HELP_TEXT[optionKey];
  if (helpText === undefined) {
    throw new Error(`[app] Missing integrator option help text for '${optionKey}'.`);
  }
  return helpText;
}

export function getBuiltinPaneControlHelpText(key: BuiltinPaneControlHelpKey): string {
  return BUILTIN_PANE_CONTROL_HELP_TEXT[key];
}

export function getIntegratorColorTripletHelpText(redChannelKey: string): string {
  const match = /^(.*)R$/u.exec(redChannelKey);
  if (match === null || match[1].length === 0) {
    throw new Error(`[app] Invalid color triplet key '${redChannelKey}'.`);
  }
  const baseKey = match[1];
  const helpText = INTEGRATOR_COLOR_TRIPLET_HELP_TEXT[baseKey];
  if (helpText === undefined) {
    throw new Error(`[app] Missing integrator color triplet help text for '${baseKey}'.`);
  }
  return helpText;
}
