#define_import_path nezha::vortex_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// Vortex floor (r = 20 m). Only the pattern rotates (never the geometry): inner calm zone
// r < calmRadius at ≤ 1°/s with ≤ 8 grey levels of contrast, outer ring at 2°/s.
// Two phases (times ta / tb, half a period apart) cross-fade so the spiral never winds up.
fn omega(r : f32) -> f32 {
  return mix(material.innerDegPerSec, material.outerDegPerSec, smoothstep(material.calmRadius - 1.0, material.calmRadius + 1.0, r)) * 0.0174533;
}

fn spiral(theta : f32, r : f32, t : f32) -> f32 {
  let a = theta + omega(r) * t;
  return 0.5 + 0.5 * sin(5.0 * a + 2.6 * log(r + 1.0));
}

fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let p = input.positionOS.xz;
  let r = length(p);
  let theta = atan2(p.x, p.y);
  let v = mix(spiral(theta, r, material.tb), spiral(theta, r, material.ta), material.wa);
  let contrast = mix(material.calmContrast, material.outerContrast, smoothstep(material.calmRadius - 1.0, material.calmRadius + 1.0, r));
  let edge = smoothstep(19.4, 20.3, r);
  let colour = material.baseColor.rgb * (1.0 + contrast * (v - 0.5) * 2.0) * (1.0 - 0.35 * edge);
  return SurfaceData(colour, normalize(input.vertexNormalWS), 0.0, 0.85, vec3<f32>(0.0), 1.0, 1.0, 0.0);
}
