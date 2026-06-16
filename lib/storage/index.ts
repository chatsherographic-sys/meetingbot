import { createLocalStoreAdapter } from "@/lib/storage/local-store";
import { createSupabaseStoreAdapter } from "@/lib/storage/supabase-store";
import { getStorageDriver } from "@/lib/storage/config";
import type {
  StorageAdapter,
  StorageAdapterFactoryOptions,
} from "@/lib/storage/types";

export { getStorageDriver } from "@/lib/storage/config";

export function createStorageAdapter(
  options: StorageAdapterFactoryOptions,
): StorageAdapter {
  return getStorageDriver() === "supabase"
    ? createSupabaseStoreAdapter(options)
    : createLocalStoreAdapter(options);
}
