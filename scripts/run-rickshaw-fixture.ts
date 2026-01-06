import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import {
  buildRickshawShows,
  parseRickshawHtml,
} from "../src/server/venues/rickshawStop.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(
  dirname,
  "../src/server/venues/__fixtures__/rickshaw-stop.html"
)

const html = await readFile(fixturePath, "utf-8")
const parsed = parseRickshawHtml(html, {
  sourcePageUrl: "https://rickshawstop.com/calendar/",
  referenceDateISO: "2026-01-05",
})

const shows = buildRickshawShows(parsed, {
  startDateISO: "2026-01-01",
  endDateISO: "2026-12-31",
})

console.log(JSON.stringify(shows, null, 2))
