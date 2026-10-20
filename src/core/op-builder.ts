/**
 * Authors an interoperability OPERATION — the set of changes a recipe asks of
 * one document — and hands back its bytes: what a native application's plugin
 * applies, in one transaction.
 *
 * WHY THIS EXISTS AND WHY IT LOOKS LIKE THIS. An operation is carried as a
 * .frag with no geometry at all: the envelope in `Model.metadata`, and one
 * geometry-less item per change whose attributes ARE the change. That was
 * cheap on the C# side, which already had a writer, and it is the reason a
 * converter had to be a console tool once: nothing in the browser could
 * produce one. So the format stayed, and this builds it here instead.
 *
 * Nothing above this class needs to know any of that. You say add / set /
 * remove and get the bytes of a recipe's result.
 *
 * WHAT IT DOES NOT DO. It does not translate. Attributes are written exactly
 * as given, in the TARGET application's own terms and units, because data
 * that gets translated on the way in has to be untranslated on the way out
 * and the day somebody forgets a field nothing complains. Deciding what a
 * Rhino layer means in Revit is the recipe's job; this only carries the
 * answer.
 *
 * DEPENDENCIES, loaded at build() time and declared as OPTIONAL PEERS:
 * `@thatopen/fragments` (the .frag schema) and `flatbuffers`. An app that
 * authors operations has both already; everything else in this package works
 * without them.
 */

type FlatbuffersModule = typeof import('flatbuffers');
type FragmentsSchema = typeof import('@thatopen/fragments');

/**
 * The reserved namespace. Everything under it is addressed to the applier and
 * is never data, so an applier skips the whole prefix rather than the names
 * it happens to know — which is what lets an author record something for its
 * OWN later use without the other side being taught what it means.
 */
const RESERVED = 'flow:';

/** The verb. An instruction sitting among data, which is why it is prefixed. */
const OP_KEY = 'flow:op';

/**
 * Where a change came from, in the author's own terms.
 *
 * NOT a link between elements — nothing is written into either model. It
 * lives on the OPERATION, which is the record of what somebody asked for,
 * and it is what lets a recipe be self-contained: "what did I already make
 * for this object" is answered by reading the queue the platform already
 * keeps, instead of a private file that a second machine does not have and a
 * lost machine takes with it.
 */
const SOURCE_KEY = 'flow:source';

/** The schema this writes. An applier that speaks a different one must refuse rather than guess. */
export const OP_SCHEMA = 'revitflow/op@2';

const CATEGORY_CHANGE = 'REVITFLOWCHANGE';
const CATEGORY_OPERATION = 'REVITFLOWOPERATION';

export interface OperationTarget {
  /** Platform project id. */
  project: string;
  /** Document name within the project — the model these edits are for. */
  document: string;
  /**
   * The commit this was authored against. The elements named here existed
   * then; by the time somebody applies it they may not, and the applier
   * reports what it could not resolve.
   */
  baseCommit: number;
  /** Who authored it, for the history. */
  author?: string;
  /** Platform user id, so the same person is not two names depending on which tool wrote it. */
  userId?: string;
  /** Groups the operations one authored action produced across several models. */
  batchId?: string;
  title?: string;
}

/** Where an added item goes, and how it is turned, in the target's own terms. */
export interface Placement {
  /** [x, y, z] in the TARGET model's own units and axes. Not converted here. */
  position?: [number, number, number];
  /** Degrees about Z, in the target's convention. */
  rotationDeg?: number;
  /**
   * The id of the object that caused this change, in the AUTHOR's own terms —
   * a Rhino guid, a row of a spreadsheet, whatever asked for it. Optional, and
   * only useful to whoever wrote it: pass it when you expect to come back and
   * find what you created.
   */
  source?: string;
}

export class OperationBuilder {
  private readonly changes: {
    op: 'add' | 'set' | 'remove';
    item?: string;
    attrs: Record<string, string>;
  }[] = [];

  constructor(private readonly target: OperationTarget) {}

