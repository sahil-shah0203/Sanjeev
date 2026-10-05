# Operations and recovery

Use [manual setup](manual-setup.md) for credentials and the first deployment. Web and worker must use the same project and feature flags. Public Supabase variables are build-time values; all secrets stay on the server.

## Deployment checks

1. Run typecheck, tests, production build, and production browser tests from the pinned lockfiles.
2. Apply forward-compatible SQL migrations before the application starts. Never reset a live database to fix a migration.
3. Confirm `/api/health` returns 200. This is a process health check, not proof of database/email/model availability.
4. Verify real authentication, a sync push/pull, one media upload/download, and guest claim with your project.
5. Supervise the persistent Node worker when generation/grading is enabled. It logs job identifiers and redacted errors, backs off and retries database outages, and returns 503 from `/healthz` when database contact is stale. Railway restarts failed processes.
6. Broader generation produces drafts requiring assigned review. Phase 4.5 source-only generation may publish `source_bounded` exercises without clinical approval, under the [documented compiler boundary](phase-4.5-release.md); learner session opt-in is required. Run a synthetic fixture job before a paid call. Paid jobs have no automatic retries. Set `ENABLE_SOURCE_PRACTICE=false` on web and worker to disable the source-only pilot.

The Docker web target runs as the unprivileged `node` user. Railway's dedicated worker image is runtime verified; the optional local Compose web stack is not. Use HTTPS and current platform security updates. Account limits, SMTP restrictions, pricing and retention depend on the plan.

Vercel packages public assets during Next's build adapter: the offline manifest is generated in `compiler.runAfterProductionCompile` before that step. After deploying, run the public offline browser journey. Railway uses [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) in `.railway/railway.ts`; legacy `railway.json` does not configure new services. Inspect `railway config plan`: secrets must remain `preserve()`, and a routine update should show no deletions.

## Reviewer assignments

Run this in the project SQL editor as an administrator, replacing the placeholders with actual Auth user UUIDs and a documented qualification. Do not grant users direct write access to `reviewer_scopes` or medical approval tables.

```sql
insert into public.reviewer_scopes(owner_id, reviewer_id, qualification)
values ('COLLECTION_OWNER_UUID', 'REVIEWER_AUTH_UUID', 'Recorded clinical/content qualification')
on conflict(owner_id, reviewer_id)
do update set qualification = excluded.qualification;
```

The reviewer signs into their own account and enters the assigned collection owner ID in the content-review workspace. Approval is server-authorized and source-version checked. Editing an existing item's substantive content creates a new item/version and quarantines the old item so old attempts remain interpretable. Resolving a report records an audit comment; resolution does not automatically reapprove a quarantined item.

## Useful operational queries

Run with a privileged operational connection. Results contain identifiers only; avoid logging source text, answers, credentials, or email addresses.

```sql
select status, kind, count(*) from public.jobs group by status, kind;
select id, kind, heartbeat_at, lease_until
from public.jobs where status='running' and lease_until < now();
select day, sum(reserved_usd) as maximum_reserved_cost
from public.usage_ledger group by day order by day desc;
select count(*) from public.documents
where entity='reports' and value->>'status'='open';
select count(*) from public.mutation_receipts
where receipt->>'status'='conflict';
```

Worker leases last 60 seconds and heartbeat every 15 seconds. Model requests time out after 45 seconds. Publication rechecks lease/cancellation inside a database transaction. Paid jobs have one attempt; uncertain paid execution is not automatically retried. The global daily ledger reserves a conservative 24,000-input/1,800-output token bound using configured rates; `used_usd` is not provider-billed telemetry. Reconcile actual provider invoices separately. Stale exhausted jobs are marked failed by idle worker housekeeping.

## Recovery drill

1. Download a native backup from the importing device. Retain that file independently of sync and browser storage.
2. In an empty browser profile, restore it through Account & data. Confirm notes/cards/media counts, an existing review head and due date, an original archive, and one note revision. Generated activities restore quarantined, including source-only exercises.
3. Review one card, close the tab immediately after the next prompt appears, and reopen. Verify one event, one schedule transition, and a recoverable undo.
4. For a cloud account, sign in on another device and complete the same check after sync. Review separate offline branches and verify one canonical branch plus retained conflict events after reconnection.
5. Test database and private-storage recovery using the selected hosting plan's documented backup facilities. Restore into a staging environment first. Supabase storage object backups and database backups must both be considered; do not assume one includes the other.

A proposed pilot target is **daily independent backups (RPO ≤24 hours)** and a **four-hour restore exercise (RTO ≤4 hours)**. These are operator targets, not measured guarantees. Record the observed drill results before promising them to students.

## Sync conflicts

An event advances the schedule only when its parent/head, state version, source version, and recomputed result match the canonical state. Stale branches and future-clock events remain audit records without an extra interval extension. New local writes stop a pending pull so a server snapshot cannot overwrite unsent reviews. A later pass retries automatically.

Use Account & data to export unresolved conflict proposals. Existing schedules cannot be replaced by ordinary state `put` requests. Restored history uses an archival mutation that retains events without replaying them. Extended divergent chains require human inspection; there is no automatic “credit all reviews” override.

Guest copying snapshots the guest data and outbox consistently, writes the account copy atomically, preserves stable mutation IDs, and retains the guest database after acknowledgement. The copy is a one-time snapshot: subsequent study in the old guest workspace is not automatically merged. Download another native backup before making a separate recovery decision.

## Storage and privacy

Only completed imports' media is eligible for cloud upload. Abandoned import staging older than 24 hours is cleaned up on library open. Original package archive Blobs are local/backup-only. Same-owner media objects are content-addressed and checked after upload and download; other owners cannot access their records or storage paths through ordinary browser credentials.

Native backups are not encrypted. Store them in a location appropriate for their source content. Source decks may contain copyrighted study material; the app never treats the supplied private sample as redistributable demo data. Do not put patient records into a study source or model request.

Cookies/Auth and IndexedDB are separate. Sign-out retains the partitioned account database for recovery and refuses pending work unless it has been synchronized. Deleting a cloud account is a separate typed-confirmation operation. Clearing browser storage is a local operation and does not delete cloud data.

The service worker caches same-origin app assets/shell only; API/Auth responses are excluded. An update waits for existing clients to close rather than forcing a reload in the middle of a review. Roll back app/policy code independently of data; retain event histories and apply forward SQL fixes.
