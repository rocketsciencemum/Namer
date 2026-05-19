import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const STORE_PATH = join(DATA_DIR, "store.json");

function emptyStore() {
  return { users: [], drawings: [] };
}

let store = emptyStore();

function load() {
  if (existsSync(STORE_PATH)) {
    try {
      store = { ...emptyStore(), ...JSON.parse(readFileSync(STORE_PATH, "utf8")) };
    } catch {
      store = emptyStore();
    }
  } else {
    persist();
  }
}

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

load();

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const db = {
  findUserByUsername(username) {
    const u = String(username).trim().toLowerCase();
    return store.users.find((x) => x.username === u) || null;
  },
  getUserById(userId) {
    return store.users.find((x) => x.id === userId) || null;
  },
  createUser({ username, passwordHash, company }) {
    const user = {
      id: id(),
      username: String(username).trim().toLowerCase(),
      passwordHash,
      company: company || null,
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    persist();
    return user;
  },
  updateUser(userId, patch) {
    const user = store.users.find((x) => x.id === userId);
    if (!user) return null;
    Object.assign(user, patch);
    persist();
    return user;
  },
  listDrawings(userId) {
    return store.drawings
      .filter((d) => d.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  getDrawing(userId, drawingId) {
    return store.drawings.find((d) => d.id === drawingId && d.userId === userId) || null;
  },
  createDrawing(userId, data) {
    const now = new Date().toISOString();
    const drawing = {
      id: id(),
      userId,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    store.drawings.push(drawing);
    persist();
    return drawing;
  },
  updateDrawing(userId, drawingId, data) {
    const drawing = store.drawings.find((d) => d.id === drawingId && d.userId === userId);
    if (!drawing) return null;
    Object.assign(drawing, data, { updatedAt: new Date().toISOString() });
    persist();
    return drawing;
  },
  deleteDrawing(userId, drawingId) {
    const i = store.drawings.findIndex((d) => d.id === drawingId && d.userId === userId);
    if (i === -1) return false;
    store.drawings.splice(i, 1);
    persist();
    return true;
  },
};
