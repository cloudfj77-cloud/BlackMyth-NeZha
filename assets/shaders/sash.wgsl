#define_import_path nezha::sash_surface

#import forgeax_material::parameters::{material}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput}

// Red Armillary Sash ribbon. uv.y runs root (0) -> tip (1).
// brightness: 1 normally, 0.3 while Sash Bind cools down.
// fill: gold pattern filling from the root as the cooldown elapses (0..1).
// flash: one-shot tip glint when the bind is ready again.
fn evaluate_surface(input : SurfaceInput) -> SurfaceData {
  let y = input.uv0.y;
  let stripe = 0.5 + 0.5 * sin(y * 46.0 + input.uv0.x * 3.0);
  let gold = step(y, material.fill) * smoothstep(0.35, 0.9, stripe) * step(0.001, material.fill);
  let red = material.sashColor.rgb * material.brightness;
  let emissive = mix(red, material.goldColor.rgb * 0.8, gold) + material.goldColor.rgb * material.flash * smoothstep(0.82, 1.0, y) * 3.0;
  return SurfaceData(material.baseColor.rgb, normalize(input.vertexNormalWS), 0.0, 0.45, emissive, 1.0, 1.0, 0.0);
}
