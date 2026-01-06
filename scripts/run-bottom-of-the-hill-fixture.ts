import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import {
  buildBottomShows,
  parseBottomOfTheHillHtml,
} from "../src/server/venues/bottomOfTheHill.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.join(
  dirname,
  "../src/server/venues/__fixtures__/bottom-of-the-hill.html"
)

const html = await readFile(fixturePath, "utf-8")
const parsed = parseBottomOfTheHillHtml(html, {
  sourcePageUrl: "https://www.bottomofthehill.com/calendar.html",
  referenceDateISO: "2026-01-05",
})

const shows = buildBottomShows(parsed, {
  startDateISO: "2026-01-01",
  endDateISO: "2026-12-31",
})

console.log(JSON.stringify(shows, null, 2))
