"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLibrary } from "./LibraryProvider";

export default function AiStudyToggle({
  checked,
  onChange,
  budget,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  budget: number;
}) {
  const { user, features } = useLibrary();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const available = features.sourcePractice && !!user && online && budget >= 5;
  useEffect(() => {
    if (!available && checked) onChange(false);
  }, [available, checked, onChange]);
  return (
    <div className="ai-choice">
      <label className="ai-switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={!available}
          aria-describedby="ai-summary"
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          Add AI-generated questions <small>· experimental</small>
        </span>
      </label>
      <p id="ai-summary">
        Brief questions from your deck. They may be wrong. Your card schedule
        stays the same.
        {features.deckPractice &&
          " Optional practice is offered around every four reviews when supported by your source."}
      </p>
      {!features.sourcePractice ? (
        <p>
          AI questions are unavailable on this installation. Regular review is
          ready.
        </p>
      ) : !online ? (
        <p>You’re offline. Regular review still works.</p>
      ) : !user ? (
        <p>
          <Link href="/account">Sign in</Link> to try AI questions. Regular
          review needs no account.
        </p>
      ) : budget < 5 ? (
        <p>Choose a timed session to keep extra questions brief.</p>
      ) : null}
      {checked && (
        <p className="ai-disclosure">
          Starting sends selected text from individual notes to{" "}
          {features.provider} for this session. Never include patient details.
          Questions are unverified; check the original source. You can skip any
          question. No research enrollment.{" "}
          <Link href="/help#ai">How it works</Link>
        </p>
      )}
    </div>
  );
}
