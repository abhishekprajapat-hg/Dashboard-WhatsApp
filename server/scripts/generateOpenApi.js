import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildOpenApiDocument } from "../openapi/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "..", "..", "docs", "openapi.json");

const document = buildOpenApiDocument();
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);

console.log(`Wrote OpenAPI spec (${Object.keys(document.paths || {}).length} paths) to ${outputPath}`);
