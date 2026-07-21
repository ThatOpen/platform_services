# GaussianSplatConverter

Convert a 3D Gaussian Splat PLY into a streamable FQ LOD tree.

Reads an uploaded .ply (plain INRIA 3DGS, or a PlayCanvas compressed.ply) and builds an octree of flat-quant (FQ) LOD nodes, published as one visible `.splat` entry whose hidden files hold the streamed nodes. The viewer fetches only the nodes it needs at the LOD it needs.

Pure CPU: no GPU, no WebGPU, no WebP, no k-means — which is what lets it run in a cloud worker at all (the splat-transform toolchain it replaces requires WebGPU). The codec and converter live in @thatopen-platform/components-beta (realityCapture); this component is only the platform I/O around it.

- **Accepts:** `.ply`
- **Produces:** `.splat`
- **Result:** the execution's `resultMessage` contains `[splatFileId=<id>]`

## Actions

| action | what it does | params |
|---|---|---|
| `default` | Convert the splat in one execution. | `fileId`, `gaussianScale` |

## Params

| id | type | label |
|---|---|---|
| `fileId` | string | Gaussian-Splat PLY File ID |
| `gaussianScale` | string | Gaussian scale (metric calibration, default 1) |

## Notes

- gaussianScale is a METRIC CALIBRATION, not a quality knob: reality-capture splats are non-metric, so this scales them to real-world metres. It is PER-CAPTURE (alcardete calibrates to ~70) — default 1, and recalibrate in the viewer.
- Spherical harmonics (view-dependent colour) are NOT carried: the FQ codec stores a flat RGBA per splat, and the renderer evaluates no SH. A capture therefore renders matte compared to its source. This is a known fidelity gap, not a bug.

## Usage

```ts
import { SplatToFq } from "@thatopen/services";

const { executionId } = await client.executeComponent(componentId, {
  projectId,
  fileId,
});

const exec = await client.getExecution(executionId);
const producedFileId = SplatToFq.parseResult(exec.resultMessage);
```
