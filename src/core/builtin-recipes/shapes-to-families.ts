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
    if (el.parent && writtenGids.has(el.parent)) continue;
    if (el.pieces.length === 0) continue;
    const category = SHAPE_CATEGORY[el.ifcClass.toUpperCase()] ?? GENERIC;

    // The frame: the first piece's placement, if it is upright and unmirrored only its turn about Z.
    const first = parts(el.pieces[0].matrix);
    const sx = len(first.x), sy = len(first.y), sz = len(first.z);
    const z = first.z.map((v) => v / (sz || 1));
    const upright = Math.abs(z[2] - 1) < 1e-6 && dot(cross(first.x, first.y), first.z) > 0 && Math.abs(sx - sy) < 1e-6 && Math.abs(sx - sz) < 1e-6;
    const angle = upright ? Math.atan2(first.x[1], first.x[0]) : 0;
    const c = Math.cos(-angle), sn = Math.sin(-angle);
    const at = first.t;
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
