# Field-Selection / Policy UI — Settled Decisions

> **Decision record, not a plan.** Captures UX decisions settled in the
> 2026-07-16 working session so they survive. These are the remaining-work item #4
> (config-level vs record-level exclusion) decisions from
> `2026-07-15-remaining-work.md` §2. The field-fate *tree* is already built
> (commits `f9d0ecc..260a935`); the items below are **not yet implemented**.

**Date:** 2026-07-16
**Status:** decided, unbuilt. Each becomes its own brainstorm→plan→implement cycle.

---

## 1. Config semantics: LOCKED POLICY (not defaults)

Admin config-screen fates are **hard rules**, not overridable defaults.
- **Config screen title:** "Translation policy overrides".
- **Hint below the title (verbatim):** "The policy you set here will apply to all
  workflows, single and bulk. Editors will see these as locked options that they
  cannot change."
- **Engine:** config fate is authoritative. The per-run picker is **subtractive
  only** — an editor may translate *fewer* of the policy-permitted fields/locales,
  never re-enable a field the admin set to Skip/Copy.
- **Sidebar per-field menu:** a policy Skip/Copy field shows its translate action
  **disabled with a reason** ("Set to Copy by translation policy").
- **Required-field floor** stays engine-enforced beneath the policy.
- A **partial** run within the policy is fine. There is **no** "must translate to N
  languages" policy, now or planned.

## 2. Editor-facing attribution

Anywhere an **editor** (not admin) sees the policy referenced, name its owner so
they know who to contact — e.g. "the plugin's translation policy set by your
admin". Admin-facing surfaces don't need this.

## 3. Tree styling → `datocms-react-ui`

The fate tree is functional but hand-rolled. Restyle with public components to
match the dashboard (light + dark):
- Translate/Copy/Skip → `ButtonGroup` + `ButtonGroupButton` (native selected state)
- "Show only models with a rule" → `SwitchField`; search → `TextField`
- section headers → `Section` (native collapse)
- Canvas tokens for spacing/color (`var(--spacing-l)`, `var(--color--ink-subtle)`,
  `var(--font-size-s)`); ensure the surface is inside `<Canvas ctx={ctx}>`.

## 4. Settings migration (onBoot)

`onBoot` runs in a hidden iframe (no UI), so a true modal popup is not available.
Idiomatic flow:
1. `onBoot` detects the old settings shape (TS type guards `isV1Config()` etc.),
   migrates **behavior-preservingly** (old exclusions → equivalent Skip/Copy fates),
   writes a `paramsVersion` flag (runs once), and fires `ctx.customToast()` with a
   **"Review translation settings"** CTA that `navigateTo`s the config screen.
2. The config screen detects the just-migrated flag and shows a **one-time review
   banner** on the same tree; flag clears on save.
- **Automatic, no prompt:** every released version already stored stable field ids;
  a previously-excluded *required* field → "copy from source"; a previously-excluded
  *optional* field → stays excluded.
- **Prompt ONLY** on a hand-edited bare field *name* (e.g. `title`) that matches
  several fields: "`title` matches 4 fields — which did you mean?".
- Ref: datocms.com/docs/plugin-sdk/releasing-new-plugin-versions.

## 5. Skip a whole language → "Don't translate (keep existing content)"

CMA `items.update` localized fields are **replace-not-merge**: omitting a locale
from a field you send **deletes** it (verified: item/update "Rule 1"). So a genuine
"skip = omit" is unsafe.
- Rename the option **"Don't translate (keep existing content)"**; it **echoes the
  existing locale value back** (which the engine's full-locale spread already does)
  — never omits.
- Send `meta.current_version` so a concurrent edit 422s instead of being clobbered.
- **Record the skipped locale explicitly** in the report (never silent).

## 6. Permission-filtered language list

Offer only locales the user's role can write. Show a hint below the field naming
the excluded ones, e.g. *"Excluding Chinese, Italian, and 4 other languages you
don't have permission to edit."*

## 7. Port the tree UI to the other workflows

Reuse the config screen's `FieldFateControl` / tree components (and the locked
semantics from §1) in:
- the **bulk page** (replace the `'All other locales'` magic pill / `ModelFieldPicker`)
- the **sidebar per-field** menu (disabled-with-reason for policy Skip/Copy)
- the **per-run picker** (subtractive-only buckets; §7.2 permitted-language filter)

## Still postponed (unchanged)

- Public/self-serve E2E project template (remaining-work #9).
- Pre-commit hooks for the E2E system (remaining-work #10 — parked on Marcelo's trial).

## Relationship to the plan/apply work

The **locked policy** here is exactly what feeds `buildPlan(policy, …)` in
`2026-07-16-translation-plan-design.md`. This UI produces the policy; that engine
consumes it. Independent build tracks.
