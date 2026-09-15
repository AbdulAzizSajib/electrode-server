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

    const addExtension = (match, p1) => {
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
    };

    // `import x from "./y"`, `export * from "./y"`, and `import("./y")`.
    content = content.replace(/from\s+["'](\.\.?\/[^"']+)["']/g, addExtension);

    // Side-effect imports (`import "./y";`) have no `from` clause, so the rule
    // above never sees them. Missing this form yields a build that compiles and
    // then dies at runtime with ERR_MODULE_NOT_FOUND on the first request that
    // loads the importing module — see storage.service.ts, which imports
    // cloudinary.config purely for its configure-on-load side effect.
    content = content.replace(
      /import\s+["'](\.\.?\/[^"']+)["']/g,
      addExtension,
    );

    fs.writeFileSync(full, content);
  }
}

fixDir("./dist");