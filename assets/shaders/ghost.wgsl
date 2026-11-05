#define_import_path nezha::ghost_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Fire afterimage: a constant fiery colour laid OVER the scene (alpha blend), so it stays orange
// on bright floors instead of washing out to white like an additive glow. Rim is hotter (gold),
// the body deeper red-orange. `intensity` drives the fade (opacity).
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let facing = abs(dot(normalize(input.vertexNormalWS), normalize(input.viewDirectionWS)));
  let rim = 1.0 - smoothstep(0.15, 0.75, facing);
  let colour = mix(material.coreColor.rgb, material.rimColor.rgb, rim);
  let alpha = clamp(material.intensity, 0.0, 1.0) * (0.55 + 0.45 * rim);
  return surfaceEmissionOnly(input, colour, alpha);
}
