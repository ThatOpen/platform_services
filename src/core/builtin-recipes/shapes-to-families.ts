/**
 * 🔴 FAMILIES FROM A FILE'S OWN SHAPES (Antonio, 21-10: «comparar el brep o la mesh y que sea igual… y no hacerlo a lo
 * bruto, sino definiendo familias»). What a target cannot build natively from records is built as a family per SHAPE:
 * its geometry in the element's own frame, once, and an instance per element placed where the file has it. Two chairs
 * of one type share their geometry in the file and differ by their placement, so they become two instances of one
 * family, as somebody modelling them would have made them.
 *
 * The frame: the placement of the element's first piece, turned only about Z (what a family instance can be). One
 * tilted or mirrored is placed unturned with its turn baked into a family of its own, so the shape is exact anyway.
 */
import type { SourceShapes } from '../recipes';

export const FEET = 1 / 0.3048;

/** The class of an IFC element → the category (Revit's built-in category name) its family is made in. */
export const SHAPE_CATEGORY: Readonly<Record<string, string>> = {
  IFCDOOR: 'OST_Doors',
  IFCWINDOW: 'OST_Windows',
  IFCFURNITURE: 'OST_Furniture',
  IFCFURNISHINGELEMENT: 'OST_Furniture',
  IFCSYSTEMFURNITUREELEMENT: 'OST_FurnitureSystems',
  IFCLIGHTFIXTURE: 'OST_LightingFixtures',
  IFCSANITARYTERMINAL: 'OST_PlumbingFixtures',
  IFCFLOWTERMINAL: 'OST_PlumbingFixtures',
  IFCCOLUMN: 'OST_Columns',
  IFCFOOTING: 'OST_StructuralFoundation',
  IFCGEOGRAPHICELEMENT: 'OST_Site',
  IFCELECTRICAPPLIANCE: 'OST_ElectricalEquipment',
  IFCELECTRICDISTRIBUTIONBOARD: 'OST_ElectricalEquipment',
  IFCUNITARYEQUIPMENT: 'OST_MechanicalEquipment',
};
const GENERIC = 'OST_GenericModel';

/** What is never a family: spaces, openings, annotations, the site (a terrain, not a thing). */
const NOT_A_THING = new Set(['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCSITE', 'IFCANNOTATION', 'IFCGRID', 'IFCVIRTUALELEMENT', 'IFCBUILDING', 'IFCBUILDINGSTOREY']);

export interface ShapedInstance {
  key: string;
  attrs: Record<string, string>;
  /** Where the family's origin goes, metres, in the file's frame. */
  at: [number, number, number];
  rotationDeg: number;
  host?: string;
}

const round = (n: number, step: number) => Math.round(n / step) * step;

