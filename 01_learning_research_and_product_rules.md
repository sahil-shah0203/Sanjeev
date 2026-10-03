# Learning Research and Product Rules

Version: 1.0  
Prepared: 2026-10-03  
Audience: the LLM and engineers implementing the application  
Companion: `02_app_build_specification.md`

## 1. Read this before implementing

Build a medical-student learning application that imports existing Anki packages and helps learners retain and apply their material with a disciplined use of study time. Preserve a strong spaced-repetition baseline. Add richer practice only where it plausibly improves outcomes enough to justify its cost.

This document is the pedagogical source of truth. The companion defines implementation. Read both before coding. If engineering convenience conflicts with a learning invariant, preserve the invariant and document the trade-off. Neither document is permission to invent medical facts or claim that the finished app has demonstrated an educational benefit.

### Evidence labels

- **Established:** supported by a substantial body of research across relevant tasks. This does not establish that our particular implementation works.
- **Supported, conditional:** evidence exists, but benefits depend appreciably on material, learners, task design, or comparison condition.
- **Documented product behavior:** confirmed in official documentation; not an independent efficacy finding.
- **Product hypothesis:** our proposed implementation or threshold. Must be instrumented, evaluated, and reversible.
- **Unknown:** evidence or validation is presently insufficient.

All numeric product thresholds below are initial engineering/experiment choices, not scientifically derived optimal values. Research references use IDs in section 16; implementation references are in the companion. No systematic review was conducted specifically for this project. This is a targeted research synthesis, including reviews, experiments, and official product documentation.

### Non-negotiable learning invariants

1. A learner attempts retrieval before answer exposure unless they explicitly request instruction or cannot attempt the item.
2. A correct recognition response is not silently treated as successful unaided recall.
3. Immediate repetition after feedback is not labeled durable mastery.
4. A prompt's format and its cognitive demand are separate attributes.
5. Original-card scheduling remains recoverable and auditable.
6. Generated explanations and questions have traceable supporting content.
7. The system can abstain and fall back to the original card.
8. No compulsory long explanation, chatbot conversation, or typing exercise on every card.
9. Preserve fast keyboard review, offline review, and a non-AI study path.
10. Record all learning exposures, even when they do not qualify as scheduler updates.
11. Use repeated failures as a signal to investigate, not proof of a specific misconception.
12. Never convert predicted retention into a prediction of exam score or clinical competence.

## 2. Product objective and boundaries

### Primary objective

Improve delayed independent recall and application of the imported material relative to total active study time. Students must be able to finish a useful session within a chosen time budget without an expanding obligation to complete generated activities.

There are two legitimate success paths:

- Similar delayed performance with less accumulated study time.
- Better delayed performance at a comparable time budget.

Short-term additional time is acceptable only as a bounded, disclosed product hypothesis whose cumulative benefit is measured. Do not present extra engagement as a substitute for learning efficiency.

### Target users

Initial users are medical students with existing Anki decks, including AnKing-style cloze notes. They may have thousands of cards, established schedules, school-specific tags, media-heavy decks, and limited willingness to configure software. Their goal may be a course exam, a shelf exam, or licensing-exam preparation; the app must not assume these are interchangeable.

The product is an educational tool. It does not provide patient-specific clinical recommendations. Imported materials can be outdated, incomplete, or wrong. Source fidelity and medical correctness are distinct quality checks.

### What success is not

- More cards answered, longer streaks, or longer sessions alone.
- A higher same-session score obtained by showing the same answer repeatedly.
- A polished explanation that the learner passively reads.
- A new scheduler claiming superiority without an appropriate benchmark.
- Replacing validated question banks with unvalidated generated medical cases.
- Training isolated facts while claiming broad readiness for clinical reasoning.

## 3. Evidence synthesis

### 3.1 Retrieval practice: the foundation

**Established.** Attempting to retrieve studied information generally improves later learning compared with simply re-exposing oneself to it. Dunlosky et al. rated practice testing among the most useful techniques in their review [R1]. A later systematic review of classroom research found benefits across a range of educational contexts, while noting limitations in the diversity of sampled populations [R2].

**Product interpretation:** keep an answer attempt central. Silent recall plus honest self-rating remains a valuable fast interaction. Typed answers create additional observable evidence but are not automatically worth their motor and reading overhead. Do not mistake clicking “show answer” for an actual retrieval attempt.

