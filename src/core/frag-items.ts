/**
 * Reads what a .frag SAYS — its metadata and its items' guids, categories and
 * attributes — without loading it as something to look at.
 *
 * The fragments model loader is for models somebody will render: it starts
 * workers, builds tiles and boxes, and streams geometry. A recipe wants none
 * of that. It wants the data, it wants it synchronously enough to loop over,
 * and it wants it for files that may have no geometry at all.
 *
 * So this walks the flatbuffer directly, using the same schema the writer
 * uses, which also keeps the two honest about each other. The schema comes
 * from the OPTIONAL PEER `@thatopen/fragments` (plus `flatbuffers`), loaded
 * when `readFrag` runs — same arrangement as {@link OperationBuilder}.
 */

type FlatbuffersModule = typeof import('flatbuffers');
type FragmentsSchema = typeof import('@thatopen/fragments');

export interface FragItem {
  localId: number;
  /** The publisher's own id for this thing — a Rhino object guid, a Revit UniqueId. */
  guid: string | null;
  category: string | null;
  attrs: Record<string, string>;
}

export interface FragContents {
  /** Whatever the publisher declared: units, axes, application. Parsed, or `{}` if unreadable. */
  metadata: Record<string, unknown>;
  /** In file order, which for an operation payload is the order the ids come back in. */
  items: FragItem[];
}

export async function readFrag(bytes: Uint8Array): Promise<FragContents> {
  const [flatbuffers, schema] = await loadFragDependencies();
  const model = schema.Model.getRootAsModel(
    new flatbuffers.ByteBuffer(await inflate(bytes)),
  );

  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(model.metadata() ?? '{}');
  } catch {
    // Unreadable metadata is worth carrying on past: the items are still the
    // point, and a caller that needs the units will say so itself when it
    // cannot find them.
  }

  // Sparse: guids_items[k] names the local_id that owns guids[k].
  const guidByLocalId = new Map<number, string>();
  for (let k = 0; k < model.guidsLength(); k++) {
    const owner = model.guidsItems(k);
    const guid = model.guids(k);
    if (owner !== null && guid) guidByLocalId.set(owner, guid);
  }

  const items: FragItem[] = [];
  for (let i = 0; i < model.attributesLength(); i++) {
    const localId = model.localIds(i);
    if (localId === null) continue;

    const attrs: Record<string, string> = {};
    const attribute = model.attributes(i);
    for (let d = 0; d < (attribute?.dataLength() ?? 0); d++) {
      const triple = attribute!.data(d);
      if (!triple) continue;
      try {
        // [name, value, type]. The type is the format's business.
        const [name, value] = JSON.parse(triple) as [string, string, string];
        attrs[name] = value;
      } catch {
        /* one unreadable attribute must not cost the item it belongs to */
      }
    }

    items.push({
      localId,
      guid: guidByLocalId.get(localId) ?? null,
      category: model.categories(i) ?? null,
      attrs,
    });
  }

  return { metadata, items };
}

/**
 * The optional peers, resolved on first read. In an app they are installed
 * (and often aliased); in plain Node the fragments root also pulls what IT
 * imports (web-ifc, three) — the error says so instead of hiding it.
 */
async function loadFragDependencies(): Promise<
  [FlatbuffersModule, FragmentsSchema]
> {
  try {
    return await Promise.all([
      import('flatbuffers'),
      import('@thatopen/fragments') as Promise<FragmentsSchema>,
    ]);
  } catch (cause) {
    throw new Error(
      'readFrag needs the optional peers `flatbuffers` and ' +
        '`@thatopen/fragments` resolvable (in Node, fragments also pulls its ' +
        `own imports, e.g. web-ifc). (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}

/** zlib, matching every writer of this format. `deflate-raw` fails on the first byte. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