/** Column-major 4x4 → its linear part's columns and translation. */
const parts = (m: number[]) => ({
  x: [m[0], m[1], m[2]],
  y: [m[4], m[5], m[6]],
  z: [m[8], m[9], m[10]],
  t: [m[12], m[13], m[14]] as [number, number, number],
});
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: number[]) => Math.sqrt(dot(a, a));
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The family instances for every element of `shapes` that nothing in `written` (source keys of what other steps
 * build: `<file>:<gid>:<kind>`) builds, and that is not part of something written (a curtain wall's mullions).
 */
export function familiesFromShapes(shapes: SourceShapes, written: ReadonlySet<string>, fileId: string): ShapedInstance[] {
  const writtenGids = new Set<string>();
  const keyOfGid = new Map<string, string>();
  for (const key of written) {
    const gid = key.split(':')[1];
    if (!gid) continue;
    writtenGids.add(gid);
    // A host is the change that made the element: its first key (a wall's run).
    if (!keyOfGid.has(gid)) keyOfGid.set(gid, key);
  }

  const familyOfShape = new Map<string, { family: string; type: string; first: boolean; key: string }>();
  const namesTaken = new Map<string, number>();
  const out: ShapedInstance[] = [];
  for (const el of shapes.elements.values()) {
    if (writtenGids.has(el.gid) || NOT_A_THING.has(el.ifcClass.toUpperCase())) continue;
    // A part of something written is that thing's (a curtain wall's mullions and panels), except a door or window
    // in it: Revit's curtain wall takes no door from the file, so it is made as the door it is (racbasic: 5 doors of
    // curtain walls missing, 21-10).
    if (el.parent && writtenGids.has(el.parent) && !/^IFC(DOOR|WINDOW)$/i.test(el.ifcClass)) continue;
    if (el.pieces.length === 0) continue;
    const category = SHAPE_CATEGORY[el.ifcClass.toUpperCase()] ?? GENERIC;

    // The frame: the first piece's placement, if it is upright and unmirrored only its turn about Z.
    const first = parts(el.pieces[0].matrix);
    const sx = len(first.x), sy = len(first.y), sz = len(first.z);
    const z = first.z.map((v) => v / (sz || 1));
    const upright = Math.abs(z[2] - 1) < 1e-6 && dot(cross(first.x, first.y), first.z) > 0 && Math.abs(sx - sy) < 1e-6 && Math.abs(sx - sz) < 1e-6;
    const angle = upright ? Math.atan2(first.x[1], first.x[0]) : 0;
    const c = Math.cos(-angle), sn = Math.sin(-angle);
    const at = [first.t[0], first.t[1], first.t[2]];
    // 🔴 A COLUMN'S BODY AT ITS OWN HEIGHT: Revit holds a column family's free-form body at the project's zero
    // whatever its base, offsets, point or a move say (measured 21-10: racbasic's L column 3 m low, its concrete one
    // 2.9 m, nothing moved them). So the family's frame is at zero height and the body where the file has it.
    // (Superseded: a column is now made as a free family, `ColumnFree`, which stands where it is put; its frame is
    // its own and its shape is shared by every column like it.)
    const freeColumn = /COLUMN/i.test(category);
    // World → the family's frame: unshift, unturn.
    const toFamily = (p: number[]) => {
      const dx = p[0] - at[0], dy = p[1] - at[1];
      return [c * dx - sn * dy, sn * dx + c * dy, p[2] - at[2]];
    };

    // The shape in that frame, and its key: the geometries and each piece's placement relative to the frame.
    // One solid per piece: a body Revit closes on its own, where all of them in one set of faces may not close.
    const pieces: { v: number[]; t: number[] }[] = [];
    const keyParts: string[] = [category];
    for (const piece of el.pieces) {
      const g = shapes.geometries.get(piece.geometry);
      if (!g) continue;
      const m = piece.matrix;
      const verts: number[] = [];
      for (let i = 0; i < g.verts.length; i += 3) {
        const x = g.verts[i], y = g.verts[i + 1], zz = g.verts[i + 2];
        const w = [m[0] * x + m[4] * y + m[8] * zz + m[12], m[1] * x + m[5] * y + m[9] * zz + m[13], m[2] * x + m[6] * y + m[10] * zz + m[14]];
        const f = toFamily(w);
        verts.push(round(f[0] * FEET, 1e-5), round(f[1] * FEET, 1e-5), round(f[2] * FEET, 1e-5));
      }
      // A mirroring placement turns the faces inside out: their order is put back.
      const mirrored = dot(cross([m[0], m[1], m[2]], [m[4], m[5], m[6]]), [m[8], m[9], m[10]]) < 0;
      const tris: number[] = [];
      for (let i = 0; i + 2 < g.tris.length; i += 3)
        mirrored ? tris.push(g.tris[i], g.tris[i + 2], g.tris[i + 1]) : tris.push(g.tris[i], g.tris[i + 1], g.tris[i + 2]);
      if (tris.length) pieces.push({ v: verts, t: tris });
      // The piece relative to the frame, rounded: equal for two placements of one type.
      const o = toFamily([m[12], m[13], m[14]]);
      const relX = [c * m[0] - sn * m[1], sn * m[0] + c * m[1], m[2]];
      const relY = [c * m[4] - sn * m[5], sn * m[4] + c * m[5], m[6]];
      keyParts.push(`${piece.geometry}@${[...o, ...relX, ...relY].map((v) => round(v, 1e-4).toFixed(4)).join(',')}`);
    }
    if (pieces.length === 0) continue;
    // 🔴 A PRISM IS A PROFILE AND A LENGTH (a beam, a mullion, a member, a panel): one family per profile with its
    // length a parameter, as a person makes a framing family, not one family per piece (rac_advanced made 113
    // families of one 50 x 150 mullion, one per length; 21-10).
    const prism = !el.host && pieces.length === 1 ? prismOf(pieces[0]) : null;
    if (prism) {
      // 🔴 ONE FAMILY PER PROFILE, HOWEVER IT IS TURNED (metal.ifc, 23-10: 1388 prism families of 663 profiles; one round
      // bar in 27 families): the profile centred, turned to its canonical way (vertical prisms: any turn about Z; lying
      // ones: as it is or end for end), and the instance moved and turned to put it back.
      const canon = canonicalPrism(prism);
      const profileKey = canon.key;
      const pkey = `prism|${category}|${canon.axis}|${profileKey}`;
      let pf = familyOfShape.get(pkey);
      if (!pf) {
        const label = clean(el.typeName ?? el.objectType ?? el.name ?? el.ifcClass);
        const n = (namesTaken.get(label) ?? 0) + 1;
        namesTaken.set(label, n);
        const name = n === 1 ? label : `${label} (${n})`;
        pf = { family: name, type: name, first: true, key: hash(pkey) };
        familyOfShape.set(pkey, pf);
      }
      const pattrs: Record<string, string> = { ShapeCategory: category, Family: pf.family, Type: pf.type, ShapeKey: pf.key, PrismLength: String(round(prism.length, 1e-5)), ...(freeColumn ? { ColumnFree: '1' } : {}) };
      if (pf.first) { pattrs.Prism = JSON.stringify({ axis: canon.axis, loops: canon.loops }); pf.first = false; }
      // The extrusion starts at the family's origin: the instance goes where the prism starts.
      const off = [0, 0, 0];
      off[prism.axis] = (canon.flipped ? prism.from + prism.length : prism.from) / FEET;
      // Where the profile's centre went, in the family's frame (feet → m).
      const u = (prism.axis + 1) % 3, w = (prism.axis + 2) % 3;
      off[u] += canon.centre[0] / FEET;
      off[w] += canon.centre[1] / FEET;
      const cw = Math.cos(angle), sw = Math.sin(angle);
      const start: [number, number, number] = [at[0] + cw * off[0] - sw * off[1], at[1] + sw * off[0] + cw * off[1], at[2] + off[2]];
      out.push({ key: `${fileId}:${el.gid}:shape`, attrs: pattrs, at: start, rotationDeg: ((angle + canon.turn) * 180) / Math.PI });
      continue;
    }
    // THE SAME SHAPE, WHEREVER IT CAME FROM. A file may write each element its own copy of a geometry (Revit's
    // IFC export does, for piles of one type), so geometries' ids alone made one family per pile. The key is the
    // shape itself in the family's frame (to the millimetre), so equal shapes share a family however they were written.
    const shapeKey = `${category}|${pieces
      .map((p) => `${p.v.map((n) => Math.round((n * 304.8) / 2)).join(',')}/${p.t.join(',')}`)
      .join('|')}`;
    // And first the file's own sharing: the same geometries placed the same way relative to the frame (a type's
    // windows), which rounding cannot split.
    const idsKey = keyParts.join('|');

    let family = familyOfShape.get(idsKey) ?? familyOfShape.get(shapeKey);
    if (family) {
      familyOfShape.set(idsKey, family);
      familyOfShape.set(shapeKey, family);
    }
    if (!family) {
      const label = clean(el.typeName ?? el.objectType ?? el.name ?? el.ifcClass);
      const n = (namesTaken.get(label) ?? 0) + 1;
      namesTaken.set(label, n);
      const name = n === 1 ? label : `${label} (${n})`;
      family = { family: name, type: name, first: true, key: hash(shapeKey) };
      familyOfShape.set(shapeKey, family);
      familyOfShape.set(idsKey, family);
    }
    const attrs: Record<string, string> = {
      ShapeCategory: category,
      Family: family.family,
      Type: family.type,
      ShapeKey: family.key,
      ...(freeColumn ? { ColumnFree: '1' } : {}),
    };
    if (family.first) {
      // The shape travels once, with the first instance: feet, in the family's frame.
      attrs.Shape = JSON.stringify({ pieces });
      family.first = false;
    }
    const host = el.host ? keyOfGid.get(el.host) : undefined;
    // The opening it fills, as a box in the family's frame (feet): what the wall is cut by, and the size of the
    // door or window family's own opening.
    const opening = el.opening ? shapes.elements.get(el.opening) : undefined;
    if (host && opening) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const piece of opening.pieces) {
        const g = shapes.geometries.get(piece.geometry);
        if (!g) continue;
        const m = piece.matrix;
        for (let i = 0; i < g.verts.length; i += 3) {
          const x = g.verts[i], y = g.verts[i + 1], zz = g.verts[i + 2];
          const f = toFamily([m[0] * x + m[4] * y + m[8] * zz + m[12], m[1] * x + m[5] * y + m[9] * zz + m[13], m[2] * x + m[6] * y + m[10] * zz + m[14]]);
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], f[k] * FEET); mx[k] = Math.max(mx[k], f[k] * FEET); }
        }
      }
      if (Number.isFinite(mn[0])) attrs.Opening = [...mn, ...mx].map((v) => round(v, 1e-5)).join(',');
    }
    out.push({
      key: `${fileId}:${el.gid}:shape`,
      attrs,
      at: [at[0], at[1], at[2]],
      rotationDeg: (angle * 180) / Math.PI,
      ...(host ? { host } : {}),
    });
  }
  return out;
}

