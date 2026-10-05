export function importError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Import could not be completed. Try again.";
  const name = error instanceof Error ? error.name : "";
  if (/QuotaExceeded/i.test(name + message))
    return "This browser reached its storage limit while saving the deck. Try a regular (non-private) browser window, free device space, or import a smaller selected deck. Existing cards and progress are preserved.";
  return message;
}
