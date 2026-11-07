#define_import_path nezha::contact_glow_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Contact glow under Nezha: a soft orange-gold pool on the seabed. Constant size and
// brightness (never flickers or shrinks: only ground warnings do that). The unit disc's
// object-space radius drives a smooth falloff; the centre is the root (judgement) point.
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let r = clamp(length(input.positionOS.xz), 0.0, 1.0);
  let core = 1.0 - smoothstep(0.0, 1.0, r);
  let falloff = core * core * (0.65 + 0.35 * (1.0 - smoothstep(0.0, 0.35, r)));
  // one/one blending ignores alpha, so the falloff scales the emission itself.
  return surfaceEmissionOnly(input, material.glowColor.rgb * material.intensity * falloff, falloff);
}
