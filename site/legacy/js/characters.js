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
      baseHipY: 0.98, gold, eyeM, sash, fx: new THREE.Group(), wheels: null,
      update() { }, reset() { },
    };
  }

  let _glow = null;
  function glowTex() {
    if (_glow) return _glow;
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.3, 'rgba(255,140,40,0.7)'); g.addColorStop(1, 'rgba(255,60,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); _glow = new THREE.CanvasTexture(c); return _glow;
  }
  // ---------------- 布料飘带（Verlet 物理，世界坐标模拟） ----------------
  // 用于混天绫、发带、红缨：有惯性、受风、会随角色动作甩动飘起
  class Ribbon {
    constructor(o) {
      this.n = o.n || 16; this.len = o.len || 1.5; this.w = o.width || 0.1;
      this.pinA = o.pinA; this.pinB = o.pinB || null;
      this.grav = o.gravity ?? -3.5; this.drag = o.drag ?? 0.04; this.flutter = o.flutter ?? 5; this.taper = o.taper ?? 0.5;
      this.twist = o.twist ?? 0.8; this.seed = Math.random() * 100; this.lift = o.lift || 0; this.back = o.back || 0;
      this.p = []; this.q = [];
      for (let i = 0; i < this.n; i++) { this.p.push(new THREE.Vector3()); this.q.push(new THREE.Vector3()); }
      const vcount = this.n * 2;
      this.pos = new Float32Array(vcount * 3);
      const idx = [], uv = [];
      for (let i = 0; i < this.n; i++) { uv.push(0, i / (this.n - 1), 1, i / (this.n - 1)); if (i < this.n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      this.geo = g;
      this.mesh = new THREE.Mesh(g, o.material);
      this.mesh.frustumCulled = false; this.mesh.castShadow = true;
      this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this.inited = false;
    }
    reset() {
      this.pinA.getWorldPosition(this._a);
      if (this.pinB) this.pinB.getWorldPosition(this._b);
      for (let i = 0; i < this.n; i++) {
        const u = i / (this.n - 1);
        if (this.pinB) this.p[i].lerpVectors(this._a, this._b, u).y -= Math.sin(u * Math.PI) * this.len * 0.3;
        else this.p[i].copy(this._a).y -= u * this.len;
        this.q[i].copy(this.p[i]);
      }
      this.inited = true;
    }
    update(dt, t, wind, backDir) {
      this.pinA.getWorldPosition(this._a);
      if (this.pinB) this.pinB.getWorldPosition(this._b);
      if (!this.inited || this._a.distanceTo(this.p[0]) > 4) this.reset();
      const seg = this.len / (this.n - 1), steps = 3, h = Math.min(dt, 0.05) / steps;
      const last = this.pinB ? this.n - 1 : this.n;
      for (let s = 0; s < steps; s++) {
        for (let i = 1; i < last; i++) {
          const p = this.p[i], q = this.q[i];
          const vx = (p.x - q.x) * (1 - this.drag), vy = (p.y - q.y) * (1 - this.drag), vz = (p.z - q.z) * (1 - this.drag);
          q.copy(p);
          const ph = t * 6 + i * 0.55 + this.seed, k = i / this.n;
          const bx = backDir ? backDir.x * this.back * k : 0, bz = backDir ? backDir.z * this.back * k : 0;
          const fx = wind.x + bx + Math.sin(ph) * this.flutter * k, fz = wind.z + bz + Math.cos(ph * 0.83) * this.flutter * k;
          const fy = this.grav + this.lift + Math.sin(ph * 1.3) * this.flutter * 0.6 * k;
          p.x += vx + fx * h * h; p.y += vy + fy * h * h; p.z += vz + fz * h * h;
        }
        this.p[0].copy(this._a); if (this.pinB) this.p[this.n - 1].copy(this._b);
        for (let it = 0; it < 4; it++) {
          for (let i = 0; i < this.n - 1; i++) {
            const a = this.p[i], b = this.p[i + 1];
            let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5, diff = (l - seg) / l;
            const fixA = i === 0, fixB = this.pinB && i + 1 === this.n - 1;
            const wa = fixA ? 0 : (fixB ? 1 : 0.5), wb = fixB ? 0 : (fixA ? 1 : 0.5);
            dx *= diff; dy *= diff; dz *= diff;
            a.x += dx * wa; a.y += dy * wa; a.z += dz * wa;
            b.x -= dx * wb; b.y -= dy * wb; b.z -= dz * wb;
          }
          for (let i = 1; i < last; i++) if (this.p[i].y < 0.04) this.p[i].y = 0.04; // 不穿地
        }
      }
      // 生成带状网格（随时间扭转，形成翻卷感）
      const tan = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), alt = new THREE.Vector3(1, 0, 0);
      for (let i = 0; i < this.n; i++) {
        const a = this.p[Math.max(0, i - 1)], b = this.p[Math.min(this.n - 1, i + 1)];
        tan.subVectors(b, a).normalize();
        side.crossVectors(tan, Math.abs(tan.y) > 0.9 ? alt : up).normalize();
        side.applyAxisAngle(tan, Math.sin(t * 2.2 + i * 0.35 + this.seed) * this.twist);
        const w = this.w * (1 - this.taper * (this.pinB ? Math.abs(i / (this.n - 1) - 0.5) * 2 : i / (this.n - 1))) * 0.5;
        const p = this.p[i];
        this.pos[i * 6] = p.x - side.x * w; this.pos[i * 6 + 1] = p.y - side.y * w; this.pos[i * 6 + 2] = p.z - side.z * w;
        this.pos[i * 6 + 3] = p.x + side.x * w; this.pos[i * 6 + 4] = p.y + side.y * w; this.pos[i * 6 + 5] = p.z + side.z * w;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.computeVertexNormals();
    }
  }

  // ---------------- 哪吒（三太子） ----------------
  function buildNezha() {
    const skin = std(0xf0c9a8, 0.7);
    const red = std(0xb3160e, 0.75, 0, { emissive: 0x2a0200 });
    const redDark = std(0x5a0a08, 0.85);
    const gold = std(0xe2a93a, 0.25, 1.0);
    const hair = std(0x14100e, 0.55);
    const lotusPink = std(0xf2a0a8, 0.6, 0, { emissive: 0x3a0a10 });
    const lotusGreen = std(0x3f7a3a, 0.7);
    const steel = std(0xd8dce4, 0.2, 1.0, { emissive: 0x401000, emissiveIntensity: 1 });
    const shaftM = std(0x4a1a10, 0.5, 0.2);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x1a0c08, emissive: 0xff3010, emissiveIntensity: 0.6 });
    const markM = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
    const silk = new THREE.MeshStandardMaterial({ color: 0xa80a08, emissive: 0x2a0000, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });
    const silk2 = new THREE.MeshStandardMaterial({ color: 0xc8120c, emissive: 0x300400, roughness: 0.5, side: THREE.DoubleSide });

    const root = new THREE.Group();
    const model = G(root);
    const BH = 1.22; // 风火轮在脚下；悬浮高度由 HoverMotion 额外叠加（永不触地）
    const hips = G(model, [0, BH, 0]);
    M(sph(0.15), redDark, hips, [0, 0, 0], [0, 0, 0], [1.2, 0.8, 1]);
    // 荷叶裙：绿叶在下、粉莲瓣在上
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const leaf = M(sph(0.13, 10, 6), lotusGreen, hips, [Math.sin(a) * 0.17, -0.13, Math.cos(a) * 0.15], [0.5 * Math.cos(a), a, -0.5 * Math.sin(a)], [0.9, 1.6, 0.25]);
      leaf.lookAt(leaf.position.clone().multiplyScalar(3).add(new THREE.Vector3(0, -0.6, 0)));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * Math.PI * 2;
      const pet = M(sph(0.09, 10, 6), lotusPink, hips, [Math.sin(a) * 0.16, -0.03, Math.cos(a) * 0.14], [0, 0, 0], [0.8, 1.4, 0.25]);
      pet.lookAt(pet.position.clone().multiplyScalar(3).add(new THREE.Vector3(0, -0.25, 0)));
    }
    M(new THREE.TorusGeometry(0.17, 0.025, 8, 20), gold, hips, [0, 0.05, 0], [Math.PI / 2, 0, 0]);
    const gourdWaist = G(hips, [0.19, -0.02, -0.06]);
    const gourdMat = std(0xb08a3e, 0.55, 0.1);
    M(sph(0.045), gourdMat, gourdWaist, [0, 0.03, 0]); M(sph(0.065), gourdMat, gourdWaist, [0, -0.06, 0]);
    const waistPin = G(hips, [-0.12, 0.0, -0.14]);

    const torso = G(hips, [0, 0.07, 0]);
    M(cap(0.17, 0.24), skin, torso, [0, 0.25, 0], [0, 0, 0], [1.1, 1, 0.8]);
    // 红肚兜 + 金边
    M(new THREE.CylinderGeometry(0.19, 0.175, 0.34, 14, 1, true, -Math.PI * 0.42, Math.PI * 0.84), red, torso, [0, 0.24, 0.01]).material = red.clone();
    torso.children[torso.children.length - 1].material.side = THREE.DoubleSide;
    M(new THREE.TorusGeometry(0.1, 0.012, 6, 16), gold, torso, [0, 0.27, 0.165], [0, 0, 0]);
    // 乾坤圈（颈）
    M(new THREE.TorusGeometry(0.16, 0.032, 10, 32), gold, torso, [0, 0.47, 0.01], [Math.PI / 2 - 0.12, 0, 0]);
    // 莲瓣肩甲
    [-1, 1].forEach(sd => { const p = M(sph(0.1, 12, 8), lotusPink, torso, [sd * 0.25, 0.42, 0], [0, 0, sd * -0.5], [1.1, 0.5, 1]); });
    const sash = M(new THREE.BoxGeometry(0.05, 0.4, 0.015), red, torso, [-0.05, 0.25, 0.17], [0, 0, -0.5]);
    const backL = G(torso, [0.2, 0.45, -0.12]), backR = G(torso, [-0.2, 0.45, -0.12]);

    const head = G(torso, [0, 0.56, 0.01]);
    M(sph(0.14), skin, head, [0, 0.02, 0], [0, 0, 0], [1, 1.08, 1]);
    M(sph(0.145), hair, head, [0, 0.07, -0.02], [0, 0, 0], [1.02, 0.85, 1.02]);
    // 双髻
    const bunL = G(head, [0.1, 0.17, -0.02]), bunR = G(head, [-0.1, 0.17, -0.02]);
    [bunL, bunR].forEach(b => { M(sph(0.065), hair, b); M(new THREE.TorusGeometry(0.05, 0.012, 6, 14), red, b, [0, -0.02, 0], [Math.PI / 2, 0, 0]); });
    M(new THREE.BoxGeometry(0.17, 0.02, 0.03), hair, head, [0, 0.05, 0.13], [0.2, 0, 0]);
    M(sph(0.016, 8, 6), eyeM, head, [-0.045, 0.01, 0.13]); M(sph(0.016, 8, 6), eyeM, head, [0.045, 0.01, 0.13]);
    // 眉心火焰印
    const mark = M(new THREE.ConeGeometry(0.014, 0.05, 4), markM, head, [0, 0.07, 0.138], [0.15, 0, 0]); mark.castShadow = false;
    M(sph(0.03, 8, 6), std(0xd88a7a, 0.7), head, [0, -0.07, 0.125], [0, 0, 0], [1.3, 0.5, 0.6]);

    function arm(side) {
      const sh = G(torso, [side * 0.25, 0.39, 0]);
      M(cap(0.055, 0.19), skin, sh, [0, -0.14, 0]);
      const el = G(sh, [0, -0.29, 0]);
      M(cap(0.048, 0.16), skin, el, [0, -0.11, 0]);
      M(new THREE.TorusGeometry(0.055, 0.014, 6, 14), gold, el, [0, -0.17, 0], [Math.PI / 2, 0, 0]);
      M(new THREE.TorusGeometry(0.06, 0.012, 6, 14), gold, sh, [0, -0.06, 0], [Math.PI / 2, 0, 0]);
      const hand = G(el, [0, -0.27, 0]);
      M(sph(0.048), skin, hand, [0, 0, 0], [0, 0, 0], [1, 1.1, 0.9]);
      return { sh, el, hand };
    }
    const R = arm(-1), L = arm(1);
    // 红缨枪
    const staffPivot = G(R.hand);
    const staff = G(staffPivot);
    const SL = 2.4, grip = 0.75;
    M(new THREE.CylinderGeometry(0.024, 0.026, SL, 10), shaftM, staff, [0, SL / 2 - grip, 0]);
    const headG = new THREE.ConeGeometry(0.06, 0.34, 4); headG.scale(1, 1, 0.3);
    M(headG, steel, staff, [0, SL - grip + 0.17, 0]);
    M(new THREE.CylinderGeometry(0.035, 0.028, 0.08, 10), gold, staff, [0, SL - grip - 0.02, 0]);
    M(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), gold, staff, [0, -grip + 0.06, 0]);
    const tip = G(staff, [0, SL - grip + 0.34, 0]);
    const mid = G(staff, [0, 0.35, 0]);
    const tasselPin = G(staff, [0, SL - grip - 0.07, 0]);
    const gourdHand = G(L.hand, [0, -0.08, 0.04]);
    M(sph(0.045), gourdMat, gourdHand); M(sph(0.065), gourdMat, gourdHand, [0, -0.09, 0]);
    gourdHand.visible = false;

    // 腿与风火轮
    const wheels = [];
    function leg(side) {
      const hip = G(hips, [side * 0.1, -0.05, 0]);
      M(cap(0.072, 0.24), redDark, hip, [0, -0.19, 0]);
      const knee = G(hip, [0, -0.4, 0]);
      M(cap(0.058, 0.26), skin, knee, [0, -0.18, 0]);
      M(new THREE.TorusGeometry(0.06, 0.014, 6, 14), gold, knee, [0, -0.33, 0], [Math.PI / 2, 0, 0]);
      M(new THREE.BoxGeometry(0.085, 0.05, 0.19), redDark, knee, [0, -0.42, 0.035]);
      // 风火轮：纵向车轮，随速度转动，轮缘喷火
      const mount = G(knee, [0, -0.53, 0.02]);
      const spin = G(mount); spin.rotation.order = 'YXZ';
      const wheelG = new THREE.Group(); spin.add(wheelG); wheelG.rotation.y = Math.PI / 2;
      M(new THREE.TorusGeometry(0.16, 0.034, 10, 32), gold, wheelG);
      M(new THREE.TorusGeometry(0.11, 0.02, 8, 26), red, wheelG);
      M(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 24), red, wheelG, [0, 0, 0], [Math.PI / 2, 0, 0]);
      for (let k = 0; k < 6; k++) M(new THREE.BoxGeometry(0.016, 0.3, 0.02), gold, wheelG, [0, 0, 0], [0, 0, k / 6 * Math.PI]);
      M(sph(0.04, 10, 8), gold, wheelG);
      const flames = [];
      const flameM = new THREE.MeshBasicMaterial({ color: 0xff6a12, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const flameM2 = new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2, f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), k % 2 ? flameM2 : flameM);
        f.position.set(Math.cos(a) * 0.23, Math.sin(a) * 0.23, 0); f.rotation.z = a - Math.PI / 2; wheelG.add(f); flames.push(f);
      }
      // 火焰光环：从正面看也能看到一圈火
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff4a0a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      wheelG.add(halo);
      const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff7a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      glowS.scale.set(0.75, 0.75, 1); mount.add(glowS);
      wheels.push({ mount, spin, flames, hip, knee, side, halo, glowS });
      return { hip, knee };
    }
    const LL = leg(1), RL = leg(-1);
    root.traverse(o => { if (o.isMesh && o.material.blending !== THREE.AdditiveBlending && o !== mark) o.castShadow = true; });

    // 飘带：混天绫（披于背后，两端固定双肩）+ 腰间长绫 + 双髻发带 + 枪缨
    const fx = new THREE.Group();
    const ribbons = [
      // 混天绫：两端系于双肩后，向上向后浮起，形成身后的绫环
      new Ribbon({ pinA: backL, pinB: backR, n: 32, len: 2.8, width: 0.17, material: silk, gravity: 0.35, flutter: 6, taper: 0.3, twist: 0.9, back: 5.5 }),
      // 绕臂长绫：随出枪挥动甩出弧线
      new Ribbon({ pinA: L.el, n: 22, len: 2.0, width: 0.11, material: silk, gravity: -0.8, flutter: 6, taper: 0.6, twist: 1.1, back: 4 }),
      new Ribbon({ pinA: waistPin, n: 20, len: 1.7, width: 0.1, material: silk, gravity: -1.2, flutter: 6, taper: 0.6, twist: 1.1, back: 4 }),
      new Ribbon({ pinA: bunL, n: 9, len: 0.6, width: 0.045, material: silk2, gravity: -1.5, flutter: 5, taper: 0.4, back: 2.5 }),
      new Ribbon({ pinA: bunR, n: 9, len: 0.6, width: 0.045, material: silk2, gravity: -1.5, flutter: 5, taper: 0.4, back: 2.5 }),
    ];
    for (let k = 0; k < 6; k++) ribbons.push(new Ribbon({ pinA: tasselPin, n: 7, len: 0.34 + k * 0.03, width: 0.04, material: silk2, gravity: -3.5, flutter: 4, taper: 0.6, twist: 0.5, back: 1.2 }));
    ribbons.forEach(r => fx.add(r.mesh));

    const wind = new THREE.Vector3(), backDir = new THREE.Vector3();
    let spinAng = 0;
    const hover = new HoverMotion(BH);
    const groundGlow = hoverShadow(); fx.add(groundGlow);
    return {
      root, model, hips, torso, head, rS: R.sh, rE: R.el, rH: R.hand, lS: L.sh, lE: L.el, lH: L.hand,
      staffPivot, staff, tip, mid, gourdHand, gourdWaist, lHip: LL.hip, lK: LL.knee, rHip: RL.hip, rK: RL.knee,
      baseHipY: BH, gold: steel, eyeM, sash, fx, wheels, ribbons, hover, groundGlow,
      reset() { hover.reset(); root.updateMatrixWorld(true); ribbons.forEach(r => r.reset()); },
      update(dt, t, speed) {
        root.updateMatrixWorld(true);
        // 地面火光：随离地高度变淡变大，持续提示"悬空"
        const hgt = Math.max(0, root.position.y + hover.out.y);
        groundGlow.position.set(root.position.x, 0.06, root.position.z);
        groundGlow.scale.setScalar(0.9 + hgt * 0.35 + Math.min(0.6, speed * 0.04));
        groundGlow.material.opacity = Math.max(0.15, 0.85 - hgt * 0.25);
        spinAng += (3 + speed * 7) * dt;
        wheels.forEach((w, i) => {
          // 抵消大小腿弯曲，让风火轮始终保持水平滚动姿态
          w.mount.rotation.x = -(w.hip.rotation.x + w.knee.rotation.x + hips.rotation.x + model.rotation.x);
          w.spin.rotation.x = spinAng * (i ? 1 : 1.03);
          const fl = 1 + Math.min(1.5, speed * 0.12);
          w.flames.forEach((f, k) => { const s = (0.7 + Math.random() * 0.6) * fl; f.scale.set(1, s, 1); });
          w.halo.material.opacity = 0.4 + Math.random() * 0.25; w.halo.scale.setScalar(0.95 + Math.random() * 0.12 * fl);
          w.glowS.material.opacity = 0.65 + Math.random() * 0.25; w.glowS.scale.setScalar(0.65 + Math.min(0.5, speed * 0.04) + Math.random() * 0.08);
        });
        wind.set(Math.sin(t * 0.7) * 1.2, 0, Math.cos(t * 0.5) * 1.0);
        root.getWorldDirection(backDir); backDir.negate();
        ribbons.forEach(r => r.update(dt, t, wind, backDir));
      },
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

  // ---------------- 悬浮运动系统（程序化，弹簧-阻尼驱动） ----------------
  // 设计依据：
  //  1) 惯性前倾：lean = atan(水平加速度 / g)，加速前倾、刹车后仰（物理驱动倾斜）
  //  2) 转弯侧倾：由横向加速度驱动 roll，身体倒向弯内，腿部向弯外甩
  //  3) 重叠动作：躯干领先、骨盆滞后、腿部双摆滞后、头部提前转向（预判）
  //  4) 永不触地：离地高度由“状态曲线”决定，任何状态下都不贴地
  //  5) 从不静止：多频率正弦叠加漂移，避免机械感
  class Spring { // 临界附近阻尼的二阶弹簧
    constructor(f = 3, z = 0.6) { this.x = 0; this.v = 0; this.f = f; this.z = z; }
    step(target, dt, force = 0) {
      const w = 2 * Math.PI * this.f;
      const a = w * w * (target - this.x) - 2 * this.z * w * this.v + force;
      this.v += a * dt; this.x += this.v * dt; return this.x;
    }
    reset(x = 0) { this.x = x; this.v = 0; }
  }
  // 各状态的悬浮参数：hover=离地高度、bob=起伏幅度、freq=起伏频率、legs=收腿程度、lean=前倾附加
  const HOVER_PROFILES = {
    idle: { hover: 0.58, bob: 0.065, freq: 0.5, legs: 0.35, lean: 0.0, drift: 1.0 },
    move: { hover: 0.48, bob: 0.045, freq: 0.9, legs: 0.5, lean: 0.12, drift: 0.6 },
    sprint: { hover: 0.40, bob: 0.025, freq: 1.4, legs: 0.85, lean: 0.3, drift: 0.3 },
    attack: { hover: 0.42, bob: 0.015, freq: 1.2, legs: 0.55, lean: 0.10, drift: 0.2 },
    heavy: { hover: 0.30, bob: 0.01, freq: 1.0, legs: 0.9, lean: 0.05, drift: 0.1 },
    charge: { hover: 0.85, bob: 0.03, freq: 2.2, legs: 1.0, lean: -0.05, drift: 0.2 },
    roll: { hover: 0.55, bob: 0.0, freq: 0, legs: 1.0, lean: 0.0, drift: 0 },
    jump: { hover: 0.30, bob: 0.0, freq: 0, legs: 0.7, lean: 0.05, drift: 0.2 },
    airatk: { hover: 0.20, bob: 0.0, freq: 0, legs: 1.0, lean: 0.25, drift: 0 },
    land: { hover: 0.30, bob: 0.0, freq: 0, legs: 0.7, lean: 0.05, drift: 0.2 },
    cast: { hover: 0.95, bob: 0.05, freq: 1.6, legs: 0.6, lean: -0.08, drift: 0.4 },
    drink: { hover: 0.62, bob: 0.05, freq: 0.7, legs: 0.4, lean: -0.04, drift: 0.8 },
    hurt: { hover: 0.38, bob: 0.0, freq: 0, legs: 0.6, lean: -0.3, drift: 0 },
    dead: { hover: 0.12, bob: 0.0, freq: 0, legs: 0.2, lean: 0, drift: 0 },
  };
  class HoverMotion {
    constructor(baseHipY) {
      this.baseHipY = baseHipY;
      this.h = new Spring(1.8, 0.55);      // 离地高度（软，带回弹）
      this.pitch = new Spring(2.2, 0.5);   // 前倾/后仰
      this.roll = new Spring(2.0, 0.45);   // 转弯侧倾
      this.pelvisYaw = new Spring(2.6, 0.5); // 骨盆滞后扭转
      this.headYaw = new Spring(4.0, 0.7); // 头部预判
      this.thigh = new Spring(2.4, 0.4);   // 大腿惯性摆
      this.shin = new Spring(3.2, 0.35);   // 小腿二级滞后（双摆）
      this.legSide = new Spring(2.0, 0.45);// 腿部向弯外甩
      this.armDrag = new Spring(2.4, 0.4); // 手臂拖尾
      this.prevV = new THREE.Vector3(); this.prevYaw = 0; this.yawRate = 0; this.t = 0;
      this.state = 'idle'; this.speed = 0; this.vy = 0; this.facing = 0; this.vel = new THREE.Vector3(); this.inputYaw = null;
      this.out = { y: 0.55, pitch: 0, roll: 0, pelvisYaw: 0, headYaw: 0, thigh: 0, shin: 0, legSide: 0, arm: 0, prof: HOVER_PROFILES.idle };
      this.h.reset(0.55);
    }
    // 每帧由游戏逻辑喂入运动学状态
    feed(dt, state, vel, vy, facing, inputYaw) {
      if (dt <= 0) return;
      dt = Math.min(dt, 1 / 30);
      this.t += dt; this.state = state; this.vy = vy; this.facing = facing; this.inputYaw = inputYaw;
      const prof = HOVER_PROFILES[state] || HOVER_PROFILES.idle;
      // 世界加速度 → 角色局部坐标（前/侧）
      const ax = (vel.x - this.prevV.x) / dt, az = (vel.z - this.prevV.z) / dt;
      this.prevV.copy(vel); this.vel.copy(vel);
      const s = Math.sin(facing), c = Math.cos(facing);
      let aF = ax * s + az * c, aS = ax * c - az * s;
      aF = Math.max(-40, Math.min(40, aF)); aS = Math.max(-40, Math.min(40, aS));
      let dy = facing - this.prevYaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      this.prevYaw = facing;
      const yawRateNew = dy / dt; const yawAcc = (yawRateNew - this.yawRate) / dt; this.yawRate = yawRateNew;
      const speed = Math.hypot(vel.x, vel.z); this.speed = speed;
      const G = 9.8, t = this.t;
      // 1) 离地高度：状态基准 + 多频起伏 + 漂移（叠加两个不同频率，避免规律感）
      const bob = prof.bob * (Math.sin(t * prof.freq * Math.PI * 2) * 0.7 + Math.sin(t * prof.freq * Math.PI * 2 * 1.618 + 1.3) * 0.3);
      const drift = prof.drift * 0.02 * Math.sin(t * 0.37 + 2.1);
      const sink = -Math.min(0.12, Math.max(0, -aF) * 0.004); // 急停时下沉，带回弹
      this.out.y = this.h.step(prof.hover + bob + drift + sink, dt);
      // 2) 惯性前倾：atan(a/g)，加上速度带来的常驻前倾
      const leanA = Math.atan2(aF, G) * 0.35 + Math.min(0.14, speed * 0.014) + prof.lean * 0.5;
      this.out.pitch = this.pitch.step(Math.max(-0.35, Math.min(0.38, leanA)), dt);
      // 3) 转弯侧倾：横向加速度 + 角速度×速度（向心）
      const centri = this.yawRate * speed;
      const rollT = Math.atan2(aS * 0.5 + centri * 0.6, G) + Math.sin(t * 0.43) * 0.025 * prof.drift;
      this.out.roll = this.roll.step(Math.max(-0.5, Math.min(0.5, rollT)), dt);
      // 4) 骨盆滞后（由角加速度驱动），头部朝输入方向预判
      this.out.pelvisYaw = this.pelvisYaw.step(0, dt, -yawAcc * 0.35);
      let hy = 0; if (inputYaw !== null && inputYaw !== undefined) { hy = inputYaw - facing; while (hy > Math.PI) hy -= Math.PI * 2; while (hy < -Math.PI) hy += Math.PI * 2; }
      this.out.headYaw = this.headYaw.step(Math.max(-0.6, Math.min(0.6, hy * 0.6)), dt);
      // 5) 腿部：惯性拖尾（加速时腿向后、刹车时向前甩），小腿二级滞后
      this.out.thigh = this.thigh.step(prof.legs * 0.25, dt, -aF * 1.4 - this.vy * 1.5);
      this.out.shin = this.shin.step(0, dt, this.thigh.v * 9);
      this.out.legSide = this.legSide.step(0, dt, centri * 2.2 + aS * 0.8);
      this.out.arm = this.armDrag.step(0, dt, -aF * 1.2);
      this.out.prof = prof;
    }
    reset() { [this.h, this.pitch, this.roll, this.pelvisYaw, this.headYaw, this.thigh, this.shin, this.legSide, this.armDrag].forEach(s => s.reset()); this.h.reset(0.55); this.prevV.set(0, 0, 0); this.yawRate = 0; }
    // 叠加到骨骼（在常规姿势之上）
    apply(rig, p, extra) {
      const o = this.out, prof = o.prof;
      const flipping = !!extra.flip;
      rig.model.position.y += o.y;
      if (!flipping) { rig.model.rotation.x += o.pitch; rig.model.rotation.z = -o.roll; }
      else rig.model.rotation.z = 0;
      rig.hips.rotation.y = o.pelvisYaw;
      rig.torso.rotation.y += -o.pelvisYaw * 0.8;
      rig.head.rotation.y += o.headYaw; rig.head.rotation.x -= o.pitch * 0.55; // 头部保持水平视线
      // 腿：悬浮时始终收拢下垂，不做迈步；按状态收腿 + 惯性摆动 + 左右错频
      const tuck = prof.legs, t = this.t;
      const sw = Math.sin(t * 1.3) * 0.06, sw2 = Math.sin(t * 1.3 + 1.1) * 0.06;
      rig.lHip.rotation.x = -0.28 - tuck * 0.55 + o.thigh + sw;
      rig.rHip.rotation.x = 0.12 - tuck * 0.2 + o.thigh * 0.85 + sw2;
      rig.lK.rotation.x = 0.55 + tuck * 0.9 + o.shin;
      rig.rK.rotation.x = 0.35 + tuck * 0.5 + o.shin * 0.8;
      rig.lHip.rotation.z = o.legSide * 0.6 + 0.06; rig.rHip.rotation.z = o.legSide * 0.6 - 0.06;
      // 手臂：非攻击状态时有拖尾
      if (!(p.__attacking)) { rig.lS.rotation.x += o.arm * 0.5; }
      // 硬约束：任何姿态（翻滚/跳劈/重击下压）下，风火轮最低点都不得低于离地安全线
      if (rig.wheels) {
        rig.root.updateMatrixWorld(true);
        let lo = Infinity; const v = this._v || (this._v = new THREE.Vector3());
        for (const w of rig.wheels) { w.mount.getWorldPosition(v); lo = Math.min(lo, v.y - 0.25); }
        const SAFE = 0.12;
        if (lo < SAFE) { rig.model.position.y += SAFE - lo; }
      }
    }
  }
  // 哪吒专用离地阴影（悬浮时投在地面的柔和光斑，强化"离地"读感）
  function hoverShadow() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,120,40,0.55)'); g.addColorStop(0.5, 'rgba(255,80,20,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 3; return m;
  }

  // ---------------- 东海三太子 · 敖丙（Boss） ----------------
  // 设计要点：冰蓝白主色与哪吒红金形成冷暖对立；龙角、龙鳞肩甲、长发与披帛飘动；手持冰锥长戟；
  // 剪影识别：头顶双龙角 + 背后冰晶脊 + 长尾。二阶段“龙化”：龙角变大发光、背后冰晶增多、尾巴变长。
  function buildAoBing() {
    const skin = std(0xdfe8ee, 0.55);
    const armor = std(0xbfd8e8, 0.3, 0.7);
    const armorDark = std(0x2a4a66, 0.4, 0.6);
    const scale = std(0x6aa8d0, 0.35, 0.5, { emissive: 0x08202e });
    const robe = std(0x3e5c72, 0.6, 0.1); // 深冰蓝长袍（压暗，避免白色大面积抢剪影；亮部留给龙角与冰刃）
    const robeBlue = std(0x23506e, 0.55);
    const gold = std(0xd8c070, 0.3, 1.0);
    const ice = new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x3ac8ff, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 });
    const hair = std(0x1a2a3a, 0.5);
    const horn = std(0xe8f4ff, 0.3, 0.2, { emissive: 0x2a8acf, emissiveIntensity: 0.6 });
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x9ff0ff, emissive: 0x4ad8ff, emissiveIntensity: 3 });
    const silk = new THREE.MeshStandardMaterial({ color: 0xd8eef8, emissive: 0x1a3a4a, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });

    const root = new THREE.Group();
    const model = G(root);
    const BH = 1.75; // 基础身高约 3.4m；整体再放大 1.3 倍 → 约 4.4m（悬浮哪吒的 2 倍以上，保证 Boss 压迫感）
    const hips = G(model, [0, BH, 0]);
    M(sph(0.36), robeBlue, hips, [0, 0, 0], [0, 0, 0], [1.2, 0.8, 1]);
    const skirt = M(new THREE.CylinderGeometry(0.4, 0.72, 1.5, 16, 1, true), robe, hips, [0, -0.65, 0]); skirt.material = robe.clone(); skirt.material.side = THREE.DoubleSide;
    // 鳞甲裙片
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const p = M(new THREE.BoxGeometry(0.28, 0.7, 0.04), scale, hips, [Math.sin(a) * 0.55, -0.45, Math.cos(a) * 0.55], [0, a, 0]); p.rotation.x = -0.25; p.rotation.order = 'YXZ'; }
    M(new THREE.TorusGeometry(0.42, 0.05, 8, 28), gold, hips, [0, 0.08, 0], [Math.PI / 2, 0, 0]);
    const tailPin = G(hips, [0, -0.1, -0.35]);

    const torso = G(hips, [0, 0.12, 0]);
    M(cap(0.36, 0.6), skin, torso, [0, 0.5, 0], [0, 0, 0], [1.15, 1, 0.8]);
    M(new THREE.CylinderGeometry(0.43, 0.38, 0.75, 16, 1, true, -Math.PI * 0.55, Math.PI * 1.1), armor, torso, [0, 0.52, 0.0]).material = armor.clone();
    torso.children[torso.children.length - 1].material.side = THREE.DoubleSide;
    M(new THREE.TorusGeometry(0.2, 0.03, 8, 20), gold, torso, [0, 0.62, 0.36]);
    M(sph(0.06, 10, 8), ice, torso, [0, 0.62, 0.38]);
    // 龙鳞肩甲（层叠三片）
    [-1, 1].forEach(sd => { for (let k = 0; k < 3; k++) M(new THREE.SphereGeometry(0.3 - k * 0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), k % 2 ? scale : armor, torso, [sd * (0.5 + k * 0.05), 0.95 - k * 0.12, 0], [0, 0, sd * (-0.6 - k * 0.15)]); });
    // 背后冰晶脊
    const spine = G(torso, [0, 0.6, -0.32]);
    const crystals = [];
    for (let i = 0; i < 7; i++) { const c = M(new THREE.ConeGeometry(0.07 + (i % 3) * 0.02, 0.5 + (i % 3) * 0.25, 5), ice, spine, [(i % 2 ? 1 : -1) * (0.1 + (i % 3) * 0.05), 0.5 - i * 0.13, -0.05], [-0.6, 0, (i % 2 ? -1 : 1) * 0.4]); crystals.push(c); }
    const backL = G(torso, [0.38, 0.9, -0.2]), backR = G(torso, [-0.38, 0.9, -0.2]);

    const head = G(torso, [0, 1.12, 0.02]);
    M(sph(0.24), skin, head, [0, 0.04, 0], [0, 0, 0], [0.95, 1.12, 1]);
    M(sph(0.255), hair, head, [0, 0.1, -0.04], [0, 0, 0], [1.0, 0.95, 1.02]);
    M(new THREE.BoxGeometry(0.34, 0.03, 0.05), hair, head, [0, 0.1, 0.22], [0.2, 0, 0]);
    M(sph(0.022, 8, 6), eyeM, head, [-0.08, 0.04, 0.22]); M(sph(0.022, 8, 6), eyeM, head, [0.08, 0.04, 0.22]);
    M(new THREE.ConeGeometry(0.02, 0.07, 4), std(0x6ad8ff, 0.4, 0, { emissive: 0x2a9aff, emissiveIntensity: 1.5 }), head, [0, 0.12, 0.235], [0.1, 0, 0]);
    // 龙角（分叉）
    const horns = [];
    [-1, 1].forEach(sd => {
      const h = G(head, [sd * 0.12, 0.26, -0.02]); h.rotation.set(-0.5, 0, sd * -0.35);
      M(new THREE.ConeGeometry(0.045, 0.5, 6), horn, h, [0, 0.25, 0]);
      M(new THREE.ConeGeometry(0.03, 0.22, 5), horn, h, [sd * 0.06, 0.2, 0.02], [0, 0, sd * -0.8]);
      horns.push(h);
    });
    const hairPin = G(head, [0, 0.0, -0.22]);
    M(new THREE.TorusGeometry(0.1, 0.025, 6, 16), gold, head, [0, 0.2, -0.16], [Math.PI / 2 - 0.4, 0, 0]);

    function arm(side) {
      const sh = G(torso, [side * 0.55, 0.88, 0]);
      M(cap(0.11, 0.38), robe, sh, [0, -0.25, 0]);
      const el = G(sh, [0, -0.55, 0]);
      M(cap(0.09, 0.34), skin, el, [0, -0.2, 0]);
      M(new THREE.CylinderGeometry(0.12, 0.1, 0.32, 10), armor, el, [0, -0.25, 0]);
      const hand = G(el, [0, -0.5, 0]);
      M(sph(0.09), skin, hand, [0, 0, 0], [0, 0, 0], [1, 1.1, 0.9]);
      return { sh, el, hand };
    }
    const R = arm(-1), L = arm(1);
    // 冰锥长戟
    const spearPivot = G(R.hand), spear = G(spearPivot);
    const SL = 4.2, grip = 1.4;
    M(new THREE.CylinderGeometry(0.045, 0.05, SL, 10), armorDark, spear, [0, SL / 2 - grip, 0]);
    const bladeG = new THREE.ConeGeometry(0.16, 0.95, 5); bladeG.scale(1, 1, 0.35);
    M(bladeG, ice, spear, [0, SL - grip + 0.47, 0]);
    M(new THREE.ConeGeometry(0.08, 0.45, 5), ice, spear, [0.16, SL - grip + 0.1, 0], [0, 0, -0.9]);
    M(new THREE.ConeGeometry(0.08, 0.45, 5), ice, spear, [-0.16, SL - grip + 0.1, 0], [0, 0, 0.9]);
    M(new THREE.CylinderGeometry(0.09, 0.07, 0.2, 10), gold, spear, [0, SL - grip - 0.08, 0]);
    const tip = G(spear, [0, SL - grip + 0.95, 0]); const mid = G(spear, [0, 1.0, 0]);
    const iceM = new THREE.MeshBasicMaterial({ color: 0x8aeaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const fireSheath = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.1, SL * 0.7, 8, 1, true), iceM); fireSheath.position.set(0, SL * 0.35, 0); spear.add(fireSheath);

    function leg(side) {
      const hip = G(hips, [side * 0.22, -0.08, 0]);
      M(cap(0.15, 0.55), robeBlue, hip, [0, -0.4, 0]);
      const knee = G(hip, [0, -0.85, 0]);
      M(cap(0.12, 0.5), robeBlue, knee, [0, -0.35, 0]);
      M(new THREE.CylinderGeometry(0.15, 0.13, 0.42, 12), armor, knee, [0, -0.45, 0]);
      M(new THREE.BoxGeometry(0.2, 0.12, 0.38), armorDark, knee, [0, -0.78, 0.08]);
      return { hip, knee };
    }
    const LL = leg(1), RL = leg(-1);
    const flashMats = [];
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material !== eyeM && o.material !== iceM && o.material !== ice && !flashMats.includes(o.material)) flashMats.push(o.material); } });
    flashMats.forEach(m => { m.emissive = m.emissive || new THREE.Color(0); });

    // 飘动：龙尾（粗）、长发、披帛
    model.scale.setScalar(1.3);
    const fx = new THREE.Group();
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x6aa8d0, emissive: 0x0a2a3a, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
    const ribbons = [
      new Ribbon({ pinA: tailPin, n: 22, len: 3.2, width: 0.42, material: tailMat, gravity: -6, flutter: 3, taper: 0.9, twist: 0.3, back: 3 }),
      new Ribbon({ pinA: hairPin, n: 14, len: 1.3, width: 0.22, material: new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.5, side: THREE.DoubleSide }), gravity: -3, flutter: 4, taper: 0.6, twist: 0.4, back: 2.5 }),
      new Ribbon({ pinA: backL, pinB: backR, n: 26, len: 3.8, width: 0.3, material: silk, gravity: 0.6, flutter: 5, taper: 0.3, twist: 0.8, back: 4 }),
      new Ribbon({ pinA: L.el, n: 18, len: 2.4, width: 0.16, material: silk, gravity: -1.2, flutter: 5, taper: 0.6, twist: 1, back: 3 }),
    ];
    ribbons.forEach(r => fx.add(r.mesh));
    const wind = new THREE.Vector3(), backDir = new THREE.Vector3();
    let dragon = 0;
    return {
      root, model, hips, torso, head, rS: R.sh, rE: R.el, rH: R.hand, lS: L.sh, lE: L.el, lH: L.hand,
      staffPivot: spearPivot, staff: spear, tip, mid, lHip: LL.hip, lK: LL.knee, rHip: RL.hip, rK: RL.knee,
      baseHipY: BH, eyeM, fireM: iceM, flashMats, fx, ribbons, horns, crystals,
      setDragon(k) { dragon = k; horns.forEach(h => h.scale.setScalar(1 + k * 0.6)); crystals.forEach((c, i) => c.scale.setScalar(1 + k * (0.6 + (i % 3) * 0.3))); horn.emissiveIntensity = 0.6 + k * 2.5; },
      reset() { root.updateMatrixWorld(true); ribbons.forEach(r => r.reset()); this.setDragon(0); },
      update(dt, t) {
        root.updateMatrixWorld(true);
        wind.set(Math.sin(t * 0.6) * 1.0, 0, Math.cos(t * 0.45) * 0.8);
        root.getWorldDirection(backDir); backDir.negate();
        ribbons.forEach(r => r.update(dt, t, wind, backDir));
        if (dragon > 0) crystals.forEach((c, i) => c.material.emissiveIntensity = 0.9 + Math.sin(t * 6 + i) * 0.4 * dragon);
      },
    };
  }

  // ---------------- 巡海夜叉（小怪） ----------------
  // 设计要点：佝偻、长臂、鱼鳍头冠、墨绿皮肤 + 珊瑚骨刺；手持鱼叉。体型 ≈ 玩家 1.2 倍，剪影与 Boss 明显区分。
  function buildYaksha(seed = 1) {
    const skinC = [0x3a6a5a, 0x4a6a4a, 0x2f5a62][seed % 3];
    const skin = std(skinC, 0.55, 0.05, { map: furTexture('#2a4a40', 40 + seed) });
    const belly = std(0x8aa890, 0.6);
    const fin = new THREE.MeshStandardMaterial({ color: 0xc85a3a, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x200604 });
    const bone = std(0xe0d0b0, 0.6);
    const cloth = std(0x2a2a30, 0.9);
    const iron = std(0x5a6066, 0.4, 0.8);
    const eyeM = new THREE.MeshStandardMaterial({ color: 0xffe06a, emissive: 0xffb020, emissiveIntensity: 2.5 });
    const root = new THREE.Group(); const model = G(root);
    const BH = 1.05;
    const hips = G(model, [0, BH, 0]);
    M(sph(0.22), cloth, hips, [0, 0, 0], [0, 0, 0], [1.2, 0.8, 1]);
    M(new THREE.CylinderGeometry(0.24, 0.36, 0.42, 10, 1, true), cloth, hips, [0, -0.15, 0]).material = cloth.clone();
    hips.children[hips.children.length - 1].material.side = THREE.DoubleSide;
    const torso = G(hips, [0, 0.08, 0]);
    M(cap(0.24, 0.32), skin, torso, [0, 0.3, 0.04], [0.25, 0, 0], [1.2, 1, 0.95]);
    M(sph(0.2), belly, torso, [0, 0.22, 0.17], [0, 0, 0], [1.1, 1.1, 0.6]);
    for (let i = 0; i < 5; i++) M(new THREE.ConeGeometry(0.04, 0.26 - i * 0.02, 5), bone, torso, [0, 0.55 - i * 0.1, -0.2 - i * 0.02], [-1.0, 0, 0]);
    const head = G(torso, [0, 0.62, 0.14]);
    M(sph(0.2), skin, head, [0, 0, 0], [0, 0, 0], [1.05, 0.9, 1.2]);
    M(sph(0.13), skin, head, [0, -0.08, 0.15], [0, 0, 0], [1.2, 0.6, 1]);
    for (let i = 0; i < 6; i++) M(new THREE.ConeGeometry(0.018, 0.07, 4), bone, head, [(i - 2.5) * 0.04, -0.12, 0.26], [Math.PI, 0, 0]);
    M(sph(0.035, 8, 6), eyeM, head, [-0.09, 0.04, 0.17]); M(sph(0.035, 8, 6), eyeM, head, [0.09, 0.04, 0.17]);
    const finG = new THREE.ConeGeometry(0.25, 0.5, 3, 1, true); finG.scale(0.15, 1, 1);
    M(finG, fin, head, [0, 0.22, -0.05], [-0.4, 0, 0]);
    [-1, 1].forEach(sd => M(finG, fin, head, [sd * 0.18, 0.02, -0.02], [0, 0, sd * 1.2], [0.7, 0.7, 0.7]));
    function arm(side) {
      const sh = G(torso, [side * 0.3, 0.45, 0.06]);
      M(cap(0.07, 0.3), skin, sh, [0, -0.2, 0]);
      const el = G(sh, [0, -0.42, 0]);
      M(cap(0.06, 0.3), skin, el, [0, -0.18, 0]);
      M(new THREE.TorusGeometry(0.07, 0.02, 6, 12), iron, el, [0, -0.1, 0], [Math.PI / 2, 0, 0]);
      const hand = G(el, [0, -0.4, 0]);
      M(sph(0.07), skin, hand); for (let k = 0; k < 3; k++) M(new THREE.ConeGeometry(0.018, 0.1, 4), bone, hand, [(k - 1) * 0.04, -0.08, 0.04], [Math.PI * 0.8, 0, 0]);
      return { sh, el, hand };
    }
    const R = arm(-1), L = arm(1);
    const spearPivot = G(R.hand), spear = G(spearPivot);
    const SL = 2.4, grip = 0.9;
    M(new THREE.CylinderGeometry(0.03, 0.03, SL, 8), std(0x4a3a2a, 0.8), spear, [0, SL / 2 - grip, 0]);
    [-1, 0, 1].forEach(k => M(new THREE.ConeGeometry(0.03, 0.3, 4), iron, spear, [k * 0.07, SL - grip + 0.12, 0], [0, 0, -k * 0.15]));
    M(new THREE.BoxGeometry(0.2, 0.04, 0.04), iron, spear, [0, SL - grip - 0.02, 0]);
    const tip = G(spear, [0, SL - grip + 0.28, 0]); const mid = G(spear, [0, 0.4, 0]);
    function leg(side) {
      const hip = G(hips, [side * 0.14, -0.05, 0]);
      M(cap(0.09, 0.3), skin, hip, [0, -0.22, 0]);
      const knee = G(hip, [0, -0.48, 0]);
      M(cap(0.075, 0.3), skin, knee, [0, -0.2, 0]);
      M(new THREE.BoxGeometry(0.14, 0.06, 0.26), skin, knee, [0, -0.46, 0.06]);
      return { hip, knee };
    }
    const LL = leg(1), RL = leg(-1);
    const flashMats = [];
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material !== eyeM && !flashMats.includes(o.material)) flashMats.push(o.material); } });
    flashMats.forEach(m => { m.emissive = m.emissive || new THREE.Color(0); m.userData.base = m.emissive.clone(); });
    return { root, model, hips, torso, head, rS: R.sh, rE: R.el, rH: R.hand, lS: L.sh, lE: L.el, lH: L.hand, staffPivot: spearPivot, staff: spear, tip, mid, lHip: LL.hip, lK: LL.knee, rHip: RL.hip, rK: RL.knee, baseHipY: BH, eyeM, flashMats };
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
    if (rig.hover) rig.hover.apply(rig, p, extra); // 悬浮角色叠加程序化浮动层
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
  return { buildPlayer, buildNezha, buildBoss, buildAoBing, buildYaksha, applyPose, blendPose, keyframes, zeroPose, ease };
})();
