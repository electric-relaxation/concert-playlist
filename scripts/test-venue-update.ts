import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runUpdate } from "./updateVenueData.ts"
import type { ScrapedShow, VenueDataFile, VenueDataShow } from "../src/shared/types.ts"

const dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.join(dirname, "tmp-venue-update")
const dataDir = path.join(tmpDir, "data/venues")

const baseShow = (overrides: Partial<VenueDataShow>): VenueDataShow => ({
  showId: "old",
  dateISO: "2026-01-10",
  startTime: "8:00 PM",
  venueId: "bottom-of-the-hill",
  venueName: "Bottom of the Hill",
  showUrl: "https://www.bottomofthehill.com/20260110.html",
  sourceUrl: "https://www.bottomofthehill.com/calendar.html",
  headliners: ["Band A"],
  openers: ["Band B"],
  ...overrides,
})

const writeVenueFile = async (file: VenueDataFile) => {
  await mkdir(dataDir, { recursive: true })
  const filePath = path.join(dataDir, `${file.venue.id}.json`)
  await writeFile(filePath, JSON.stringify(file, null, 2))
  return filePath
}

const readVenueFile = async (venueId: string) => {
  const filePath = path.join(dataDir, `${venueId}.json`)
  const raw = await readFile(filePath, "utf-8")
  return JSON.parse(raw) as VenueDataFile
}

const runUpdateWithShows = async (
  previousShows: VenueDataShow[],
  nextScraped: VenueDataShow[]
) => {
  const previous: VenueDataFile = {
    venue: {
      id: "bottom-of-the-hill",
      name: "Bottom of the Hill",
      calendarUrl: "https://www.bottomofthehill.com/calendar.html",
    },
    generatedAtISO: "2026-01-01T00:00:00.000Z",
    shows: previousShows,
  }
  await writeVenueFile(previous)

  const scraped: ScrapedShow[] = nextScraped.flatMap((show) => {
    const rows: ScrapedShow[] = []
    rows.push({
      date: show.dateISO,
      time: "20:00",
      artists: [show.headliners[0] ?? ""],
      roles: ["headliner"],
      venue: show.venueId,
      showUrl: show.showUrl ?? "",
      sourcePageUrl: show.sourceUrl,
    })
    for (const opener of show.openers) {
      rows.push({
        date: show.dateISO,
        time: "20:00",
        artists: [opener],
        roles: ["opener"],
        venue: show.venueId,
        showUrl: show.showUrl ?? "",
        sourcePageUrl: show.sourceUrl,
      })
    }
    return rows
  })

  await runUpdate({
    venue: "bottom-of-the-hill",
    outDir: dataDir,
    startDateISO: "2026-01-01",
    endDateISO: "2026-12-31",
    scrapedByVenue: {
      "bottom-of-the-hill": scraped,
    },
  })

  return readVenueFile("bottom-of-the-hill")
}

// Updating only showID -> unchanged:1
const unchangedResult = await runUpdateWithShows(
  [baseShow({ showId: "existing" })],
  [baseShow({ showId: "new" })]
)

if (unchangedResult.shows[0].showId !== "existing") {
  throw new Error("Expected showId preserved on unchanged run.")
}

// Updating a field in a show -> updated:1
const updatedResult = await runUpdateWithShows(
  [baseShow({ showId: "keep" })],
  [baseShow({ openers: ["Band C"] })]
)
if (updatedResult.shows[0].openers[0] !== "Band C") {
  throw new Error("Expected opener update to be written.")
}

// Keep existing show, add new show -> unchanged:1, added:1
const addedResult = await runUpdateWithShows(
  [baseShow({ showId: "existing" })],
  [
    baseShow({ showId: "existing" }),
    baseShow({
      dateISO: "2026-01-11",
      showUrl: "https://www.bottomofthehill.com/20260111.html",
      headliners: ["Band Z"],
    }),
  ]
)
if (addedResult.shows.length !== 2) {
  throw new Error("Expected new show to be written.")
}

// Update one show, remove one show -> updated:1, removed:1
const removedResult = await runUpdateWithShows(
  [
    baseShow({ showId: "keep" }),
    baseShow({
      showId: "remove",
      dateISO: "2026-01-12",
      showUrl: "https://www.bottomofthehill.com/20260112.html",
    }),
  ],
  [baseShow({ showId: "keep", openers: ["Band C"] })]
)
if (removedResult.shows.length !== 1) {
  throw new Error("Expected removed show to be dropped.")
}

// One show is old, one show is unchanged and one show is updated
const oldAndUpdate = await runUpdateWithShows(
  [
    baseShow({
      showId: "remove",
      dateISO: "2026-01-03",
      headliners: ["Removed Headliner"],
      openers: ["Removed Opener"],
      showUrl: "https://www.bottomofthehill.com/20260103.html",
    }),
    baseShow({ 
      showId: "unchanged",
      headliners: ["Unchanged Headliner"],
      openers: ["Unchanged Opener"],
      showUrl: "https://www.bottomofthehill.com/20260110.html",
    }),
    baseShow({ 
      showId: "updated",
      headliners: ["Original Headliner"],
      openers: ["Original Opener"],
      showUrl: "https://www.bottomofthehill.com/20260111.html",
    }),
    
  ],
  [
    baseShow({ 
      showId: "unchanged",
      headliners: ["Unchanged Headliner"],
      openers: ["Unchanged Opener"],
      showUrl: "https://www.bottomofthehill.com/20260110.html",
    }),
    baseShow({ 
      showId: "updated",
      headliners: ["Updated Headliner"],
      openers: ["Updated Opener"],
      showUrl: "https://www.bottomofthehill.com/20260111.html",
    }),
  ]
)

// Expect: unchanged:1, updated:1, removed:1
if (oldAndUpdate.shows.length !== 2 && oldAndUpdate.shows[1].openers[0] == "Updated Opener") {
  throw new Error("Expected removed show to be dropped.")
}

// One show is old but not updates/adds so expect no changes
const oldOnly = await runUpdateWithShows(
  [
    baseShow({
      showId: "remove",
      dateISO: "2026-01-03",
      headliners: ["Removed Headliner"],
      openers: ["Removed Opener"],
      showUrl: "https://www.bottomofthehill.com/20260103.html",
    }),
    baseShow({ 
      showId: "unchanged",
      headliners: ["Unchanged Headliner"],
      openers: ["Unchanged Opener"],
      showUrl: "https://www.bottomofthehill.com/20260110.html",
    })
    
  ],
  [
    baseShow({ 
      showId: "unchanged",
      headliners: ["Unchanged Headliner"],
      openers: ["Unchanged Opener"],
      showUrl: "https://www.bottomofthehill.com/20260110.html",
    })
  ]
)

// Expect: unchanged:1, removed:0
if (oldOnly.shows.length !== 2) {
  throw new Error("Expected no changes.")
}


console.log("Venue update tests passed.")