**Implementation rule:** record whether an attempt was submitted, self-reported, skipped, or assisted. A no-attempt reveal is an exposure, not a successful recall.

**What this evidence does not prove:** our prompt generator, our UI, or typing every answer will outperform existing Anki use.

### 3.2 Spacing and successive relearning

**Established for spacing; supported for particular relearning protocols.** Cepeda et al. found that beneficial spacing depended on the eventual retention interval; the best gap was not one universal calendar [R3]. Research on successive relearning combines successful retrieval with revisiting material across sessions [R4].

**Product interpretation:** carry learning forward across days, not only within an onboarding lesson. Retain an established scheduler. Avoid forcing arbitrary multiple-correct streaks for all content. A short correction and later fresh retrieval can be more useful than immediately grinding the same wording.

**Implementation rule:** initial learning, same-session correction, and later review are distinct events. Future due dates persist across app restarts and devices. Relearning must not quietly expand the day's new-card intake.

**Unknown:** the optimal number of immediate repetitions for every type of medical item. Do not convert a study-specific criterion into a universal rule.

### 3.3 Ebbinghaus: a descriptive curve, not a personalized prescription

**Established phenomenon with important scope limits.** Ebbinghaus's work and a modern replication show a decline in savings when relearning syllable lists after delay [R5]. Savings measures relearning efficiency; it is not the same quantity as the probability of answering a medical question correctly.

**Product interpretation:** forgetting justifies revisiting material, but do not display fixed claims such as “you lose 70% after one day.” Do not label a decorative exponential curve as the student's measured memory. FSRS estimates must be named as model estimates for qualifying card recall, not measurements of conceptual understanding.

**Implementation rule:** never hard-code a 1/3/7/30-day schedule as the default learning science. Use scheduler outputs and versioned settings.

### 3.4 Self-explanation and elaborative questioning

**Supported, conditional.** A meta-analysis of induced self-explanation included 69 effect sizes from 64 research reports and estimated a mean effect of Hedges' g = 0.55 [R6]. That is a standardized difference across included conditions, not “55% more retention.” Explanation quality, prompts, and the task matter.

**Product interpretation:** ask learners to connect causes, distinguish concepts, or justify a step when those relationships matter. Explaining every trivial fact is not required. Asking “why?” is only useful if the learner can attempt a meaningful explanation and receive a trustworthy correction.

**Implementation rule:** explanation prompts identify one intended relationship and a small rubric. Accept multiple correct phrasings. Do not reward fluent but unsupported verbosity.

### 3.5 Rubber-duck explanations and learning by teaching

**Rubber duck:** a named debugging practice, not a uniquely proven memory treatment. The Pragmatic Programmer describes explaining code step by step to expose problems [R7]. The relevant learning evidence is research on explanation and retrieval.

In an experiment by Koh et al., teaching without notes and retrieval practice outperformed teaching with notes and a control condition on a comprehension test one week later [R8]. This supports retrieval as a contributor; it does not establish that talking to a duck or an LLM always outperforms short-answer practice. Mechanisms and boundary conditions remain debated [R9].

**Decision:** no mandatory conversational tutor. Offer one-sentence or 20–40-second teach-back tasks after a clear trigger, or on request. Voice is a later accessibility/input option, not the scientific mechanism. A learner may type, speak, or explain privately and self-check; only submitted content can receive automated assessment.

### 3.6 Interleaving and discrimination

**Supported, conditional.** Interleaved mathematics practice has improved later performance in classroom experiments [R10]. This does not establish that mixing unrelated flashcards at random is sufficient or that all topics should be interleaved before initial understanding.

**Product interpretation:** create purposeful comparisons among concepts the learner plausibly confuses. Teach prerequisites when needed, then test selection of the appropriate rule or concept.

**Implementation rule:** comparison items must state the feature that distinguishes the choices. A broad shared tag is insufficient evidence that two concepts are useful contrasts. Preserve sibling separation to avoid answer leakage.

### 3.7 Transfer to new questions

**Supported, conditional.** Pan and Rickard's meta-analysis found that retrieval practice can support transfer, with a mean effect around d = 0.40 relative to restudy controls. Benefits varied by task and were influenced by factors including elaborated retrieval and initial performance [R11]. Retrieval does not guarantee broad transfer.

**Product interpretation:** test the use of knowledge in unfamiliar but supported contexts. Rephrasing a definition is not the same as requiring a novel inference. A vignette with an obvious keyword may still test simple recall.

