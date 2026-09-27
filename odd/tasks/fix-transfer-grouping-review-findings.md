# Fix — transfer grouping review findings

## Objective

Close three defects in the transfer grouping shipped in #80, all found by an
**independent review after the feature was merged to `main`**, all reproduced with
runtime probes first. Every finding is import-reachable: `replaceAll` keeps whatever
`id` and `date` each leg had in the file, and `validateImportJson` checks neither id
uniqueness nor date coherence between the legs of one `transferId`. The normal
`transferFunds` path cannot produce any of them. Debt items D1, D2 and D3 in
`group-transfers-in-transaction-history.md` were factually wrong and are corrected
there by this change.

## Finding 1 — `removeTransfer` corrupted the daily allowance

`hooks/use-budget.tsx`, `removeTransfer`. The removed block netted the legs dated
today and moved `remainingToday`/`progress` when that net was non-zero.
`transferFunds` stamps both legs with `today`, so the net is 0 and the block never
ran on local data — which is why it read as dead code. On imported data with
divergent leg dates the net is a lone leg, the branch runs, and it credits back an
amount that was never debited anywhere:

- **daily** — `remainingToday` 0 → **300**, `progress` 0 → **342.86%**, persisted to
  `daily-budget-data` and surviving a reload.
- **track** — `dailyAllowance` is 0, so the division by zero gave `progress`
  **`Infinity`**, which `JSON.stringify` writes as **`null`**. That blob is exactly
  what `components/sync/sync-qr-modal.tsx` ships over QR sync, so the bad value could
  reach another device.

Re-measured during this fix: track mode is `progress = Infinity` in state, `null` on
disk. The day-check effect only runs on a day change, which is how the values persist.

**Fix:** the `remainingToday`/`progress` mutation is deleted outright. A transfer is
not spending — the money stays inside the app — so `transferFunds` never moves the
allowance and its inverse must not either. True for every case, divergent dates
included. The misleading comment is replaced by the real invariant; no guard is left
pretending to protect something.

## Finding 2 — a grouped row could display a date older than the row above it

`components/transaction-history.tsx`, `buildHistoryRows` / `toRowView`. The row's
**position** was anchored on `legs[0]` (first-seen = most recent) while the displayed
`date` came from `from`, chosen by **sign**. When the positive leg is newer than the
negative one, a row labelled with the older date rendered above a newer one — legs
`+300` today and `-300` five days ago, plus a `-50` expense two days ago, rendered as
`["22 Sep Transfer between...", "25 Sep Noise..."]`.

**Fix:** the anchor leg is carried on the transfer `HistoryRow` and is what
`toRowView` renders as the date, so position and label come from the same leg and
cannot disagree. A `single` row is unaffected, and a well-formed group shares one
date across both legs, so the normal path is unchanged.

## Finding 3 — a group whose legs share one `id` rendered twice

`components/transaction-history.tsx`, `buildHistoryRows`. The anchor was
`if (transaction.id !== legs[0].id) continue`. With both legs carrying the same `id`
both iterations passed it and the row was pushed twice — duplicate visible content,
not just a warning (4 React "same key" warnings: 2 desktop rows + 2 mobile rows).

**Fix:** the group is no longer anchored on leg identity. A `Set<string>` of
`transferId`s already emitted in the pass decides emission, which is
order-independent and does not assume ids are unique. `legs[0]` stays the anchor for
position and date.

**Also closed, at effectively zero cost:** render keys are namespaced by row kind —
`tx:${id}` for `single`, `tr:${transferId}` for `transfer` — on both `HistoryRow.key`
and `RowView.key`. This closes the pre-existing "duplicate React key" debt item, where
an imported transaction `id` equal to another transaction's `transferId` produced the
same warning.

## Verification

- `pnpm exec vitest run`: **165/165 in 14 files** (160 baseline + 5 new).
- `pnpm exec tsc --noEmit`: **exit 0**. `pnpm lint`: **0 errors**, 5 pre-existing
  warnings, unchanged.
- **Mutation-checked:** against the pre-fix sources, reverting
  `components/transaction-history.tsx` fails all 3 new history tests (22 existing still
  pass); restoring the `removeTransfer` block fails both new hook tests with
  `remainingToday` 300 against the expected 0 (24 existing still pass). Not vacuous.

## Out of scope

- The pre-existing `removeTransaction` progress bug (a single-leg delete inflates
  `progress` past 100%). Deliberately untouched.
- D4: `RecentTransactions` still shows both legs, so overview and history disagree on
  movement count. Still open. The `calculateDailyAllowance` refactor is untouched too.

## Next steps

1. Push and PR are the user's call. Commit type `fix`, scope `history` + `budget`.
2. Worth considering separately: validating date coherence and id uniqueness in
   `validateImportJson` would remove the import surface these three findings shared,
   instead of relying on the consumers to be defensive.
