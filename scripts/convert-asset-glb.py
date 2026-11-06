#!/usr/bin/env python3
"""Asset-track glb → game glb (11-06): drop the glb materials (their imported Standard roots clash with
ours: material-artifact-conflict) and code each part's glow in the vertex-colour alpha instead
(1 = plain, lower = brighter; see assets/shaders/model-vc.wgsl). White glow parts take their tint.
Usage: python3 scripts/convert-asset-glb.py <src.glb> <dst.glb>   then  forgeax asset import <dst> --root .
After a new skeleton: regenerate assets/models/skins.ts (joint order, inverse binds, nodes, GUIDs)."""
import json, struct, sys
GLOW = {'NZ_Body': 1.0, 'NZ_UniverseRing_Glow': 0.8, 'NZ_Sash_Glow': 0.85, 'NZ_Wheel_Glow': 0.35, 'NZ_Spear': 1.0,
        'NZ_SpearTip_Glow': 0.55, 'DK_Body': 1.0, 'DK_Eye_Glow': 0.5}
TINT = {'NZ_UniverseRing_Glow': (1.0, 0.62, 0.12), 'NZ_Sash_Glow': (0.82, 0.06, 0.03), 'NZ_SpearTip_Glow': (1.0, 0.42, 0.06),
        'DK_Eye_Glow': (0.7, 0.95, 1.0)}

def convert(src, dst):
    b = open(src, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l])
    bl = struct.unpack('<I', b[20 + l:24 + l])[0]; bin_ = bytearray(b[28 + l:28 + l + bl])
    def read(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        n = {'VEC3': 3, 'VEC4': 4}[a['type']]; fmt = {5126: 'f', 5123: 'H', 5121: 'B'}[a['componentType']]
        sz = struct.calcsize(fmt); off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride', n * sz)
        norm = {5126: 1, 5123: 65535, 5121: 255}[a['componentType']]
        return [[v / norm for v in struct.unpack_from('<' + fmt * n, bin_, off + k * st)] for k in range(a['count'])]
    for m in j['meshes']:
        for pr in m['primitives']:
            mat = j['materials'][pr['material']]['name']; cols = read(pr['attributes']['COLOR_0']); t = TINT.get(mat)
            data = b''.join(struct.pack('<4f', *((c[0] * t[0], c[1] * t[1], c[2] * t[2]) if t else c[:3]), GLOW.get(mat, 1.0)) for c in cols)
            while len(bin_) % 4: bin_.append(0)
            off = len(bin_); bin_ += data
            j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
            j['accessors'].append({'bufferView': len(j['bufferViews']) - 1, 'componentType': 5126, 'count': len(cols), 'type': 'VEC4'})
            pr['attributes']['COLOR_0'] = len(j['accessors']) - 1; del pr['material']
    del j['materials']
    while len(bin_) % 4: bin_.append(0)
    j['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js
                          + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_))

if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])
