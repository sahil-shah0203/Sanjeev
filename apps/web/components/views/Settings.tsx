"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Cloud,
  Download,
  Upload,
  ShieldCheck,
  RefreshCw,
  LogOut,
  ArrowUpRight,
} from "lucide-react";
import { type Preferences, errorMessage } from "@recall/domain";
import { useLibrary } from "../LibraryProvider";
import { savePreferences, Library } from "../../lib/db/local";
import { download, exportLibrary, restoreLibrary } from "../../features/backup";
import { claimGuest } from "../../features/sync";
import { cloudConfigured, supabase } from "../../lib/supabase/client";
import { PageTitle, Notice } from "../ui";
export default function Settings() {
  const { db, prefs, user, sync, syncStatus } = useLibrary();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [clear, setClear] = useState("");
  const [deleteAccount, setDeleteAccount] = useState("");
  const [guestCount, setGuestCount] = useState(0);
  const [quota, setQuota] = useState<{ usage?: number; quota?: number }>({});
  const [flags, setFlags] = useState({ adaptive: false, generation: false });
  const pending = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
  const conflicts =
    useLiveQuery(
      () =>
        db.meta
          .filter(
            (m) =>
              m.id.startsWith("conflict:") ||
              m.id.startsWith("claim-conflict:"),
          )
          .toArray(),
      [db],
    ) ?? [];
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("authError")) {
      setError(
        "That sign-in link could not be verified. Request a new link and open it in the same browser.",
      );
      history.replaceState({}, "", "/settings");
    } else if (params.get("connected")) {
      setMessage(
        "Your account is connected. Sync your guest library below to preserve this device's progress.",
      );
      history.replaceState({}, "", "/settings");
    }
    navigator.storage
      ?.estimate()
      .then(setQuota)
      .catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then(setFlags)
      .catch(() => {});
    const owner = localStorage.getItem("recall-guest");
    if (user && owner && owner !== user.id) {
      const guest = new Library(owner);
      guest.cards
        .count()
        .then(setGuestCount)
        .finally(() => guest.close());
    }
  }, [user]);
  const task = async (fn: () => Promise<void>) => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const change = async <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    try {
      await savePreferences(db, { ...prefs, [key]: value });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const backup = () =>
    task(async () => {
      download(
        await exportLibrary(db),
        `recall-backup-${new Date().toISOString().slice(0, 10)}.recall`,
      );
      setMessage(
        "Native backup downloaded. Keep it somewhere you can recover even if this browser is cleared.",
      );
    });
  const signIn = () =>
    task(async () => {
      const { error } = await supabase().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) throw error;
      setMessage(
        "Check your email for the sign-in link. Keep this browser open to bring your guest library with you.",
      );
    });
  return (
    <>
      <PageTitle
        eyebrow="MAKE IT YOURS"
        title="A routine that fits."
        description="Set your pace, keep a backup, and choose how your data is used."
      />
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <div className="settings-layout">
        <section className="panel settings-section">
          <h2>Your study rhythm</h2>
          <div className="settings-fields">
            <label>
              Session length
              <select
                value={prefs.budgetMinutes}
                onChange={(e) =>
                  change("budgetMinutes", Number(e.target.value))
                }
              >
                {[5, 15, 30, 0].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} minutes` : "Untimed"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New cards per study day
              <input
                type="number"
                min="0"
                max="1000"
                value={prefs.newLimit}
                onChange={(e) =>
                  change(
                    "newLimit",
                    Math.min(1000, Math.max(0, Number(e.target.value))),
                  )
                }
              />
              <small>
                New intake stays separate from due learning and review steps.
              </small>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={prefs.burySiblings}
                onChange={(e) => change("burySiblings", e.target.checked)}
              />
              Bury sibling cards until the next study day
            </label>
            <label>
              Appearance
              <select
                value={prefs.theme}
                onChange={(e) =>
                  change("theme", e.target.value as Preferences["theme"])
                }
              >
                <option value="system">Follow device</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Study-day rollover
              <select
                value={prefs.rollover}
                onChange={(e) => change("rollover", Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              Timezone
              <select
                value={prefs.timezone}
                onChange={(e) => change("timezone", e.target.value)}
              >
                {[
                  ...new Set([
                    prefs.timezone,
                    ...Intl.supportedValuesOf("timeZone"),
                  ]),
                ].map((t) => (
                  <option value={t} key={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <details>
              <summary>Advanced scheduling</summary>
              <label>
                Desired retention: {Math.round(prefs.retention * 100)}%
                <input
                  type="range"
                  min="70"
                  max="99"
                  value={Math.round(prefs.retention * 100)}
                  onChange={(e) =>
                    change("retention", Number(e.target.value) / 100)
                  }
                />
                <small>
                  Higher targets generally increase review workload. Changes
                  apply to future reviews; existing due dates stay intact.
                </small>
              </label>
              <p>FSRS 5.4.2 · deterministic scheduling · default target 90%</p>
            </details>
          </div>
        </section>
        <div className="settings-fields">
          <section id="account" className="panel settings-section">
            <div className="section-heading">
              <h2>Save across devices</h2>
              <Cloud size={20} />
            </div>
            {user ? (
              <>
                <p>
                  Signed in as <strong>{user.email}</strong>
                </p>
                <p>
                  {syncStatus} · {pending} local changes waiting
                </p>
                <p>
                  Reviews save immediately on this device and sync automatically
                  when you are online. Use Sync now to force an immediate retry.
                </p>
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => task(sync)}
                  >
                    <RefreshCw size={16} />
                    Sync now
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      task(async () => {
                        if (pending)
                          throw new Error(
                            "Sync your pending changes before signing out. A native backup is also available for independent recovery.",
                          );
                        const { error } = await supabase().auth.signOut();
                        if (error) throw error;
                      })
                    }
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
                {guestCount > 0 && (
                  <Notice>
                    {guestCount} cards are still in your guest workspace.{" "}
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        task(async () => {
                          await claimGuest(db);
                          setGuestCount(0);
                          setMessage(
                            "Guest library copied and acknowledged by the server. The guest copy is retained for recovery.",
                          );
                        })
                      }
                    >
                      Bring guest library into this account
                    </button>
                  </Notice>
                )}
                <p className="muted">
                  Your account library stays on this device after sign-out,
                  partitioned from other accounts.
                </p>
              </>
            ) : cloudConfigured() ? (
              <>
                <p>
                  Use an email link to add cloud recovery and continue on
                  another device. Your guest library can be transferred after
                  sign-in.
                </p>
                <form
                  className="account-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void signIn();
                  }}
                >
                  <input
                    required
                    type="email"
                    aria-label="Email address"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <button
                    className="button primary"
                    disabled={busy}
                    type="submit"
                  >
                    Send sign-in link
                  </button>
                </form>
              </>
            ) : (
              <>
                <p>
                  Cloud accounts are not configured on this installation. Your
                  library works locally, including ordinary review and backups.
                </p>
                <Notice>
                  Saved on this device does not mean backed up. Download a
                  native backup below.
                </Notice>
              </>
            )}
          </section>
          <section className="panel settings-section">
            <div className="section-heading">
              <h2>Backup & recovery</h2>
              <ShieldCheck size={20} />
            </div>
            <p>
              A native backup includes your source material, media, schedules,
              review history, and additional practice records.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                disabled={busy}
                onClick={backup}
              >
                <Download size={16} />
                Download native backup
              </button>
              <label className="button secondary file-button">
                <Upload size={16} />
                Restore backup
                <input
                  aria-label="Restore native backup"
                  type="file"
                  accept=".recall,.zip"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void task(async () => {
                        await restoreLibrary(db, file);
                        setMessage(
                          "Backup validated and restored with its history and media.",
                        );
                      });
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p>
              Restore into an empty library to avoid overwriting current
              progress. Anki content exports are available from each deck.
            </p>
            <p>
              {quota.usage !== undefined
                ? `${(quota.usage / 1024 ** 2).toFixed(1)} MiB used on this device.`
                : ""}
            </p>
            <button
              className="text-button"
              onClick={() =>
                task(async () => {
                  const persisted = await navigator.storage.persist();
                  setMessage(
                    persisted
                      ? "This browser granted persistent storage. Still keep a native backup."
                      : "This browser did not grant persistent storage. Keep regular native backups.",
                  );
                })
              }
            >
              Request persistent browser storage
            </button>
          </section>
        </div>
        <section className="panel settings-section settings-full">
          <h2>Understanding checks & AI</h2>
          <p>
            Ordinary review always works without AI. Optional checks use a
            bounded part of your session and never give automatic credit to the
            original card’s schedule.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.adaptive}
              disabled={!flags.adaptive}
              onChange={(e) => change("adaptive", e.target.checked)}
            />
            Offer approved understanding checks
          </label>
          {!flags.adaptive && (
            <p>
              Reviewed practice is disabled for this deployment. Your ordinary
              study path is ready to use.
            </p>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.aiConsent}
              disabled={!user || !flags.generation}
              onChange={(e) => change("aiConsent", e.target.checked)}
            />
            Allow selected source excerpts to be processed by the configured AI
            provider
          </label>
          <p>
            Generation sends only the selected text and source references.
            Medical correctness still requires qualified human review. Provider
            retention policies apply; do not include patient records.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={prefs.evaluationConsent}
              onChange={(e) => change("evaluationConsent", e.target.checked)}
            />
            Opt into a future learning evaluation (separate from ordinary usage)
          </label>
          <Link href="/review-content" className="text-link">
            Content review workspace
            <ArrowUpRight size={14} />
          </Link>
        </section>
        {conflicts.length > 0 && (
          <section className="panel settings-full">
            <h2>Preserved sync conflicts</h2>
            <p>
              {conflicts.length} changes need review. Canonical server schedules
              remain authoritative.
            </p>
            <button
              className="button secondary"
              onClick={() =>
                download(
                  new Blob([JSON.stringify(conflicts, null, 2)], {
                    type: "application/json",
                  }),
                  "recall-conflicts.json",
                )
              }
            >
              Export conflict audit
            </button>
          </section>
        )}
        <section className="panel settings-section settings-full danger-zone">
          <h2>Clear this device’s library</h2>
          <p>
            Export a native backup first. This removes the currently open
            library from this browser. Cloud data can return on the next sync.
          </p>
          <label>
            Type CLEAR to enable
            <input
              value={clear}
              onChange={(e) => setClear(e.target.value)}
              autoComplete="off"
              aria-label="Confirm clearing local library"
            />
          </label>
          <button
            className="button danger"
            disabled={clear !== "CLEAR" || busy}
            onClick={() =>
              task(async () => {
                await db.delete();
                location.assign("/");
              })
            }
          >
            Clear local library
          </button>
          {user && (
            <>
              <h3>Delete cloud account</h3>
              <p>
                This permanently removes your account, cloud records, and
                private cloud media. Download your backup first.
              </p>
              <label>
                Type DELETE ACCOUNT
                <input
                  value={deleteAccount}
                  onChange={(e) => setDeleteAccount(e.target.value)}
                  autoComplete="off"
                  aria-label="Confirm deleting cloud account"
                />
              </label>
              <button
                className="button danger"
                disabled={deleteAccount !== "DELETE ACCOUNT" || busy}
                onClick={() =>
                  task(async () => {
                    const response = await fetch("/api/account", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ confirmation: deleteAccount }),
                    });
                    const body = await response.json();
                    if (!response.ok)
                      throw new Error(
                        body.error?.message ?? "Deletion failed.",
                      );
                    await supabase().auth.signOut();
                    setMessage("Cloud account deleted.");
                  })
                }
              >
                Delete cloud account permanently
              </button>
            </>
          )}
        </section>
      </div>
    </>
  );
}
