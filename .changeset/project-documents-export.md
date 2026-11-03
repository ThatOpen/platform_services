---
'@thatopen/services': minor
---

`exportProjectDocuments(projectId, { format? })`: a project's documents as one flat table for BI and spreadsheets — a row per file with its folder path, live version and every metadata field as a `meta.<key>` column; JSON rows by default, CSV text with `format: 'csv'`. Needs the platform's `GET /item/export`.
