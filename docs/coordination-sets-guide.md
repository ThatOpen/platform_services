# Coordination sets and issues — how an app keeps them

Read this before you add the issues panel (`<top-topics-panel>`), the clashes panel, or anything that makes
issues (BCF topics) to an app — and before you write the app's **Save**.

## A project holds several kinds of documents

On That Open Platform a project's files are **documents**, each of its own kind, each with its own history
(versions), its own attached files and its own permissions:

- a **BIM model** (an IFC, a model edited in an authoring app, its streamed views);
- a drawing set (sheets);
- a **Coordination Set**: the project's coordination information, across its models — its **issues** (a BCF
  file), the lenses saved with them, which buildings it opens, and who did what. Usually there is **one per
  project**.

A Coordination Set is a document like the others: it appears in the history API and in the built-in history
panel, every save is a version of it. That is the point — the project keeps not only issues that cross models,
but the whole trace of what was coordinated, when and by whom.

## Nothing is saved by itself

The built-in issues panel and the issue bubbles in 3D **do not write to the platform**. What the user makes or
changes (a new issue, an edited title, a comment, a status) is kept as a **draft** of the open Coordination Set:
it can be undone, and it is lost on reload unless the app saves it. Each issue not saved yet shows a quiet
grey **"!"** mark on its row and on its bubble.

There is **no autosave** on purpose: a version of the set per keystroke would flood its history and hit the
write limits (see `rate-limits.md`). Saving is **the app's decision**: when the user presses the app's
**Save** (or Ctrl+S), the app saves everything it owns that changed — in an authoring app, the edited models
**and** the Coordination Set if its issues changed; in an app that only reviews, just the set.

## How the app saves the issues

`TopicsManager` (a built-in of `@thatopen/services`, initialised with `init(client)`) holds the open set:

| Member | What it is |
|---|---|
| `persist(name?)` | Saves the open set: its issues as a new version in the project. A set never saved before needs a **name** the first time (`set.folderId` is `null`). |
| `dirty` | There is something to save. |
| `unsavedWork` | Leaving the page now would lose work — use it for the «Leave site?» warning. |
| `unsavedTopics()` | The issues not saved yet, by guid (the ones marked with the grey "!"). |
| `onSetChanged` | Fires when the issues or the set change, and after a save: enable or disable your Save button with it. |
| `set` | The open set: `{ folderId, name }` (`folderId` null until it is saved the first time). |

```ts
import { TopicsManager } from "@thatopen/services";

const topics = components.get(TopicsManager);

/** The app's Save: its own documents first, then the Coordination Set if its issues changed. */
async function save() {
  // await saveMyModels();                 // what else the app edits, if anything
  if (topics.dirty) {
    // A set never saved needs a name the first time: ask the user, or use a clear default.
    const name = topics.set?.folderId ? undefined : "Coordination set";
    await topics.persist(name);
  }
}

// Save button state, and the «Leave site?» warning.
topics.onSetChanged.add(() => { saveButton.disabled = !topics.dirty; });
window.addEventListener("beforeunload", (event) => {
  if (topics.unsavedWork) event.preventDefault();
});
```

Rules:

- Call `persist` **only on an explicit save** by the user (button, Ctrl+S) — never on every change, never in a
  loop. Writes are capped at 30 per minute and a `429` loses the write.
- Don't save an empty, never-saved set just because the user pressed Save: check `dirty` / `unsavedWork`.
- Don't export the BCF and upload it yourself: `persist` is what keeps the set's history, merges what other
  apps saved meanwhile, and clears the "!" marks.
- In the platform's apps, Ctrl+S is the shared shortcut «Save the changes»; give your app the same key for its
  Save.
