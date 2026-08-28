/* Where the app syncs to.
 *
 * Leave these empty and the app is exactly what it was: local-only, no
 * network. Fill them in (or set them per-device under Settings → Sync) and
 * the same values point at either a hosted Supabase project or one you run
 * yourself — it is the same API either way, so moving is a URL change.
 *
 * The anon key is a public, client-side key by design; it is not a secret.
 * The pairing code IS the secret, and lives only in each device's settings —
 * never in this file, and never in a backup.
 */
const Config = {
  url: '',        // e.g. 'https://abcdefgh.supabase.co', later 'http://nayla:8000'
  anonKey: '',
};
