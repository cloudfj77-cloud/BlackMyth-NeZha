#define_import_path nezha::light_beam_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// Additive god-ray shaft from the sea surface. The open cone is authored with
// local y in [0, 1] (0 = seabed, 1 = surface); edges and both ends fade out.

fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let h = clamp(input.positionOS.y, 0.0, 1.0);
  let facing = abs(dot(normalize(input.vertexNormalWS), normalize(input.viewDirectionWS)));
  let edge = pow(facing, 2.2);
  let ends = smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.55, 1.0, h));
  let angle = atan2(input.positionOS.x, input.positionOS.z);
  let streaks = 0.65 + 0.35 * sin(angle * 7.0 + input.frameTime * 0.35 + h * 3.0) * sin(angle * 3.0 - input.frameTime * 0.2);
  let shimmer = 0.85 + 0.15 * sin(input.frameTime * 0.9 + h * 6.0 + angle * 2.0);
  let mask = clamp(edge * ends * streaks * shimmer, 0.0, 1.0);
  return SurfaceData(
    vec3<f32>(0.0),
    input.vertexNormalWS,
    0.0,
    1.0,
    material.beamColor.rgb * material.intensity,
    1.0,
    mask,
    0.0,
  );
}
