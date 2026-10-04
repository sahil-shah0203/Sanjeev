"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { id, defaults, type Preferences } from "@recall/domain";
import { Library, cleanupStaging } from "../lib/db/local";
import { cloudConfigured, supabase } from "../lib/supabase/client";
import { syncLibrary } from "../features/sync";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
type Context = {
  db: Library;
  prefs: Preferences;
  user: { id: string; email?: string } | null;
  syncStatus: string;
  features: {
    adaptive: boolean;
    generation: boolean;
    sourcePractice: boolean;
    provider: string;
  };
  sync: () => Promise<void>;
};
const LibraryContext = createContext<Context | null>(null);
export const useLibrary = () => {
  const c = useContext(LibraryContext);
  if (!c) throw new Error("Library is not ready.");
  return c;
};
function Ready({
  db,
  user,
  children,
}: {
  db: Library;
  user: Context["user"];
  children: ReactNode;
}) {
  const prefs =
    useLiveQuery(() => db.preferences.get("preferences"), [db]) ?? defaults();
  const [syncStatus, setStatus] = useState("Saved on this device");
  const [features, setFeatures] = useState({
    adaptive: false,
    generation: false,
    sourcePractice: false,
    provider: "the configured provider",
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      const previous = await db.meta.get("deployment-features");
      if (active && previous) setFeatures(previous.value as typeof features);
      try {
        const response = await fetch("/api/config");
        if (!response.ok) return;
        const value = await response.json();
        const checked = {
          adaptive: value.adaptive === true,
          generation: value.generation === true,
          sourcePractice: value.sourcePractice === true,
          provider:
            value.provider === "OpenAI"
              ? "OpenAI"
              : "the synthetic fixture provider",
        };
        await db.meta.put({ id: "deployment-features", value: checked });
        if (active) setFeatures(checked);
      } catch {}
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [db]);
  const pending = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
  const sync = async () => {
    if (!user) {
      setStatus(
        navigator.onLine ? "Saved on this device" : "Offline · saved here",
      );
      return;
    }
    try {
      await syncLibrary(db, setStatus);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Sync needs attention");
    }
  };
  useEffect(() => {
    const theme =
      prefs.theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : prefs.theme;
    document.documentElement.dataset.theme = theme;
  }, [prefs.theme]);
  useEffect(() => {
    void sync();
    const onFocus = () => void sync();
    window.addEventListener("online", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener("offline", onFocus);
    const interval = setInterval(onFocus, 30000);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onFocus);
    };
  }, [db, user]);
  useEffect(() => {
    if (!user || pending === 0) return;
    const timer = setTimeout(() => void sync(), 1000);
    return () => clearTimeout(timer);
  }, [db, user, pending]);
  return (
    <LibraryContext.Provider
      value={{
        db,
        prefs,
        user,
        features,
        syncStatus:
          user && pending > 0 && syncStatus.startsWith("Synced")
            ? `Saved here · ${pending} changes waiting`
            : syncStatus,
        sync,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}
export default function LibraryProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Library | null>(null);
  const [user, setUser] = useState<Context["user"]>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current: Library | undefined;
    let cancelled = false;
    let guest = localStorage.getItem("recall-guest");
    if (!guest) {
      guest = id();
      localStorage.setItem("recall-guest", guest);
    }
    const open = async (owner: string, u: Context["user"]) => {
      if (current?.owner === owner && current.isOpen()) {
        setUser(u);
        return;
      }
      setDb(null);
      current?.close();
      const opening = new Library(owner);
      current = opening;
      try {
        await opening.open();
        await cleanupStaging(opening);
        if (!cancelled && current === opening) {
          setError("");
          setUser(u);
          setDb(opening);
        } else opening.close();
      } catch (e) {
        if (!cancelled && current === opening)
          setError(
            `Device storage could not open (${e instanceof Error ? e.name : "storage error"}). Enable browser storage or try again in a regular browser window.`,
          );
      }
    };
    void open(guest, null);
    let unsub: () => void = () => {};
    if (cloudConfigured()) {
      const { data } = supabase().auth.onAuthStateChange(
        (_event: AuthChangeEvent, session: Session | null) => {
          const u = session?.user;
          void open(u?.id ?? guest!, u ? { id: u.id, email: u.email } : null);
        },
      );
      unsub = () => data.subscription.unsubscribe();
    }
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      cancelled = true;
      unsub();
      current?.close();
    };
  }, []);
  if (error)
    return (
      <main className="center" role="alert">
        <h1>Storage needs attention</h1>
        <p>{error}</p>
      </main>
    );
  if (!db)
    return (
      <div className="center" role="status">
        <span className="brand-mark">R</span>
        <p>Opening your study space…</p>
      </div>
    );
  return (
    <Ready key={db.name} db={db} user={user}>
      {children}
    </Ready>
  );
}