**Implementation rule:** each generated question identifies its learning objective and cognitive task. Application claims require a new decision, inference, or use of a relationship, not merely longer wording.

### 3.8 Feedback and multiple choice

**Supported.** Multiple-choice practice can expose learners to incorrect alternatives. Butler and Roediger found that feedback increased benefits and reduced harmful learning of lures [R12]. Findings about optimal feedback timing are task-dependent; this document does not claim immediate feedback is always best.

**Product interpretation:** provide a concise correction after an error, including why the selected distractor fails when that distinction is useful. Do not use random terms as distractors just to manufacture a question.

**Implementation rule:** every distractor has a source-supported rejection rationale. If there is more than one defensible answer, reject or revise the item. Do not count retyping the displayed correct answer as independent retrieval.

### 3.9 Methods we will not prioritize

Rereading and highlighting received lower general utility ratings than retrieval and spacing in the broad review [R1]. They can support orientation or repair; they should not become the main loop. We are not claiming they have no value.

Do not build learning-style classification, universal speed-learning claims, passive AI summaries as the default task, compulsory lengthy lectures, or rewards that require unnecessary practice. These are excluded product choices; this project has not separately reviewed every possible learning-style or gamification intervention.

Sleep, stress, workload, prior knowledge, and instruction outside the app affect outcomes. This application cannot isolate or control all of them. It should not imply that better software removes those constraints.

## 4. A fair account of Anki

Anki is not pedagogically obsolete merely because its interface feels old. Its central recall-and-review workflow is well aligned with retrieval and spacing. Current documentation describes both legacy scheduling and FSRS; with FSRS, optimization uses review history and desired retention controls review frequency [A1]. Do not assume every user enabled FSRS or exported compatible parameters.

The normal answer workflow is self-rated. Hard means correctly recalled with difficulty, not forgotten [A2]. Built-in typed answer comparison exists but still leaves the scheduling rating to the learner [A3].

Anki allows different templates and multiple cards from notes [A4]. Authors can write explanations, clinical cases, comparison prompts, or reasoning cards. The limitation is not that Anki cannot display them; it does not automatically design, validate, and selectively deploy that curriculum for the learner.

Anki can flag repeatedly failed cards as leeches and recommends changing presentation or improving understanding [A5]. That recognizes an important problem but largely leaves diagnosis and repair to the user.

### Gaps to address

| ID | Gap in common use | Our responsibility |
| --- | --- | --- |
| G1 | Format progression must be authored/configured | Choose assistance and response format intentionally. |
| G2 | Self-assessment may be overly generous | Sample observable answers without slowing every review. |
| G3 | Familiar cues can mask fragile recall | Test selected alternate cues and record recent exposures. |
| G4 | Correct facts can coexist with weak understanding | Use focused explanation checks when justified. |
| G5 | Recall may not transfer to exam-style decisions | Sample independently validated application tasks. |
| G6 | Repeated failures may produce inefficient repetition | Offer concise, targeted repair and allow card edits. |
| G7 | Related facts may remain disconnected | Group conservatively and test important relationships. |
| G8 | One success label can hide distinct abilities | Report separate recall, explanation, and application evidence. |

These eight categories are a product framework, not an exhaustive or validated psychometric taxonomy. Custom decks and add-ons may already address parts of them. Do not claim we invented every intervention.

## 5. What Quizlet contributes

Quizlet describes Learn as mixing formats and increasing the use of written questions and flashcards as performance improves [Q1]. Its materials also describe progression from multiple choice to written answers [Q2]. Other current marketing mentions true/false, so exact availability should be tested on target accounts and platforms rather than assumed universal [Q3].

The help center documents configurable question types, answer direction, and optional retyping of missed written answers [Q4]. Current relaxed grading can accept meaning, synonyms, and rephrasing, with stricter modes also available [Q5].

Quizlet separately documents website Flashcards spaced repetition with recall ratings [Q6]. Do not claim Quizlet lacks spaced repetition. The public pages reviewed do not establish that every Learn activity updates a shared scheduler equivalent to Anki's FSRS.

### Our assessment of its coverage

