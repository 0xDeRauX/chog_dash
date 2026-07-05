import fs from "fs";
import path from "path";

export function writeRaw(source, date, payload) {
  const dir = path.resolve("data/raw", source);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
