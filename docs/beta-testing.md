# Friend-testing guide

Beta: https://recall-sepia-seven.vercel.app

Start with two or three friends and small exports they are allowed to use. Keep Anki and a backup as the source of recovery during the beta.

1. Open the app without signing in. Try the six demonstration cards, then import a small `.apkg`. Compare the reported playable, suspended and unsupported counts with Anki. Unsupported content should be explained rather than silently shown as a blank card.
2. Study a few cards. Space reveals; 1–4 grade; Z undoes. Try **I can’t attempt this yet**, edit a note, flag/suspend/bury a card, and verify the original answer stays hidden until reveal.
3. Download a native backup. Restore it in an empty browser profile and compare the deck, history and media.
4. On the original device, choose **Check offline readiness** from a deck. Disconnect, reopen a study session, review, reload, and reconnect. Confirm the saved count stays correct.
5. Optionally sign in through Account & data, bring the guest library into the account, and sign into a second browser/device. Confirm media and progress arrive. Study different cards offline on each device, reconnect, and check that neither answer disappears.
6. Keep AI off for the first core workflow trial. Then, while signed in and online, choose a timed session on Today and turn on **AI-generated questions based on your deck**. Review ten original cards; a supported source may offer one extra exercise. Expect safe abstention on unsuitable sources and no exercise for a short session. Read its source, self-check, skip or report it. The label says unverified, and original FSRS intervals must stay unchanged. The [release notes](phase-4.5-release.md) describe the narrow source-only scope and remaining limits.

Report the browser/device, action, expected behavior, actual behavior, approximate time and any displayed error code. A synthetic reproduction is preferable to sharing private decks. Do not send credentials or patient information. For incorrect source content, report the card; for questionable generated content, use **Report question** and retain the source reference for the assigned reviewer.

Ask whether fast review stayed fast, whether feedback clarified the specific gap, and whether they could recover their work. These are product hypotheses to evaluate; time spent in the app or a successful immediate repair is not proof of lasting learning.

Before expanding the pilot, test real iOS Safari/Android/Firefox, a screen reader, denied or low browser storage, an authorized history-bearing deck, and an image-heavy collection. Review the exact compatibility matrix in `import-compatibility.md`.
