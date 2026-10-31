// ===== 角色模型与程序化姿势 =====
const Chars = (() => {
  const std = (color, rough = 0.85, metal = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));

  function furTexture(base, seed) {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    let s = seed;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 2600; i++) {
      const px = r() * S, py = r() * S, l = 4 + r() * 10, a = (r() - 0.5) * 0.6 + Math.PI / 2;
      x.strokeStyle = r() < 0.5 ? 'rgba(255,240,210,0.10)' : 'rgba(0,0,0,0.22)';
      x.lineWidth = 1 + r();
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.repeat.set(2, 2);
    return t;
  }
  function M(geo, mat, parent, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p); m.rotation.set(...r); m.scale.set(...s);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  }
  const G = (parent, p = [0, 0, 0]) => { const g = new THREE.Group(); g.position.set(...p); parent.add(g); return g; };
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
  const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);

  // ---------------- 天命人（悟空） ----------------
  function buildPlayer() {
    const fur = std(0x8a6a44, 0.95, 0, { map: furTexture('#7a5c3a', 7) });
    const furD = std(0x4d3a26, 0.95, 0, { map: furTexture('#4d3a26', 9) });
    const face = std(0xc79f7a, 0.75);
    const bronze = std(0x7a5a32, 0.38, 0.85);
    const gold = std(0xd9a441, 0.25, 1.0);
    const cloth = std(0x34100b, 0.92);
    const cloth2 = std(0x2d2621, 0.92);
    const staffM = std(0x3a1510, 0.45, 0.4);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0xffa21a, emissiveIntensity: 2.5 });

    const root = new THREE.Group();
    const model = G(root);
    const hips = G(model, [0, 0.98, 0]);
    M(sph(0.17), cloth2, hips, [0, 0, 0], [0, 0, 0], [1.25, 0.85, 1]);
    const skirt = M(new THREE.CylinderGeometry(0.21, 0.36, 0.48, 12, 1, true), cloth, hips, [0, -0.17, 0]); skirt.material = cloth.clone(); skirt.material.side = THREE.DoubleSide;
    M(new THREE.TorusGeometry(0.205, 0.035, 8, 20), bronze, hips, [0, 0.04, 0], [Math.PI / 2, 0, 0]);
    // 腰间葫芦
    const gourdMat = std(0xb08a3e, 0.55, 0.1);
    const gourdWaist = G(hips, [0.2, -0.02, -0.08]);
    M(sph(0.05), gourdMat, gourdWaist, [0, 0.03, 0]); M(sph(0.075), gourdMat, gourdWaist, [0, -0.07, 0]);
    // 尾巴
    const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.05, -0.15), new THREE.Vector3(0, -0.3, -0.38), new THREE.Vector3(0.05, -0.62, -0.42), new THREE.Vector3(0.1, -0.78, -0.25)]);
    M(new THREE.TubeGeometry(tailCurve, 16, 0.032, 6), fur, hips);

    const torso = G(hips, [0, 0.08, 0]);
    M(cap(0.2, 0.26), fur, torso, [0, 0.27, 0], [0, 0, 0], [1.15, 1, 0.85]);
    M(new THREE.CylinderGeometry(0.235, 0.205, 0.34, 14, 1, true, -Math.PI * 0.45, Math.PI * 0.9), bronze, torso, [0, 0.27, 0.005]).material = bronze.clone();
    torso.children[torso.children.length - 1].material.side = THREE.DoubleSide;
    M(new THREE.TorusGeometry(0.15, 0.065, 8, 16), furD, torso, [0, 0.5, 0], [Math.PI / 2, 0, 0]);
    // 披挂（红色飘带）
    const sash = M(new THREE.BoxGeometry(0.06, 0.62, 0.02), cloth, torso, [0.02, 0.28, 0.19], [0, 0, 0.62]);
    // 肩甲
    const padG = new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    M(padG, bronze, torso, [-0.29, 0.43, 0], [0, 0, 0.45]);
    M(padG, bronze, torso, [0.29, 0.43, 0], [0, 0, -0.45]);

    const head = G(torso, [0, 0.6, 0.01]);
    M(sph(0.15), fur, head, [0, 0.03, 0], [0, 0, 0], [1, 1.06, 1]);
    M(sph(0.11), face, head, [0, -0.01, 0.075], [0, 0, 0], [1, 0.92, 0.72]);
    M(sph(0.068), face, head, [0, -0.06, 0.135], [0, 0, 0], [1.25, 0.78, 1]);
    M(new THREE.BoxGeometry(0.2, 0.035, 0.06), furD, head, [0, 0.045, 0.13], [0.25, 0, 0]);
    M(sph(0.018, 8, 6), eyeM, head, [-0.045, 0.015, 0.16]);
    M(sph(0.018, 8, 6), eyeM, head, [0.045, 0.015, 0.16]);
    M(sph(0.045), face, head, [-0.15, 0.0, 0], [0, 0, 0], [0.45, 1, 0.9]);
    M(sph(0.045), face, head, [0.15, 0.0, 0], [0, 0, 0], [0.45, 1, 0.9]);
    M(new THREE.TorusGeometry(0.152, 0.017, 8, 28), gold, head, [0, 0.07, 0.0], [Math.PI / 2 + 0.12, 0, 0]);
    // 翎子
    const featherM = std(0x6b2a14, 0.6);
    [-1, 1].forEach(s => {
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.05, 0.15, 0.04), new THREE.Vector3(s * 0.12, 0.55, -0.05), new THREE.Vector3(s * 0.22, 0.92, -0.42), new THREE.Vector3(s * 0.32, 1.02, -0.95), new THREE.Vector3(s * 0.38, 0.9, -1.25)]);
      M(new THREE.TubeGeometry(c, 30, 0.011, 5), featherM, head);
    });

    // 手臂
    function arm(side) {
      const sh = G(torso, [side * 0.27, 0.41, 0]);
      M(cap(0.066, 0.2), fur, sh, [0, -0.15, 0]);
      const el = G(sh, [0, -0.31, 0]);
      M(cap(0.056, 0.17), fur, el, [0, -0.12, 0]);
      M(new THREE.CylinderGeometry(0.066, 0.06, 0.16, 10), bronze, el, [0, -0.16, 0]);
      const hand = G(el, [0, -0.29, 0]);
      M(sph(0.055), face, hand, [0, 0, 0], [0, 0, 0], [1, 1.1, 0.9]);
      return { sh, el, hand };
    }
    const R = arm(-1), L = arm(1);
    // 金箍棒
    const staffPivot = G(R.hand);
    const staff = G(staffPivot);
    const SL = 2.3, grip = 0.75;
    M(new THREE.CylinderGeometry(0.028, 0.028, SL, 10), staffM, staff, [0, SL / 2 - grip, 0]);
    M(new THREE.CylinderGeometry(0.037, 0.037, 0.24, 12), gold, staff, [0, SL - grip - 0.12, 0]);
    M(new THREE.CylinderGeometry(0.037, 0.037, 0.24, 12), gold, staff, [0, -grip + 0.12, 0]);
    M(new THREE.TorusGeometry(0.034, 0.008, 6, 14), gold, staff, [0, SL - grip - 0.3, 0], [Math.PI / 2, 0, 0]);
    M(new THREE.TorusGeometry(0.034, 0.008, 6, 14), gold, staff, [0, -grip + 0.3, 0], [Math.PI / 2, 0, 0]);
    const tip = G(staff, [0, SL - grip, 0]);
    const mid = G(staff, [0, 0.35, 0]);
    const staffGlowMat = gold; // 蓄力时提高 emissive
    // 手持葫芦（饮用时显示）
    const gourdHand = G(L.hand, [0, -0.08, 0.04]);
    M(sph(0.05), gourdMat, gourdHand, [0, 0.0, 0]); M(sph(0.075), gourdMat, gourdHand, [0, -0.1, 0]);
    gourdHand.visible = false;

    function leg(side) {
      const hip = G(hips, [side * 0.11, -0.05, 0]);
      M(cap(0.085, 0.28), cloth2, hip, [0, -0.22, 0]);
      const knee = G(hip, [0, -0.45, 0]);
      M(cap(0.068, 0.28), cloth2, knee, [0, -0.2, 0]);
      M(new THREE.CylinderGeometry(0.075, 0.065, 0.2, 10), std(0x6e6252, 0.9), knee, [0, -0.3, 0]);
      M(new THREE.BoxGeometry(0.1, 0.07, 0.22), furD, knee, [0, -0.47, 0.04]);
      return { hip, knee };
    }
    const LL = leg(1), RL = leg(-1);

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return {
      root, model, hips, torso, head, rS: R.sh, rE: R.el, rH: R.hand, lS: L.sh, lE: L.el, lH: L.hand,
      staffPivot, staff, tip, mid, gourdHand, gourdWaist, lHip: LL.hip, lK: LL.knee, rHip: RL.hip, rK: RL.knee,
      baseHipY: 0.98, gold, eyeM, sash,
    };
  }

  // ---------------- 黑风大王（黑熊精） ----------------
  function buildBoss() {
    const fur = std(0x5e534b, 0.9, 0, { map: furTexture('#2a2420', 21) });
    const furL = std(0x6e6258, 0.9, 0, { map: furTexture('#3a322c', 33) });
    const robe = std(0x3a0d09, 0.9);
    const robe2 = std(0x16110f, 0.9);
    const gold = std(0xc4923a, 0.3, 1.0);
    const bronze = std(0x5e4a2e, 0.4, 0.85);
    const shaftM = std(0x1c1210, 0.6, 0.2);
    const blade = std(0xb8bcc4, 0.22, 1.0);
    const tassel = std(0x8a1410, 0.85);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 3 });
    const fang = std(0xe8e0cc, 0.5);

    const root = new THREE.Group();
    const model = G(root);
    const hips = G(model, [0, 1.9, 0]);
    M(sph(0.62), robe2, hips, [0, 0, 0], [0, 0, 0], [1.25, 0.8, 1.05]);
    const skirt = M(new THREE.CylinderGeometry(0.72, 1.15, 1.25, 16, 1, true), robe, hips, [0, -0.5, 0]); skirt.material = robe.clone(); skirt.material.side = THREE.DoubleSide;
    M(new THREE.TorusGeometry(0.74, 0.07, 8, 28), gold, hips, [0, 0.1, 0], [Math.PI / 2, 0, 0]);
    M(new THREE.TorusGeometry(1.14, 0.04, 6, 30), gold, hips, [0, -1.11, 0], [Math.PI / 2, 0, 0]);

    const torso = G(hips, [0, 0.15, 0]);
    M(sph(0.78), fur, torso, [0, 0.42, 0.05], [0, 0, 0], [1.15, 0.95, 1.0]);
    M(sph(0.82), fur, torso, [0, 1.05, 0], [0, 0, 0], [1.3, 0.92, 0.95]);
    M(sph(0.5), furL, torso, [0, 0.55, 0.42], [0, 0, 0], [1.1, 1.0, 0.6]);
    // 胸前月牙白纹（黑熊特征）
    M(new THREE.TorusGeometry(0.5, 0.075, 8, 24, Math.PI * 0.9), std(0xd9cdb4, 0.8), torso, [0, 1.12, 0.74], [0.25, 0, Math.PI * 1.05], [1.1, 0.8, 1]);
    // 袈裟斜披
    M(new THREE.BoxGeometry(0.5, 2.0, 0.08), robe, torso, [0.1, 0.85, 0.72], [0.15, 0, 0.62]);
    M(new THREE.BoxGeometry(0.06, 2.0, 0.1), gold, torso, [0.3, 0.92, 0.74], [0.15, 0, 0.62]);
    // 佛珠
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      M(sph(0.075, 8, 6), bronze, torso, [Math.sin(a) * 0.62, 1.5 - Math.cos(a) * 0.12 + (Math.cos(a) > 0 ? -0.18 * Math.cos(a) : 0), Math.cos(a) * 0.5]);
    }
    // 肩甲
    const pad = new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    M(pad, gold, torso, [0.98, 1.38, 0], [0, 0, -0.5]);
    M(pad, bronze, torso, [-0.98, 1.38, 0], [0, 0, 0.5], [0.85, 0.85, 0.85]);
    for (let i = 0; i < 3; i++) M(new THREE.ConeGeometry(0.07, 0.35, 6), gold, torso, [1.05 + i * 0.12, 1.72 - i * 0.08, -0.15 + i * 0.15], [0, 0, -0.6]);

    const head = G(torso, [0, 1.78, 0.12]);
    M(sph(0.5), fur, head, [0, 0, 0], [0, 0, 0], [1, 0.95, 0.95]);
    M(sph(0.28), furL, head, [0, -0.14, 0.38], [0, 0, 0], [1.05, 0.8, 1.15]);
    M(sph(0.1), std(0x0c0a09, 0.4), head, [0, -0.05, 0.69], [0, 0, 0], [1.2, 0.8, 0.8]);
    M(sph(0.16), fur, head, [-0.38, 0.38, -0.02]); M(sph(0.16), fur, head, [0.38, 0.38, -0.02]);
    M(sph(0.08), furL, head, [-0.38, 0.38, 0.07]); M(sph(0.08), furL, head, [0.38, 0.38, 0.07]);
    const eyeL = M(sph(0.055, 10, 8), eyeM, head, [-0.18, 0.08, 0.42]);
    const eyeR = M(sph(0.055, 10, 8), eyeM, head, [0.18, 0.08, 0.42]);
    M(new THREE.BoxGeometry(0.62, 0.08, 0.15), fur, head, [0, 0.16, 0.42], [0.3, 0, 0]);
    [-0.12, 0.12].forEach(x => M(new THREE.ConeGeometry(0.035, 0.14, 6), fang, head, [x, -0.3, 0.55], [Math.PI, 0, 0]));
    // 金箍发冠
    M(new THREE.TorusGeometry(0.42, 0.04, 8, 28), gold, head, [0, 0.22, 0], [Math.PI / 2 + 0.2, 0, 0]);

    function arm(side) {
      const sh = G(torso, [side * 0.98, 1.25, 0]);
      M(cap(0.24, 0.55), fur, sh, [0, -0.4, 0]);
      const el = G(sh, [0, -0.82, 0]);
      M(cap(0.21, 0.5), fur, el, [0, -0.36, 0]);
      M(new THREE.CylinderGeometry(0.24, 0.22, 0.42, 12), gold, el, [0, -0.42, 0]);
      const hand = G(el, [0, -0.78, 0]);
      M(sph(0.21), furL, hand, [0, 0, 0], [0, 0, 0], [1, 1.1, 1]);
      for (let i = 0; i < 4; i++) M(new THREE.ConeGeometry(0.035, 0.16, 5), fang, hand, [(i - 1.5) * 0.08, -0.16, 0.12], [Math.PI * 0.8, 0, 0]);
      return { sh, el, hand };
    }
    const R = arm(-1), L = arm(1);
    // 黑缨枪
    const spearPivot = G(R.hand);
    const spear = G(spearPivot);
    const SL = 4.8, grip = 1.5;
    M(new THREE.CylinderGeometry(0.055, 0.06, SL, 10), shaftM, spear, [0, SL / 2 - grip, 0]);
    const headG = new THREE.ConeGeometry(0.14, 0.75, 4); headG.scale(1, 1, 0.35);
    M(headG, blade, spear, [0, SL - grip + 0.37, 0]);
    M(new THREE.CylinderGeometry(0.08, 0.06, 0.18, 10), gold, spear, [0, SL - grip - 0.05, 0]);
    const tas = M(new THREE.ConeGeometry(0.22, 0.6, 12, 1, true), tassel, spear, [0, SL - grip - 0.4, 0], [Math.PI, 0, 0]);
    tas.material = tassel.clone(); tas.material.side = THREE.DoubleSide;
    M(new THREE.CylinderGeometry(0.08, 0.08, 0.25, 10), gold, spear, [0, -grip + 0.1, 0]);
    const tip = G(spear, [0, SL - grip + 0.6, 0]);
    const mid = G(spear, [0, 1.0, 0]);
    const fireM = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const fireSheath = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, SL * 0.7, 8, 1, true), fireM);
    fireSheath.position.set(0, SL * 0.35, 0); spear.add(fireSheath);

    function leg(side) {
      const hip = G(hips, [side * 0.42, -0.1, 0]);
      M(cap(0.3, 0.55), fur, hip, [0, -0.45, 0]);
      const knee = G(hip, [0, -0.9, 0]);
      M(cap(0.25, 0.5), fur, knee, [0, -0.42, 0]);
      M(new THREE.CylinderGeometry(0.27, 0.25, 0.4, 12), bronze, knee, [0, -0.5, 0]);
      M(new THREE.BoxGeometry(0.36, 0.18, 0.55), furL, knee, [0, -0.88, 0.12]);
      return { hip, knee };
    }
    const LL = leg(1), RL = leg(-1);
    // 收集可着色材质（受击闪白、定身金光）
    const flashMats = [];
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material !== eyeM && o.material !== fireM && !flashMats.includes(o.material)) flashMats.push(o.material); } });
    flashMats.forEach(m => { m.emissive = m.emissive || new THREE.Color(0); m.userData.baseEmissive = m.emissive.clone(); });

    return {
      root, model, hips, torso, head, rS: R.sh, rE: R.el, rH: R.hand, lS: L.sh, lE: L.el, lH: L.hand,
      staffPivot: spearPivot, staff: spear, tip, mid, lHip: LL.hip, lK: LL.knee, rHip: RL.hip, rK: RL.knee,
      baseHipY: 1.9, eyeM, fireM, flashMats,
    };
  }

  // ---------------- 姿势系统 ----------------
  const KEYS = ['hipY', 'hipX', 'hipZ', 'tX', 'tY', 'tZ', 'hX', 'hY', 'rsX', 'rsY', 'rsZ', 'reX', 'wX', 'wY', 'wZ', 'lsX', 'lsY', 'lsZ', 'leX', 'lhX', 'rhX', 'lkX', 'rkX', 'lhZ', 'rhZ'];
  const zeroPose = () => { const p = {}; KEYS.forEach(k => p[k] = 0); return p; };
  function applyPose(rig, p, extra = {}) {
    rig.hips.position.y = rig.baseHipY + p.hipY * (rig.baseHipY / 0.98);
    rig.hips.rotation.set(p.hipX + (extra.roll || 0), 0, p.hipZ);
    rig.torso.rotation.set(p.tX, p.tY, p.tZ);
    rig.head.rotation.set(p.hX, p.hY, 0);
    rig.rS.rotation.set(p.rsX, p.rsY, p.rsZ);
    rig.rE.rotation.set(p.reX, 0, 0);
    rig.staffPivot.rotation.set(p.wX, p.wY, p.wZ);
    rig.lS.rotation.set(p.lsX, p.lsY, p.lsZ);
    rig.lE.rotation.set(p.leX, 0, 0);
    rig.lHip.rotation.set(p.lhX, 0, p.lhZ); rig.rHip.rotation.set(p.rhX, 0, p.rhZ);
    rig.lK.rotation.set(p.lkX, 0, 0); rig.rK.rotation.set(p.rkX, 0, 0);
    // 翻滚：绕身体中心（离地 flipC 米）旋转，而不是绕脚底
    const fa = extra.flip || 0, fc = extra.flipC || 0.6;
    rig.model.rotation.y = extra.spin || 0;
    rig.model.rotation.x = (extra.tilt || 0) + fa;
    rig.model.position.y = (extra.lift || 0) + (fa ? fc - fc * Math.cos(fa) : 0);
    rig.model.position.z = fa ? -fc * Math.sin(fa) : 0;
  }
  function blendPose(cur, tgt, k) { for (const key of KEYS) cur[key] += ((tgt[key] ?? 0) - cur[key]) * k; }
  const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  // 关键帧：frames = [[t, {..}], ...]，返回目标姿势（叠加在 base 上）
  function keyframes(base, frames, t) {
    const out = Object.assign({}, base);
    let i = 0; while (i < frames.length - 1 && t > frames[i + 1][0]) i++;
    const [t0, a] = frames[i], [t1, b] = frames[Math.min(i + 1, frames.length - 1)];
    const u = t1 > t0 ? ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 1;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.forEach(k => { const va = a[k] ?? base[k] ?? 0, vb = b[k] ?? base[k] ?? 0; out[k] = va + (vb - va) * u; });
    return out;
  }
  return { buildPlayer, buildBoss, applyPose, blendPose, keyframes, zeroPose, ease };
})();