  /** How many changes are queued. An operation with none is refused by `build`. */
  get length(): number {
    return this.changes.length;
  }

  // The envelope, readable. Whoever writes the queue entry has to put the SAME
  // values in it as the payload carries — an entry that disagrees with its own
  // payload is a row describing a different operation — so they are exposed
  // here rather than passed twice by every caller.
  get batchId(): string | undefined {
    return this.target.batchId;
  }
  get title(): string {
    return this.target.title ?? `${this.changes.length} change(s)`;
  }
  get author(): string {
    return this.target.author ?? 'app';
  }
  get userId(): string | undefined {
    return this.target.userId;
  }
  get baseCommit(): number {
    return this.target.baseCommit;
  }

  /**
   * Create something. There is no id yet: the attributes describe what it is,
   * the placement says where it goes, and the operation answers with the id
   * it got.
   */
  add(attrs: Record<string, string>, placement: Placement = {}): this {
    this.changes.push({ op: 'add', attrs: this.pack(attrs, placement) });
    return this;
  }

  /** Write attributes onto an item that already exists, named by the id the target published. */
  set(
    item: string,
    attrs: Record<string, string>,
    placement: Placement = {},
  ): this {
    this.requireId(item, 'set');
    this.changes.push({ op: 'set', item, attrs: this.pack(attrs, placement) });
    return this;
  }

  /** Delete an item. Whatever the target cascades along with it is reported, not guessed at here. */
  remove(item: string): this {
    this.requireId(item, 'remove');
    this.changes.push({ op: 'remove', item, attrs: {} });
    return this;
  }

  /**
   * A label for what this operation mostly does. Derived, never read to
   * decide anything: one operation may add, set and remove at once and still
   * be atomic, so what each change does is written on the change.
   */
  get summary(): 'add' | 'set' | 'remove' | 'mixed' {
    const kinds = new Set(this.changes.map((c) => c.op));
    return kinds.size === 1 ? [...kinds][0] : 'mixed';
  }

  /**
   * The .frag bytes, zlib-deflated, ready to upload as the operation's
   * payload.
   *
   * `opId` is taken rather than generated so the caller can put the same id
   * in the queue entry it writes next ({@link Recipes} mints it before the
   * run); an id this class invented and did not return would have to be dug
   * back out of the bytes.
   */
  async build(opId: string): Promise<Uint8Array> {
    if (this.changes.length === 0) {
      throw new Error(
        'An operation with no changes is not an operation. Add at least one.',
      );
    }

    const envelope = {
      schema: OP_SCHEMA,
      opId,
      // Through the getters, so the envelope and the queue entry cannot drift
      // into disagreeing about the same operation.
      batchId: this.batchId ?? opId,
      targetProject: this.target.project,
      targetDocument: this.target.document,
      baseCommit: this.baseCommit,
      author: this.author,
      ...(this.userId ? { userId: this.userId } : {}),
      title: this.title,
      summary: this.summary,
    };

    const [flatbuffers, schema] = await loadDependencies();
    return deflate(
      this.flatbuffer(flatbuffers, schema, opId, JSON.stringify(envelope)),
    );
  }

  // ---------------------------------------------------------------------------------------------

