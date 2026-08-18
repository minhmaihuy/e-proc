import fs from "node:fs/promises";
import { Workbook } from "@oai/artifact-tool";

const csvText = await fs.readFile("D:/Workspaces/Database/question_bank_rows.csv", "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Questions" });
const rows = workbook.worksheets.getItem("Questions").getUsedRange(true).values;
const headers = rows[0].map((v) => String(v ?? ""));
const moduleIndex = headers.indexOf("module");
const idIndex = headers.indexOf("id");
const groupIndex = headers.indexOf("question_group");
const counts = new Map();
for (const row of rows.slice(1)) {
  const module = String(row[moduleIndex] ?? "").trim();
  if (!counts.has(module)) counts.set(module, { count: 0, ids: [], groups: new Set() });
  const item = counts.get(module);
  item.count++;
  if (item.ids.length < 5) item.ids.push(String(row[idIndex] ?? ""));
  item.groups.add(String(row[groupIndex] ?? ""));
}
console.log(JSON.stringify([...counts.entries()].map(([module, v]) => ({ module, count: v.count, ids: v.ids, groups: [...v.groups] })), null, 2));