| Gap | Learn-style contribution | Remaining requirement |
| --- | --- | --- |
| G1 | Largely addresses automatic format progression | Avoid a universal format ladder. |
| G2 | Partially addresses grading through submitted responses | Handle guesses, partial correctness, and grader uncertainty. |
| G3 | Partially removes cues by requiring written recall | Validate alternate prompts and unfamiliar contexts. |
| G4 | Not inherently filled | Evaluate a specific explanation. |
| G5 | Not inherently filled | Design supported application tasks. |
| G6 | Partially filled by feedback and further practice | Identify likely reasons for failure and repair them. |
| G7 | Not inherently filled | Teach and assess relationships. |
| G8 | Not inherently filled | Keep ability-specific evidence. |

The count “one largely, three partially, four not inherently” is our classification, not a comparative experiment or a percentage improvement.

## 6. Knowledge representation

Keep these distinct:

- **Source note:** imported fields, tags, templates, source references, media.
- **Source card:** a particular prompt generated from that note, with its original schedule/history.
- **Objective:** a specific fact, relationship, discrimination, or application target.
- **Concept:** a useful grouping of objectives, possibly spanning notes; not a replacement for notes.
- **Activity:** one authored or generated way to practice an objective.
- **Attempt:** the learner's response to one presentation.
- **Exposure:** any event revealing relevant content, even without a response.
- **Evidence:** a qualified observation about recall, explanation, discrimination, or application.

An objective can relate to multiple source cards, but passing it does not automatically pass all of them. Concept grouping is an aid to activity selection; it must not merge schedules or erase distinctions between clinically different facts.

For each evidence record, retain the ability dimension, task format, assistance, correctness status, confidence source, timestamp, source versions, and recent answer exposure. Start with descriptive evidence counts and dates. Do not invent a calibrated “concept mastery percentage.”

### Format is not difficulty

| Format | Possible cognitive demands |
| --- | --- |
| Cloze | A simple fact or a substantial relationship, depending on context. |
| Short answer | Recalled term, explanation, comparison, or calculation. |
| Multiple choice | Easy recognition or difficult reasoning among plausible alternatives. |
| One-sentence explanation | A focused mechanism or justification. |
| Vignette | Could still be keyword matching; must be inspected for real application. |

Store `format` and `cognitive_task` separately. Difficulty is an estimated property of a particular item for a particular population; it is not assigned solely from format.

## 7. Learning policy version 1

### 7.1 Three paths

1. **Quick review:** default; source-card retrieval, reveal, self-rating.
2. **Understanding check:** occasional validated alternate cue, distinction, or application task.
3. **Targeted repair:** concise correction after a selected gap; return to practice without a required lecture.

A new concept does not automatically require a lesson. Offer a short orientation when requested or when prerequisite evidence is weak. Imported advanced learners should not be forced through beginner instruction.

### 7.2 Initial time-budget hypotheses

These are configurable pilot defaults:

- Default session budget: 15 minutes, editable in one click; allow untimed study.
- At least 85% of planned active time reserved for ordinary review in initial adaptive pilots.
- Understanding checks and repairs together may use at most 15% of the session budget.
- At most one unsolicited understanding check per ten completed ordinary reviews.
- At most one unsolicited teach-back per session, targeting about 30 seconds.
- A repair targets about 20–45 seconds; if more is needed, offer a separate optional explanation.
- No forced timer on answers. Suggested durations are planning estimates, not grading criteria.
- User-requested deeper study is allowed beyond the automatic cap, with a clear choice.

Both count and time caps apply. If a session is short, has overdue reviews, or already exceeded the cap, reduce or omit interventions. Extra practice must not hide the count of unfinished due cards. Stopping a session never marks those cards completed.

### 7.3 Trigger candidates

Use transparent, versioned rules before any learned policy:

- Two failures of the same objective on distinct study days within a rolling 14-day window: repair candidate.
- A correctly recalled fact followed by a failed application probe: relationship/application repair candidate.
- Two observed confusions between the same alternatives: comparison candidate.
- A learner explicitly selects “I don't understand”: immediate explanation option.
- A small sample of apparently successful objectives: diagnostic checks to catch unobserved gaps.

Those thresholds are hypotheses. Same-session repetition, latency alone, self-reported confidence, or a single ambiguous generated answer must not be treated as diagnosis. Avoid explanations when a bad card or missing image is the likely issue.

### 7.4 Selection pseudocode

```text
if no valid local study content:
    show honest setup/recovery state
else if learner explicitly requests explanation:
    offer source-grounded repair
else if an original learning/relearning step is due:
    prefer that step
else if an eligible intervention fits both time and count budgets
        and it has not been contaminated by a recent answer exposure
        and it is validated for this content version:
    select the highest-priority check/repair candidate
else:
    select an eligible original due card

if no due cards remain:
    offer a limited new-card batch or finish
```

