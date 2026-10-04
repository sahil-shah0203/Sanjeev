# Phase 4.5 — Student-first UI and bounded AI study mode

**Status:** Implementation brief for the next product pass  
**Product:** Sanjeev (currently branded Recall in parts of the app)  
**Scope:** Learner-facing navigation, visual identity, settings simplification, tutorial/help, and a small opt-in AI question pilot grounded in a learner’s Anki content.

This document turns the current product feedback into an implementation brief. It is a proposed beta iteration, not evidence that any study method improves learning. Read this alongside [`01_learning_research_and_product_rules.md`](../01_learning_research_and_product_rules.md), [`02_app_build_specification.md`](../02_app_build_specification.md), and [`phase-4-beta.md`](phase-4-beta.md). If a detail here conflicts with a safety or data-integrity rule in those documents, preserve the stronger safety/data rule and record the discrepancy.

## 1. Goal and product promise

Make the app understandable to a busy medical student on first use. A student should be able to import an existing deck, understand what is due, start a short review, and leave knowing where their work is saved—without configuring an AI system, creating an account, or reading Anki implementation terminology.

The learner-facing promise should be modest and concrete:

> **Sanjeev helps you keep using your Anki decks, review on your schedule, and optionally practice the same source material in a few different ways.**

Keep the ordinary Anki-style review fast, local-first, available offline, and backed by the existing FSRS schedule. Optional AI practice is an experiment, not a replacement for the source card, a medical authority, or a proven learning advantage. Do not market Sanjeev as universally better than Anki. Describe which workflow it supports and evaluate learning claims with the research plan before making them.

## 2. Decisions for this pass

1. Change the visible product name from **Recall** to **Sanjeev**.
2. Retain green as the recognizable action/accent color, but make warm beige and paper-like neutrals a substantial part of the learner interface.
3. Simplify the learner’s main route to **Today, Decks, Browse, Progress, Help**. Keep account and data controls in one clearly labeled place.
4. Remove duplicate import calls to action while keeping import obvious for a student with no decks.
5. Put one optional **AI-generated questions** toggle in study setup, directly before starting a session. It is off by default. Do not make students navigate a three-checkbox AI setup in Settings.
6. In this pilot, permit only constrained transformations of explicitly selected Anki source content. The toggle must not enable unrestricted medical question generation or automatic medical grading.
7. Add a short, skippable, revisitable tutorial. Do not put a login or tutorial wall in front of import or normal study.
8. Preserve source content, local data, FSRS scheduling, and existing backup/cloud compatibility. Do not make cosmetic rebranding a database migration.

## 3. Current-state observations to resolve

These observations refer to the current web app and should be rechecked against the branch before implementation:

- `apps/web/components/App.tsx` shows the `recall.` identity and has a global sidebar import button. The Today empty state and header, and the Decks header, also offer import. Several routes therefore repeat the same action.
- The account row and top-bar account link both lead to Settings’ account section. Settings also has its own navigation entry, which makes two concepts appear to open the same destination.
- `apps/web/components/views/Settings.tsx` combines study defaults, appearance, timezone/rollover, advanced FSRS controls, cloud auth/sync, backup/restore, AI consent, evaluation consent, review-workspace access, conflict handling, and destructive actions in one long view.
- The AI controls are not currently a single learner-facing study choice. Generation/review tooling exists separately, and a successful generation request is not the same as a learner-ready question. The implementation must trace the current flags, worker, approval state, and generation/grading calls before wiring a new toggle.
- `apps/web/components/views/Today.tsx` is already the natural place to choose a deck, session length, and start a session.
- The existing palette is green-forward, though `--warm` already exists in `apps/web/app/globals.css`. Build from the existing tokens and audit hard-coded colors instead of layering an unrelated palette on top.

## 4. Learner information architecture

Use a short, stable primary navigation:

| Destination | Student’s question it answers                   |
| ----------- | ----------------------------------------------- |
| Today       | What should I study now?                        |
| Decks       | What material do I have, and what can I study?  |
| Browse      | Can I find or inspect a particular card?        |
| Progress    | What have I reviewed?                           |
| Help        | How does this work, and where do I get unstuck? |

