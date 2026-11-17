"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMappings = listMappings;
exports.addMapping = addMapping;
exports.removeMapping = removeMapping;
exports.execsSupportedBy = execsSupportedBy;
exports.easForExec = easForExec;
const storage_1 = require("./storage");
const audit_1 = require("./audit");
const KEY = "ea-mappings";
async function listMappings() {
    return (0, storage_1.readJson)(KEY, []);
}
async function addMapping(eaEmail, execEmail, actor) {
    const list = await listMappings();
    const ea = eaEmail.trim().toLowerCase();
    const exec = execEmail.trim().toLowerCase();
    if (!ea || !exec)
        throw new Error("eaEmail and execEmail required");
    if (!list.some((m) => m.eaEmail === ea && m.execEmail === exec)) {
        list.push({ eaEmail: ea, execEmail: exec, createdAt: new Date().toISOString(), createdBy: actor });
        await (0, storage_1.writeJson)(KEY, list);
        await (0, audit_1.audit)({ actor, action: "ea_mapping.add", target: `${ea}->${exec}` });
    }
    return list;
}
async function removeMapping(eaEmail, execEmail, actor) {
    const list = await listMappings();
    const ea = eaEmail.trim().toLowerCase();
    const exec = execEmail.trim().toLowerCase();
    const next = list.filter((m) => !(m.eaEmail === ea && m.execEmail === exec));
    if (next.length !== list.length) {
        await (0, storage_1.writeJson)(KEY, next);
        await (0, audit_1.audit)({ actor, action: "ea_mapping.remove", target: `${ea}->${exec}` });
    }
    return next;
}
async function execsSupportedBy(eaEmail) {
    const list = await listMappings();
    const ea = eaEmail.toLowerCase();
    return list.filter((m) => m.eaEmail === ea).map((m) => m.execEmail);
}
async function easForExec(execEmail) {
    const list = await listMappings();
    const exec = execEmail.toLowerCase();
    return list.filter((m) => m.execEmail === exec).map((m) => m.eaEmail);
}
//# sourceMappingURL=eaMappings.js.map