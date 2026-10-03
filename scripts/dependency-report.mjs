import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
const root = JSON.parse(await readFile("package.json", "utf8"));
const rows = [];
const notices = [];
for (const [scope, dependencies] of Object.entries({
  Runtime: root.dependencies,
  Development: root.devDependencies,
}))
  for (const [name, version] of Object.entries(dependencies)) {
    const directory = `node_modules/${name}`;
    const pkg = JSON.parse(await readFile(`${directory}/package.json`, "utf8"));
    rows.push(
      `| ${name} | ${version} | ${pkg.license ?? "See package license"} | ${scope} |`,
    );
    if (scope === "Runtime") {
      let license = "";
      for (const file of await readdir(directory)) {
        if (/^licen[cs]e(?:\.|$)/i.test(file)) {
          license = await readFile(`${directory}/${file}`, "utf8").catch(
            () => "",
          );
          if (license) break;
        }
      }
      notices.push(
        `${name}@${version}\n${"=".repeat(60)}\n${license || `License metadata: ${pkg.license}. Consult the distributed package's license files.`}\n`,
      );
    }
  }
const header =
  "# Dependency versions and provenance\n\nGenerated from installed direct dependency metadata. Exact transitive resolution is in both lockfiles. Do not infer full license clearance from this inventory. The project remains private; source-deck rights are separate from software licenses.\n\nNode recommended: 22.12+; exercised locally: 22.11.0 on Windows. Package manager: pnpm 10.34.6; installation/tests here also use npm 10.9.0.\n\n| Package | Pinned version | Declared license | Use |\n| --- | --- | --- | --- |\n";
const provenance =
  "\n## Format references\n\nAnki discovery sources were checked against upstream reference commit `f5a0b608069094c1cf461b2d5998f1a285e68021` (2026-09-11 reference snapshot, not a claim to be the newest commit).\n\n- [Package metadata and media fields](https://github.com/ankitects/anki/blob/f5a0b608069094c1cf461b2d5998f1a285e68021/proto/anki/import_export.proto)\n- [Note-type config fields](https://github.com/ankitects/anki/blob/f5a0b608069094c1cf461b2d5998f1a285e68021/proto/anki/notetypes.proto)\n- [Archive member selection](https://github.com/ankitects/anki/blob/f5a0b608069094c1cf461b2d5998f1a285e68021/rslib/src/import_export/package/meta.rs)\n- [Zstandard frame format, RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html)\n\nThe wire/frame reader is an independent restricted implementation; Anki runtime code and generated protobuf files are not vendored. Anki upstream code carries AGPL terms. Any future copied/generated upstream code needs an explicit licensing review. Runtime package license texts are emitted into `apps/web/public/third-party-licenses.txt` during the build, including the licenses accompanying copied SQL WASM and KaTeX assets. Package installs preserve their own notices.\n\nThe browser uses an SVG icon drawn in repository source and system fonts. No generated stock imagery or external font service is required. The private sample is neither bundled nor licensed for public demo use.\n";
await writeFile(
  "docs/dependency-versions.md",
  header + rows.join("\n") + "\n" + provenance,
);
await mkdir("apps/web/public", { recursive: true });
await writeFile("apps/web/public/third-party-licenses.txt", notices.join("\n"));
console.log(
  `Recorded ${rows.length} direct dependency versions and runtime license notices.`,
);
