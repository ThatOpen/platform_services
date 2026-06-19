import * as OBC from "@thatopen/components";

/**
 * TEMPORARY measurement-perf profiler (the clip/gizmo streak diagnostics have been
 * removed now that those bugs are fixed; this stays one more round to confirm the
 * overlay-only cursor-repaint win, then it goes too).
 *
 *  - Press "t": ARM the profiler (resets counters, starts collecting). Move the
 *    cursor while measuring for a few seconds, then press "t" again to print the
 *    breakdown: per-phase deferred render cost, renders-per-pointer-move (cursor
 *    vs pick), snap-pick (castRay) latency, and per-pick phases (cpu=main-thread,
 *    gpu=async readback wait).
 *  - Press "T" (Shift+T): same, but with gpuSync ON — adds a gl.finish per frame
 *    for the TRUE GPU+CPU total/render (at the cost of a pipeline stall).
 */
export const diagnostics = (_components: OBC.Components) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const G = globalThis as any;

  const armPerf = (gpuSync: boolean) => {
    G.__measPerf = {
      on: true,
      gpuSync,
      frames: [],
      pickMs: [],
      gpuTotalMs: [],
      pointerEvents: 0,
      cursorRenders: 0,
      pickRenders: 0,
    };
    console.log(
      `[meas-perf] ARMED${gpuSync ? " (gpuSync ON)" : ""} — measure now, press T again to report`,
    );
  };

  const avg = (a: number[]) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  const reportPerf = () => {
    const p = G.__measPerf;
    if (!p) return;
    p.on = false;
    const frames: Record<string, number>[] = p.frames ?? [];
    const f2 = (v: number) => v.toFixed(2);
    const keys = [
      "setup",
      "capture",
      "ao",
      "composite",
      "fxaa",
      "depthOverlay",
      "overlay",
      "tail",
      "total",
    ];
    console.log(
      `[meas-perf] ===== ${frames.length} deferred render(s) over ${p.pointerEvents} pointer move(s) =====`,
    );
    for (const k of keys) {
      const vals = frames.map((fr) => fr[k] ?? 0);
      console.log(`  ${k.padEnd(13)} avg ${f2(avg(vals))} ms`);
    }
    const cpuTotal = avg(frames.map((fr) => fr.total ?? 0));
    console.log(
      `[meas-perf] CPU-submit total/render ${f2(cpuTotal)} ms (${f2(1000 / (cpuTotal || 1))} fps if CPU-bound)`,
    );
    if (p.gpuTotalMs?.length) {
      const g = avg(p.gpuTotalMs);
      console.log(
        `[meas-perf] GPU+CPU total/render ${f2(g)} ms (${f2(1000 / (g || 1))} fps real) [gl.finish, ${p.gpuTotalMs.length} samples]`,
      );
    } else {
      console.log(
        "[meas-perf] (no gpuSync samples — use Shift+T for true GPU-bound fps)",
      );
    }
    const rendersPerMove =
      p.pointerEvents > 0
        ? (p.cursorRenders + p.pickRenders) / p.pointerEvents
        : 0;
    console.log(
      `[meas-perf] renders/move ${f2(rendersPerMove)} (cursor=${p.cursorRenders} + pick=${p.pickRenders} over ${p.pointerEvents} moves)`,
    );
    console.log(
      `[meas-perf] snap-pick (castRay) avg ${f2(avg(p.pickMs ?? []))} ms over ${(p.pickMs ?? []).length} picks`,
    );
    const pick = p.pick as Record<string, { sum: number; n: number }> | undefined;
    if (pick) {
      console.log(
        "[meas-perf] --- per-pick phases (cpu=main-thread, gpu=async wait) ---",
      );
      for (const k of Object.keys(pick)) {
        const e = pick[k];
        if (e.n) console.log(`  ${k.padEnd(18)} ${f2(e.sum / e.n)} ms avg (n=${e.n})`);
      }
    } else {
      console.log("[meas-perf] (no per-pick phase data captured)");
    }
    G.__measPerf = undefined;
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "T") {
      if (!G.__measPerf) armPerf(true);
      else reportPerf();
    } else if (e.key === "t") {
      if (!G.__measPerf) armPerf(false);
      else reportPerf();
    }
  });

  console.log(
    "[diagnostics] ready — t (measurement-perf) / Shift+T (true GPU-bound fps)",
  );
};