Candidate selection is deterministic with a stored random seed for diagnostic sampling. Record why an intervention was selected. Do not choose solely to maximize interaction rate.

### 7.5 Feedback policy

After a correct simple response: short confirmation, no mandatory explanation screen.

After an incorrect submitted response: show the correct target and the smallest useful explanation; optionally explain the selected distractor. Provide source access. Allow “ambiguous/wrong question,” skip, edit, and grading dispute.

After repeated failure: offer a repair matched to the likely problem: missing prerequisite, confused alternatives, overly broad prompt, or forgotten fact. Label inferred reasons as tentative. Learner dismissal does not count as failure.

## 8. Scheduling and additional practice

### 8.1 Conservative initial boundary

Use established FSRS for qualifying original-card reviews. Begin with documented defaults and a versioned configuration. Later parameter optimization is separate from basic scheduling and requires suitable history.

Do not feed an MCQ pass, hinted answer, or LLM judgment into original-card FSRS as if it were the same retrieval event. Do not replace the original scheduler with an LLM decision about the next date.

| Event | Original-card scheduler update? | Other record |
| --- | --- | --- |
| Unassisted original prompt, honest rating | Yes | Review and exposure. |
| Original recall failure, then answer revealed | Yes, failure | Feedback exposure. |
| Hint requested after a failed attempt | Failure if learner confirms failed original recall | Assistance and exposure. |
| Generated MCQ/alternate/application task | No, initial policy | Ability-specific attempt and exposure. |
| Retyping a displayed answer | No | Correction exercise only. |
| LLM says an explanation is incomplete | No | Provisional explanation evidence. |
| User skips or reports broken content | No | Skip/report. |
| Recently answer-exposed original card | No calibrated success in initial policy | Contaminated practice; original remains due. |

This is conservative, not perfectly exposure-aware memory modeling. Ignoring supplemental learning can lead to extra reviews, so measure that inefficiency. The safer initial response is to reduce redundant intervention exposure, not silently inflate memory estimates.

### 8.2 Resolving the “replacement” tension

We want richer practice to replace wasted work, but cannot responsibly credit all formats as identical FSRS evidence yet. Therefore:

- In version 1, interventions occupy a bounded part of the session budget; they do not falsely complete due originals.
- Prefer a probe after a qualifying original review and schedule additional probes on different days when possible.
- A revealed answer marks related objectives as exposed for the session. Defer immediate sibling testing where practical, without changing the actual due date.
- Any later policy that lets an alternate task complete an original review is a separately tested experiment with an explicit mapping and rollback.

Do not promise equal daily review completion at the same time budget during early pilots. Measure whether cumulative benefit compensates for the budget displaced by interventions.

## 9. Medical content and LLM requirements

### Two distinct validation questions

1. Is the generated item faithful to the imported source?
2. Is that source medically correct, sufficiently current, and appropriate to the stated objective?

Source-grounded generation answers neither question automatically. A second LLM agreeing with the first is not independent medical verification.

### Content pipeline

1. Extract text and structured source fields; retain original HTML and media separately.
2. Identify a narrow objective and supporting spans.
3. Propose at most a small number of useful activities.
4. Validate schema, source references, answer uniqueness, scope, and ambiguity.
5. Apply a second critique pass where useful, recording its limits.
6. For the initial medical pilot, require qualified human review before generated clinical application content becomes active.
7. Activate only approved versions; quarantine reports and superseded items.

A tag naming a book or video is a reference, not possession of its contents. An image may contain essential text; do not use filename inference as understanding. OCR/vision-derived material requires separate validation. No automatic paywall traversal or redistribution of a licensed question bank.

### Grading

Use deterministic comparison for narrow answers with a curated acceptance set. Preserve clinically meaningful units, qualifiers, signs, and negation. Broader semantic grading uses a rubric with `correct`, `partially_correct`, `incorrect`, or `uncertain` outcomes.

An LLM self-reported confidence value is not calibrated probability. Store it, if used, as a model output only. Uncertain grading returns a self-check or ungraded result. A learner can dispute a grade; preserve both the original output and adjudication. Never allow a disputed AI grade to damage an original schedule.

### Brief teach-back rubric

- Names the intended relationship or mechanism.
- Includes the essential causal step or distinguishing feature.
- Does not assert a material contradiction.
- Can be incomplete without being wholly wrong.

