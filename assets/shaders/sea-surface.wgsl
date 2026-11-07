#define_import_path nezha::sea_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// 东海 sea (v1.4.0 sea.js fragment, ported): the dynamic mesh carries the Gerstner swell
// (positions and normals written on the CPU); here a moving value-noise ripple perturbs the
// normal, deep/shallow colour follows the slope, and crests get foam. Sun glint, sky
// reflection, Fresnel and fog come from the Standard lighting at low roughness.

fn h2(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn n2(p : vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2<f32>(1.0, 0.0)), f.x), mix(h2(i + vec2<f32>(0.0, 1.0)), h2(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let t = input.frameTime;
  let p = input.positionWS.xz;
  let ripple = vec3<f32>(n2(p * 0.9 + vec2<f32>(t * 0.4)) - 0.5, 0.0, n2(p.yx * 0.9 - vec2<f32>(t * 0.3)) - 0.5) * 0.18;
  let normal = normalize(input.vertexNormalWS + ripple);
  // Crest height above the rest level (0 … ~1 m) drives the foam, as v1.4.0's vFoam.
  let crest = smoothstep(0.5, 0.85, (input.positionWS.y - material.seaY) / max(material.swell, 0.01));
  let foam = crest * smoothstep(0.4, 0.8, n2(p * 1.6 + vec2<f32>(t * 0.5)));
  var color = mix(material.deepColor.rgb, material.shallowColor.rgb, clamp(normal.y * 0.5 + crest * 0.6 - 0.25, 0.0, 1.0));
  color = mix(color, material.foamColor.rgb, foam * 0.75);
  return SurfaceData(
    color,
    normal,
    0.0,
    mix(0.07, 0.6, foam),
    material.deepColor.rgb * material.glow,
    1.0,
    1.0,
    0.0,
  );
}
