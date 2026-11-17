"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJson = readJson;
exports.writeJson = writeJson;
exports.appendJsonl = appendJsonl;
exports.readJsonl = readJsonl;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
// Tiny JSON-file persistence layer. No DB by design.
// Each logical collection lives in its own file under data/.
async function ensureDataDir() {
    await promises_1.default.mkdir(config_1.config.paths.data, { recursive: true });
}
function filePath(name) {
    if (!/^[a-z0-9_-]+$/i.test(name)) {
        throw new Error(`Invalid storage name: ${name}`);
    }
    return path_1.default.join(config_1.config.paths.data, `${name}.json`);
}
async function readJson(name, fallback) {
    await ensureDataDir();
    try {
        const raw = await promises_1.default.readFile(filePath(name), "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return fallback;
        throw err;
    }
}
async function writeJson(name, data) {
    await ensureDataDir();
    const tmp = filePath(name) + ".tmp";
    await promises_1.default.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await promises_1.default.rename(tmp, filePath(name));
}
async function appendJsonl(name, entry) {
    await ensureDataDir();
    const p = path_1.default.join(config_1.config.paths.data, `${name}.jsonl`);
    await promises_1.default.appendFile(p, JSON.stringify(entry) + "\n", "utf8");
}
async function readJsonl(name, limit = 1000) {
    await ensureDataDir();
    const p = path_1.default.join(config_1.config.paths.data, `${name}.jsonl`);
    try {
        const raw = await promises_1.default.readFile(p, "utf8");
        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        const slice = lines.slice(-limit);
        return slice.map((l) => JSON.parse(l));
    }
    catch (err) {
        if (err.code === "ENOENT")
            return [];
        throw err;
    }
}
//# sourceMappingURL=storage.js.map