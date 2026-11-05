#define_import_path nezha::flat_glow_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Uniform emission-only glow (one/one): afterimages, rings, ground warnings.
// `intensity` is driven per instance at runtime (fades, warning flicker).
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let k = clamp(material.intensity, 0.0, 4.0);
  return surfaceEmissionOnly(input, material.glowColor.rgb * k, min(k, 1.0));
}
