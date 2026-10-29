// Uniform grid over the XZ plane, rebuilt every frame. Items need x, z and radius.
export class SpatialHash {
  constructor(half = 700, cell = 8, maxItems = 2048) {
    this.half = half;
    this.cell = cell;
    this.dim = Math.ceil((half * 2) / cell);
    this.heads = new Int32Array(this.dim * this.dim).fill(-1);
    this.next = new Int32Array(maxItems);
    this.items = new Array(maxItems);
    this.n = 0;
  }

  clear() {
    this.heads.fill(-1);
    this.n = 0;
  }

  cellCoord(v) {
    const c = Math.floor((v + this.half) / this.cell);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  insert(item) {
    if (this.n >= this.next.length) return;
    const c = this.cellCoord(item.z) * this.dim + this.cellCoord(item.x);
    const i = this.n++;
    this.items[i] = item;
    this.next[i] = this.heads[c];
    this.heads[c] = i;
  }

  // Fills `out` with items whose circle overlaps the query circle.
  query(x, z, r, out) {
    out.length = 0;
    const pad = 4; // max item radius
    const x0 = this.cellCoord(x - r - pad);
    const x1 = this.cellCoord(x + r + pad);
    const z0 = this.cellCoord(z - r - pad);
    const z1 = this.cellCoord(z + r + pad);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.heads[cz * this.dim + cx];
        while (i !== -1) {
          const it = this.items[i];
          const dx = it.x - x;
          const dz = it.z - z;
          const rr = r + it.radius;
          if (dx * dx + dz * dz <= rr * rr) out.push(it);
          i = this.next[i];
        }
      }
    }
    return out;
  }
}
