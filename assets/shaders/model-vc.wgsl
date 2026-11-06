#define_import_path nezha::model_vc_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// Asset-track models (Blender, vertex-coloured). The glb materials are dropped at import (their
// Standard roots clash with ours); each part's glow rides in the vertex-colour alpha instead:
// 1 = plain, lower = brighter self-light (sash 0.65, 乾坤圈 0.7, wheel fire 0.3, spear blade 0.1, eyes 0.5).
// `glowAdd` × `glowColor` lights the plain parts too (the dragon's 万龙甲 in phase 2).
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let vc = input.vertexColor.rgb;
  let a = input.vertexColor.a;
  let base = vc * material.tint.rgb;
  let plain = step(0.95, a);
  let emissive = vc * (1.0 - a) * material.glow + material.glowColor.rgb * material.glowAdd * plain;
  return SurfaceData(base, normalize(input.vertexNormalWS), material.metallic * plain, mix(0.35, material.roughness, plain), emissive, 1.0, 1.0, 0.0);
}
