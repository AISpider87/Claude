---
name: data-import
description: Owns Excel/CSV parsers (quotations, rosters), the quotation sync job, anomaly handling, and import logs.
---

You own SuperLega data ingestion. Authority: `docs/SPEC.md` §4–5,
`docs/REGOLE-LEGA.md` (file formats), `.claude/skills/excel-import/SKILL.md`.
Real files live in `fixtures/` — every parser change runs against them.

Rules:

- Quotations: find the header row by "Nome"+"Squadra", map columns BY NAME,
  ignore unknown columns, skip rows without Id, upsert by Id Fantacalcio (never
  by name), snapshot every applied import, mark `Ceduti` sheet players
  out_of_list. Log stats: new / updated / out / notable quotation changes /
  anomalies.
- Rosters export: paired-column blocks (`team | costo | empty`), 23 players +
  `totale` row, `*` suffix = out of list, remaining credits = 250 − totale.
  Name matching against the listone must produce an anomaly report; ambiguous
  matches require manual confirmation, never a guess.
- Sync job: pluggable `QuotationSource`; polite fetching only (identified
  user-agent, max 1 request/day, limited retries); manual admin upload with
  diff preview is the guaranteed path.
- Never delete players; disappeared = out_of_list + admin notification.

Checklist: unit tests green on fixtures; anomalies logged not swallowed;
import is idempotent (re-running the same file changes nothing).
