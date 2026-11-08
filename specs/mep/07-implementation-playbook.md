# Implementation playbook: a suggested way to tackle a capability

**Status:** Draft · **Last updated:** 2026-07-29

The other files say *what* is needed. This one is a **suggestion** for how to work when you
(AI agent, a third-party app builder, or an engineer who codes) pick a
capability from [`06-open-source-engines.md`](./06-open-source-engines.md) and decide to try
building it. It is a proposal / suggestion from one MEP engineer, not a mandated process.

The reason it is written as stage gates is a specific failure mode: three months of
integration work on an engine that a licence clause, a memory ceiling or a wrong number
would have disqualified in week one. Every stage ends with an **exit gate**, evidence that
should exist before moving on. Stopping at a gate is a legitimate outcome.
**A documented "we tried X and it fails because Y" is a contribution**, and belongs in this
folder next to the successes so nobody pays for the same discovery twice.

---

## Stage 0: Pick and scope

Pick one `MEP-CAP-*`. Read its **Model inputs**, **Gaps to build** and **Legal** sections
before anything else. They are the map of what you are signing up for.

Then cut the thinnest vertical slice that still proves the whole chain. Not "hydronic
calculations" but *one closed heating circuit, one pump, five radiators, sized and written
back*. Not "heat loads" but *one room with two external walls and a window, compared
against a hand calculation*. The slice must exercise every link (model → contract → engine →
results back), because the links are where integrations die, not the middles.

**Exit gate.** A one-page scope: the capability, the slice, the engine candidate(s), and
which `MEP-DATA-*` blocks the slice needs. If the platform cannot supply those blocks yet,
say how the POC will fake them. Hand-authored input is fine at POC stage. Silence about it
is not.

---

## Stage 1: Documentation and API analysis

Read before writing. For the engine:

- **API surface and I/O formats.** Is there a real API (EPANET's toolkit, OpenStudio's SDK),
  or only input files and a binary? File-only is workable (that is what `MEP-INT-02`
  isolation assumes), but it changes the adapter design.
- **Project health.** Last release, issue activity, maintainer responsiveness, open source
  or merely source-visible. An abandoned engine can still be the right choice (EPANET's core
  moves slowly because it is *finished*), but choose it knowingly.
- **Runtime shape.** Language, platform support (a Windows-only toolchain matters for a
  Linux cloud runtime, CONTAM being the example to check), memory and wall-clock behaviour
  at realistic model sizes, and the licence of the *dependencies*, not just the engine.
- **Numerical behaviour.** Solver convergence controls, unit conventions, known limitations.
  The documentation of a thirty-year-old engine usually contains its whole failure
  catalogue. Read it. It is the cheapest testing you will ever do.

And for the platform side: which of the needed `MEP-DATA-*` blocks exist today, which are
coming with the semantic layer, which need faking. This is also the moment to re-read
[`MEP-INT-01`](./06-open-source-engines.md) so the adapter you sketch matches the pattern
everyone else will follow.

**Exit gate.** A short written analysis: chosen engine and why, API/IO route, runtime
constraints, and the list of platform data dependencies with their status.

---

## Stage 2: Licensing deep-dive

The tables in [`06`](./06-open-source-engines.md) are triage, not clearance. Before code:

- **Read the actual licence file** of the engine version you will ship, not the project's
  website summary. Check: commercial use, redistribution of modified and unmodified
  binaries, attribution wording, patent clauses, trademark restrictions (EnergyPlus), and
  whether the licence differs between the engine and its GUI or tooling (it often does).
- **Dependencies too.** A BSD engine with a GPL dependency is a GPL question.
- **Data licences separately from code licences.** Weather files, material databases,
  example networks, fitting-loss datasets. Each has its own terms, and "came with the
  engine" is not a licence.
- **AI-tooling restrictions.** This one is new and easy to walk into. Some documentation and
  most standards explicitly forbid ingestion by AI tools. **ASHRAE prohibits feeding its
  publications into AI systems. CEN, ISO and national standards bodies assert the same
  through copyright.** Practically: you may not paste standard text, tables or worked
  examples into an AI assistant while implementing a normative layer, and you may not use
  scanned standards as context for code generation. Work from your purchased copy manually,
  implement the *method*, cite clause numbers, and point AI tools only at your own code and
  at documentation whose licence permits it. The same caution applies to manufacturer
  catalogues.
- **Anti-benchmarking clauses.** Relevant to Stage 4: several commercial EULAs forbid
  publishing comparative results. If your validation plan includes "compare against
  commercial tool X", check X's EULA *now*, not after you have the numbers.

**Exit gate.** A licence record for the manifest (`MEP-INT-05`): engine, version, licence,
obligations, AI-ingestion restrictions on any reference material used, and a
green/amber/red verdict. Red means stop. Write down why. That is the cheap version of this
whole playbook.

---

## Stage 3: Proof of concept, on the platform

