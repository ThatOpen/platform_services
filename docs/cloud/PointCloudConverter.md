# PointCloudConverter

Convert a LAS point cloud into a streamable Potree 2.0 octree.

Reads an uploaded .las and builds a Potree 2.0 octree (metadata.json + hierarchy.bin + chopped octree pieces), published as one visible `.potree` entry whose hidden files hold the streamed chunks. The viewer byte-ranges those chunks, so a cloud opens without downloading it whole.

The conversion itself lives in @thatopen-platform/components-beta (realityCapture); this component is only the platform I/O around it.

- **Accepts:** `.las`
- **Produces:** `.potree`
- **Result:** the execution's `resultMessage` contains `[potreeFileId=<id>]`

## Actions

| action | what it does | params |
|---|---|---|
| `SIMPLE` | Build the whole cloud in ONE execution. The default, and what you almost always want. | `fileId` |
| `PLAN` | For clouds too big for SIMPLE: stream the source once and return an adaptive set of tiles that each fit a worker. | `fileId`, `K` |
| `BUILD` | Build ONE tile of a PLAN as an aligned subtree of the global octree. Fired once per tile. | `grid`, `cell`, `entryId`, `shards` |
| `MERGE` | Graft the built tiles into one global octree and publish the `.potree` entry. The tiles' bytes are referenced, never copied. | `grid`, `tiles`, `entryId` |

## Params

| id | type | label |
|---|---|---|
| `action` | string | Action (SIMPLE|PLAN|BUILD|MERGE) |
| `fileId` | string | LAS Point Cloud File ID |
| `K` | number | Split level (PLAN) |
| `grid` | string | Global grid JSON (BUILD/MERGE) |
| `cell` | string | Cell name (BUILD) |
| `tiles` | string | Tile descriptors JSON (MERGE) |
| `entryId` | string | Shared entry item id (BUILD/MERGE) |
| `shards` | string | Cell LAS shard hidden-file ids JSON (BUILD cell-file mode) |

## Notes

- PLAN/BUILD/MERGE is a MEMORY workaround, not a speed feature — a billion-point cloud cannot fit in one worker. It needs many chained executions, and the platform's file API is whole-file-only (it ignores HTTP Range) at ~7 MB/s, so a 50GB / 2B-point cloud would spend ~9 hours just moving bytes, most of it network. Convert those OFFLINE and upload the .potree directly.
- LAZ is not supported (it is compressed; the LASF signature check rejects it).

## Usage

```ts
import { LasToPotree } from "@thatopen/services";

const { executionId } = await client.executeComponent(componentId, {
  projectId,
  fileId,
  action: "SIMPLE",
});

const exec = await client.getExecution(executionId);
const producedFileId = LasToPotree.parseResult(exec.resultMessage);
```
