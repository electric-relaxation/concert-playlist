import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import {
  buildIndependentShows,
  parseIndependentHtml,
} from "../src/server/venues/theIndependent.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(
  dirname,
  "../src/server/venues/__fixtures__/independent.html"
)

const html = await readFile(fixturePath, "utf-8")
const parsed = parseIndependentHtml(html, {
  sourcePageUrl: "https://www.theindependentsf.com",
  referenceDateISO: "2026-01-05",
})

const shows = buildIndependentShows(parsed, {
  startDateISO: "2026-01-01",
  endDateISO: "2026-12-31",
})

console.log(JSON.stringify(shows, null, 2))