Keep **Account & data** reachable from one obvious account control. The Settings entry should open preferences, not duplicate the account link. The account control should open account, sync, and recovery controls—not land on the same undifferentiated page. This can be implemented as clear sections on one page or distinct routes; preserve deep links and make mobile navigation behave consistently. Do not force a new route structure if a clear section split is sufficient.

Keep specialist content-review/admin tooling out of the learner’s main path. Preserve its access for authorized reviewers, but do not present an unassigned review queue or raw JSON workflow as a normal student feature.

### Today and starting a session

Today should answer, at a glance, what is due and offer one clear primary action. Use student language such as “Due,” “New,” and “Start review.” Explain a count when its meaning is not obvious. If a session is in progress, make “Resume” prominent. Put deck and duration choices close to Start so students do not need to visit Settings to begin.

The ordinary path should remain one short setup followed by review. Keep advanced scheduling details behind a clearly labeled advanced disclosure. Avoid putting internal terms such as “cognitive task,” “exposure,” or raw FSRS parameters in the main study flow.

### Consolidate import entry points

Choose one persistent, consistent **Import deck** entry point, plus one contextual import action when the library is empty. Remove same-page duplicate header/empty-state buttons and redundant global/per-page actions. If import remains available from multiple navigation contexts for usability, make them point to the same flow and avoid showing multiple copies in a single view.

Keep import useful without an account. State supported file types and what happens to media in plain language. Errors should identify the file or compatibility issue and offer a next step; never silently discard a deck or overwrite existing data.

## 5. Sanjeev identity and warm visual direction

### Visible brand

Update user-visible identity consistently: app wordmark, page title/metadata, PWA manifest name and short name, relevant accessible labels, and any visible product copy. Use **Sanjeev** consistently, with capitalization as shown. Review the icon and favicon for fit with the new identity; do not invent a separate visual language for each screen.

Before changing identifiers, classify them:

- **Visible identity:** safe to update as part of this pass.
- **Internal compatibility identifiers:** local database names/keys, backup file naming or extensions, Supabase bucket names, schema/table names, API identifiers, package scopes, and stored user data. Keep these stable unless a separately designed migration preserves existing installs, backups, and cloud files.

In particular, do not mass-replace every `recall` string. Check restore/import paths, service worker/PWA behavior, database upgrades, and existing backup compatibility before changing any persistent identifier.

### Palette and visual hierarchy

Keep green as an accent for primary actions and selected states. Shift the overall canvas and secondary surfaces toward warm ivory, oatmeal, and pale beige so the interface feels calmer and less uniformly green. Use contrast rather than color alone to communicate due state, success, warning, error, and selection.

Start with a small token set in `apps/web/app/globals.css`, then remove or reconcile hard-coded color values in components. A possible direction—not a locked palette—is warm off-white page backgrounds, light beige cards and dividers, dark warm charcoal text, restrained deep green actions, and muted green for secondary emphasis. Avoid low-contrast beige text. Verify text, controls, focus rings, rating buttons, and status colors against WCAG AA contrast targets. Check both the normal and any supported dark/high-contrast appearance.

Reduce visual clutter through hierarchy, spacing, and fewer competing panels. Study screens should prioritize the prompt, reveal action, answer, and rating controls. Long imported cards must remain readable without truncating source material or hiding media.

## 6. One-toggle AI question pilot

### Placement and behavior

Place a single toggle immediately before **Start session**, in the existing study setup. Suggested label:

> **Add AI-generated questions**

One concise line below it should say that the questions are experimental, based only on selected deck content, and may be wrong. When enabled, show a short just-in-time disclosure before the first request: selected source text is sent to the configured AI service to create the optional activity; it is not sent for ordinary review; the original Anki answer remains the reference. Warn users not to import patient-identifying information. Be accurate about which provider receives data and avoid claiming that data is not retained unless the service configuration supports that claim.

The toggle is off by default, per session (or session setup), and has one clear consequence. It must not silently enroll a student in research, enable open-ended grading, change FSRS, or turn on AI elsewhere. If the student is offline, generation is unavailable, or the feature flag is off, explain this briefly and continue ordinary review. Do not block session start. If a generation call fails, show the original card and continue without penalty.

Today is the preferred entry point. Starting from a deck detail page must either lead to the same setup with the selected deck retained or use the same single choice before any AI request. Do not create a second differently named AI setting on the deck page.

### Closed-source content boundary

