import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildChapelShows, parseChapelHtml } from "../src/server/venues/theChapel.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const outputDir = path.join(dirname, "output")
const outputPath = path.join(outputDir, "the-chapel.json")
const htmlPath = path.join(outputDir, "the-chapel.html")

const startDateISO = process.env.START_DATE ?? "2026-01-01"
const endDateISO = process.env.END_DATE ?? "2026-12-31"
const calendarUrl = "https://thechapelsf.com/music/?list1page=1"

console.log(`Fetching ${calendarUrl}`)
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 15000)

let html = ""
try {
  const response = await fetch(calendarUrl, {
    headers: {
      "user-agent":
        "concert-playlist-bot/1.0 (+https://example.com) scraper for personal use",
    },
    signal: controller.signal,
  })
  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`)
  }
  html = await response.text()
} finally {
  clearTimeout(timeout)
}

console.log(`Fetched HTML length: ${html.length}`)
console.log(`Snippet: ${html.slice(0, 300).replace(/\s+/g, " ")}`)

await mkdir(outputDir, { recursive: true })
await writeFile(htmlPath, html)

const parsed = parseChapelHtml(html, {
  sourcePageUrl: calendarUrl,
  referenceDateISO: startDateISO,
})
console.log(`Parsed show blocks: ${parsed.length}`)

const events = buildChapelShows(parsed, { startDateISO, endDateISO })
await writeFile(outputPath, JSON.stringify(events, null, 2))

console.log(`Saved ${events.length} rows to ${outputPath}`)