Feedback should identify one actionable gap in one or two sentences. If meaningful evaluation would require a long essay, the activity is too broad for automatic daily review.

## 10. Applying this to the supplied sample

The inspected `forsahil.apkg` contains three notes/cards in AnKing Step Deck, covering cervical carcinoma presentation and risk factors. It includes extra text, media, and resource tags. This is an observed fixture, not a representative medical curriculum.

Potential activities, subject to clinical review:

- Original cloze retrieval: reproduce the source task faithfully.
- Alternate recall: ask for the same target without relying on the sentence's surrounding clues.
- Comparison: distinguish a risk association from the underlying causal mechanism, only after sufficient supported material is provided.
- Brief explanation: justify a relationship present in the source and verified by the content reviewer.

Do not automatically convert a risk-factor list into a diagnosis or treatment case. Those are different learning objectives requiring additional context. The sample includes broad assertions and superlative wording; retain the original as user content but flag absolute claims for review before expanding them. This document does not endorse every medical assertion in the sample.

The sample has no review-log rows. It cannot validate historical scheduling migration or personalized optimization. Larger de-identified, authorized exports with and without history are needed.

## 11. User-facing progress

Prefer:

- “Due today: 84.”
- “Recall: successful on two different days.”
- “Application: one check completed; more evidence needed.”
- “This concept may need another look.”
- “Saved on this device” versus “Synced.”

Avoid:

- “You know 94% of cardiology.”
- “Guaranteed exam ready.”
- “Mastered forever.”
- “AI verified” as a substitute for naming the actual source/review status.
- Conflating quick recognition, explanation, and delayed recall in one score.

Confidence questions may be used sparingly for diagnostics; do not add a second rating after every ordinary Anki-style rating. Response speed can help estimate time budgets but is not a sufficient measure of knowledge, especially with accessibility differences or interruptions.

## 12. Evaluation plan

### Stage A: correctness and usability

Recruit a small authorized pilot, for example 5–10 students, to detect import failures, content errors, confusing interactions, excessive overhead, and missing workflow needs. This is a usability sample, not a powered efficacy study.

Gate progression on reliable saving and correct prompts. A positive learning signal cannot compensate for corrupted schedules or answer leakage.

### Stage B: feasibility of the learning policy

Use a counterbalanced within-person design where practical. Assign comparable concept clusters, not sibling cards from the same note, to standard FSRS practice versus FSRS plus interventions. Stratify by baseline knowledge and topic. Keep original retention settings and content quality comparable. Prevent overlapping objectives from leaking across conditions.

Compare equal study-time budgets initially. Also run a separate time-to-criterion analysis if desired; do not conflate its result with the equal-time result. Record outside study and acknowledge contamination rather than pretending it is absent.

Suggested delayed assessments: approximately 7 and 30 days, with prespecified windows. Use unseen, independently reviewed recall and application questions. Do not generate a final test by paraphrasing the training item with the same obvious cues. Keep assessment forms consistent in difficulty across conditions.

### Metrics

| Metric | Definition / caution |
| --- | --- |
| Delayed recall | Correct unaided responses on held-out factual objectives. |
| Delayed application | Correct decisions/reasoning on held-out supported cases. |
| Total active time | Review, reading feedback, repair, typing, and assessment preparation time; account for idle periods explicitly. |
| Cumulative time | Sum across all study sessions, not only the first session. |
| Retained objectives per hour | Descriptive efficiency measure; report its numerator and denominator separately too. |
| Time to criterion | Time to a prespecified delayed performance criterion; include non-achievers. |
| Due-card backlog | Detect whether interventions simply deferred essential review. |
| Grading quality | Human-adjudicated false-correct, false-incorrect, uncertain, and dispute rates. |
| Content quality | Unsupported/ambiguous/incorrect questions per audited sample. |
| Retention in app usage | Return rate and abandonment; useful operationally, not proof of knowledge retention. |

### Analysis safeguards

- Predefine primary outcomes, stopping rules, and what would count as an unacceptable time penalty.
- Analyze student and concept clustering; thousands of card attempts are not thousands of independent students.
- Report uncertainty intervals and missing assessment data.
- Keep intention-to-treat and actual-use summaries distinct.
- Account for baseline performance, prior Anki familiarity, outside practice, and question difficulty.
- Do not cherry-pick the best format or time point after the fact.
- A formal non-inferiority claim requires a justified margin and adequate power; a small pilot cannot establish it.
- Use an independent, qualified reviewer for medical answer keys. Investigate disagreements before scoring.

