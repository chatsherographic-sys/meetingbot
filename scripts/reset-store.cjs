const fs = require("node:fs/promises");
const path = require("node:path");
const {
  emptyStore,
  ensureDataDirectory,
  fileExists,
  formatTimestampForFilename,
  storeBackupPath,
  storePath,
  writeRawStoreAtomically,
} = require("./store-file-utils.cjs");

async function main() {
  await ensureDataDirectory();

  const hasStore = await fileExists(storePath);
  const timestamp = formatTimestampForFilename();

  if (hasStore) {
    const corruptedCopyPath = path.join(
      path.dirname(storePath),
      `store.corrupted.${timestamp}.json`,
    );
    await fs.copyFile(storePath, corruptedCopyPath);
    console.log(`Backed up current store to ${corruptedCopyPath}`);
  } else {
    console.log("data/store.json was missing. Creating a fresh store file.");
  }

  const rawEmptyStore = JSON.stringify(emptyStore, null, 2);
  await fs.writeFile(storeBackupPath, rawEmptyStore, "utf8");
  await writeRawStoreAtomically(rawEmptyStore);

  console.warn(
    "Store reset complete. Local bots, triggers, timer triggers, and logs were reset to an empty state.",
  );
}

main().catch((error) => {
  console.error(
    `Unexpected reset-store failure: ${
      error instanceof Error ? error.message : "Unknown error."
    }`,
  );
  process.exitCode = 1;
});
