#define_import_path nezha::whirlpool_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// 镇海台 whirlpool (boss 11-06 20:57): a funnel one Nezha deep, always turning. Log-spiral arms that
// drift inward and round (no shear over time), foam on the arm crests, darker toward the eye, a rim
// of white water where it meets the stone. Driven by frameTime only (no CPU updates).

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
  let t = input.frameTime * material.speed;
  let p = input.positionWS.xz;
  let r = length(p);
  let a = atan2(p.x, p.y);
  let k = clamp(r / material.radius, 0.0, 1.0);
  // Six spiral arms turning and flowing in.
  let arm = 0.5 + 0.5 * sin(6.0 * a + 9.0 * log(r + 0.6) + t * 2.2);
  let arm2 = 0.5 + 0.5 * sin(11.0 * a + 15.0 * log(r + 0.6) + t * 3.1 + 1.7);
  // Foam noise in a frame that turns with the water (faster near the eye).
  let w = t * (0.35 + 1.6 / (r + 1.5));
  let c = cos(w);
  let s = sin(w);
  let q = vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
  let noise = n2(q * 0.9) * 0.6 + n2(q * 2.3) * 0.4;
  let foam = smoothstep(0.6, 0.9, arm * 0.7 + arm2 * 0.3 + noise * 0.25) * smoothstep(0.03, 0.3, k);
  let rimFoam = smoothstep(0.86, 0.99, k) * (0.6 + 0.4 * noise);
  var color = mix(material.deepColor.rgb, material.waterColor.rgb, smoothstep(0.0, 0.8, k) * (0.45 + 0.55 * arm));
  color = mix(color, material.foamColor.rgb, clamp(foam * 0.7 + rimFoam, 0.0, 1.0));
  let ripple = vec3<f32>(n2(q * 1.7) - 0.5, 0.0, n2(q.yx * 1.7) - 0.5) * 0.25;
  let glow = material.waterColor.rgb * material.glow * (0.4 + 0.6 * arm) * (1.0 - smoothstep(0.0, 0.25, k) * 0.0);
  return SurfaceData(
    color,
    normalize(input.vertexNormalWS + ripple),
    0.0,
    mix(0.08, 0.5, foam),
    glow + material.foamColor.rgb * foam * 0.08,
    1.0,
    1.0,
    0.0,
  );
}
