// Values electron-vite reads from .env for the main process (MAIN_VITE_ prefix). Not committed.
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