This pilot may skip a qualified medical reviewer only for the narrow operations below. The bypass is a risk boundary, not a claim that the generated content is medically verified. The imported Anki note can itself be incorrect, incomplete, or out of date.

Allowed, when every fact and relationship is explicitly present in the selected source note:

- Rephrase the same prompt as a short-answer retrieval question.
- Create a small multiple-choice question with one answer directly supported by the source and distractors that are unambiguously contradicted by other explicit source text. If safe distractors cannot be constructed, abstain.
- Ask the learner to compare two explicitly stated facts from that same note.
- Ask for a one-sentence explanation of an explicitly stated relation, without requiring missing medical knowledge.

Not allowed in the no-review pilot:

- New clinical vignettes, patients, symptoms, or examination findings.
- Diagnosis, treatment selection, management, prognosis, dosing, contraindication, triage, or other clinical application decisions.
- Facts sourced from model memory, external search, or another note that the student did not select for that activity.
- Inference that depends on unstated mechanisms, causal links, exceptions, or clinical context.
- Claims that generated content is accurate, validated, personalized, or proven to improve retention.
- LLM-only verdicts that a free-text medical answer is correct or incorrect.

If the source is ambiguous, conflicts with itself, lacks an explicit answer, or cannot support safe alternatives, return **no activity** and continue ordinary card review. “Source-grounded” means the question points back to source material; it does not prove the source or transformation is true.

### Source handling, review, and reporting

- Send only the minimum selected source fields needed for the current activity. Do not upload a whole deck for generation. Do not send unrelated notes, media, or account data.
- Preserve the source note identity and version/hash with each generated draft/activity. Show a readable source reference and allow the student to reveal the exact excerpt used.
- Validate output against a strict schema and enforce source references. Reject malformed, unsupported, or unreferenced output. Heuristics and schema validation are guardrails, not medical fact-checking.
- Label each activity **AI-generated · unverified** and provide visible **Skip** and **Report** actions. A report should remove/suppress the activity for that learner and enter an auditable human-review state; do not keep serving a reported item as if it were approved.
- A learner may dispute a question or source relationship. Store the dispute with source/version and activity ID, without treating it as evidence of learner mastery. Keep reviewer tools separate from normal study.
- Do not let the AI mode select content as medically safe based on confidence scores. Uncertainty means abstention.

### Formats, cognitive tasks, and bounded sequence

Keep _what the learner does_ (the cognitive task) separate from _how the prompt is presented_ (the question format), as required by the research guide. Rotate only formats that can be generated inside the closed-source boundary. A single short sequence may pair two formats for the same source objective, such as retrieval followed by comparison. Do not manufacture variety by adding outside clinical facts.

The proposed pilot should preserve quick review: at most one optional intervention per ten original reviews and no more than 15% of planned session time for checks/repairs, consistent with the current Phase 4 policy. Treat a two-format pair for one source objective as one intervention and include both activities in that time budget. A pair should be short (roughly 45 seconds total); do not force it on every card. If those limits cannot be honored, omit the activity. These are pilot guardrails/hypotheses, not validated optimal thresholds; record exposure and evaluate them before changing.

After meaningful difficulty, a concise targeted repair may show the relevant original source excerpt and one retrieval retry. Do not launch a long chatbot exchange or require an explanation on every card. Preserve a fast “continue with normal review” route at all times.

### Answer checking and learning records

- Multiple-choice checking should use the stored answer key and deterministic comparison.
- A short answer may be marked only by a conservative, source-derived accepted-answer set where exact equivalence is defensible. Otherwise show the expected source wording and let the learner self-check; record the result as uncertain/ungraded, not correct/incorrect.
- Do not use an LLM grader as an authority on a medical free-text response in this pilot.
- Track original recall/rating, explanation attempt, application attempt (if a future reviewed mode allows it), assistance/hints, and exposure separately. Never collapse them into one mastery score without an evaluated rule.
- AI activities, hints, reports, and generated-question scores must never silently reschedule the original card. Only the ordinary original-card review rating follows the existing FSRS rules.
- Ensure retry/idempotency behavior prevents duplicate generation/review events from double-counting exposure or changing schedule.

### Feature flags and fallback

