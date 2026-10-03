import { createClient } from "@supabase/supabase-js";
import { HttpError } from "./auth";
export function adminStorage() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new HttpError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Private cloud storage is not configured.",
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