  /** Placement rides in the attributes, in the same string form the target published. */
  private pack(
    attrs: Record<string, string>,
    placement: Placement,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs ?? {})) {
      // The protocol's namespace is ours, not the data's: nobody sets it through attributes.
      if (k.startsWith(RESERVED)) continue;
      out[k] = String(v);
    }
    if (placement.position) out.Position = placement.position.map(num).join(',');
    if (placement.rotationDeg !== undefined)
      out.Rotation = num(placement.rotationDeg);
    if (placement.source) out[SOURCE_KEY] = placement.source;
    return out;
  }

  private requireId(item: string, verb: string): void {
    if (!item || !item.trim()) {
      throw new Error(`A '${verb}' has to name the item it acts on.`);
    }
  }

  /**
   * The buffer itself.
   *
   * Laid out exactly as the C# writer lays it out, because the add-in's
   * reader is the one that has to accept both: items first and the container
   * after, ids handed out by one monotonic counter, attributes as
   * `[name, value, type]` JSON triples, and a Meshes table that exists but is
   * empty.
   *
   * Empty rather than absent: the reader asks for it unconditionally, and a
   * model that draws nothing is still a model. Nothing here gets a sample —
   * an item with no triangles must not have one, because a sample's bounding
   * box would then have no size and the reader turns a box into a "dimension"
   * and rejects a falsy one.
   */
  private flatbuffer(
    flatbuffers: FlatbuffersModule,
    schema: FragmentsSchema,
    opId: string,
    metadata: string,
  ): Uint8Array {
    const { Attribute, Meshes, Model, SpatialStructure, Transform } = schema;
    const b = new flatbuffers.Builder(1024);
    const n = this.changes.length;

    // ids: one counter across everything. Changes take 1..n, the container
    // that groups them takes n+1, and max_local_id is the next free one.
    const itemIds = new Uint32Array(n);
    let next = 1;
    for (let i = 0; i < n; i++) itemIds[i] = next++;
    const containerId = next++;

    // ---- Meshes: present, and entirely empty. ----
    const emptyOffsets = (start: (bb: typeof b, k: number) => void) => {
      start(b, 0);
      return b.endVector();
    };
    const shells = Meshes.createShellsVector(b, []);
    const circleExtrusions = Meshes.createCircleExtrusionsVector(b, []);
    const samples = emptyOffsets(Meshes.startSamplesVector);
    const representations = emptyOffsets(Meshes.startRepresentationsVector);
    const materials = emptyOffsets(Meshes.startMaterialsVector);
    const localTransforms = emptyOffsets(Meshes.startLocalTransformsVector);
    const globalTransforms = emptyOffsets(Meshes.startGlobalTransformsVector);
    const meshesItems = Meshes.createMeshesItemsVector(b, []);
    const materialIds = Meshes.createMaterialIdsVector(b, []);
    const representationIds = Meshes.createRepresentationIdsVector(b, []);
    const sampleIds = Meshes.createSampleIdsVector(b, []);
    const localTransformIds = Meshes.createLocalTransformIdsVector(b, []);
    const globalTransformIds = Meshes.createGlobalTransformIdsVector(b, []);

    Meshes.startMeshes(b);
    // Written INLINE, and it has to be: a flatbuffers struct is serialised
    // into its parent, not referenced, so building it before startMeshes
    // throws "struct must be serialized inline". The model's own coordinate
    // system, identity because an operation places nothing globally.
    Meshes.addCoordinates(b, Transform.createTransform(b, 0, 0, 0, 1, 0, 0, 0, 1, 0));
    Meshes.addGlobalTransforms(b, globalTransforms);
    Meshes.addShells(b, shells);
    Meshes.addRepresentations(b, representations);
    Meshes.addSamples(b, samples);
    Meshes.addLocalTransforms(b, localTransforms);
    Meshes.addMaterials(b, materials);
    Meshes.addCircleExtrusions(b, circleExtrusions);
    Meshes.addMeshesItems(b, meshesItems);
    Meshes.addRepresentationIds(b, representationIds);
    Meshes.addSampleIds(b, sampleIds);
    Meshes.addMaterialIds(b, materialIds);
    Meshes.addLocalTransformIds(b, localTransformIds);
    Meshes.addGlobalTransformIds(b, globalTransformIds);
    const meshes = Meshes.endMeshes(b);

    const metadataOffset = b.createString(metadata);

    // ---- Attributes: one entry per item, changes then container. ----
    const unique = new Set<string>();
    const attributeOffsets: number[] = [];
    for (const change of this.changes) {
      const triples: number[] = [];
      const props: Record<string, string> = {
        [OP_KEY]: change.op,
        ...change.attrs,
      };
      for (const [name, value] of Object.entries(props)) {
        const json = JSON.stringify([name, value, 'IFCTEXT']);
        unique.add(json);
        triples.push(b.createString(json));
      }
      attributeOffsets.push(
        Attribute.createAttribute(b, Attribute.createDataVector(b, triples)),
      );
    }
    {
      const json = JSON.stringify(['Name', opId, 'IFCLABEL']);
      unique.add(json);
      const data = Attribute.createDataVector(b, [b.createString(json)]);
      attributeOffsets.push(Attribute.createAttribute(b, data));
    }
    const attributes = Model.createAttributesVector(b, attributeOffsets);
    const uniqueAttributes = Model.createUniqueAttributesVector(
      b,
      [...unique].map((s) => b.createString(s)),
    );

    // ---- Categories, parallel to local_ids. ----
    const categoryOffsets = this.changes.map(() =>
      b.createString(CATEGORY_CHANGE),
    );
    categoryOffsets.push(b.createString(CATEGORY_OPERATION));
    const categories = Model.createCategoriesVector(b, categoryOffsets);

    // ---- Guids: only the changes that name something. An `add` names nothing yet. ----
    const guidOffsets: number[] = [];
    const guidItems: number[] = [];
    this.changes.forEach((change, i) => {
      if (!change.item) return;
      guidOffsets.push(b.createString(change.item));
      guidItems.push(itemIds[i]);
    });
    const guids = Model.createGuidsVector(b, guidOffsets);
    const guidsItems = Model.createGuidsItemsVector(b, guidItems);

    const localIds = Model.createLocalIdsVector(b, [...itemIds, containerId]);

    // ---- Spatial structure: the operation, with every change hanging off it. ----
    const leaves = this.changes.map((_, i) =>
      SpatialStructure.createSpatialStructure(
        b,
        itemIds[i],
        b.createString(CATEGORY_CHANGE),
        0,
      ),
    );
    const spatial = SpatialStructure.createSpatialStructure(
      b,
      containerId,
      b.createString(CATEGORY_OPERATION),
      SpatialStructure.createChildrenVector(b, leaves),
    );

    const modelGuid = b.createString(opId);

    Model.startModel(b);
    Model.addMeshes(b, meshes);
    Model.addMetadata(b, metadataOffset);
    Model.addAttributes(b, attributes);
    Model.addUniqueAttributes(b, uniqueAttributes);
    Model.addLocalIds(b, localIds);
    Model.addCategories(b, categories);
    Model.addGuidsItems(b, guidsItems);
    Model.addGuids(b, guids);
    Model.addGuid(b, modelGuid);
    Model.addSpatialStructure(b, spatial);
    Model.addMaxLocalId(b, next);
    const model = Model.endModel(b);

    // WITH the file identifier the schema declares. A buffer finished without
    // it is readable by something that does not check and rejected by
    // everything that does.
    Model.finishModelBuffer(b, model);
    return b.asUint8Array();
  }
}

