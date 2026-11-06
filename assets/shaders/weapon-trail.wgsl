#define_import_path nezha::weapon_trail_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Spear swing trail (v1.4.0 `Trail`): a strip sampled at the blade and the shaft each frame;
// uv0.x is the fade (fresh 1 → 0 at the end of its 0.15 s life, and toward the shaft).
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let a = clamp(input.uv0.x, 0.0, 1.0);
  let core = mix(material.trailColor.rgb, material.hotColor.rgb, a * a);
  return surfaceEmissionOnly(input, core * material.intensity * a, a * 0.85);
}
