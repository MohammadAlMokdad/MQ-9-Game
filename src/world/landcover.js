// Baked ground maps, drawn once with Canvas 2D when the map is built.
//  cover (whole map, 1 m per texel): R = packed-dirt yards, G = tilled fields, A = sky occlusion
//        around buildings, walls, trees and parked vehicles (1 = open sky).
//  fine  (the hacienda compound, ~0.22 m per texel): occlusion only, so the contact shading at
//        the foot of the walls and buildings stays crisp.
// Soft edges come from the canvas shadow blur (drawing the shape far off-canvas and letting only
// its blurred shadow land), which works in every browser.
import * as THREE from 'three';

const OFF = 100000; // shapes are drawn this far off-canvas; only their shadows land

function canvas(n, fill) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = fill;
  g.fillRect(0, 0, n, n);
  return { c, g };
}

// A painter in world units: (x, z) metres -> canvas pixels.
function painter(g, n, minX, minZ, size) {
  const k = n / size;
  const px = (x) => (x - minX) * k;
  const pz = (z) => (z - minZ) * k;
  // Blurred shape: drawn off-canvas, its shadow (colour, blur in metres) lands on the canvas.
  const soft = (color, blurM, draw) => {
    g.save();
    g.shadowColor = color;
    g.shadowBlur = Math.max(0.5, blurM * k);
    g.shadowOffsetX = OFF;
    g.shadowOffsetY = 0;
    g.fillStyle = '#000';
    g.beginPath();
    draw((x) => px(x) - OFF, pz, k);
    g.fill();
    g.restore();
  };
  return {
    k,
    disc(x, z, r, color, blurM) {
      soft(color, blurM, (X, Z, kk) => g.arc(X(x), Z(z), Math.max(0.5, r * kk), 0, Math.PI * 2));
    },
    // Rectangle centred at (x, z), w along its local x, d along local z, rotated by ry (yaw).
    rect(x, z, w, d, ry, color, blurM) {
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      const pts = [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
      soft(color, blurM, (X, Z) => {
        g.moveTo(X(pts[0][0]), Z(pts[0][1]));
        for (let i = 1; i < 4; i++) g.lineTo(X(pts[i][0]), Z(pts[i][1]));
        g.closePath();
      });
    },
  };
}

function toTexture(n, channels) {
  const data = new Uint8Array(n * n * 4);
  const read = channels.map((ch) => (ch ? ch.g.getImageData(0, 0, n, n).data : null));
  const defaults = [0, 0, 0, 255];
  for (let i = 0; i < n * n; i++) {
    for (let k = 0; k < 4; k++) data[i * 4 + k] = read[k] ? read[k][i * 4] : defaults[k];
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// occluders: [{ x, z, w, d, ry, h }] boxes (buildings, walls, vehicles, hedges);
// canopies: [{ x, z, r, dark }] trees and palms.
function paintOcclusion(p, occluders, canopies, fine) {
  for (const o of canopies) {
    // Ground under a crown sees little sky; the edge fades out past the canopy.
    p.disc(o.x, o.z, o.r * (fine ? 0.75 : 0.8), `rgba(0,0,0,${o.dark})`, o.r * 0.7);
  }
  for (const o of occluders) {
    const reach = Math.min(fine ? 3.2 : 6, 0.5 + o.h * 0.45);
    // Wide soft skirt, then a tight dark contact line.
    p.rect(o.x, o.z, o.w + reach * 0.6, o.d + reach * 0.6, o.ry, 'rgba(0,0,0,0.42)', reach);
    if (fine) p.rect(o.x, o.z, o.w + 0.15, o.d + 0.15, o.ry, 'rgba(0,0,0,0.5)', 0.45);
  }
}

// yards: [[x, z, r]]; fields: Float32Array (x, y, z, yaw, scale)* per field.
export function buildLandcover({ yards, fields, occluders, canopies, half = 1024, fineHalf = 112 }) {
  const N = 2048;
  const size = half * 2;
  const minX = -half;
  const minZ = -half;
  const rng = (() => {
    let s = 12345;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();

  // R: yards, as clusters of overlapping soft blobs so the outline is irregular.
  const yard = canvas(N, '#000');
  {
    const p = painter(yard.g, N, minX, minZ, size);
    for (const [x, z, r] of yards) {
      p.disc(x, z, r * 0.62, 'rgba(255,255,255,0.9)', r * 0.25);
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const d = r * (0.3 + rng() * 0.45);
        p.disc(x + Math.cos(a) * d, z + Math.sin(a) * d, r * (0.18 + rng() * 0.22), 'rgba(255,255,255,0.75)', r * 0.15);
      }
    }
  }
  // G: tilled soil under the agave fields.
  const field = canvas(N, '#000');
  {
    const p = painter(field.g, N, minX, minZ, size);
    for (const A of fields) {
      for (let i = 0; i < A.length; i += 5) p.disc(A[i], A[i + 2], 1.7, 'rgba(255,255,255,1)', 1.2);
    }
  }
  // A: sky occlusion.
  const occ = canvas(N, '#fff');
  paintOcclusion(painter(occ.g, N, minX, minZ, size), occluders, canopies, false);

  // Fine occlusion map for the compound.
  const FN = 1024;
  const fine = canvas(FN, '#fff');
  const near = (o) => Math.abs(o.x) < fineHalf + 10 && Math.abs(o.z) < fineHalf + 10;
  paintOcclusion(painter(fine.g, FN, -fineHalf, -fineHalf, fineHalf * 2), occluders.filter(near), canopies.filter(near), true);

  return {
    map: toTexture(N, [yard, field, null, occ]),
    rect: [minX, minZ, size],
    fine: toTexture(FN, [fine, null, null, null]),
    fineRect: [-fineHalf, -fineHalf, fineHalf * 2],
  };
}
