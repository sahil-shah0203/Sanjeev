import Link from "next/link";
import { PageTitle } from "../ui";
export default function Help() {
  return (
    <div className="help-guide">
      <PageTitle
        eyebrow="A TWO-MINUTE GUIDE"
        title="Make yourself at home."
        description="Your Anki cards, a short review, and a clear next step."
      />
      <ol>
        <li className="panel">
          <h2>Bring your cards</h2>
          <p>
            Open <Link href="/decks">Decks</Link> and choose Import deck. Select
            an Anki .apkg file, check the preview, then import. Your supported
            cards and included media save on this device. You can start without
            an account.
          </p>
          <p>
            Just looking around? <Link href="/">Today</Link> offers six
            demonstration cards when your library is empty.
          </p>
        </li>
        <li className="panel">
          <h2>Make time for a review</h2>
          <p>
            On <Link href="/">Today</Link>, choose a deck and 5, 15, or 30
            minutes. Due cards are ready to review now; new cards are limited by
            your daily setting. Start review, try to recall the answer, then
            reveal it. An unfinished session can be resumed from Today.
          </p>
        </li>
        <li className="panel">
          <h2>Tell us how recall felt</h2>
          <p>
            Rate your own recall after seeing the original answer. FSRS uses
            these ratings to plan the next review.
          </p>
          <table>
            <caption className="sr-only">Review ratings</caption>
            <tbody>
              <tr>
                <th>Again</th>
                <td>You forgot or answered incorrectly.</td>
              </tr>
              <tr>
                <th>Hard</th>
                <td>You remembered correctly, with difficulty.</td>
              </tr>
              <tr>
                <th>Good</th>
                <td>You remembered correctly with normal effort.</td>
              </tr>
              <tr>
                <th>Easy</th>
                <td>You remembered correctly and it felt effortless.</td>
              </tr>
            </tbody>
          </table>
          <p>
            If you cannot attempt a card, choose “I can’t attempt this yet.”
            Seeing the answer saves an exposure without moving its schedule. Use
            Browse to find, edit, flag, suspend, or bury a card.
          </p>
          <p>
            Keyboard: <kbd>Space</kbd> reveals; <kbd>1</kbd>–<kbd>4</kbd> rate;{" "}
            <kbd>Z</kbd> undoes the last review. Shortcuts pause while you type.
          </p>
        </li>
        <li className="panel" id="ai">
          <h2>Try a different question</h2>
          <p>
            Before a timed session, optionally turn on{" "}
            <strong>Add AI-generated questions</strong>. It starts off.
            Signed-in, online students can get occasional source-completion,
            source-wording choices, comparisons, or restatements from a selected
            note. Some notes cannot support a question, so we continue ordinary
            review.
          </p>
          <p>
            Selected source text goes to the configured AI provider (shown
            beside the toggle); provider retention policies apply. Never include
            patient-identifying information. The model selects from constrained
            source exercises; it does not author new clinical cases or give
            medical advice. Your deck itself may contain mistakes or outdated
            information.
          </p>
          <p>
            Every question is labeled unverified and includes its source. Skip
            or report anything questionable. Free-text responses are for
            self-checking, not an AI medical grade. Extra questions never rate
            your original card or change FSRS. These formats are an experiment,
            not a proven learning advantage.
          </p>
          <p>
            Expect at most one extra question per ten original reviews and a
            small part of your timed session. Generation runs while you review;
            a slow or unavailable service never holds up your cards.
          </p>
        </li>
        <li className="panel">
          <h2>Keep your progress safe</h2>
          <p>
            Reviews save automatically on this device.{" "}
            <Link href="/account">Account & data</Link> lets you optionally sign
            in for automatic sync, bring your guest library into your account,
            or download a native backup. “Saved on this device” and “Synced”
            mean different things. Keep a backup somewhere safe in case the
            browser’s storage is cleared.
          </p>
          <p>
            For offline study, open a deck and choose Check offline readiness
            while connected. Regular reviews work offline and sync on reconnect.
            Restore a native backup into an empty library. An Anki content
            export does not include your Sanjeev review schedule.
          </p>
        </li>
      </ol>
      <div className="button-row">
        <Link href="/" className="button primary">
          Back to Today
        </Link>
        <Link href="/account" className="button secondary">
          Settings & account
        </Link>
      </div>
    </div>
  );
}
