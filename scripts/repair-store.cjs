const {
  ensureDataDirectory,
  fileExists,
  readJsonFile,
  storeBackupPath,
  storePath,
  writeRawStoreAtomically,
} = require("./store-file-utils.cjs");

async function main() {
  await ensureDataDirectory();

  const hasStore = await fileExists(storePath);

  if (!hasStore) {
    console.error("data/store.json does not exist.");
    console.error(
      "If you have a valid backup, place it at data/store.backup.json and rerun npm run repair-store.",
    );
    console.error(
      "Otherwise run npm run reset-store to create a fresh empty store.",
    );
    process.exitCode = 1;
    return;
  }

  try {
    await readJsonFile(storePath);
    console.log("data/store.json is valid. No repair was needed.");
    return;
  } catch (storeError) {
    console.warn(
      `data/store.json is invalid: ${
        storeError instanceof Error ? storeError.message : "Unknown JSON error."
      }`,
    );
  }

  try {
    const backup = await readJsonFile(storeBackupPath);
    await writeRawStoreAtomically(backup.raw);
    console.log(
      "Repair successful. Restored data/store.json from data/store.backup.json.",
    );
  } catch (backupError) {
    console.error(
      "Repair failed. data/store.json is invalid and data/store.backup.json is missing or invalid.",
    );
    console.error(
      "Manual recovery: stop the dev server, inspect data/store.json and data/store.backup.json, then rerun npm run repair-store or npm run reset-store.",
    );
    console.error(
      `Backup error: ${
        backupError instanceof Error ? backupError.message : "Unknown backup error."
      }`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `Unexpected repair-store failure: ${
      error instanceof Error ? error.message : "Unknown error."
    }`,
  );
  process.exitCode = 1;
});
