import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  StorageAdapter,
  StorageAdapterFactoryOptions,
  StorageAdapterWriteOptions,
} from "@/lib/storage/types";

export function getLocalStorePaths(rootDirectory = process.cwd()) {
  const dataDirectory = path.join(rootDirectory, "data");

  return {
    dataDirectory,
    storePath: path.join(dataDirectory, "store.json"),
    storeTempPath: path.join(dataDirectory, "store.json.tmp"),
    storeBackupPath: path.join(dataDirectory, "store.backup.json"),
  };
}

export function createLocalStoreAdapter(
  options: StorageAdapterFactoryOptions,
): StorageAdapter {
  const { dataDirectory, storeBackupPath, storePath, storeTempPath } =
    getLocalStorePaths();

  async function readStoreFileRaw(filePath: string): Promise<string> {
    return readFile(filePath, "utf8");
  }

  async function ensureStoreFilesExist(): Promise<void> {
    await mkdir(dataDirectory, { recursive: true });

    try {
      await readFile(storePath, "utf8");
    } catch {
      try {
        const rawBackupStore = await readStoreFileRaw(storeBackupPath);
        options.normalizeStoreData(JSON.parse(rawBackupStore) as object);
        await writeFile(storePath, rawBackupStore, "utf8");
        return;
      } catch {
        const rawEmptyStore = JSON.stringify(options.emptyStore, null, 2);
        await writeFile(storePath, rawEmptyStore, "utf8");
        await writeFile(storeBackupPath, rawEmptyStore, "utf8");
      }
    }
  }

  async function writeStoreAtomically(
    data: ReturnType<typeof options.normalizeStoreData>,
    writeOptions?: StorageAdapterWriteOptions,
  ): Promise<void> {
    await mkdir(dataDirectory, { recursive: true });
    const nextRawStore = JSON.stringify(data, null, 2);

    if (typeof writeOptions?.previousRawStore === "string") {
      await writeFile(storeBackupPath, writeOptions.previousRawStore, "utf8");
    }

    await writeFile(storeTempPath, nextRawStore, "utf8");
    await rename(storeTempPath, storePath);
  }

  return {
    driver: "local",
    async initialize() {
      await ensureStoreFilesExist();
    },
    async readStore() {
      await ensureStoreFilesExist();

      try {
        const rawStore = await readStoreFileRaw(storePath);
        return options.normalizeStoreData(
          JSON.parse(rawStore) as ReturnType<typeof JSON.parse>,
        );
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }

        try {
          const rawBackupStore = await readStoreFileRaw(storeBackupPath);
          const recoveredStore = options.normalizeStoreData(
            JSON.parse(rawBackupStore) as ReturnType<typeof JSON.parse>,
          );
          await writeStoreAtomically(recoveredStore, {
            previousRawStore: rawBackupStore,
          });
          return recoveredStore;
        } catch (backupError) {
          if (backupError instanceof SyntaxError) {
            throw new Error(options.corruptionRecoveryError);
          }

          if (backupError instanceof Error && "code" in backupError) {
            throw new Error(options.corruptionRecoveryError);
          }

          throw backupError;
        }
      }
    },
    async writeStore(data, writeOptions) {
      await writeStoreAtomically(data, writeOptions);
    },
  };
}
