# What Sahil needs to do manually

The app can already run locally without an account or API key. These tasks concern services, credentials, content review, and release evidence that require your accounts or real users.

## Current deployment and remaining actions

The web app is deployed at **https://recall-sepia-seven.vercel.app**. Supabase is configured and both migrations are applied. Railway project **recall-beta**, service **recall-worker**, is deployed; its health endpoint is https://recall-worker-production-60b6.up.railway.app/healthz. You do not need to recreate these services or reinstall their CLIs.

Owner actions still needed:

- In Supabase Auth, verify Site URL is the beta URL above and Redirect URLs includes `https://recall-sepia-seven.vercel.app/auth/callback`. Configure custom SMTP before inviting friends: development email restrictions can prevent delivery to other addresses. Complete one real hosted email-link sign-in yourself.
- Rotate the Supabase secret key, OpenAI API key and database password that had been placed in `.env.example`. GitHub rejected that initial push; the published baseline was sanitized. Update the ignored local environment files and the Vercel/Railway secret stores, then redeploy. Never paste these values into tracked files. The new secret guard runs in lint/CI.
- The Phase 4.5 source-only pilot is enabled and needs no reviewer assignment: its model selects source text and code builds a bounded exercise. It does not validate medical truth. Broader clinical generation still requires a qualified reviewer; assignment SQL is in `operations.md`.
- Choose backup retention and test your Supabase database plus Storage restore procedure. Native app backup/restore does not substitute for an operator recovery drill.
- Use `beta-testing.md` for friend testing on actual phones, personal histories and representative decks. Their clinical/content review and educational evaluation cannot be completed by automated tests.

The remaining sections explain setup for a fresh checkout or a separate staging project.

## 1. Try your local app

Run `npm run dev` and open `http://localhost:3000`, or use `npm run build` followed by `npm run start` to test offline mode. Import `forsahil.apkg`. Its three cards are **suspended in the source export**: select **Resume suspended cards on import** if you want to study them immediately. Their suspension is preserved by default.

Download a native backup from Account & data after important study sessions. Keep your existing Anki collection until your actual templates/history have passed the compatibility checks.

## 2. Connect Supabase for cloud accounts

1. Create a Supabase project under your account. Choose a suitable region and save its database password privately.
2. Install the official Supabase CLI, run `supabase login`, then `supabase link --project-ref YOUR_PROJECT_REF` from this repository. Run `supabase db push` to apply the migration files. Alternatively, execute the SQL files in filename order in a fresh project's SQL editor. Do not rerun already-applied migrations manually.
3. Copy `.env.example` to **`apps/web/.env.local`** for the web app and **`.env`** at the repository root for the worker/Compose. Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`: project URL.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: public publishable key (legacy public anon key also works).
   - `SUPABASE_SERVICE_ROLE_KEY`: server-only service-role key for private media and account deletion.
   - `DATABASE_URL`: server PostgreSQL connection string for the project; use a database role allowed to `SET LOCAL ROLE recall_server`. The migrations grant that role to `postgres`. Use the provider's TLS connection settings and correctly URL-encode the password.
   - `APP_ORIGIN`: the exact browser origin, initially `http://localhost:3000`.
4. In Supabase Auth, set Site URL and allow `${APP_ORIGIN}/auth/callback`. Configure a production email/SMTP provider before inviting students. Open sign-in links in the browser where sign-in began.
5. Rebuild/restart the web app after changing `NEXT_PUBLIC_*` values. Confirm the `recall-media` bucket is private and the migrations completed.
6. Sign in from Account & data, choose **Bring guest library into this account**, and wait for acknowledgement. The guest copy remains on this device for recovery.

Official references: [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started), [migrations/deployment](https://supabase.com/docs/guides/deployment/managing-environments), and [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

For local cloud development instead, install Docker Desktop and the Supabase CLI, run `supabase start`, and use the local project values it prints. Configuration is in `supabase/config.toml`; local test mail is available through the local mail viewer. Docker was not available in the build workspace, so this full service stack still needs a local run.

## 3. Deploy the web server and worker

Choose your host and domain. Provide the public Supabase variables at **build time**, and all server secrets through the host's environment/secret manager. Set `APP_ORIGIN` and Supabase Auth redirects to the final HTTPS origin.

The included `Dockerfile` has `web` and `worker` targets. With a configured root `.env`:

```sh
docker compose up --build -d
docker compose --profile cloud up --build -d
```

The first command starts the app; the second also runs the persistent worker. Put the web service behind HTTPS. A normal Node host can use `npm run build` / `npm run start`, with `npm run worker` supervised separately. Do not place the worker in a short-lived HTTP function.

The live web app uses Vercel, and Railway runs `Dockerfile.worker` using `.railway/railway.ts`. Temporary synthetic smoke accounts exercise hosted Auth/Storage and are removed after each run. The alternative Docker Compose web stack remains untested locally; see `verification.md` for measured deployment evidence.

## 4. Optional source-only practice and reviewed drafts

Ordinary review works with all AI flags false. The deployed Phase 4.5 pilot uses `ENABLE_SOURCE_PRACTICE=true` on web and worker, plus `ENABLE_ADAPTIVE_PRACTICE` and `ENABLE_AI_GENERATION` on web. A signed-in learner chooses **AI-generated questions based on your deck** on Today before a timed session. The switch starts off each session. Expect at most one extra exercise after ten original reviews, subject to time and source eligibility. No Settings AI checkboxes are needed. [Exact scope and limits](phase-4.5-release.md) explain the source-only compiler, provider disclosure, self-check and quarantine. Set `ENABLE_SOURCE_PRACTICE=false` to disable this pilot.

For broader reviewer-authored/generated drafts, the protected `/review-content` workflow remains separate:

1. Assign a qualified reviewer to each collection. Use the SQL template in [operations](operations.md); this is an administrator action, not a browser permission.
2. Turn on `ENABLE_ADAPTIVE_PRACTICE=true` on the web service once approved activities exist. Delivery also requires session opt-in; unreviewed clinical application remains excluded from the learner mode.
3. Reviewers can author drafts through **Write a draft** without a model. For generation, verify the chosen provider/model's current availability, token prices, privacy/retention terms, and your intended data use. Set `LLM_PROVIDER=openai`, `LLM_MODEL`, `LLM_API_KEY`, the two per-million token prices, and a positive daily spend limit on the worker. Enable `ENABLE_AI_GENERATION=true` on web and worker.
4. Sign in, consent to selected-source processing, select one source note, and request a draft. `LLM_PROVIDER=fixture` supports all task/format combinations for the authored polygon example and simple recall for the remaining synthetic demo facts; it abstains on medical sources. Live model availability and results are recorded in `verification.md`.
5. The assigned reviewer checks fidelity **and** medical correctness/currentness, edits the draft, supplies the answer/rationale/rubric, and approves it. These broader drafts are review-gated; `source_bounded` never means `human_approved`. Reporting or source changes quarantine practice.

## 5. Complete the live release checks

Use the concrete checklist in [verification](verification.md): real email sign-in, two signed-in devices, offline divergence/reconnection, media transfer, sign-out/account switching, account deletion, and a restore drill. Test your target Anki versions and representative history-bearing/image-heavy decks. Check iOS Safari, Android Chrome, Firefox, keyboard-only use, and a screen reader.

Record backup retention/RPO/RTO for the hosting plan, verify recovery, and review content licensing, app branding, and privacy disclosures before inviting students. Qualified medical review and an educational evaluation cannot be replaced by the code's unit tests.
