import fs from "fs";
import path from "path";

function fixDir(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const full = path.join(dir, file);

    if (fs.statSync(full).isDirectory()) {
      fixDir(full);
      continue;
    }

    if (!file.endsWith(".js")) continue;

    let content = fs.readFileSync(full, "utf8");

    content = content.replace(
      /from\s+["'](\.\.?\/[^"']+)["']/g,
      (match, p1) => {
        if (p1.endsWith(".js")) return match;

        // Resolve the path relative to the current file's directory
        const currentDir = path.dirname(full);
        const resolved = path.resolve(currentDir, p1);

        // Check if it's a directory with index.js
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          return match.replace(p1, `${p1}/index.js`);
        }

        // Otherwise append .js
        return match.replace(p1, `${p1}.js`);
      },
    );

    fs.writeFileSync(full, content);
  }
}

fixDir("./dist");