### Initial kill switches

Disable a generated activity immediately when reported as potentially medically wrong pending review. Disable the adaptive feature cohort-wide if it introduces severe answer leakage or corrupts scheduling. Reduce intervention frequency if backlog/time cost rises without a convincing benefit. Keep standard review available throughout.

## 13. Experiment register

| ID | Hypothesis | Benefit sought | Main risk | First test |
| --- | --- | --- | --- | --- |
| H1 | Sparse alternate cues expose fragile recall | Better cue-independent retention | Meaning drift | Expert equivalence review plus delayed recall. |
| H2 | Targeted contrasts reduce recurring confusion | Better discrimination | Poor distractors teach errors | Audit distractors and retest confusion later. |
| H3 | Brief repair after repeated failure reduces future time | Fewer recurring lapses | Extra reading without benefit | Cumulative time and distinct-day lapses. |
| H4 | Sparse teach-back improves relationship learning | Better explanations/application | Slow or unreliable grading | Matched objectives, time cap, human grade audit. |
| H5 | Application sampling finds hidden gaps | Better unfamiliar-case performance | Unsupported case generation | Reviewed cases and held-out transfer test. |
| H6 | Bounded adaptive mix improves efficiency | Better delayed learning per minute | Displaced due reviews | Equal-budget comparison with backlog monitoring. |

Ship one identifiable policy version at a time. Store assignment and policy versions so an experiment can be reproduced. Personalize thresholds only after enough representative evidence exists.

## 14. Priority decisions

### Required in the first adoption release

- Reliable import, truthful rendering, persistent progress, established scheduling.
- Fast ordinary review and a clean mobile/desktop interface.
- Optional account, cross-device sync, export, and recovery.
- Ability to disable all adaptive features.
- Source-linked, reviewed pilot interventions with time caps.
- Flags, disputes, event instrumentation, and content-version tracking.

### Later, only after validation

- Voice teach-back, broad automatic concept graphs, automated personalized FSRS training, and alternate-task scheduling credit.
- More expansive generation from licensed or verified external sources.
- Personalized intervention selection learned from outcomes.

### Explicitly excluded initially

- Mandatory chatbot tutoring or lengthy onboarding.
- An arbitrary “learning style” questionnaire.
- Public redistribution of imported deck content.
- Clinical advice workflows.
- Claims of improved licensing-exam scores without appropriate evidence.

## 15. Pedagogical acceptance checklist

- [ ] Every practice event identifies its objective and task type.
- [ ] Assistance and recent source exposure are recorded.
- [ ] The scheduler boundary in section 8 is enforced in code.
- [ ] No generated activity is required to access ordinary study.
- [ ] Time and count budgets are both enforced.
- [ ] Due-card backlog remains visible and is never falsely cleared.
- [ ] No score collapses recognition, recall, and application into fabricated mastery.
- [ ] Uncertain grading can abstain and can be disputed.
- [ ] Medical application items have the initial required human review.
- [ ] Unsupported generation falls back instead of inventing source material.
- [ ] Delayed outcome tests are independent of the training prompts.
- [ ] Product hypotheses are labeled as such in developer and evaluation documentation.

## 16. Research and product references

Research dates below are publication years; product behavior was checked on 2026-10-03. Some product pages change continuously. Consult their current versions before implementation.

### Learning research

