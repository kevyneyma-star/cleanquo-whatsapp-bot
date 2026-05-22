import fs from "node:fs";
import path from "node:path";

const cwd = globalThis.process?.cwd?.() ?? globalThis.nodeRepl?.cwd ?? ".";
const DATA_DIR = path.resolve(cwd, ".data");
const STORE_FILE = path.join(DATA_DIR, "conversations.json");

export class ConversationStore {
  constructor() {
    this.conversations = new Map();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(STORE_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      this.conversations = new Map(Object.entries(raw));
    } catch (error) {
      console.warn("Could not load conversation store:", error.message);
    }
  }

  persist() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify(Object.fromEntries(this.conversations), null, 2)
    );
  }

  get(userId) {
    return this.conversations.get(userId) ?? null;
  }

  list() {
    return [...this.conversations.values()].sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt))
    );
  }

  upsert(userId, patch) {
    const now = new Date().toISOString();
    const current = this.get(userId) ?? {
      userId,
      status: "new",
      profile: {},
      quote: null,
      booking: null,
      pendingAdminAction: null,
      createdAt: now,
      updatedAt: now
    };

    const next = {
      ...current,
      ...patch,
      profile: { ...current.profile, ...(patch.profile ?? {}) },
      quote: patch.quote === undefined ? current.quote : patch.quote,
      booking: patch.booking === undefined ? current.booking : patch.booking,
      updatedAt: now
    };

    this.conversations.set(userId, next);
    this.persist();
    return next;
  }

  reset(userId) {
    this.conversations.delete(userId);
    this.persist();
  }
}

export const store = new ConversationStore();
