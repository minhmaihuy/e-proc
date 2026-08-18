import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const inputPath = "D:/Workspaces/Database/question_bank_rows.csv";
const previewBeforePath = "D:/Workspaces/e-proc/.codex-tmp/question-csv-update/before.png";
const previewAfterPath = "D:/Workspaces/e-proc/.codex-tmp/question-csv-update/after.png";

const csvText = await fs.readFile(inputPath, "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Questions" });
const sheet = workbook.worksheets.getItem("Questions");
const used = sheet.getUsedRange(true);
const rows = used.values;

if (!rows || rows.length < 2) throw new Error("CSV không có dữ liệu.");
const headers = rows[0].map((value) => String(value ?? "").trim());
const sampleIndex = headers.indexOf("question_sample");
const moduleIndex = headers.indexOf("module");
if (sampleIndex < 0 || moduleIndex < 0) throw new Error("Thiếu cột question_sample hoặc module.");

const before = await workbook.render({ sheetName: "Questions", range: "A1:N10", scale: 1, format: "png" });
await fs.writeFile(previewBeforePath, new Uint8Array(await before.arrayBuffer()));

const entities = new Map([
  ["&nbsp;", " "], ["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"],
  ["&quot;", "\""], ["&#39;", "'"], ["&apos;", "'"],
]);
function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => entities.get(m.toLowerCase()) ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((line) => line.trim()).join("\n").trim();
}

const baseHeaders = headers.filter((h) => h !== "question_group" && h !== "question_plain");
const outputHeaders = [];
for (const header of baseHeaders) {
  outputHeaders.push(header);
  if (header === "module") outputHeaders.push("question_group");
  if (header === "question_sample") outputHeaders.push("question_plain");
}

const sourceIndexes = new Map(headers.map((h, i) => [h, i]));
function classifyQuestionGroup(moduleValue) {
  const module = String(moduleValue ?? "").trim().toLowerCase();
  if (module === "database" || module.startsWith("sql_")) return "database";
  if (module === "dsa" || module.startsWith("dsa_") || module.startsWith("dsa ")) return "dsa";
  if (module === "frontend") return "frontend";
  if (module.startsWith("java_") || module.startsWith("java ")) return "java";
  if (module.startsWith("orm_")) return "orm";
  if (module.startsWith("reactjs_")) return "reactjs";
  if (module === "spring" || module === "spring boot" || module.startsWith("spring_")) return "spring";
  return module.replace(/\s+/g, "_");
}
const outputRows = [outputHeaders];
for (const row of rows.slice(1)) {
  const out = outputHeaders.map((header) => {
    if (header === "question_group") return classifyQuestionGroup(row[moduleIndex]);
    if (header === "question_plain") return stripHtml(row[sampleIndex] ?? "");
    return row[sourceIndexes.get(header)] ?? "";
  });
  outputRows.push(out);
}

used.clear({ applyTo: "all" });
const target = sheet.getRangeByIndexes(0, 0, outputRows.length, outputHeaders.length);
target.values = outputRows;
sheet.getRangeByIndexes(0, 0, 1, outputHeaders.length).format = {
  fill: "#E2E8F0",
  font: { bold: true, color: "#0F172A" },
  wrapText: true,
};
sheet.freezePanes.freezeRows(1);
sheet.getRange("A:A").format.columnWidth = 14;
sheet.getRange("B:C").format.columnWidth = 13;
sheet.getRange("D:E").format.columnWidth = 18;
sheet.getRange("F:G").format.columnWidth = 48;
sheet.getRange("H:J").format.columnWidth = 42;
sheet.getRange("K:L").format.columnWidth = 23;
sheet.getRange("M:P").format.columnWidth = 16;

const lastCol = String.fromCharCode(64 + outputHeaders.length);
const check = await workbook.inspect({
  kind: "table",
  range: `Questions!A1:${lastCol}6`,
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: outputHeaders.length,
  maxChars: 8000,
});
console.log(check.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const after = await workbook.render({ sheetName: "Questions", range: "A1:G10", scale: 1, format: "png" });
await fs.writeFile(previewAfterPath, new Uint8Array(await after.arrayBuffer()));

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const outputCsv = outputRows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
await fs.writeFile(inputPath, outputCsv, "utf8");

const plainIndex = outputHeaders.indexOf("question_plain");
const groupIndex = outputHeaders.indexOf("question_group");
const blankPlain = outputRows.slice(1).filter((row) => !String(row[plainIndex] ?? "").trim()).length;
const nonBlankGroups = outputRows.slice(1).filter((row) => String(row[groupIndex] ?? "").trim()).length;
const groupCounts = {};
for (const row of outputRows.slice(1)) {
  const group = String(row[groupIndex] ?? "");
  groupCounts[group] = (groupCounts[group] ?? 0) + 1;
}
console.log(JSON.stringify({ dataRows: outputRows.length - 1, columns: outputHeaders.length, blankPlain, nonBlankGroups, groupCounts, outputHeaders }));