Use the existing feature-flag and worker architecture where possible. Trace the request from study UI through API, durable job, provider, validation, local persistence, sync, and report/review state. Do not present an AI toggle that is only cosmetic or writes a preference without a functioning end-to-end experience. Keep generation disabled when required provider configuration or a safe mode is unavailable. Include a deterministic fixture provider for development and tests; never use real private decks in public fixtures.

## 7. Settings, account, and recovery

Redesign Settings around decisions students recognize, using progressive disclosure:

1. **Study preferences:** session defaults, new cards, sibling behavior, appearance, and timezone where needed.
2. **Account & data:** sign in/out, sync status, device/cloud state, backup/export, restore, and storage/recovery information.
3. **Advanced:** FSRS retention/scheduling details and other rarely changed controls, with concise explanations and safe defaults.

Keep destructive clear/delete actions isolated, explicit, and protected from accidental taps. Keep sync conflict information near sync/recovery. Make local-only/guest status understandable without implying work is lost: distinguish **saved on this device** from **synced to your account**. Preserve access to export and backups without forcing account creation.

Remove the AI checkbox maze from Settings. The session toggle is the sole learner control for the optional AI activity. Research consent, if there is an actual approved research program, must remain a separate, explicit, understandable consent flow and must never be inferred from using the AI toggle. Do not ask for future evaluation consent if there is no real study enrollment flow.

## 8. Tutorial / Help page

Add a short, skippable page reachable from primary navigation and from useful empty/error states. It should be readable on a phone, revisitable, and written for students—not as a tour of internal architecture. Suggested sections:

1. **Bring your cards:** import an Anki `.apkg`; explain that local study works without signing in.
2. **Start a review:** choose a deck and time, try to recall before revealing the answer.
3. **Choose a rating:** explain Again/Hard/Good/Easy in plain language and that normal card ratings drive FSRS scheduling. Avoid implying one universal rating rule beyond the app’s actual behavior.
4. **Optional AI questions:** explain the toggle, that generated prompts use selected deck content, may be wrong, show their source, and do not change the card’s FSRS schedule. Explain the provider disclosure and do not overpromise privacy.
5. **Keep your work safe:** distinguish local saving, offline use, backup, and optional account sync; link to the correct recovery controls.

Use small examples or screenshots only if they are accurate and kept current. Add a concise first-run hint only if it can be dismissed and never blocks import/study. Do not force a multi-step onboarding wizard.

## 9. Accessibility, mobile, and content clarity

- Meet WCAG AA contrast for normal text and controls; use visible keyboard focus and never communicate state using color alone.
- Ensure every action has a descriptive accessible name; icon-only controls need labels. Toggle state and AI disclosure must be announced to assistive technology.
- Keep all study controls keyboard-operable. Document and expose existing shortcuts consistently; do not invent shortcuts that conflict with text entry or browser behavior.
- Check narrow phone widths, large text, landscape, long card fields, clozes, media, and dialogs. Primary review/reveal/rating actions should remain easy to reach without horizontal scrolling.
- Use plain-language labels, short explanatory help, and progressive disclosure for scheduling or sync terminology. Do not hide important source, safety, or data-loss information in a tooltip.
- Respect reduced-motion preferences. Make dialogs, focus return, and error announcements work with screen readers.

## 10. Suggested implementation order

The implementing LLM should inspect the current branch, working tree, repository guidance, and existing product specs first. Preserve existing user changes and secrets. Then work in reviewable vertical slices:

1. Update the implementation checklist and confirm the current navigation, brand strings, settings state, flags, generation pipeline, scheduling boundary, and deployed configuration.
2. Implement visible Sanjeev branding and the warm-neutral/green design tokens; test existing routes and backup/install compatibility.
3. Consolidate import entry points and separate learner navigation from account/data and reviewer tools.
4. Simplify Settings and add the Help/Tutorial page.
5. Implement the one-toggle study flow end to end behind flags, including the closed-source generation contract, source references, abstention, deterministic answer checking, report state, budget enforcement, offline/error fallback, and no-FSRS-credit guarantee.
6. Validate representative existing `.apkg` decks and long/hostile card content in the new presentation. Do not put private/copyrighted decks into fixtures or commits.
7. Run relevant automated and manual checks, resolve failures, update setup/feature-flag/known-limits documentation, and produce a concise handoff with anything that still requires an owner action.

