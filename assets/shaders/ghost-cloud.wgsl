#define_import_path nezha::ghost_cloud_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// All roll afterimages in one mesh (M4 §12: one draw). Same look as ghost.wgsl; each copy's fade
// rides in uv0.x (1 = fresh, 0 = gone), written per step by the combat plugin.
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let facing = abs(dot(normalize(input.vertexNormalWS), normalize(input.viewDirectionWS)));
  let rim = 1.0 - smoothstep(0.15, 0.75, facing);
  let colour = mix(mix(material.coreColor.rgb, material.rimColor.rgb, rim), material.rimColor.rgb * 1.2, (1.0 - clamp(input.uv0.y, 0.0, 1.0)) * 0.6);
  // uv0.y = strength (roll 1 dark / walking 0.3 pale; boss 11-06 20:57). Pale ones also wash toward white.
  let strength = clamp(input.uv0.y, 0.0, 1.0);
  let alpha = clamp(material.intensity * input.uv0.x * strength, 0.0, 1.0) * (0.55 + 0.45 * rim);
  return surfaceEmissionOnly(input, colour, alpha);
}
