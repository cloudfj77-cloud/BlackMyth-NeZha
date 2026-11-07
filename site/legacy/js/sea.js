// ===== 场景二：东海 · 陈塘关（哪吒专属关卡） =====
// 关卡结构（玩家由南向北推进）：
//   ① 陈塘关海岸栈道（前置关卡，z 140→70）：残破木栈道、礁石、渔船残骸、石灯；巡海夜叉 3 只分两波伏击
//   ② 李府莲池小院（检查点，z≈60）：太乙莲台＝检查点
//   ③ 龙宫水门（z≈34）：两尊龙柱夹出的石门，夜叉清空前被水幕封闭
//   ④ 镇海台（Boss 场，半径 24 的圆形石台）：四面环海，八根龙柱，中央太极阵纹；Boss 东海三太子·敖丙
const SeaWorld = (() => {
  const U = World.util;
  const ARENA_R = 24, PATH_HX = 4.2, PATH_Z0 = 22, PATH_Z1 = 142;
  const ENTRY_Z = 21.5;

  function build(scene) {
    const R = U.rng(808);
    const colliders = [], blockers = [];
    const group = new THREE.Group(); scene.add(group);
    const add = (o) => { group.add(o); return o; };

    // ---------- 材质 ----------
    const [slabC, slabB] = U.stoneSlabTex();
    const [rkC, rkB] = U.rockTex();
    const tiles = U.tileTex();
    const wood = (() => { // 海水浸泡、盐渍发白的旧木板
      const S = 256, [c, cx] = U.canvasPair(S);
      U.noiseFill(cx, S, 4, (n, n2, x, y) => {
        const grain = U.fbm(x / S * 3, y / S * 28, 3, 0);
        const salt = U.smooth(0.62, 0.8, n2);
        const v = 0.55 + grain * 0.45 + n * 0.15;
        return [(78 * v) * (1 - salt) + 150 * salt, (84 * v) * (1 - salt) + 158 * salt, (82 * v) * (1 - salt) + 150 * salt];
      });
      return U.toTex(c, true);
    })();
    const M = {
      stone: new THREE.MeshStandardMaterial({ map: slabC, bumpMap: slabB, bumpScale: 0.6, roughness: 0.85, color: 0x6a767c }), // 压暗石台，给预警与角色留出对比
      rock: new THREE.MeshStandardMaterial({ map: rkC, bumpMap: rkB, bumpScale: 0.9, roughness: 0.9, color: 0x6c7a80 }),
      wetRock: new THREE.MeshStandardMaterial({ map: rkC, bumpMap: rkB, bumpScale: 0.9, roughness: 0.45, metalness: 0.1, color: 0x4a5a62 }),
      wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82, color: 0xffffff }), // 海水浸泡后的灰青旧木
      jade: new THREE.MeshStandardMaterial({ color: 0x1f5a5c, roughness: 0.32, metalness: 0.55, emissive: 0x021212 }), // 青铜绿龙鳞
      jadeDark: new THREE.MeshStandardMaterial({ color: 0x1c4a52, roughness: 0.5, metalness: 0.3 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 1.0 }),
      redLac: new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.55 }),
      tile: new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.6, color: 0x4a7a86 }),
      coral: new THREE.MeshStandardMaterial({ color: 0x9a4a3e, roughness: 0.8, emissive: 0x0a0202 }),
      glow: new THREE.MeshStandardMaterial({ color: 0x9ff6ff, emissive: 0x3ad8ff, emissiveIntensity: 2.4 }),
      lotus: new THREE.MeshStandardMaterial({ color: 0xf6b0c0, emissive: 0x6a1a2a, emissiveIntensity: 0.6, roughness: 0.5 }),
    };

    // ---------- 天空：阴沉海天，云隙中透出冷光 ----------
    const sunDir = new THREE.Vector3(0.45, 0.28, -0.85).normalize();
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: sunDir }, time: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform float time;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fb(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
        void main(){
          vec3 d = normalize(vDir); float y = d.y;
          vec3 hor = vec3(0.62,0.70,0.72), zen = vec3(0.16,0.22,0.30), sea = vec3(0.10,0.18,0.22);
          vec3 col = mix(hor, zen, smoothstep(0.0, 0.6, y));
          col = mix(col, sea, smoothstep(0.0, -0.1, y));
          float s = max(dot(d, sunDir), 0.);
          col += vec3(0.9,0.95,1.0) * pow(s, 10.) * 0.35 + vec3(1.0,0.95,0.85) * pow(s, 120.) * 0.8;
          if (y > 0.0) {
            vec2 uv = d.xz / (y + 0.1) * 1.3 + vec2(time*0.006, time*0.003);
            float c = smoothstep(0.35, 0.75, fb(uv));
            vec3 cc = mix(vec3(0.30,0.34,0.38), vec3(0.85,0.88,0.9), pow(s,4.));
            col = mix(col, cc, c * 0.75 * smoothstep(0.0, 0.2, y));
          }
          gl_FragColor = vec4(col, 1.);
        }`
    });
    const sky = add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat)); sky.renderOrder = -10; sky.frustumCulled = false;

    // ---------- 海面：多层 Gerstner 波 + 菲涅尔 + 泡沫 ----------
    const seaMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 }, sunDir: { value: sunDir }, camPos: { value: new THREE.Vector3() } }]),
      vertexShader: `uniform float time; varying vec3 vW; varying vec3 vN; varying float vFoam;
        #include <fog_pars_vertex>
        vec3 gw(vec2 dir, float k, float a, float sp, vec2 p, inout vec3 tan, inout vec3 bin){
          float f = k*(dot(dir,p) - sp*time); float q = a*k;
          tan += vec3(-dir.x*dir.x*q*sin(f), dir.x*q*cos(f), -dir.x*dir.y*q*sin(f));
          bin += vec3(-dir.x*dir.y*q*sin(f), dir.y*q*cos(f), -dir.y*dir.y*q*sin(f));
          return vec3(dir.x*a*cos(f), a*sin(f), dir.y*a*cos(f));
        }
        void main(){
          vec4 wp = modelMatrix*vec4(position,1.); vec2 p = wp.xz;
          vec3 tan = vec3(1,0,0), bin = vec3(0,0,1), d = vec3(0);
          d += gw(normalize(vec2(1.,0.6)), 0.08, 0.55, 3.0, p, tan, bin);
          d += gw(normalize(vec2(-0.7,1.)), 0.14, 0.28, 2.4, p, tan, bin);
          d += gw(normalize(vec2(0.2,-1.)), 0.31, 0.12, 1.8, p, tan, bin);
          d += gw(normalize(vec2(-1.,-0.3)), 0.6, 0.05, 1.3, p, tan, bin);
          wp.xyz += d; vW = wp.xyz; vN = normalize(cross(bin, tan)); vFoam = smoothstep(0.55, 0.95, d.y);
          vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 sunDir; uniform vec3 camPos; uniform float time; varying vec3 vW; varying vec3 vN; varying float vFoam;
        #include <fog_pars_fragment>
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 V = normalize(camPos - vW); vec3 N = normalize(vN + vec3(n(vW.xz*0.9+time*0.4)-0.5, 0., n(vW.zx*0.9-time*0.3)-0.5)*0.18);
          float fres = pow(1. - max(dot(N, V), 0.), 4.);
          vec3 deep = vec3(0.02,0.09,0.12), shallow = vec3(0.07,0.30,0.33), skyC = vec3(0.55,0.64,0.68);
          vec3 c = mix(deep, shallow, clamp(N.y*0.5 + vFoam*0.6, 0., 1.));
          c = mix(c, skyC, fres*0.75);
          vec3 Hh = normalize(sunDir + V); c += vec3(1.,0.97,0.9) * pow(max(dot(N,Hh),0.), 220.) * 2.5;
          float foam = vFoam * smoothstep(0.4, 0.8, n(vW.xz*1.6 + time*0.5));
          c = mix(c, vec3(0.88,0.94,0.95), foam*0.75);
          gl_FragColor = vec4(c, 1.);
          #include <fog_fragment>
        }`,
    });
    const sea = add(new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 160, 160), seaMat));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, -1.6, 40); sea.frustumCulled = false;

    // ---------- 几何工具 ----------
    const box = (mat, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0, collide = false, block = true) => {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true; if (block) blockers.push(m);
      if (collide) colliders.push({ x, z, r: Math.max(w, d) * 0.55 }); return m;
    };
    const cyl = (mat, rt, rb, h, x, y, z, seg = 16, block = true) => {
      const m = add(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)); m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true; if (block) blockers.push(m); return m;
    };
    const roof = (mat, w, d, h, x, y, z, ry = 0, top = 0.3) => {
      const g = new THREE.CylinderGeometry(top, 1, 1, 4, 1); g.rotateY(Math.PI / 4);
      const m = add(new THREE.Mesh(g, mat)); const k = 1 / Math.SQRT1_2;
      m.scale.set(w / 2 * k, h, d / 2 * k); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; return m;
    };
    const rockGeo = (() => { const gs = []; for (let v = 0; v < 6; v++) { const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), s = 0.62 + U.fbm(x * 1.4 + v * 7, y * 1.3 + z, 4) * 0.7 + (U.fbm(x * 6 + v, y * 6 - z * 3, 2) - 0.5) * 0.12; p.setXYZ(i, x * s, y * s * (0.8 + v * 0.08), z * s); } g.computeVertexNormals(); gs.push(g); } return gs; })();
    const rock = (x, y, z, s, mat = M.wetRock, collide = false, sy = 1) => {
      const m = add(new THREE.Mesh(rockGeo[(R() * rockGeo.length) | 0], mat)); m.position.set(x, y, z); m.scale.set(s, s * sy, s); m.rotation.set(R() * 0.5, R() * 6.3, R() * 0.5);
      m.castShadow = m.receiveShadow = true; blockers.push(m); if (collide) colliders.push({ x, z, r: s * 0.85 }); return m;
    };

    // ---------- ① 海岸栈道（前置关卡） ----------
    // 石基 + 木栈板，两侧护栏残缺，栈道下是海
    const pathLen = PATH_Z1 - PATH_Z0;
    box(M.rock, PATH_HX * 2 + 1.4, 2.2, pathLen + 2, 0, -1.25, (PATH_Z0 + PATH_Z1) / 2, 0, 0, 0, false, false);
    const plankMat = M.wood;
    for (let z = PATH_Z0 + 0.6; z < PATH_Z1; z += 0.62) {
      if (R() < 0.04) continue; // 缺板
      const w = PATH_HX * 2 + 0.6 - (R() < 0.15 ? R() * 1.2 : 0);
      const pl = box(plankMat, w, 0.12, 0.56, (R() - 0.5) * 0.15, 0.0, z, (R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.02, false, false);
      pl.receiveShadow = true;
    }
    // 护栏
    for (let side of [-1, 1]) {
      for (let z = PATH_Z0 + 2; z < PATH_Z1 - 1; z += 3.2) {
        if (R() < 0.22) continue;
        const x = side * (PATH_HX + 0.45);
        cyl(M.wood, 0.11, 0.13, 1.25, x, 0.62, z, 8);
        if (R() > 0.3) box(M.wood, 0.1, 0.1, 3.2, x, 1.08, z + 1.6, 0, 0, (R() - 0.5) * 0.1, false, false);
        if (R() < 0.18) { // 垂落的残绳
          const rope = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), M.wood)); rope.position.set(x, 0.4, z + 0.8); rope.rotation.z = 0.3;
        }
      }
    }
    // 海岸礁石群（大小两层，形成纵深）
    for (let z = PATH_Z0; z < PATH_Z1 + 10; z += 3.4) {
      for (const side of [-1, 1]) {
        const x = side * (PATH_HX + 2.2 + R() * 3);
        rock(x, -0.8 + R() * 0.5, z + R() * 2, 1.2 + R() * 1.8, R() < 0.5 ? M.wetRock : M.rock);
        if (R() < 0.2) rock(side * (PATH_HX + 9 + R() * 18), -1.5 + R() * 2, z, 3 + R() * 6, M.rock, false, 1.4 + R());
      }
    }
    // 远处海蚀柱（剪影，制造远景层次）
    for (let i = 0; i < 18; i++) {
      const a = R() * Math.PI * 2, d = 90 + R() * 150;
      const x = Math.sin(a) * d, z = 40 + Math.cos(a) * d;
      if (Math.abs(x) < 30 && z > 0 && z < 160) continue;
      const h = 12 + R() * 35;
      const m = rock(x, h * 0.35 - 2, z, 4 + R() * 6, M.rock, false, h / 8);
      m.material = M.rock;
    }
    // 渔船残骸
    function wreck(x, z, ry) {
      const g = new THREE.Group(); g.position.set(x, -0.6, z); g.rotation.set(0.25, ry, 0.35); add(g);
      for (let i = 0; i < 7; i++) { const rib = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.09, 6, 12, Math.PI), M.wood); rib.position.z = i * 0.7 - 2.1; rib.rotation.z = Math.PI; rib.castShadow = true; g.add(rib); }
      const keel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 5.4), M.wood); keel.position.y = -1.3; g.add(keel);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), M.wood); mast.position.set(0, 0.6, 0.4); mast.rotation.z = 0.6; mast.castShadow = true; g.add(mast);
    }
    wreck(-9.5, 96, 0.4); wreck(10.5, 58, -0.9);
    // 海岸石灯（冷光）
    const lampPos = [];
    function seaLamp(x, z) {
      cyl(M.stone, 0.32, 0.4, 0.3, x, 0.15, z, 8, false);
      cyl(M.stone, 0.12, 0.15, 1.1, x, 0.85, z, 8, false);
      box(M.jadeDark, 0.6, 0.12, 0.6, x, 1.45, z, 0, 0, 0, false, false);
      box(M.glow, 0.32, 0.36, 0.32, x, 1.7, z, 0, 0, 0, false, false);
      roof(M.tile, 0.9, 0.9, 0.35, x, 2.05, z, 0, 0.1);
      lampPos.push(new THREE.Vector3(x, 1.7, z));
      colliders.push({ x, z, r: 0.45 });
    }
    for (let z = PATH_Z0 + 8; z < PATH_Z1; z += 14) seaLamp((Math.floor(z / 14) % 2 ? 1 : -1) * (PATH_HX - 0.5), z);

    // 栈道入口牌楼「陈塘关」
    function paifang(z, text, scale = 1) {
      const W = (PATH_HX + 1.2) * scale;
      [-W, W].forEach(x => { cyl(M.redLac, 0.3, 0.34, 6, x, 3, z); box(M.stone, 1.1, 0.8, 1.1, x, 0.4, z, 0, 0, 0, true); });
      box(M.redLac, W * 2 + 0.6, 0.5, 0.45, 0, 5.2, z);
      roof(M.tile, W * 2 + 3, 2.4, 1.1, 0, 6.6, z);
      box(M.gold, W * 2 + 0.7, 0.08, 0.5, 0, 5.47, z, 0, 0, 0, false, false);
      const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
      x.fillStyle = '#0f2a2c'; x.fillRect(0, 0, 512, 160); x.strokeStyle = '#c9a24a'; x.lineWidth = 10; x.strokeRect(10, 10, 492, 140);
      x.fillStyle = '#e8c870'; x.font = 'bold 92px "STKaiti","KaiTi","Kaiti SC","Songti SC",serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 84);
      const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
      [1, -1].forEach(sd => { const pl = add(new THREE.Mesh(new THREE.PlaneGeometry(3, 0.94), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 }))); pl.position.set(0, 4.5, z + sd * 0.25); if (sd < 0) pl.rotation.y = Math.PI; pl.material.side = THREE.FrontSide; });
      box(M.redLac, W * 2, 0.35, 0.3, 0, 4.0, z, 0, 0, 0, false, false);
    }
    paifang(PATH_Z1 - 4, '陈 塘 关');

    // ---------- ② 莲池小院（检查点） ----------
    const SH = { x: 3.0, z: 62 };
    // 小莲池 + 太乙莲台
    const pond = add(new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshStandardMaterial({ color: 0x1a4a4a, roughness: 0.15, metalness: 0.3 })));
    pond.rotation.x = -Math.PI / 2; pond.position.set(SH.x, 0.08, SH.z);
    cyl(M.stone, 1.75, 1.85, 0.25, SH.x, 0.0, SH.z, 24, false);
    const lotus = new THREE.Group(); lotus.position.set(SH.x, 0.35, SH.z); add(lotus);
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 8; i++) {
      const a = (i + ring * 0.5) / 8 * Math.PI * 2, pet = new THREE.Mesh(new THREE.SphereGeometry(0.28 - ring * 0.06, 10, 8), M.lotus);
      pet.scale.set(0.55, 1.3, 0.25); pet.position.set(Math.sin(a) * (0.32 - ring * 0.12), 0.18 + ring * 0.08, Math.cos(a) * (0.32 - ring * 0.12));
      pet.lookAt(lotus.position.clone().add(pet.position.clone().multiplyScalar(3).setY(-1.5))); pet.rotateX(Math.PI / 2 * 0.0); lotus.add(pet);
    }
    for (let i = 0; i < 5; i++) { const pad = add(new THREE.Mesh(new THREE.CircleGeometry(0.3 + R() * 0.15, 16), new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.7, side: THREE.DoubleSide }))); pad.rotation.x = -Math.PI / 2; const a = R() * 6.28; pad.position.set(SH.x + Math.sin(a) * 1.1, 0.1, SH.z + Math.cos(a) * 1.1); }
    colliders.push({ x: SH.x, z: SH.z, r: 1.9 });

    // ---------- ③ 龙宫水门 ----------
    const GZ = 27.5;
    const occluders = [];
    function dragonPillar(x, z, h = 7.5, fade = false) {
      const mats = fade ? [M.stone.clone(), M.jadeDark.clone(), M.jade.clone(), M.gold.clone()] : [M.stone, M.jadeDark, M.jade, M.gold];
      if (fade) mats.forEach(m => { m.transparent = true; });
      const [mStone, mJD, mJ, mG] = mats;
      cyl(mStone, 0.95, 1.05, 0.6, x, 0.3, z, 12);
      cyl(mJD, 0.55, 0.62, h, x, h / 2 + 0.6, z, 14);
      // 盘龙：沿柱螺旋的鳞节
      for (let i = 0; i < 44; i++) {
        const u = i / 44, a = u * Math.PI * 4.2, r = 0.66;
        const seg = add(new THREE.Mesh(new THREE.SphereGeometry(0.2 - u * 0.05, 8, 6), mJ));
        seg.position.set(x + Math.cos(a) * r, 1.0 + u * (h - 0.8), z + Math.sin(a) * r);
        seg.rotation.y = -a; seg.scale.set(0.55, 0.7, 1.25); seg.castShadow = true;
      }
      // 镜头遮挡代理体：不可见、比柱子略粗，覆盖盘龙，防止镜头钻进龙柱
      const proxy = add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, h + 2, 10), new THREE.MeshBasicMaterial({ visible: false })));
      proxy.position.set(x, (h + 2) / 2, z); blockers.push(proxy);
      const head = add(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 6), mG)); head.position.set(x, h + 1.0, z + 0.35); head.rotation.x = Math.PI / 2;
      cyl(mG, 0.7, 0.6, 0.25, x, h + 0.7, z, 12, false);
      if (fade) occluders.push({ x, z, r: 1.1, mats, a: 1 });
      colliders.push({ x, z, r: 1.1 });
    }
    dragonPillar(-PATH_HX - 1.6, GZ); dragonPillar(PATH_HX + 1.6, GZ);
    box(M.jadeDark, PATH_HX * 2 + 5, 0.7, 0.9, 0, 8.4, GZ);
    roof(M.tile, PATH_HX * 2 + 8, 3, 1.4, 0, 9.5, GZ, 0, 0.25);
    // 水幕（夜叉未清时封门）
    const veilMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, op: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float op;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){ float v = n(vec2(vUv.x*30., vUv.y*4. + time*3.))*0.7 + n(vec2(vUv.x*70., vUv.y*9. + time*5.))*0.3;
          float edge = smoothstep(0.,0.08,vUv.x)*smoothstep(1.,0.92,vUv.x);
          gl_FragColor = vec4(mix(vec3(0.2,0.6,0.7), vec3(0.8,1.,1.), v), (0.25 + v*0.5)*edge*op); }`
    });
    const veil = add(new THREE.Mesh(new THREE.PlaneGeometry(PATH_HX * 2 + 1, 7.5), veilMat)); veil.position.set(0, 3.75, GZ);

    // ---------- ④ 镇海台（Boss 场） ----------
    cyl(M.rock, ARENA_R + 2.8, ARENA_R + 4.2, 4, 0, -2.05, 0, 72, false);
    const floor = add(new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 2.8, 72), M.stone.clone()));
    floor.material.map = slabC.clone(); floor.material.map.needsUpdate = true; floor.material.map.repeat.set(9, 9);
    floor.material.bumpMap = slabB.clone(); floor.material.bumpMap.needsUpdate = true; floor.material.bumpMap.repeat.set(9, 9);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.0; floor.receiveShadow = true;
    // 太极阵纹（发光细线）
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x3aa8c0, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    [[7.0, 7.25], [14.8, 15.0], [ARENA_R - 0.3, ARENA_R]].forEach(([a, b]) => { const r = add(new THREE.Mesh(new THREE.RingGeometry(a, b, 96), runeMat)); r.rotation.x = -Math.PI / 2; r.position.y = 0.03; });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const l = add(new THREE.Mesh(new THREE.PlaneGeometry(0.14, 7.6), runeMat)); l.rotation.x = -Math.PI / 2; l.rotation.z = a; l.position.set(Math.sin(a) * 11, 0.031, Math.cos(a) * 11); }
    // 太极阴阳鱼（中心）
    const yy = add(new THREE.Mesh(new THREE.CircleGeometry(3.2, 64, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x0e2a30, transparent: true, opacity: 0.5, depthWrite: false })));
    yy.rotation.x = -Math.PI / 2; yy.position.y = 0.025;
    // 场边八龙柱 + 低矮石栏（栏杆留出入口）
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) > 0) continue; // 入口方向不放
      dragonPillar(Math.sin(a) * (ARENA_R + 1.6), Math.cos(a) * (ARENA_R + 1.6), 5.5 + (i % 2) * 1.5, true);
    }
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2; if (Math.cos(a) > 0.93) continue;
      const x = Math.sin(a) * (ARENA_R + 2.5), z = Math.cos(a) * (ARENA_R + 2.5);
      const post = cyl(M.stone, 0.12, 0.14, 1.0, x, 0.5, z, 6, false);
      if (i % 2 === 0) { const rail = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.4), M.stone)); rail.position.set(x, 0.9, z); rail.rotation.y = a + Math.PI / 2; }
    }
    // 远处龙宫（海中升起的宫阙剪影）
    const PZ = -150; const PS = 1.6; // 远景龙宫：远而大，靠雾形成大气透视
    const farM = new THREE.MeshStandardMaterial({ color: 0x3a5a62, roughness: 0.7, metalness: 0.2 });
    const farRoof = new THREE.MeshStandardMaterial({ map: tiles, color: 0x2a4048, roughness: 0.6 });
    const farGold = new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 0.4, metalness: 0.8 });
    const fbox = (m, w, h, d, x, y, z) => { const o = add(new THREE.Mesh(new THREE.BoxGeometry(w * PS, h * PS, d * PS), m)); o.position.set(x * PS, y * PS - 2, PZ + z * PS); return o; };
    const froof = (w, d, h, x, y, z, top) => { const g = new THREE.CylinderGeometry(top, 1, 1, 4, 1); g.rotateY(Math.PI / 4); const o = add(new THREE.Mesh(g, farRoof)); const k = 1 / Math.SQRT1_2; o.scale.set(w / 2 * k * PS, h * PS, d / 2 * k * PS); o.position.set(x * PS, y * PS - 2, PZ + z * PS); return o; };
    fbox(farM, 70, 5, 30, 0, 0.5, 0);                        // 台基
    for (let i = 0; i < 3; i++) fbox(farM, 70 - i * 6, 1, 32 - i * 2, 0, 3.5 + i, 2 + i);   // 叠级台阶
    for (let i = -4; i <= 4; i++) { const c = add(new THREE.Mesh(new THREE.CylinderGeometry(0.7 * PS, 0.8 * PS, 12 * PS, 10), farM)); c.position.set(i * 6.5 * PS, 12 * PS - 2, PZ + 10 * PS); }
    fbox(farM, 58, 1.2, 22, 0, 18.4, 2);
    froof(72, 32, 4.5, 0, 21.5, 2, 0.42);                    // 重檐下层
    fbox(farM, 38, 4, 14, 0, 25.5, 2);
    froof(48, 22, 6, 0, 30.5, 2, 0.2);                       // 重檐上层
    fbox(farGold, 1.6, 4, 1.6, 0, 35.5, 2);
    for (const sx of [-1, 1]) { fbox(farM, 9, 30, 9, sx * 40, 15, 6); froof(14, 14, 5, sx * 40, 32.5, 6, 0.15); fbox(farM, 5, 8, 5, sx * 40, 37, 6); froof(8, 8, 3.5, sx * 40, 42.5, 6, 0.1); }
    // 珊瑚（场边与栈道下）
    function coral(x, y, z, s) {
      const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); add(g);
      const grow = (p, dir, len, r, d) => {
        if (d > 3) return; const end = p.clone().addScaledVector(dir, len);
        const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, len, 6), M.coral); c.position.copy(p).lerp(end, 0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); c.castShadow = true; g.add(c);
        for (let k = 0; k < 2; k++) grow(end, dir.clone().add(new THREE.Vector3((R() - 0.5) * 1.2, 0.3, (R() - 0.5) * 1.2)).normalize(), len * 0.7, r * 0.7, d + 1);
      };
      grow(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.8, 0.12, 0);
    }
    for (let i = 0; i < 14; i++) { const a = R() * Math.PI * 2; coral(Math.sin(a) * (ARENA_R + 6 + R() * 4), -1.2, Math.cos(a) * (ARENA_R + 6 + R() * 4), 0.7 + R() * 0.7); }
    for (let i = 0; i < 10; i++) coral((R() < 0.5 ? -1 : 1) * (PATH_HX + 2.5 + R() * 2), -1.1, PATH_Z0 + 8 + R() * (pathLen - 16), 0.5 + R() * 0.5);

    // ---------- 灯光 ----------
    const lights = [];
    lampPos.forEach((p, i) => { if (i % 2) return; const l = new THREE.PointLight(0x6ad8ff, 1.5, 9, 2); l.position.copy(p); add(l); lights.push(l); });
    const lotusLight = new THREE.PointLight(0xff8aa0, 1.8, 7, 2); lotusLight.position.set(SH.x, 1.2, SH.z); add(lotusLight);
    const arenaLight = new THREE.PointLight(0x4ad0ff, 0, 40, 1.5); arenaLight.position.set(0, 8, 0); add(arenaLight);

    // ---------- 飞沫与水汽 ----------
    const NL = 500, lp = new Float32Array(NL * 3), lv = [];
    for (let i = 0; i < NL; i++) { lp[i * 3] = (R() - 0.5) * 60; lp[i * 3 + 1] = R() * 10; lp[i * 3 + 2] = (R() - 0.5) * 60; lv.push({ s: 0.2 + R() * 0.6, ph: R() * 6.28 }); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    const spray = add(new THREE.Points(lg, new THREE.PointsMaterial({ size: 0.09, map: dot, color: 0xcff6ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })));
    spray.frustumCulled = false;

    const _cam = new THREE.Vector3();
    function update(t, dt, focus, fightActive, camera) {
      skyMat.uniforms.time.value = t; seaMat.uniforms.time.value = t; veilMat.uniforms.time.value = t;
      if (camera) seaMat.uniforms.camPos.value.copy(camera.position);
      lotus.rotation.y = t * 0.3; lotus.position.y = 0.35 + Math.sin(t * 1.4) * 0.05;
      runeMat.opacity = 0.16 + Math.sin(t * 1.3) * 0.06 + (fightActive ? 0.14 : 0);
      arenaLight.intensity += ((fightActive ? 1.6 : 0) - arenaLight.intensity) * Math.min(1, dt * 2);
      lights.forEach((l, i) => l.intensity = 1.4 + Math.sin(t * 5 + i) * 0.15);
      for (let i = 0; i < NL; i++) {
        const v = lv[i]; let x = lp[i * 3], y = lp[i * 3 + 1], z = lp[i * 3 + 2];
        x += Math.sin(t * 0.6 + v.ph) * 0.01 + 0.012; y += Math.sin(t * 0.9 + v.ph) * 0.004; z += Math.cos(t * 0.5 + v.ph) * 0.01;
        if (Math.abs(x - focus.x) > 30 || Math.abs(z - focus.z) > 30) { x = focus.x + (Math.random() - 0.5) * 58; z = focus.z + (Math.random() - 0.5) * 58; y = Math.random() * 8; }
        lp[i * 3] = x; lp[i * 3 + 1] = y; lp[i * 3 + 2] = z;
      }
      lg.attributes.position.needsUpdate = true;
      veil.visible = veilMat.uniforms.op.value > 0.01;
      mist.visible = mistMat.uniforms.op.value > 0.01;
      mistMat.uniforms.time.value = t;
      mistMat.uniforms.op.value += ((fightActive ? 1 : 0) - mistMat.uniforms.op.value) * Math.min(1, dt * 2);
    }
    // 战斗时封闭入口的水雾门
    const mistMat = veilMat.clone(); mistMat.uniforms = { time: { value: 0 }, op: { value: 0 } };
    const mist = add(new THREE.Mesh(new THREE.PlaneGeometry(PATH_HX * 2 + 1, 6), mistMat)); mist.position.set(0, 3, ENTRY_Z + 2.4); mist.visible = false;

    // 区域约束：自由模式 = 圆台 ∪ 栈道（水门封闭时不能过 GZ）；战斗时仅圆台
    let gateOpen = false;
    function constrain(p, rad, arenaOnly) {
      const R2 = ARENA_R - rad, hx = PATH_HX - rad, z1 = PATH_Z1 - rad;
      const zMin = gateOpen ? PATH_Z0 : GZ + 0.8 + rad;
      const d = Math.hypot(p.x, p.z);
      const inDisc = gateOpen && d <= R2;
      const inRect = !arenaOnly && Math.abs(p.x) <= hx && p.z >= zMin && p.z <= z1;
      const discOnly = arenaOnly && d <= R2;
      if (!(inDisc || inRect || discOnly)) {
        let bx = p.x, bz = p.z, bd = Infinity;
        if (gateOpen || arenaOnly) { const k = R2 / Math.max(d, 1e-4); bx = p.x * k; bz = p.z * k; bd = Math.hypot(bx - p.x, bz - p.z); }
        if (!arenaOnly) { const cx = Math.max(-hx, Math.min(hx, p.x)), cz = Math.max(zMin, Math.min(z1, p.z)); const dd = Math.hypot(cx - p.x, cz - p.z); if (dd < bd) { bd = dd; bx = cx; bz = cz; } }
        p.x = bx; p.z = bz;
      }
      for (const c of colliders) { const dx = p.x - c.x, dz = p.z - c.z, dd = Math.hypot(dx, dz), m = c.r + rad; if (dd < m && dd > 1e-4) { p.x = c.x + dx / dd * m; p.z = c.z + dz / dd * m; } }
    }
    function setGate(open) { gateOpen = open; veilMat.uniforms.op.value = open ? 0 : 1; }
    setGate(false);

    return {
      id: 'sea', group, update, occluders, constrain, heightAt: () => -1.2, blockers, colliders, sunDir, mist, setGate,
      shrine: SH, checkpoint: new THREE.Vector3(0, 0, 58), spawn: new THREE.Vector3(0, 0, 136),
      bossHome: new THREE.Vector3(0, 0, -12), ARENA_R, ENTRY_Z, gateZ: GZ,
      inArena: (p) => gateOpen && Math.hypot(p.x, p.z) < ARENA_R - 0.3 && p.z < ENTRY_Z,
      // 前置关卡伏击点（两波）
      ambush: [{ z: 112, spawns: [[-2.5, 100], [2.5, 98]] }, { z: 80, spawns: [[0, 66], [-3, 70], [3, 72]] }],
      fog: { color: 0x7d9aa2, density: 0.0115 }, light: { sun: 0xdce8ff, sunI: 1.6, hemiSky: 0xbfe0ff, hemiGround: 0x1a2a30, hemiI: 0.45, exposure: 1.0 },
      showcase: new THREE.Vector3(0, 0, 128), title: '第一回 · 东海陈塘关', intro: '沿海岸栈道前行 · 东海三太子镇守镇海台',
    };
  }
  return { build };
})();
