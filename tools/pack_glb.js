// Shrinks the models in assets/models after a Blender export:
//   positions float32 -> uint16 (KHR_mesh_quantization, de-quantised by the node transform)
//   normals   float32 -> int16 normalised, indices -> uint16 where possible, unused attributes dropped
// Run after any tools/build_*.py:   node tools/pack_glb.js   (also refreshes the .glbz copies)
// The reader in js/showcase.js understands both packed and unpacked files.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'models');
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function pack(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  if ((json.extensionsUsed || []).includes('KHR_mesh_quantization')) return console.log('already packed:', path.basename(file));
  const bin = buf.slice(20 + jsonLen + 8);

  const read = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = TYPES[a.componentType];
    const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), n = a.count * SIZE[a.type];
    return new T(bin.buffer.slice(off, off + n * T.BYTES_PER_ELEMENT));
  };

  const chunks = [], views = [], accessors = [];
  let length = 0;
  const push = (bytes, extra) => {                       // every view starts on a 4-byte boundary
    const pad = (4 - (length % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    views.push(Object.assign({ buffer: 0, byteOffset: length, byteLength: bytes.length }, extra));
    chunks.push(bytes); length += bytes.length;
    return views.length - 1;
  };

  (json.nodes || []).forEach((node) => {
    if (node.mesh === undefined) return;
    const prims = json.meshes[node.mesh].primitives;
    const all = prims.map((p) => read(p.attributes.POSITION));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    all.forEach((pos) => { for (let i = 0; i < pos.length; i++) { const c = i % 3; if (pos[i] < min[c]) min[c] = pos[i]; if (pos[i] > max[c]) max[c] = pos[i]; } });
    const scale = max.map((m, c) => (m - min[c]) / 65535 || 1e-9);
    node.translation = min; node.scale = scale;        // exporter writes identity transforms, so this is safe

    prims.forEach((p, k) => {
      const pos = all[k], count = pos.length / 3;
      const qp = Buffer.alloc(count * 8);              // uint16 x3, stride 8 (attributes must be 4-byte aligned)
      for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) qp.writeUInt16LE(Math.round((pos[i * 3 + c] - min[c]) / scale[c]), i * 8 + c * 2);
      accessors.push({ bufferView: push(qp, { byteStride: 8, target: 34962 }), componentType: 5123, count, type: 'VEC3', min: [0, 0, 0], max: [65535, 65535, 65535] });
      const attributes = { POSITION: accessors.length - 1 };

      if (p.attributes.NORMAL !== undefined) {
        const nor = read(p.attributes.NORMAL), qn = Buffer.alloc(count * 8);
        for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) qn.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(nor[i * 3 + c] * 32767))), i * 8 + c * 2);
        accessors.push({ bufferView: push(qn, { byteStride: 8, target: 34962 }), componentType: 5122, normalized: true, count, type: 'VEC3' });
        attributes.NORMAL = accessors.length - 1;
      }
      p.attributes = attributes;

      if (p.indices !== undefined) {
        const idx = read(p.indices), small = count <= 65535;
        const out = small ? Uint16Array.from(idx) : Uint32Array.from(idx);
        accessors.push({ bufferView: push(Buffer.from(out.buffer), { target: 34963 }), componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
        p.indices = accessors.length - 1;
      }
    });
  });

  json.accessors = accessors; json.bufferViews = views;
  json.extensionsUsed = ['KHR_mesh_quantization']; json.extensionsRequired = ['KHR_mesh_quantization'];
  (json.materials || []).forEach((m) => { Object.keys(m).forEach((key) => { if (key !== 'name') delete m[key]; }); });   // looked up by name on the site
  const pad = (4 - (length % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
  json.buffers = [{ byteLength: length }];

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + length, 8);
  jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, ...chunks]));
  console.log('packed:', path.basename(file), buf.length, '->', fs.statSync(file).size, 'bytes');
}

fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).forEach((f) => pack(path.join(DIR, f)));

// Pre-compressed copies (.glbz = gzip). The site prefers these and unpacks them in the browser,
// so the download is small even on hosts that do not compress .glb on the fly.
const zlib = require('zlib');
fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).forEach((f) => {
  const src = path.join(DIR, f), out = src + 'z';
  fs.writeFileSync(out, zlib.gzipSync(fs.readFileSync(src), { level: 9 }));
  console.log('gzipped:', path.basename(out), fs.statSync(out).size, 'bytes');
});
