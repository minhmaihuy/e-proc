"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUnicode = normalizeUnicode;
exports.generateAccessCode = generateAccessCode;
function normalizeUnicode(str) {
    return str
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}
function generateAccessCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}
//# sourceMappingURL=string.js.map