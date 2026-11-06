#define_import_path nezha::sea_veil_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

// Water curtain (v1.4.0 veil): falling streaks between the gate pillars, soft side edges.
// `op` fades it (1 = gate shut, 0 = open); the fight mist at the entry uses the same shader.

fn h2(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn n2(p : vec2<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2<f32>(1.0, 0.0)), f.x), mix(h2(i + vec2<f32>(0.0, 1.0)), h2(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}

fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let uv = input.uv0;
  let t = input.frameTime;
  let v = n2(vec2<f32>(uv.x * 30.0, uv.y * 4.0 + t * 3.0)) * 0.7 + n2(vec2<f32>(uv.x * 70.0, uv.y * 9.0 + t * 5.0)) * 0.3;
  let edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
  let a = (0.25 + v * 0.5) * edge * clamp(material.op, 0.0, 1.0);
  let color = mix(material.lowColor.rgb, material.highColor.rgb, v);
  return surfaceEmissionOnly(input, color * a * material.intensity, a);
}