- **[R1]** Dunlosky, Rawson, Marsh, Nathan, & Willingham (2013). *Improving Students' Learning With Effective Learning Techniques.* Broad review supporting practice testing and distributed practice. [Publisher DOI](https://doi.org/10.1177/1529100612453266). Used for broad technique comparison, not an Anki-versus-Quizlet experiment.
- **[R2]** Agarwal, Nunes, & Blunt (2021). *Retrieval Practice Consistently Benefits Student Learning: A Systematic Review of Applied Research in Schools and Classrooms.* [Publisher DOI](https://doi.org/10.1007/s10648-021-09595-9). Real-classroom evidence; population and intervention heterogeneity limit universal claims.
- **[R3]** Cepeda, Vul, Rohrer, Wixted, & Pashler (2008). *Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention.* [Abstract](https://pubmed.ncbi.nlm.nih.gov/19076480/). [Author-hosted full text](https://laplab.ucsd.edu/articles/Cepeda%20et%20al%202008_psychsci.pdf). Spacing depends on retention horizon.
- **[R4]** Rawson, Dunlosky, & Sciartelli (2013). *The Power of Successive Relearning: Improving Performance on Course Exams and Long-Term Retention.* [Bibliographic record and abstract](https://eric.ed.gov/?id=EJ1036741). See also Rawson & Dunlosky, *Successive Relearning: An Underexplored but Potent Technique for Obtaining and Maintaining Knowledge* (2022), [DOI](https://doi.org/10.1177/09637214221100484). No fixed repetition criterion is adopted from these papers.
- **[R5]** Murre & Dros (2015). *Replication and Analysis of Ebbinghaus' Forgetting Curve.* [Full text](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644). A savings-based replication, not universal medical-content forgetting percentages.
- **[R6]** Bisra, Liu, Nesbit, Salimi, & Winne (2018). *Inducing Self-Explanation: A Meta-Analysis.* [Publisher](https://link.springer.com/article/10.1007/s10648-018-9434-x). Abstract inspected; effect size does not directly specify time efficiency for our application.
- **[R7]** Hunt & Thomas, *The Pragmatic Programmer*, debugging discussion. [Book excerpt hosted by Duke](https://courses.cs.duke.edu/compsci308/spring26/readings/pragmatic-programmer-debugging.pdf). Historical explanation of rubber-duck debugging, not a randomized educational study.
- **[R8]** Koh, Lee, & Lim (2018). *The Learning Benefits of Teaching: A Retrieval Practice Hypothesis.* [Publisher](https://onlinelibrary.wiley.com/doi/abs/10.1002/acp.3410). Summary inspected; specific teaching/retrieval experiment.
- **[R9]** Kobayashi (2022). *The Retrieval Practice Hypothesis in Research on Learning by Teaching: Current Status and Challenges.* [Full text](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.842668/full). Mechanistic cautions; does not establish LLM tutor efficacy.
- **[R10]** Rohrer and colleagues (2020; published online 2019). *A Randomized Controlled Trial of Interleaved Mathematics Practice.* [DOI](https://doi.org/10.1037/edu0000367). Domain-specific support; not direct evidence for medical flashcard mixing.
- **[R11]** Pan & Rickard (2018). *Transfer of Test-Enhanced Learning: Meta-Analytic Review and Synthesis.* [DOI](https://doi.org/10.1037/bul0000151). [Full text](https://pdf.retrievalpractice.org/transfer/Pan_Rickard_2018.pdf). Transfer is possible but conditional.
- **[R12]** Butler & Roediger (2008). *Feedback Enhances the Positive Effects and Reduces the Negative Effects of Multiple-Choice Testing.* [Abstract](https://pubmed.ncbi.nlm.nih.gov/18491500/). Supports corrective feedback and careful handling of distractors.

### Anki official documentation

- **[A1]** [Deck options and FSRS](https://docs.ankiweb.net/deck-options.html).
- **[A2]** [Studying and rating meanings](https://docs.ankiweb.net/studying.html).
- **[A3]** [Typed answers and field replacement](https://docs.ankiweb.net/templates/fields.html).
- **[A4]** [Card templates](https://docs.ankiweb.net/templates/intro.html) and [card generation](https://docs.ankiweb.net/templates/generation.html).
- **[A5]** [Leeches](https://docs.ankiweb.net/leeches.html).

### Quizlet official documentation

- **[Q1]** [Study modes](https://quizlet.com/features/study-modes). Official indexed text inspected; direct page retrieval was unavailable in this session.
- **[Q2]** [How Quizlet works](https://quizlet.com/features/how-quizlet-works). Official indexed text inspected; exact account behavior still requires product testing.
- **[Q3]** [Learn feature page](https://quizlet.com/features/learn). Marketing descriptions are not an independent efficacy evaluation.
- **[Q4]** [Studying with Learn](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn).
- **[Q5]** [Grading options](https://help.quizlet.com/hc/en-us/articles/360048313652-Using-grading-options-US).
- **[Q6]** [Studying with Spaced Repetition](https://help.quizlet.com/hc/en-us/articles/48324742264077-Studying-with-Spaced-Repetition).

## 17. Final instruction to the implementing LLM

Build the smallest complete system that respects these principles, then expand behind explicit release gates. Preserve the fast path. Make every new learning mechanism inspectable, optional where uncertain, and measurable. Do not substitute confident medical prose or attractive dashboards for correct learning mechanics.
