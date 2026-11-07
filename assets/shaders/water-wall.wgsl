#define_import_path nezha::water_wall_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Water wall (inner radius 26 m): horizontal water streaks drifting round the arena
// (30 s per turn via `phase`), denser and more opaque at the foot, thinning upward.
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let u = input.uv0.x;
  let v = input.uv0.y;
  let streak = 0.5 + 0.5 * sin((u + material.phase) * 6.2831853 * 28.0 + sin(v * 11.0 + u * 40.0) * 1.4);
  let band = 0.5 + 0.5 * sin(v * 23.0 - (u + material.phase) * 12.0);
  let k = 0.78 + 0.22 * (streak * 0.7 + band * 0.3);
  let alpha = mix(0.82, 0.38, smoothstep(0.0, 1.0, v));
  return surfaceEmissionOnly(input, material.waterColor.rgb * k, alpha);
}
