const fs = require("node:fs/promises");
const path = require("node:path");

const dataDirectory = path.join(process.cwd(), "data");
const storePath = path.join(dataDirectory, "store.json");
const storeTempPath = path.join(dataDirectory, "store.json.tmp");
const storeBackupPath = path.join(dataDirectory, "store.backup.json");

const emptyStore = {
  storageLoggingMode: "production_minimal",
  meetingSessions: [
    {
      id: "default-session",
      name: "Default Session",
      zoomUrl: "",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: null,
      notes: "Automatically created for older records that did not have a session.",
    },
  ],
  scheduledBotJoins: [],
  triggerRules: [],
  transcriptLogs: [],
  matchLogs: [],
  recallBots: [],
  timerTriggers: [],
  timerTriggerLogs: [],
  liveChatLogs: [],
  liveChatRoundRobinIndex: 0,
  webhookDebugLogs: [],
};

async function ensureDataDirectory() {
  await fs.mkdir(dataDirectory, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return {
    raw,
    parsed: JSON.parse(raw),
  };
}

async function writeRawStoreAtomically(rawStore) {
  await ensureDataDirectory();
  await fs.writeFile(storeTempPath, rawStore, "utf8");
  await fs.rename(storeTempPath, storePath);
}

function formatTimestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

module.exports = {
  dataDirectory,
  emptyStore,
  ensureDataDirectory,
  fileExists,
  formatTimestampForFilename,
  readJsonFile,
  storeBackupPath,
  storePath,
  writeRawStoreAtomically,
};
