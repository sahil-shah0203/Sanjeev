"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  LibraryBig,
  Search,
  CircleHelp,
  UserRound,
  ArrowUpRight,
} from "lucide-react";
import LibraryProvider, { useLibrary } from "./LibraryProvider";
import Today from "./views/Today";
import ImportView from "./views/ImportView";
import Decks from "./views/Decks";
import Study from "./views/Study";
import Browse from "./views/Browse";
import Progress from "./views/Progress";
import SettingsView from "./views/Settings";
import Help from "./views/Help";
import ContentReview from "./views/ContentReview";
const nav = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/decks", label: "Decks", icon: LibraryBig },
  { href: "/browse", label: "Browse", icon: Search },
  { href: "/progress", label: "Progress", icon: ChartNoAxesCombined },
  { href: "/help", label: "Help", icon: CircleHelp },
];
function Shell() {
  const routedPath = usePathname();
  const path =
    typeof window === "undefined" ? routedPath : window.location.pathname;
  const { user, syncStatus } = useLibrary();
  const studying = path.startsWith("/study");
  if (studying) return <Study />;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          Sanjeev AI
        </Link>
        <p className="nav-caption">YOUR STUDY SPACE</p>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={
                path === n.href || (n.href !== "/" && path.startsWith(n.href))
                  ? "nav-link active"
                  : "nav-link"
              }
              aria-current={path === n.href ? "page" : undefined}
            >
              <n.icon size={19} />
              {n.label}
              {n.href === "/" && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="device-note">
            <span className="status-dot" />
            <span>{syncStatus}</span>
          </div>
          <Link href="/account" className="account-row">
            <span className="avatar">
              {user?.email?.slice(0, 1).toUpperCase() ?? "G"}
            </span>
            <span>
              <strong>{user?.email?.split("@")[0] ?? "Guest workspace"}</strong>
              <small>Settings & account</small>
            </span>
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link href="/" className="mobile-brand">
            Sanjeev AI
          </Link>
          <span className="topbar-motto">Your cards. Your next step.</span>
          <div className="topbar-actions">
            <Link href="/account" className="mobile-account">
              <UserRound size={15} />
              Settings & account
            </Link>
          </div>
        </header>
        <main id="main">
          {path === "/import" ? (
            <ImportView />
          ) : path.startsWith("/decks") ? (
            <Decks />
          ) : path === "/browse" ? (
            <Browse />
          ) : path === "/progress" ? (
            <Progress />
          ) : path === "/help" ? (
            <Help />
          ) : path === "/account" || path === "/settings" ? (
            <SettingsView key="account" />
          ) : path === "/review-content" ? (
            <ContentReview />
          ) : (
            <Today />
          )}
        </main>
        <footer className="app-footer">
          <span>Sanjeev AI · built around your study day.</span>
          <span>Beta · your progress stays yours.</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map((n) => (
          <Link
            href={n.href}
            key={n.href}
            aria-label={n.label}
            className={path === n.href ? "active" : ""}
          >
            <n.icon size={20} />
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
export default function App() {
  return (
    <LibraryProvider>
      <Shell />
    </LibraryProvider>
  );
}
