#define_import_path nezha::pillar_fade_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// Screen-door see-through pillar: stays in the opaque queue with depth writes (no
// transparency sorting); a world-space hash discards a `1 - fade` share of fragments
// through the alpha-clip threshold. Grazing-angle fragments keep full coverage and a
// cool emissive edge, so the pillar's silhouette still reads while Nezha shows through.
fn pillar_hash(p : vec3<f32>) -> f32 {
  let q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  let r = q + dot(q, q.yxz + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let n = normalize(input.vertexNormalWS);
  let v = normalize(input.viewDirectionWS);
  let facing = abs(dot(n, v));
  let fading = 1.0 - material.fade;
  let rim = (1.0 - smoothstep(material.rimWidth, material.rimWidth + 0.06, facing)) * step(0.001, fading);
  let cell = floor(input.positionWS * material.cellsPerMeter);
  let keep = step(pillar_hash(cell), material.fade);
  let opacity = max(keep, rim);
  let edge = material.rimColor.rgb * rim;
  return SurfaceData(material.baseColor.rgb, n, 0.0, 0.6, edge, 1.0, opacity, 0.5);
}
