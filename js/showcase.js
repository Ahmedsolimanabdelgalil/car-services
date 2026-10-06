/* 3D showcase: one precision part per stage, presented like jewellery.
   Stage 0 gears (hero) · 1 piston · 2 brake · 3 wheel · 4 spark plug · 5 fan · 6 oil filter */
(function () {
  'use strict';

  var SITE = window.SITE, THREE = window.THREE;
  var canvas = document.getElementById('scene');
  var renderer;

  try {
    if (!THREE) throw new Error('three.js not loaded');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    document.documentElement.classList.add('no-3d');
    SITE.hideLoader();
    return;
  }

  var isMobile = window.matchMedia('(max-width: 860px)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0, 8);
  var TAU = Math.PI * 2;

  /* ---------------- textures ---------------- */
  function radialTexture(stops, size) {
    size = size || 256;
    var c = document.createElement('canvas'); c.width = c.height = size;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (s) { grd.addColorStop(s[0], s[1]); });
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  // concentric machining marks (for faces cut on a lathe), used as roughness
  var ringsCanvas = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 1024;
    var g = c.getContext('2d'); g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 1024, 1024);
    for (var r = 1; r < 724; r += 0.7) {
      var v = 70 + Math.floor(Math.random() * 150);
      g.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.lineWidth = 0.5 + Math.random();
      g.beginPath(); g.arc(512, 512, r, 0, TAU); g.stroke();
    }
    return c;
  })();
  function ringsTexture(radius) {            // maps extrude UVs (= x,y in model units) onto the canvas
    var t = new THREE.CanvasTexture(ringsCanvas);
    t.repeat.set(0.5 / radius, 0.5 / radius); t.offset.set(0.5, 0.5);
    t.anisotropy = 8; return t;
  }
  // straight brushed lines (for turned cylinders: lathe UVs run along the profile)
  var linesTexture = (function () {
    var c = document.createElement('canvas'); c.width = 8; c.height = 1024;
    var g = c.getContext('2d');
    for (var y = 0; y < 1024; y++) { var v = 80 + Math.floor(Math.random() * 140); g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(0, y, 8, 1); }
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();

  /* ---------------- geometry helpers ---------------- */
  // average normals across faces meeting at less than `deg`; keeps machined edges crisp
  function smoothNormals(geo, deg) {
    if (geo.index) geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    var pos = geo.attributes.position, nor = geo.attributes.normal;
    var cos = Math.cos((deg || 35) * Math.PI / 180), groups = new Map(), i, key;
    for (i = 0; i < pos.count; i++) {
      key = Math.round(pos.getX(i) * 3000) + '_' + Math.round(pos.getY(i) * 3000) + '_' + Math.round(pos.getZ(i) * 3000);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    var src = nor.array.slice(), out = nor.array;
    groups.forEach(function (ids) {
      for (var a = 0; a < ids.length; a++) {
        var ia = ids[a] * 3, x = 0, y = 0, z = 0;
        for (var b = 0; b < ids.length; b++) {
          var ib = ids[b] * 3;
          if (src[ia] * src[ib] + src[ia + 1] * src[ib + 1] + src[ia + 2] * src[ib + 2] > cos) { x += src[ib]; y += src[ib + 1]; z += src[ib + 2]; }
        }
        var l = Math.sqrt(x * x + y * y + z * z) || 1;
        out[ia] = x / l; out[ia + 1] = y / l; out[ia + 2] = z / l;
      }
    });
    return geo;
  }
  function lathe(pts, seg, deg) {            // profile [[radius, y], ...] revolved around Y
    return smoothNormals(new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 72), deg || 35);
  }
  function extrude(shape, depth, bevel, curveSeg) {   // centred on z = 0
    bevel = bevel || 0;
    var g = new THREE.ExtrudeGeometry(shape, {
      depth: depth - 2 * bevel, curveSegments: curveSeg || 24,
      bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2
    });
    g.translate(0, 0, -depth / 2 + bevel);
    return smoothNormals(g, 35);
  }
  function circle(path, cx, cy, r, n) {      // polygonal circle so segment count is per-feature
    for (var i = 0; i <= n; i++) {
      var a = i / n * TAU, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i) path.lineTo(x, y); else path.moveTo(x, y);
    }
    return path;
  }
  function hole(cx, cy, r, n) { return circle(new THREE.Path(), cx, cy, r, n || 24); }
  function cyl(r, h, seg, axis) {            // axis: 'z' (default) or 'y'
    var g = new THREE.CylinderGeometry(r, r, h, seg || 32);
    if (axis !== 'y') g.rotateX(Math.PI / 2);
    return g;
  }
  function add(parent, geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m;
  }

  /* ---------------- studio environment ---------------- */
  (function () {
    var env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), new THREE.MeshBasicMaterial({ color: 0x07080b, side: THREE.BackSide })));
    function panel(w, h, color, power, x, y, z) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    }
    panel(12, 6, 0xffffff, 9, 0, 9, 2);          // overhead softbox
    panel(1.6, 12, 0xffffff, 12, -9, 1, 5);      // left strip
    panel(1.6, 12, 0xdbe8ff, 9, 9, 1, 3);        // right strip (cool)
    panel(10, 5, 0xffffff, 1.6, 0, 1, 12);       // soft fill behind the camera
    panel(14, 1.2, 0xff2a1a, 7, 0, -6, -6);      // red kicker from below/behind
    panel(1.2, 9, 0xffffff, 6, 5, 3, -10);       // back rim
    var pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  })();

  var keyLight = new THREE.DirectionalLight(0xffffff, 1.6); keyLight.position.set(3, 5, 6); scene.add(keyLight);
  var rimLight = new THREE.DirectionalLight(0xff3a28, 2.2); rimLight.position.set(-5, -2, -4); scene.add(rimLight);

  /* ---------------- materials ---------------- */
  function std(o) { return new THREE.MeshStandardMaterial(o); }
  function phys(o) { return new THREE.MeshPhysicalMaterial(o); }
  var M = {
    chrome: std({ color: 0xe8ecf2, metalness: 1, roughness: 0.07 }),
    steel: std({ color: 0xb9bfc8, metalness: 1, roughness: 0.3 }),
    turned: std({ color: 0xc6ccd4, metalness: 1, roughness: 0.6, roughnessMap: linesTexture }),
    alu: std({ color: 0xd4d8de, metalness: 1, roughness: 0.42 }),
    gun: std({ color: 0x2b2e35, metalness: 1, roughness: 0.28 }),
    black: std({ color: 0x0b0c0f, metalness: 0.6, roughness: 0.38 }),
    rubber: std({ color: 0x0a0a0b, metalness: 0, roughness: 0.88 }),
    red: phys({ color: 0xc8101e, metalness: 0.35, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
    ceramic: phys({ color: 0xf2f0ea, metalness: 0, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }),
    gold: std({ color: 0xe0a431, metalness: 1, roughness: 0.2 }),
    oil: phys({ color: 0xf0a020, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0, emissive: 0xc86a00, emissiveIntensity: 0.45 })
  };
  function faced(radius, o) {                 // machined face with concentric marks
    o = o || {};
    return std({ color: o.color || 0xb2b8c1, metalness: 1, roughness: o.roughness || 0.62, roughnessMap: ringsTexture(radius) });
  }

  /* ================================================================
     Parts — each returns { group, update(time, dt) }
     ================================================================ */
  var builders = [];

  // ---------- 0. gear train ----------
  function gearShape(N, rp, bore, lighten) {
    var m = 2 * rp / N, ro = rp + m, rr = rp - 1.2 * m, p = TAU / N, s = new THREE.Shape(), first = true;
    function pt(r, a) { var x = r * Math.cos(a), y = r * Math.sin(a); if (first) { s.moveTo(x, y); first = false; } else s.lineTo(x, y); }
    for (var k = 0; k < N; k++) {
      var a = k * p;
      pt(rr, a); pt(rr, a + 0.2 * p); pt(rp, a + 0.29 * p); pt(ro, a + 0.37 * p);
      pt(ro, a + 0.63 * p); pt(rp, a + 0.71 * p); pt(rr, a + 0.8 * p);
    }
    s.closePath();
    s.holes.push(hole(0, 0, bore, 32));
    if (lighten) for (var i = 0; i < lighten.n; i++) {
      var b = i / lighten.n * TAU;
      s.holes.push(hole(Math.cos(b) * lighten.at, Math.sin(b) * lighten.at, lighten.r, 28));
    }
    return s;
  }
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.scale.setScalar(0.72); inner.position.set(-0.05, 0.3, 0); inner.rotation.set(0.12, -0.5, 0);

    var defs = [
      { N: 24, rp: 1.2, bore: 0.2, lighten: { n: 6, at: 0.66, r: 0.21 }, depth: 0.3, mat: faced(1.3), x: -0.45, y: -0.25 },
      { N: 12, rp: 0.6, bore: 0.14, depth: 0.36, mat: faced(0.7, { color: 0x3a3d45, roughness: 0.5 }), from: 35 },
      { N: 10, rp: 0.5, bore: 0.12, depth: 0.36, mat: faced(0.6, { color: 0xd9a53a, roughness: 0.45 }), from: -62 }
    ];
    var gears = defs.map(function (d, i) {
      var g = new THREE.Group();
      if (i === 0) g.position.set(d.x, d.y, 0);
      else {
        var phi = d.from * Math.PI / 180, dist = defs[0].rp + d.rp;
        g.position.set(defs[0].x + Math.cos(phi) * dist, defs[0].y + Math.sin(phi) * dist, 0);
        d.phi = phi;
      }
      add(g, extrude(gearShape(d.N, d.rp, d.bore, d.lighten), d.depth, 0.018), d.mat);
      add(g, cyl(d.bore * 1.9, d.depth + 0.12, 40), M.steel);                 // hub boss
      add(g, cyl(d.bore * 0.98, d.depth + 0.5, 32), M.chrome);                // shaft
      add(g, cyl(d.bore * 0.55, d.depth + 0.56, 6), i === 0 ? M.red : M.gun); // hex key
      inner.add(g);
      return g;
    });
    return {
      group: group,
      update: function (t) {
        var a = t * 0.22, N1 = defs[0].N, p1 = TAU / N1;
        gears[0].rotation.z = a;
        for (var i = 1; i < gears.length; i++) {
          var d = defs[i];
          gears[i].rotation.z = (d.phi + Math.PI) - (a + 0.5 * p1 - d.phi) * N1 / d.N;
        }
      }
    };
  });

  // ---------- 1. piston + connecting rod ----------
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.position.set(0, 0.78, 0); inner.rotation.z = 0.28;
    var spin = new THREE.Group(); inner.add(spin);

    var R = 0.6, prof = [[0, 0.5], [0.3, 0.5], [0.34, 0.47], [0.52, 0.47], [0.56, 0.5], [0.575, 0.5], [R, 0.47]];
    [0.4, 0.3, 0.2].forEach(function (y) { prof.push([R, y + 0.02], [R - 0.04, y + 0.02], [R - 0.04, y - 0.025], [R, y - 0.025]); });
    prof.push([R, -0.4], [R - 0.02, -0.43], [R - 0.07, -0.43], [R - 0.07, 0.28], [0, 0.28]);
    add(spin, lathe(prof, 96), M.turned);
    [0.4, 0.3].forEach(function (y) { add(spin, cyl(R - 0.004, 0.036, 96, 'y'), M.gun, 0, y - 0.002, 0); });
    add(spin, cyl(R - 0.004, 0.036, 96, 'y'), M.black, 0, 0.198, 0);
    add(spin, cyl(0.15, 2 * R + 0.012, 40), M.chrome);                        // wrist pin
    add(spin, cyl(0.1, 2 * R + 0.02, 32), M.gun);

    // connecting rod (I-beam silhouette)
    var L = 1.7, r1 = 0.24, r2 = 0.44, s = new THREE.Shape();
    s.moveTo(r1 * Math.cos(-Math.PI / 3), r1 * Math.sin(-Math.PI / 3));
    s.absarc(0, 0, r1, -Math.PI / 3, Math.PI * 4 / 3, false);
    s.lineTo(r2 * Math.cos(Math.PI * 2 / 3), -L + r2 * Math.sin(Math.PI * 2 / 3));
    s.absarc(0, -L, r2, Math.PI * 2 / 3, Math.PI / 3 + TAU, false);
    s.closePath();
    s.holes.push(hole(0, 0, 0.15, 32), hole(0, -L, 0.29, 40));
    add(spin, extrude(s, 0.24, 0.03, 40), M.steel);
    var web = new THREE.Shape();
    web.moveTo(-0.06, -0.34); web.lineTo(0.06, -0.34); web.lineTo(0.11, -L + 0.52); web.lineTo(-0.11, -L + 0.52); web.closePath();
    add(spin, extrude(web, 0.26, 0.02), M.gun);
    var shell = new THREE.CylinderGeometry(0.285, 0.285, 0.3, 48, 1, true); shell.rotateX(Math.PI / 2);
    var shellMat = M.gold.clone(); shellMat.side = THREE.DoubleSide;
    add(spin, shell, shellMat, 0, -L, 0);                                     // bearing shell
    [1, -1].forEach(function (sx) {
      add(spin, cyl(0.05, 0.5, 6, 'y'), M.gun, sx * 0.53, -L, 0);
      add(spin, new THREE.BoxGeometry(0.16, 0.5, 0.2), M.steel, sx * 0.5, -L, 0);
    });
    return {
      group: group,
      update: function (t) { spin.rotation.y = t * 0.35; inner.position.y = 0.78 + Math.sin(t * 1.1) * 0.05; }
    };
  });

  // ---------- 2. drilled brake disc + caliper ----------
  function discShape(ro, ri, drilled) {
    var s = new THREE.Shape(); circle(s, 0, 0, ro, 128); s.holes.push(hole(0, 0, ri, 96));
    if (drilled) for (var i = 0; i < 18; i++) for (var j = 0; j < 3; j++) {
      var a = i / 18 * TAU + j * 0.085, r = ri + (ro - ri) * (0.22 + j * 0.28);
      s.holes.push(hole(Math.cos(a) * r, Math.sin(a) * r, 0.026, 10));
    }
    return s;
  }
  function caliperShape(r0, r1, a0, a1) {
    var s = new THREE.Shape();
    s.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
    s.absarc(0, 0, r1, a0, a1, false);
    s.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1));
    s.absarc(0, 0, r0, a1, a0, true);
    s.closePath();
    return s;
  }
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.scale.setScalar(1.22); inner.rotation.set(0.1, -0.55, 0);
    var rotor = new THREE.Group(); inner.add(rotor);
    var face = faced(1.0, { roughness: 0.7 });
    var plate = extrude(discShape(1.0, 0.56, true), 0.045, 0.006, 10);
    add(rotor, plate, face, 0, 0, 0.05); add(rotor, plate, face, 0, 0, -0.05);
    var vent = new THREE.CylinderGeometry(0.985, 0.985, 0.06, 96, 1, true); vent.rotateX(Math.PI / 2);
    add(rotor, vent, M.black);
    for (var i = 0; i < 36; i++) {                                           // cooling vanes
      var v = add(rotor, new THREE.BoxGeometry(0.4, 0.012, 0.06), M.gun);
      var a = i / 36 * TAU; v.position.set(Math.cos(a) * 0.79, Math.sin(a) * 0.79, 0); v.rotation.z = a + 0.35;
    }
    // hat (bell) with lug holes
    var hatWall = new THREE.CylinderGeometry(0.46, 0.5, 0.2, 72, 1, true); hatWall.rotateX(Math.PI / 2);
    add(rotor, hatWall, M.gun, 0, 0, 0.16);
    add(rotor, extrude(discShape(0.58, 0.44, false), 0.03, 0.004), M.gun, 0, 0, 0.065);
    var hs = new THREE.Shape(); circle(hs, 0, 0, 0.465, 72); hs.holes.push(hole(0, 0, 0.17, 40));
    for (var k = 0; k < 5; k++) { var b = k / 5 * TAU + 0.3; hs.holes.push(hole(Math.cos(b) * 0.31, Math.sin(b) * 0.31, 0.045, 16)); }
    add(rotor, extrude(hs, 0.03, 0.006), faced(0.47, { color: 0x4a4e57, roughness: 0.5 }), 0, 0, 0.25);

    // caliper (fixed)
    var a0 = 18 * Math.PI / 180, a1 = 92 * Math.PI / 180;
    add(inner, extrude(caliperShape(0.6, 1.13, a0, a1), 0.4, 0.045, 40), M.red);
    add(inner, extrude(caliperShape(0.94, 1.16, a0 + 0.12, a1 - 0.12), 0.2, 0.02, 30), M.black);   // pad window
    [34, 55, 76].forEach(function (deg) {
      var c = deg * Math.PI / 180;
      add(inner, cyl(0.085, 0.05, 28), M.gun, Math.cos(c) * 0.8, Math.sin(c) * 0.8, 0.2);
      add(inner, cyl(0.05, 0.07, 6), M.chrome, Math.cos(c) * 0.8, Math.sin(c) * 0.8, 0.2);
    });
    return { group: group, update: function (t) { rotor.rotation.z = -t * 0.45; } };
  });

  // ---------- 3. alloy wheel + tyre ----------
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.scale.setScalar(1.2); inner.rotation.set(0.06, -0.6, 0);
    var spin = new THREE.Group(); inner.add(spin);

    // tyre profile with circumferential grooves
    var tp = [[0.66, -0.3], [0.8, -0.32], [0.93, -0.31], [0.985, -0.27], [1.0, -0.21]];
    [-0.14, -0.047, 0.047, 0.14].forEach(function (z) { tp.push([1.0, z - 0.016], [0.965, z - 0.016], [0.965, z + 0.016], [1.0, z + 0.016]); });
    tp.push([1.0, 0.21], [0.985, 0.27], [0.93, 0.31], [0.8, 0.32], [0.66, 0.3]);
    var tyre = lathe(tp, 96, 50); tyre.rotateX(Math.PI / 2);
    add(spin, tyre, M.rubber);
    for (var i = 0; i < 60; i++) {                                           // shoulder tread blocks
      var a = i / 60 * TAU;
      [1, -1].forEach(function (sd) {
        var b = add(spin, new THREE.BoxGeometry(0.03, 0.05, 0.1), M.rubber, Math.cos(a) * 0.985, Math.sin(a) * 0.985, sd * 0.235);
        b.rotation.z = a; b.rotation.x = sd * 0.25;
      });
    }
    var barrel = lathe([[0.675, -0.3], [0.65, -0.29], [0.64, -0.22], [0.6, -0.1], [0.6, 0.12], [0.64, 0.22], [0.65, 0.29], [0.675, 0.3]], 96, 60);
    barrel.rotateX(Math.PI / 2);
    var barrelMat = M.chrome.clone(); barrelMat.side = THREE.DoubleSide; barrelMat.roughness = 0.16;
    add(spin, barrel, barrelMat);

    // spoke face: disc with ten windows cut out
    var NS = 10, w = 0.036, rIn = 0.2, rOut = 0.585, face = new THREE.Shape(); circle(face, 0, 0, 0.655, 128);
    for (var k = 0; k < NS; k++) {
      var c0 = k / NS * TAU, c1 = (k + 1) / NS * TAU, so = Math.asin(w / rOut), si = Math.asin(w / rIn), h = new THREE.Path();
      h.moveTo(rOut * Math.cos(c0 + so), rOut * Math.sin(c0 + so));
      h.absarc(0, 0, rOut, c0 + so, c1 - so, false);
      h.lineTo(rIn * Math.cos(c1 - si), rIn * Math.sin(c1 - si));
      h.absarc(0, 0, rIn, c1 - si, c0 + si, true);
      h.closePath(); face.holes.push(h);
    }
    add(spin, extrude(face, 0.07, 0.022, 14), std({ color: 0xdfe3e9, metalness: 1, roughness: 0.2 }), 0, 0, 0.2);
    add(spin, cyl(0.2, 0.1, 48), M.gun, 0, 0, 0.21);
    add(spin, cyl(0.095, 0.03, 40), M.red, 0, 0, 0.265);
    for (var j = 0; j < 5; j++) { var la = j / 5 * TAU; add(spin, cyl(0.026, 0.05, 6), M.chrome, Math.cos(la) * 0.15, Math.sin(la) * 0.15, 0.255); }

    // brake visible through the spokes
    add(spin, extrude(discShape(0.53, 0.2, true), 0.05, 0.005, 8), faced(0.53, { roughness: 0.7 }), 0, 0, 0.04);
    add(inner, extrude(caliperShape(0.34, 0.585, 0.5, 1.6), 0.16, 0.02, 24), M.red, 0, 0, 0.05);
    return { group: group, update: function (t) { spin.rotation.z = -t * 0.5; } };
  });

  // ---------- 4. spark plug ----------
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.scale.setScalar(1.05); inner.position.set(0.05, 0.1, 0); inner.rotation.z = -0.62;
    var spin = new THREE.Group(); inner.add(spin);

    var th = [[0, -1.2], [0.19, -1.2]];
    for (var y = -1.2; y < -0.52; y += 0.045) th.push([0.225, y + 0.0225], [0.19, y + 0.045]);
    th.push([0.225, -0.5], [0.34, -0.5], [0.34, -0.43], [0.3, -0.42]);
    add(spin, lathe(th, 64, 25), M.steel);
    add(spin, cyl(0.38, 0.3, 6, 'y'), std({ color: 0xc4c9d1, metalness: 1, roughness: 0.25 }), 0, -0.27, 0);
    add(spin, lathe([[0.3, -0.13], [0.3, 0.0], [0.27, 0.05], [0, 0.05]], 64), M.steel);

    var ce = [[0.25, 0.04], [0.24, 0.32]];
    for (var i = 0; i < 5; i++) { var cy = 0.36 + i * 0.1; ce.push([0.205, cy], [0.235, cy + 0.035], [0.235, cy + 0.065], [0.205, cy + 0.1]); }
    ce.push([0.17, 0.9], [0.15, 0.94], [0, 0.94]);
    add(spin, lathe(ce, 64, 50), M.ceramic);
    add(spin, lathe([[0.075, 0.94], [0.075, 1.02], [0.12, 1.04], [0.125, 1.16], [0.09, 1.2], [0, 1.2]], 40), M.chrome);
    add(spin, lathe([[0.19, -1.2], [0.09, -1.3], [0, -1.3]], 40), M.ceramic);          // insulator nose
    add(spin, cyl(0.035, 0.1, 16, 'y'), M.gold, 0, -1.33, 0);                          // centre electrode
    add(spin, new THREE.BoxGeometry(0.05, 0.26, 0.09), M.steel, 0.2, -1.31, 0);        // ground strap
    add(spin, new THREE.BoxGeometry(0.25, 0.045, 0.09), M.steel, 0.1, -1.455, 0);

    var sparkTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(150,200,255,.8)'], [1, 'rgba(60,120,255,0)']], 128);
    var spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    spark.position.set(0.02, -1.405, 0); spin.add(spark);
    var light = new THREE.PointLight(0x7fb8ff, 0, 3); light.position.copy(spark.position); spin.add(light);
    return {
      group: group,
      update: function (t) {
        spin.rotation.y = t * 0.4;
        var f = Math.max(0, Math.sin(t * 37) * Math.sin(t * 11.3) + 0.25 * Math.sin(t * 71));
        spark.scale.setScalar(0.25 + f * 0.55); spark.material.opacity = 0.35 + f * 0.65; light.intensity = f * 6;
      }
    };
  });

  // ---------- 5. A/C blower fan ----------
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.scale.setScalar(1.18); inner.rotation.set(0.15, -0.6, 0);
    var rotor = new THREE.Group(); inner.add(rotor);

    var L = 0.66, C = 0.44, blade = new THREE.BoxGeometry(L, 0.022, C, 12, 1, 8), p = blade.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var u = p.getX(i) / L + 0.5, y = p.getY(i), z = p.getZ(i);
      y += 0.07 * (1 - Math.pow(2 * z / C, 2));                              // camber
      var tw = 1.05 - 0.6 * u, cy = Math.cos(tw), sy = Math.sin(tw);         // twist root -> tip
      var y2 = y * cy - z * sy, z2 = y * sy + z * cy;
      var r = 0.3 + u * L, sw = 0.4 * u * u, cs = Math.cos(sw), sn = Math.sin(sw);   // sweep
      p.setXYZ(i, r * cs - y2 * sn, r * sn + y2 * cs, z2);
    }
    blade.computeVertexNormals();
    var bladeMat = std({ color: 0xd5d9df, metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
    for (var k = 0; k < 11; k++) { var b = add(rotor, blade, bladeMat); b.rotation.z = k / 11 * TAU; }
    var hub = lathe([[0, 0.34], [0.1, 0.32], [0.22, 0.22], [0.3, 0.05], [0.31, -0.24], [0, -0.24]], 64, 50); hub.rotateX(Math.PI / 2);
    add(rotor, hub, M.chrome);
    var tip = lathe([[0, 0.345], [0.07, 0.335], [0.1, 0.325]], 32, 60); tip.rotateX(Math.PI / 2);
    add(rotor, tip, M.red);

    var shroud = lathe([[1.0, -0.3], [1.06, -0.32], [1.1, -0.28], [1.1, 0.28], [1.06, 0.32], [1.0, 0.3], [0.985, 0.0], [1.0, -0.3]], 128, 40);
    shroud.rotateX(Math.PI / 2);
    add(inner, shroud, M.black);
    var lip = new THREE.TorusGeometry(1.085, 0.022, 12, 128);
    add(inner, lip, M.chrome, 0, 0, 0.31);
    for (var s = 0; s < 3; s++) { var st = add(inner, new THREE.BoxGeometry(1.0, 0.07, 0.03), M.gun, 0, 0, -0.26); st.rotation.z = s / 3 * Math.PI; }

    // cool air stream
    var N = 160, seed = new Float32Array(N * 3), pos = new Float32Array(N * 3);
    for (var q = 0; q < N * 3; q++) seed[q] = Math.random();
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var air = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.05, map: radialTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 64),
      color: 0x8fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    air.frustumCulled = false; inner.add(air);
    return {
      group: group,
      update: function (t) {
        rotor.rotation.z = -t * 2.4;
        for (var i = 0; i < N; i++) {
          var u = (seed[i * 3] + t * (0.16 + seed[i * 3 + 1] * 0.12)) % 1, a = seed[i * 3 + 2] * TAU + u * 2.2, r = 0.25 + seed[i * 3 + 1] * 0.7 + u * 0.3;
          pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r; pos[i * 3 + 2] = 0.35 + u * 2.6;
        }
        g.attributes.position.needsUpdate = true;
      }
    };
  });

  // ---------- 6. oil filter + drops ----------
  builders.push(function () {
    var group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
    inner.scale.setScalar(1.12); inner.position.set(-0.25, 0, 0); inner.rotation.z = 0.2;
    var spin = new THREE.Group(); inner.add(spin);

    add(spin, lathe([[0, 0.92], [0.3, 0.92], [0.42, 0.88], [0.5, 0.8], [0.52, 0.74]], 14, 20), M.black);       // fluted grip cap
    add(spin, cyl(0.52, 0.22, 14, 'y'), M.black, 0, 0.63, 0);
    add(spin, lathe([[0.535, 0.52], [0.55, 0.5], [0.55, -0.62], [0.535, -0.64]], 96), std({ color: 0x101114, metalness: 0.7, roughness: 0.5, roughnessMap: linesTexture }));
    add(spin, cyl(0.556, 0.09, 96, 'y'), M.gold, 0, 0.3, 0);
    add(spin, cyl(0.556, 0.03, 96, 'y'), M.red, 0, 0.2, 0);
    add(spin, lathe([[0.535, -0.64], [0.57, -0.66], [0.57, -0.74], [0.5, -0.78], [0.3, -0.78], [0.3, -0.7], [0.16, -0.7], [0.16, -0.78], [0, -0.78]], 96), M.chrome);
    add(spin, new THREE.TorusGeometry(0.44, 0.035, 12, 72).rotateX(Math.PI / 2), M.rubber, 0, -0.79, 0);       // gasket
    add(spin, cyl(0.1, 0.06, 6, 'y'), M.steel, 0, 0.95, 0);

    var dp = [];
    for (var i = 0; i <= 28; i++) { var th = i / 28 * Math.PI; dp.push([0.36 * Math.sin(th) * Math.pow(Math.sin(th / 2), 1.3), 0.6 * Math.cos(th)]); }
    var dropGeo = lathe(dp, 48, 70);
    var drops = [[1.05, 0.25, 0.3, 0.9], [1.45, 1.1, -0.2, 0.42], [0.85, 1.3, 0.1, 0.3]].map(function (d) {
      var m = add(inner, dropGeo, M.oil, d[0], d[1], d[2]); m.scale.setScalar(d[3]); m.rotation.z = -0.2; m.userData = d; return m;
    });
    return {
      group: group,
      update: function (t) {
        spin.rotation.y = t * 0.3;
        drops.forEach(function (m, i) {
          var d = m.userData, f = (t * 0.22 + i * 0.37) % 1;
          m.position.y = d[1] + 0.5 - f * 1.4;
          m.scale.setScalar(d[3] * Math.min(1, f * 6) * Math.min(1, (1 - f) * 6));
        });
      }
    };
  });

  /* ---------------- stage: parts + backdrop ---------------- */
  var stage = new THREE.Group(); scene.add(stage);
  var parts = builders.map(function (b) { var p = b(); p.group.visible = false; stage.add(p.group); return p; });

  // instrument dial behind the part
  var dial = new THREE.Group(); dial.position.z = -1.6; scene.add(dial);
  var lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  dial.add(new THREE.Mesh(new THREE.RingGeometry(2.16, 2.168, 160), lineMat));
  dial.add(new THREE.Mesh(new THREE.RingGeometry(2.62, 2.624, 160), lineMat));
  (function () {
    var v = [];
    for (var i = 0; i < 120; i++) {
      var a = i / 120 * TAU, r0 = 2.24, r1 = i % 10 === 0 ? 2.42 : (i % 5 === 0 ? 2.34 : 2.29);
      v.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    dial.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })));
    var arc = new THREE.Mesh(new THREE.RingGeometry(2.5, 2.53, 64, 1, 0, 1.1), new THREE.MeshBasicMaterial({ color: 0xe5202e, transparent: true, opacity: 0.9, depthWrite: false }));
    dial.add(arc);
  })();
  var halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(229,32,46,.42)'], [0.45, 'rgba(229,32,46,.12)'], [1, 'rgba(229,32,46,0)']]),
    transparent: true, depthWrite: false
  }));
  halo.position.z = -2.5; halo.scale.setScalar(8.5); scene.add(halo);

  /* ---------------- frame loop ---------------- */
  var SX = [-0.2, -0.2, 0.2, -0.2, 0.2, -0.2, 0.2];     // framing: negative = part sits on the left
  var W = 0, H = 0, fit = 1;
  function resize() {
    W = window.innerWidth; H = window.innerHeight; isMobile = W <= 860;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    fit = isMobile ? Math.min(0.8, Math.max(0.52, camera.aspect * 1.3)) : Math.min(1, Math.max(0.62, camera.aspect * 0.62));
  }
  resize();
  window.addEventListener('resize', resize);

  var pointer = { x: 0, y: 0 }, tilt = { x: 0, y: 0 };
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX / W * 2 - 1; pointer.y = e.clientY / H * 2 - 1;
  }, { passive: true });

  var clock = new THREE.Clock(), time = 0, curT = SITE.stageT(), curSx = SX[0], started = false;

  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, clock.getDelta());
    if (document.hidden || window.scrollY > SITE.journeyEnd()) return;        // canvas is covered
    if (!SITE.reduceMotion) time += dt;

    var k = SITE.reduceMotion ? 1 : 1 - Math.exp(-dt * 5);
    var t = SITE.stageT();
    curT += (t - curT) * k;
    var i0 = Math.min(SX.length - 2, Math.floor(t)), f = t - i0;
    curSx += ((SX[i0] + (SX[i0 + 1] - SX[i0]) * f) - curSx) * k;
    tilt.x += (pointer.y * 0.16 - tilt.x) * k * 0.6;
    tilt.y += (pointer.x * 0.3 - tilt.y) * k * 0.6;

    parts.forEach(function (p, i) {
      var d = curT - i, ad = Math.abs(d);
      p.group.visible = ad < 0.98;
      if (!p.group.visible) return;
      p.group.position.y = d * 4.4;                                          // rides up with the scroll
      p.group.scale.setScalar(fit * (1 - 0.4 * ad) * (isMobile && i === 0 ? 0.82 : 1));
      p.group.rotation.set(tilt.x + d * 0.5, tilt.y + d * 1.5, 0);
      p.update(time, dt);
    });

    dial.scale.setScalar(fit);
    dial.rotation.z = -curT * 0.7 + time * 0.03;
    halo.scale.setScalar(8.5 * fit);

    var sx = isMobile ? 0 : curSx, sy = isMobile ? 0.2 + 0.08 * Math.max(0, 1 - curT) : 0;
    camera.setViewOffset(W, H, -sx * W, sy * H, W, H);
    renderer.render(scene, camera);
    if (!started) { started = true; SITE.hideLoader(); }
  }
  frame();
})();
