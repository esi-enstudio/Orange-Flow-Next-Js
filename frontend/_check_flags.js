const fs = require("fs");
const devPath = require.resolve("next/dist/cli/next-dev");
const src = fs.readFileSync(devPath, "utf8");
const lines = src.split("\n");
for (let i = 0; i < Math.min(lines.length, 150); i++) {
  console.log(i + ": " + lines[i]);
}
