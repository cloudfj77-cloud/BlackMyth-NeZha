#define_import_path nezha::flame_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Spear-tip flame sheet: local y 0 (spear tip) -> 1 (end of the 3 m reach).
// White-gold at the root, orange-gold along the body, soft at the end. Never flickers.
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let y = clamp(input.positionOS.y, 0.0, 1.0);
  let colour = mix(material.rootColor.rgb, material.tipColor.rgb, smoothstep(0.0, 0.6, y));
  let fade = (1.0 - smoothstep(0.75, 1.0, y)) * material.intensity;
  return surfaceEmissionOnly(input, colour * fade, fade);
}
