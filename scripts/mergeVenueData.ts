import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { VenueDataFile, VenueDataShow } from "../src/shared/types.ts"

const dataDir = "public/data/venues"
const outputPath = path.join(dataDir, "all-venues.json")

const compareTime = (value: string | null) => value ?? "99:99 PM"

const sortShows = (a: VenueDataShow, b: VenueDataShow) => {
  if (a.dateISO !== b.dateISO) {
    return a.dateISO.localeCompare(b.dateISO)
  }
  if (compareTime(a.startTime) !== compareTime(b.startTime)) {
    return compareTime(a.startTime).localeCompare(compareTime(b.startTime))
  }
  if (a.venueName !== b.venueName) {
    return a.venueName.localeCompare(b.venueName)
  }
  return a.headliners.join(",").localeCompare(b.headliners.join(","))
}

const main = async () => {
  const entries = await readdir(dataDir)
  const files = entries.filter(
    (name) => name.endsWith(".json") && name !== "all-venues.json"
  )

  const shows: VenueDataShow[] = []
  for (const file of files) {
    const raw = await readFile(path.join(dataDir, file), "utf-8")
    const parsed = JSON.parse(raw) as VenueDataFile
    shows.push(...parsed.shows)
  }

  const merged = {
    generatedAtISO: new Date().toISOString(),
    shows: shows.sort(sortShows),
  }

  await writeFile(outputPath, JSON.stringify(merged, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