The POC is not "the engine runs on my laptop". It is **the basic functionality working
inside That Open Platform, end to end**: model data in, engine run, result back where a user
can see it. The question a POC must answer is not only *is the physics feasible* but *is
this integrable*. Engines rarely kill integrations. The wiring does, and the wiring only
gets tested by wiring it.

Two passes, in order:

**Pass 1: engine standalone.** Hand-authored input, answer checked against a hand
calculation. If you cannot make the engine produce a correct number by hand, the platform
work would only automate your confusion. Cheap, one or two days, done first.

**Pass 2: the same slice through the platform.** The real POC:

- The slice runs as a **cloud component** (or in-app for the small WASM-able engines):
  read the model data (real where the platform has it, stubbed where it does not, with the
  stubs listed), generate the engine input, execute, parse, and write the result back onto
  the model elements or surface it in a panel.
- This deliberately exercises the platform's actual seams: which
  [`MEP-DATA-*`](./06-open-source-engines.md) blocks are reachable today, whether the
  runtime can host the engine at all (native binary or not, open question 1 in
  [`06`](./06-open-source-engines.md)), execution limits, and whether results have anywhere
  sane to land ([`MEP-CALC-04`](./04-calculations.md)). Every one of those answers is worth
  more than the calculation itself.
- The example stays **small enough to check by hand**: one room, one circuit, one board.
  The point is a number verifiable on paper travelling the full path, not a demo that looks
  alive.
- Throwaway code is allowed and expected. The POC answers questions. It does not become the
  adapter.
- Measure on the way through: runtime, memory, input size at realistic scale, and the
  platform round-trip overhead on top of the bare engine run.
- Probe failure modes on purpose (a disconnected network, a missing U-value, a zero-flow
  branch) at *both* layers: how the engine fails, and how the platform behaves when it does.

**Exit gate.** A go/no-go note with evidence: the hand calculation, the same number arriving
back through the platform, the delta, runtime and memory figures, the list of stubbed data
blocks and platform gaps hit, and the surprises. "Feasible but not yet integrable, blocked
on X" is a legitimate and valuable verdict. It converts an integration unknown into a
concrete platform requirement. No-go with reasons is a full-credit exit.

---

## Stage 4: Validation with documented evidence

The stage that makes the result signable, per `MEP-INT-06`. An engineer will not trust a
tool they have not seen reproduce a known answer, and neither will their insurer.

- **Prefer public benchmarks**: ASHRAE 140 for building energy, EPANET's published example
  networks for hydraulics, textbook worked examples with printed solutions for the normative
  layers. Public benchmarks can be republished. Commercial comparisons often cannot
  (Stage 2).
- Where the reference is a recognised commercial tool, run it under a licence you hold,
  record tool and version, and check the EULA before publishing the comparison.
- **State the tolerance before running**, and justify it. "Within 2% of the benchmark" is a
  claim. "Close enough" is not.
- **The adapter must not change the engine's answer.** Validate in two layers: engine versus
  benchmark (is the physics right), and adapter-driven versus hand-driven engine run on
  identical input (is the adapter faithful). A deviation in the second layer is always a bug.
- Publish the evidence in the repo: inputs, outputs, references, deltas, and the script that
  reruns it. Validation that cannot be rerun rots. Make it CI, not a PDF.

**Exit gate.** The validation dossier is in the repo and reruns clean. Every number the
adapter will write back to the model is covered by at least one benchmarked path.

---

## Stage 5: Implementation, then users

Only now the real adapter, built to the patterns already specified:

- Adapter shape and readiness checking per `MEP-INT-01`. Process isolation per
  `MEP-INT-02`. Traceability of every result per [`MEP-CALC-04`](./04-calculations.md).
  Staleness per [`MEP-CALC-06`](./04-calculations.md). **Missing model data fails loudly,
  per element**, never silently defaulted.
- Grow feature by feature *behind the validation corpus*: each new capability slice gets its
  benchmark before it gets merged. The corpus only grows.
- **Get it onto a real project model early**: a live one, with its real gaps and its real
  mess, run in shadow next to the engineer's current tool for a few weeks. The deltas are
  the feedback. Real models are where "Reality today" in the
  [`MEP-DATA-*` table](./06-open-source-engines.md) stops being a column and starts being
  your bug tracker.
- Close the loop visibly: feedback → issue → fix or documented won't-fix. An engineer who
  stops reporting has usually also stopped using the tool.
- Version the adapter, pin the engine (`MEP-INT-02`), and state loudly what the tool does
  **not** do. In engineering software, unstated limitations are how people get hurt. Stated
  ones are how tools get trusted.

**Exit gate.** This one never closes. It is a loop: users, feedback, corpus, release.

---

## The short version

**Read → clear the licence → prove it on paper, then end-to-end on the platform → prove it
against a benchmark → build it → put it in front of a real engineer.** Two rules apply at
every stage. Stopping with a documented reason is a contribution, not a failure. And no
number reaches the model that cannot be traced to evidence somebody can rerun.

Treat all of it as a starting point, not a rulebook. If your capability needs a different
path, take it and write down why. That note improves this file for the next person.
