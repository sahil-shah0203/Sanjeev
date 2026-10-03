import { createBrowserClient } from "@supabase/ssr";
export const cloudConfigured = () =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client: ReturnType<typeof createBrowserClient> | undefined;
export function supabase() {
  if (!cloudConfigured())
    throw new Error(
      "Cloud accounts have not been configured for this installation.",
    );
  return (client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ));
}
