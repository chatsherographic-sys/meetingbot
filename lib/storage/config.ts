import type { StorageDriver } from "@/lib/storage/types";

export function getStorageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER?.trim().toLowerCase() === "supabase"
    ? "supabase"
    : "local";
}

export function getSupabaseStorageConfigError(): string | null {
  if (getStorageDriver() !== "supabase") {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return "Supabase storage is selected but Supabase environment variables are missing.";
  }

  return null;
}
