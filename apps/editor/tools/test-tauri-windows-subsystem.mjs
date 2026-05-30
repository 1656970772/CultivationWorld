import fs from "node:fs";
import path from "node:path";

const executablePath = path.resolve(
  "src-tauri",
  "target",
  "release",
  "xuantian-editor.exe",
);

if (!fs.existsSync(executablePath)) {
  throw new Error(`missing release executable: ${executablePath}`);
}

const image = fs.readFileSync(executablePath);

if (image.readUInt16LE(0) !== 0x5a4d) {
  throw new Error(`${executablePath} is not an MZ executable`);
}

const peOffset = image.readUInt32LE(0x3c);
if (image.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
  throw new Error(`${executablePath} is not a PE executable`);
}

const optionalHeaderOffset = peOffset + 24;
const subsystem = image.readUInt16LE(optionalHeaderOffset + 68);

if (subsystem !== 2) {
  throw new Error(
    `expected Windows GUI subsystem (2), received ${subsystem}; the app may open a console window`,
  );
}

console.log("tauri windows subsystem test passed");
