import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildIndependentShows,
  parseIndependentHtml,
} from "../src/server/venues/theIndependent.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(dirname, "output")
const outputPath = path.join(outputDir, "independent.json")
const htmlPath = path.join(outputDir, "independent.html")

const startDateISO = process.env.START_DATE ?? "2026-01-01"
const endDateISO = process.env.END_DATE ?? "2026-12-31"
const calendarUrl = "https://www.theindependentsf.com"

console.log(`Fetching ${calendarUrl}`)
const response = await fetch(calendarUrl)
if (!response.ok) {
  throw new Error(`Fetch failed with ${response.status}`)
}

const html = await response.text()
console.log(`Fetched HTML length: ${html.length}`)
console.log(`Snippet: ${html.slice(0, 300).replace(/\s+/g, " ")}`)

await mkdir(outputDir, { recursive: true })
await writeFile(htmlPath, html)

const parsed = parseIndependentHtml(html, {
  sourcePageUrl: calendarUrl,
  referenceDateISO: startDateISO,
})
console.log(`Parsed show blocks: ${parsed.length}`)

const events = buildIndependentShows(parsed, {
  startDateISO,
  endDateISO,
})

await writeFile(outputPath, JSON.stringify(events, null, 2))

console.log(`Saved ${events.length} rows to ${outputPath}`)