/** A family name Revit takes: no characters it refuses, not empty, not too long. */
function clean(name: string): string {
  const plain = name.replace(/[\\:{}[\]|;<>?`~]/g, '-').replace(/\s+/g, ' ').trim();
  return (plain || 'Shape').slice(0, 120);
}

/** A short stable key for a shape (FNV-1a, base 36). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** World points of an element of `shapes` (metres). */
/**
 * The openings nothing fills (a niche, a pass-through), in the walls that `written` builds: each its points flat
 * (metres, the file's frame) and the change of the wall it is cut in. A door's or window's opening is cut by its family.
 */
export function openingsFromShapes(shapes: SourceShapes, written: ReadonlySet<string>, fileId: string): { key: string; host: string; box: number[] }[] {
  const wallKey = new Map<string, string>();
  for (const key of written) {
    const [, gid, kind] = key.split(':');
    if (gid && /^run/.test(kind ?? '') && !wallKey.has(gid)) wallKey.set(gid, key);
  }
  const out: { key: string; host: string; box: number[] }[] = [];
  for (const el of shapes.elements.values()) {
    if (el.ifcClass.toUpperCase() !== 'IFCOPENINGELEMENT' || !el.host) continue;
    const host = wallKey.get(el.host);
    if (!host) continue;
    // 🔴 EACH PIECE ITS OWN OPENING: Revit writes a wall's edited profile as one opening of several extrusions
    // (Savoyvilla: walls twice the IFC's volume, their two-box openings failing the rectangle test as a whole, 23-10).
    // (And the pieces of one geometry that touch nothing of each other, apart: web-ifc may give the two as one.)
    for (const part of openingParts(shapes, el.gid)) {
    const pts = part.pts;
    if (pts.length < 4) continue;
    // A RECTANGLE IN THE WALL, or not cut: Revit cuts a wall only with rectangles, and the extent of an opening under
    // a sloped top cut half its wall away (racbasic's SIP gable wall: 0.61 m³ for the IFC's 1.19; 21-10). Its volume
    // against its box along the wall's axis says.
    const axis = wallAxis(pointsOf(shapes, el.host));
    if (!axis) continue;
    const along = pts.map((p) => (p[0] - axis.a[0]) * axis.u[0] + (p[1] - axis.a[1]) * axis.u[1]);
    const across = pts.map((p) => -(p[0] - axis.a[0]) * axis.u[1] + (p[1] - axis.a[1]) * axis.u[0]);
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    const box = span(along) * span(across) * span(pts.map((p) => p[2]));
    if (!(box > 0) || Math.abs(part.volume) < 0.75 * box) continue; // boxes measured 0.81..0.92, the others 0.42..0.62
    // Its points, not a box: the wall may run at any angle, and the applier takes their extent along it.
    out.push({ key: `${fileId}:${el.gid}:opening${part.index === 0 && part.of === 1 ? '' : `#${part.index}`}`, host, box: pts.flat() });
    }
  }
  return out;
}

/**
 * A prism's profile in its canonical way: centred on its box, and turned (a vertical prism, about Z: its principal axes,
 * or for a round one its outermost points, tried) or put end for end (a lying one: Z turned half a turn mirrors its
 * profile across the vertical), whichever writes the smallest key. `turn`: radians the instance turns more about Z;
 * `centre`: where the profile's centre is in the family's frame before the turn (feet).
 */
function canonicalPrism(prism: { axis: number; loops: [number, number][][] }): { axis: number; loops: [number, number][][]; key: string; centre: [number, number]; turn: number; flipped: boolean } {
  const all = prism.loops.flat();
  // The centre: the mean of its points, the same however it is turned (a box's middle is not).
  const c: [number, number] = [all.reduce((x, p) => x + p[0], 0) / all.length, all.reduce((x, p) => x + p[1], 0) / all.length];
  // A ROUND ONE (a faceted circle, or a tube's two) is the same whatever its roll: each regular loop about the centre
  // laid with a vertex at angle 0 (a 22-gon of 10 mm moves by 0.1 mm at most).
  const centred = prism.loops.map((l) => {
    const q = l.map(([a, b]) => [a - c[0], b - c[1]] as [number, number]);
    const r = q.map(([a, b]) => Math.hypot(a, b));
    const mean = r.reduce((x, y) => x + y, 0) / r.length;
    if (q.length < 8 || mean <= 0 || r.some((x) => Math.abs(x - mean) > 0.02 * mean)) return q;
    const area = q.reduce((sum, p, i) => { const n = q[(i + 1) % q.length]; return sum + p[0] * n[1] - n[0] * p[1]; }, 0);
    const dir = area >= 0 ? 1 : -1;
    return q.map((_, k) => [mean * Math.cos((dir * 2 * Math.PI * k) / q.length), mean * Math.sin((dir * 2 * Math.PI * k) / q.length)] as [number, number]);
  });
  const keyOf = (loops: [number, number][][]) => {
    const norm = loops.map((l) => {
      const q = l.map(([a, b]) => `${Math.round(a * 304.8)},${Math.round(b * 304.8)}`);
      let best = 0;
      for (let i = 1; i < q.length; i++) if (q[i] < q[best]) best = i;
      return [...q.slice(best), ...q.slice(0, best)].join(';');
    });
    return norm.sort().join('|');
  };
  const turned = (loops: [number, number][][], t: number) => {
    const ct = Math.cos(-t), st = Math.sin(-t);
    return loops.map((l) => l.map(([a, b]) => [ct * a - st * b, st * a + ct * b] as [number, number]));
  };
  const candidates: { loops: [number, number][][]; turn: number; flipped: boolean }[] = [];
  // Lying along Y is lying along X a quarter turn about Z: its profile (z, x) becomes (y, z) = (-x, z).
  let axis = prism.axis, base = 0, lying = centred;
  if (axis === 1) { axis = 0; base = Math.PI / 2; lying = centred.map((l) => l.map(([a, b]) => [-b, a] as [number, number])); }
  if (axis === 2) {
    // The principal axes of the points, and for a round one each outermost point brought to angle 0.
    let sxx = 0, syy = 0, sxy = 0;
    const pts = centred.flat();
    for (const [a, b] of pts) { sxx += a * a; syy += b * b; sxy += a * b; }
    const angles = new Set<number>();
    const principal = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    for (let k = 0; k < 4; k++) angles.add(principal + (k * Math.PI) / 2);
    const r = pts.map(([a, b]) => Math.hypot(a, b));
    const far = Math.max(...r);
    const outer = pts.filter((_, i) => r[i] > far - 0.003);
    if (Math.abs(sxx - syy) < 1e-3 * (sxx + syy) || outer.length > 4)
      for (const [a, b] of outer.slice(0, 64)) angles.add(Math.atan2(b, a));
    for (const t of angles) candidates.push({ loops: turned(centred, t), turn: t, flipped: false });
  } else {
    // Lying along X or Y: half a turn about Z sends it end for end and mirrors the profile's first axis.
    candidates.push({ loops: lying, turn: 0, flipped: false });
    candidates.push({ loops: lying.map((l) => l.map(([a, b]) => [-a, b] as [number, number]).reverse()), turn: Math.PI, flipped: true });
  }
  let best = candidates[0], bestKey = keyOf(best.loops);
  for (const one of candidates.slice(1)) { const k = keyOf(one.loops); if (k < bestKey) { best = one; bestKey = k; } }
  return { axis, loops: best.loops, key: bestKey, centre: c, turn: base + best.turn, flipped: best.flipped };
}

/**
 * The piece as a prism along one of its frame's axes, or null: every point on one of two planes across that axis, and
 * the cap on the first plane a closed outline (with its holes). Feet, in the family's frame; the outline in the two
 * other axes' order ((axis+1)%3, (axis+2)%3).
 */
export function prismOf(piece: { v: number[]; t: number[] }): { axis: number; from: number; length: number; loops: [number, number][][] } | null {
  const tol = 1e-3;
  const n = piece.v.length / 3;
  if (n < 6) return null;
  // The longest way first: a box is a prism every way, and its length is what varies between a type's pieces.
  const extent = [0, 1, 2].map((k) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { const c = piece.v[i * 3 + k]; lo = Math.min(lo, c); hi = Math.max(hi, c); } return hi - lo; });
  for (const axis of [0, 1, 2].sort((a, b) => extent[b] - extent[a])) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const c = piece.v[i * 3 + axis]; lo = Math.min(lo, c); hi = Math.max(hi, c); }
    if (hi - lo < 0.01) continue;
    let ok = true;
    for (let i = 0; i < n && ok; i++) { const c = piece.v[i * 3 + axis]; if (Math.abs(c - lo) > tol && Math.abs(c - hi) > tol) ok = false; }
    if (!ok) continue;
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    // Points welded to 0.1 mm in the cap's plane, so the cap's triangles share their corners.
    const id = new Map<string, number>();
    const pts: [number, number][] = [];
    const at = (i: number) => {
      const p: [number, number] = [piece.v[i * 3 + u], piece.v[i * 3 + w]];
      const k = `${Math.round(p[0] * 3048)},${Math.round(p[1] * 3048)}`;
      if (!id.has(k)) { id.set(k, pts.length); pts.push(p); }
      return id.get(k)!;
    };
    const edges = new Map<string, number>();
    const capTris: number[][] = [];
    for (let t = 0; t + 2 < piece.t.length; t += 3) {
      const tri = [piece.t[t], piece.t[t + 1], piece.t[t + 2]];
      if (!tri.every((i) => Math.abs(piece.v[i * 3 + axis] - lo) <= tol)) continue;
      const q = tri.map(at);
      if (q[0] === q[1] || q[1] === q[2] || q[0] === q[2]) continue;
      capTris.push(q);
      for (let k = 0; k < 3; k++) { const a = q[k], b = q[(k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
    }
    if (capTris.length === 0) continue;
    // Boundary: edges of one triangle only, chained into loops.
    const next = new Map<number, number[]>();
    for (const tri of capTris) for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      if (edges.get(a < b ? `${a},${b}` : `${b},${a}`) !== 1) continue;
      next.set(a, [...(next.get(a) ?? []), b]);
    }
    if ([...next.values()].some((v) => v.length !== 1)) continue;
    const loops: [number, number][][] = [];
    const left = new Set(next.keys());
    while (left.size) {
      const start = left.values().next().value as number;
      const loop: [number, number][] = [];
      let cur = start, guard = 0;
      do { loop.push(pts[cur]); left.delete(cur); cur = next.get(cur)![0]; } while (cur !== start && guard++ < 100000 && next.has(cur));
      if (cur !== start || loop.length < 3) { loops.length = 0; break; }
      // Collinear corners out: a fan leaves points along straight edges.
      const clean = loop.filter((p, i) => {
        const a = loop[(i - 1 + loop.length) % loop.length], b = loop[(i + 1) % loop.length];
        return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-7;
      });
      loops.push(clean.map(([x, y]) => [round(x, 1e-5), round(y, 1e-5)] as [number, number]));
    }
    if (loops.length === 0 || loops.some((l) => l.length < 3)) continue;
    // The cap and the far end the same outline: each cap point has its twin at the other end.
    let twins = 0;
    for (let i = 0; i < n; i++) if (Math.abs(piece.v[i * 3 + axis] - hi) <= tol) twins++;
    if (twins < 3) continue;
    return { axis, from: lo, length: hi - lo, loops };
  }
  return null;
}

/**
 * The rooms: each IfcSpace as a point inside its floor (the middle of the largest triangle of its bottom), its bottom
 * and its height (metres, the file's frame), its number (Name) and name (LongName). A room is the walls' to bound, as
 * in Revit: placed at that point after them, it takes their outline.
 */
export function roomsFromShapes(shapes: SourceShapes, fileId: string): { key: string; at: [number, number, number]; height: number; number: string; name: string }[] {
  const out: { key: string; at: [number, number, number]; height: number; number: string; name: string }[] = [];
  for (const el of shapes.elements.values()) {
    if (el.ifcClass.toUpperCase() !== 'IFCSPACE') continue;
    let lo = Infinity, hi = -Infinity;
    const tris: number[][][] = [];
    for (const piece of el.pieces) {
      const g = shapes.geometries.get(piece.geometry);
      if (!g) continue;
      const m = piece.matrix;
      const P = (i: number) => {
        const x = g.verts[i * 3], y = g.verts[i * 3 + 1], z = g.verts[i * 3 + 2];
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      };
      for (let t = 0; t + 2 < g.tris.length; t += 3) {
        const tri = [P(g.tris[t]), P(g.tris[t + 1]), P(g.tris[t + 2])];
        for (const p of tri) { lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
        tris.push(tri);
      }
    }
    if (!Number.isFinite(lo) || hi - lo < 0.1) continue;
    let best: number[][] | null = null, bestArea = 0;
    for (const tri of tris) {
      if (!tri.every((p) => Math.abs(p[2] - lo) < 1e-3)) continue;
      const area = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1])) / 2;
      if (area > bestArea) { bestArea = area; best = tri; }
    }
    if (!best) continue;
    out.push({
      key: `${fileId}:${el.gid}:room`,
      at: [(best[0][0] + best[1][0] + best[2][0]) / 3, (best[0][1] + best[1][1] + best[2][1]) / 3, lo],
      height: hi - lo,
      number: el.name ?? '',
      name: el.longName ?? el.name ?? '',
    });
  }
  return out;
}

/** A wall's long axis in plan, from its two farthest points: a start and the unit along it. */
function wallAxis(pts: number[][]): { a: number[]; u: number[] } | undefined {
  if (pts.length < 2) return undefined;
  let a = pts[0], b = pts[0], far = 0;
  for (const p of pts) { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > far) { far = d; b = p; } }
  far = 0;
  for (const p of pts) { const d = Math.hypot(p[0] - b[0], p[1] - b[1]); if (d > far) { far = d; a = p; } }
  if (far < 0.1) return undefined;
  return { a, u: [(b[0] - a[0]) / far, (b[1] - a[1]) / far] };
}

/** An element's triangles placed, split into the bodies that share no vertex: each its points and volume. */
function openingParts(shapes: SourceShapes, gid: string): { pts: number[][]; volume: number; index: number; of: number }[] {
  const el = shapes.elements.get(gid);
  if (!el) return [];
  const points: number[][] = [];
  const tris: number[] = [];
  const at = new Map<string, number>();
  for (const piece of el.pieces) {
    const g = shapes.geometries.get(piece.geometry);
    if (!g) continue;
    const m = piece.matrix;
    const local: number[] = [];
    for (let i = 0; i < g.verts.length; i += 3) {
      const x = g.verts[i], y = g.verts[i + 1], z = g.verts[i + 2];
      const p = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      const k = p.map((c) => Math.round(c * 1e4)).join(',');
      let id = at.get(k);
      if (id === undefined) { id = points.length; at.set(k, id); points.push(p); }
      local.push(id);
    }
    for (let t = 0; t + 2 < g.tris.length; t += 3) tris.push(local[g.tris[t]], local[g.tris[t + 1]], local[g.tris[t + 2]]);
  }
  const root = points.map((_, i) => i);
  const find = (i: number): number => { while (root[i] !== i) { root[i] = root[root[i]]; i = root[i]; } return i; };
  for (let t = 0; t < tris.length; t += 3) { const a = find(tris[t]); root[find(tris[t + 1])] = a; root[find(tris[t + 2])] = a; }
  const groups = new Map<number, { pts: Set<number>; volume: number }>();
  for (let t = 0; t < tris.length; t += 3) {
    const r = find(tris[t]);
    let g = groups.get(r);
    if (!g) { g = { pts: new Set(), volume: 0 }; groups.set(r, g); }
    const [a, b, c] = [points[tris[t]], points[tris[t + 1]], points[tris[t + 2]]];
    g.volume += dot(a, cross(b, c)) / 6;
    g.pts.add(tris[t]); g.pts.add(tris[t + 1]); g.pts.add(tris[t + 2]);
  }
  const list = [...groups.values()];
  return list.map((g, index) => ({ pts: [...g.pts].map((i) => points[i]), volume: g.volume, index, of: list.length }));
}

/** An element's enclosed volume (m³), its triangles placed: the divergence sum. */
function volumeOf(shapes: SourceShapes, gid: string, only?: number): number {
  const el = shapes.elements.get(gid);
  let v = 0;
  if (!el) return v;
  for (const piece of only === undefined ? el.pieces : [el.pieces[only]]) {
    const g = shapes.geometries.get(piece.geometry);
    if (!g) continue;
    const m = piece.matrix;
    const P = (i: number) => {
      const x = g.verts[i * 3], y = g.verts[i * 3 + 1], z = g.verts[i * 3 + 2];
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    };
    for (let t = 0; t + 2 < g.tris.length; t += 3) v += dot(P(g.tris[t]), cross(P(g.tris[t + 1]), P(g.tris[t + 2]))) / 6;
  }
  return v;
}

export function pointsOf(shapes: SourceShapes, gid: string, only?: number): number[][] {
  const el = shapes.elements.get(gid);
  const out: number[][] = [];
  if (!el) return out;
  for (const piece of only === undefined ? el.pieces : [el.pieces[only]]) {
    const g = shapes.geometries.get(piece.geometry);
    if (!g) continue;
    const m = piece.matrix;
    for (let i = 0; i < g.verts.length; i += 3) {
      const x = g.verts[i], y = g.verts[i + 1], z = g.verts[i + 2];
      out.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
    }
  }
  return out;
}

/**
 * 🔴 A WALL WHOSE TOP THE FILE SHOWS CUT BY A ROOF, ATTACHED TO IT (21-10: racbasic's partitions under its roof stood
 * flat-topped, 6-30 % more wall than the IFC, because the converter had not said they were attached). The wall's top
 * in the file is not level (its two ends' tops differ, or its middle stands above them), and a roof covers it from
 * just above: that roof's record id, or undefined.
 */
export function roofOverWall(shapes: SourceShapes, wallGid: string, roofs: { id: string; gid: string }[]): string | undefined {
  const pts = pointsOf(shapes, wallGid);
  if (pts.length < 4 || roofs.length === 0) return undefined;
  // The wall's long horizontal axis, from its two farthest points in plan.
  let a = pts[0], b = pts[0], far = 0;
  for (const p of pts) { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > far) { far = d; b = p; } }
  far = 0;
  for (const p of pts) { const d = Math.hypot(p[0] - b[0], p[1] - b[1]); if (d > far) { far = d; a = p; } }
  if (far < 0.3) return undefined;
  const ux = (b[0] - a[0]) / far, uy = (b[1] - a[1]) / far;
  const along = (p: number[]) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
  const top = Math.max(...pts.map((p) => p[2]));
  const topNear = (t: number) => Math.max(...pts.filter((p) => Math.abs(along(p) - t) < 0.05).map((p) => p[2]), -Infinity);
  const startTop = topNear(0), endTop = topNear(far);
  if (Math.abs(startTop - endTop) < 0.05 && top - Math.max(startTop, endTop) < 0.05) return undefined;
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  let best: { id: string; gap: number } | undefined;
  for (const roof of roofs) {
    const rp = pointsOf(shapes, roof.gid);
    if (rp.length === 0) continue;
    const xs = rp.map((p) => p[0]), ys = rp.map((p) => p[1]), zs = rp.map((p) => p[2]);
    if (cx < Math.min(...xs) - 0.2 || cx > Math.max(...xs) + 0.2 || cy < Math.min(...ys) - 0.2 || cy > Math.max(...ys) + 0.2) continue;
    const gap = Math.min(...zs) - top;
    if (gap > 1.5 || Math.max(...zs) < top - 0.05) continue;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { id: roof.id, gap };
  }
  return best?.id;
}