### Likely code areas to inspect (not an exhaustive file list)

- Web shell/navigation/brand: `apps/web/components/App.tsx`, `apps/web/app/layout.tsx`, `apps/web/public/manifest.webmanifest`, `apps/web/app/globals.css`.
- Learner screens: `apps/web/components/views/Today.tsx`, `Decks.tsx`, `Study.tsx`, `Settings.tsx`, `ContentReview.tsx`; route and mobile navigation code.
- Generation and safety path: `packages/ai/src/index.ts`, `packages/learning/src/index.ts`, `packages/domain/src/index.ts`, `apps/web/app/api/generation/route.ts`, `apps/web/lib/server/jobs.ts`, `apps/worker/src/main.ts`.
- Persistence/scheduling boundaries: `apps/web/lib/db/local.ts` and existing sync/event/job modules. Trace current code before changing schemas or storage keys.
- Product constraints: the linked research/build guides, `docs/phase-4-beta.md`, `docs/evaluation.md`, and the repository README/environment documentation.

## 11. Acceptance criteria

### Brand and navigation

- Learner-visible product identity consistently says Sanjeev across app chrome and install metadata.
- Existing users’ local data, backups, imports, and cloud media remain readable; internal identifiers are not casually renamed.
- A student can identify Today, Decks, Browse, Progress, Help, and Account & data without encountering duplicate links to the same Settings destination.
- There is one consistent import flow; an empty library clearly invites import; import and ordinary study do not require login.

### Study and settings

- A student can begin an ordinary review from Today with clear due/new information and no AI or network requirement.
- One optional AI toggle appears at session setup, is off by default, and gives a concise accurate disclosure. No Settings checkbox maze is required.
- Settings presents study preferences, account/data recovery, and advanced scheduling in understandable groups. Backup, restore, sync, and destructive-action safeguards still work.
- Help explains the complete first review and recovery path and can be revisited without forcing onboarding.

### AI safety and scheduling

- Each generated item is derived only from the selected source, includes a source/version reference, and is rejected/omitted when support is ambiguous or absent.
- No unreviewed clinical vignettes, management/dosing/diagnosis/application decisions, external facts, or unsupported facts are generated in the reviewer-bypass mode.
- There is no LLM-only medical correctness judgment for free text. Deterministic checks or self-check/uncertain behavior are used.
- User can skip/report, reported items are suppressed for that learner and have a traceable review state, and errors/offline state fall back to normal card review.
- The configured intervention and time budgets are enforced; exposure and task evidence remain separate; generated activities never alter original FSRS scheduling.
- The AI toggle does not imply research consent or claim a learning benefit. Normal review works with AI flags disabled and no network.

### Quality

- Responsive, keyboard-accessible UI retains readable source/card content and visible focus.
- Automated checks cover the changed behavior, including closed-source validation/abstention, event idempotency/budgets, fallback behavior, and the FSRS boundary; existing app checks are run and failures fixed.
- User-facing documentation accurately states provider data flow, configuration, limitations, and how to disable AI. No secrets or private decks/media enter the repository.

## 12. Manual product checks for a small student pilot

After implementation, ask a few medical students to attempt these tasks without coaching and note where they hesitate:

- Find how to import a deck and understand whether an account is needed.
- Start a review and explain what the due count and rating buttons mean.
- Find backup/recovery and tell whether a change is only on this device or synced.
- Explain what the AI toggle sends, what its questions are based on, and how to skip/report a bad one.
- Complete the same session with AI off and the network unavailable.

Treat feedback as usability evidence, not proof of learning efficacy. Check the current evaluation/research guidance before collecting sensitive feedback or study data. Before wider friend testing, inspect the deployed environment and confirm the AI feature flags, provider disclosures, and report/review route match this document.

## 13. Explicit non-goals

- No Phase 5/6 claims or broad personalization claims.
- No unreviewed clinical case generator, external medical search, diagnosis/treatment/dose grading, or AI medical authority.
- No mandatory AI activity, long chat, forced explanation, account wall, or AI default-on behavior.
- No changes that grant generated questions/hints alternate FSRS scheduling credit.
- No whole-deck upload, private/copyrighted test fixtures, or destructive migration of user data to achieve the rebrand.
- No claims that different question formats are proven to improve retention until an appropriate evaluation supports them.