/**
 * The optional peers, resolved when an operation is actually built — so apps
 * that never author operations pay nothing and need nothing installed.
 */
async function loadDependencies(): Promise<[FlatbuffersModule, FragmentsSchema]> {
  try {
    return await Promise.all([
      import('flatbuffers'),
      import('@thatopen/fragments') as Promise<FragmentsSchema>,
    ]);
  } catch (cause) {
    throw new Error(
      'OperationBuilder needs the optional peers `flatbuffers` and ' +
        '`@thatopen/fragments` installed — add them to the app that authors ' +
        `operations. (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}

/**
 * The number as text, round-trippable. `Position` and `Rotation` are strings
 * because every attribute is a string; writing them with the shortest form
 * that reads back identically is what keeps "9000 mm" from arriving as
 * 8999.999999999998.
 */
function num(v: number): string {
  return Number.isFinite(v) ? String(v) : '0';
}

/**
 * zlib, which is what the reader inflates — NOT raw deflate.
 * `CompressionStream("deflate")` is the zlib-wrapped one and `"deflate-raw"`
 * is the bare stream, and picking the wrong one produces a file that fails at
 * the first byte with an error about the format rather than about the choice.
 *
 * Native on both sides, so this costs no dependency in the browser and none
 * in a test runner.
 */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
