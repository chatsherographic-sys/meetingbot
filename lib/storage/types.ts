import type { StoreData } from "@/lib/types";

export type StorageDriver = "local" | "supabase";

export type NormalizeStoreDataInput = unknown;

export type StorageAdapterWriteOptions = {
  previousRawStore?: string | null;
};

export type StorageAdapter = {
  driver: StorageDriver;
  initialize(): Promise<void>;
  readStore(): Promise<StoreData>;
  writeStore(
    data: StoreData,
    options?: StorageAdapterWriteOptions,
  ): Promise<void>;
};

export type StorageAdapterFactoryOptions = {
  emptyStore: StoreData;
  normalizeStoreData: (input: NormalizeStoreDataInput) => StoreData;
  corruptionRecoveryError: string;
};
