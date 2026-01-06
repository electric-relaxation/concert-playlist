import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  venues,
} from "../src/server/venues/index.ts"
import { scrapeBottomOfTheHill } from "../src/server/venues/bottomOfTheHill.ts"
import { scrapeTheIndependent } from "../src/server/venues/theIndependent.ts"
import type {
  ScrapedShow,
  StreamMessage,
  VenueDataFile,
  VenueDataShow,
  VenueIndexFile,
} from "../src/shared/types.ts"
import {
  buildShowKey,
  diffShows,
  preserveShowIds,
} from "./updateVenueDataUtils.ts"

type Args = {
  venue: string
  startDateISO: string | null
  endDateISO: string | null
  outDir: string
}

// Parse CLI flags like "--venue", "--start", "--end", "--outDir".
const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    venue: "all",
    startDateISO: null,
    endDateISO: null,
    outDir: "public/data/venues",
  }
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === "--venue") {
      args.venue = argv[i + 1] ?? "all"
      i += 1
    } else if (value === "--start") {
      args.startDateISO = argv[i + 1] ?? null
      i += 1
    } else if (value === "--end") {
      args.endDateISO = argv[i + 1] ?? null
      i += 1
    } else if (value === "--outDir") {
      args.outDir = argv[i + 1] ?? args.outDir
      i += 1
    }
  }
  return args
}

// Convert 24-hour "HH:mm" into a human-friendly "h:mm AM/PM".
const formatTime12 = (time24: string) => {
  if (!time24) {
    return null
  }
  const [hourText, minuteText] = time24.split(":")
  const hour = Number.parseInt(hourText, 10)
  const minutes = minuteText ?? "00"
  if (Number.isNaN(hour)) {
    return null
  }
  const meridiem = hour >= 12 ? "PM" : "AM"
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${minutes} ${meridiem}`
}

// Small deterministic hash for stable IDs (FNV-1a).
const hashString = (value: string) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

// Build a canonical string and hash it to keep IDs stable across runs.
const buildShowId = (show: {
  venueId: string
  dateISO: string
  showUrl: string | null
  headliners: string[]
}) => {
  const canonical = [
    show.venueId,
    show.dateISO,
    show.showUrl ?? "",
    show.headliners.join(","),
  ].join("|")
  return hashString(canonical)
}

// Group ScrapedShow rows into normalized show objects for venue JSON output.
export const normalizeShows = (
  venueId: string,
  venueName: string,
  sourceUrl: string,
  scraped: ScrapedShow[]
): VenueDataShow[] => {
  const byKey = new Map<string, VenueDataShow>()
  const shows: VenueDataShow[] = []
  for (const item of scraped) {
    const showUrl = item.showUrl || null
    const role = item.roles[0] ?? "headliner"
    const key =
      showUrl
        ? `url:${showUrl}`
        : role === "opener"
        ? null
        : `date:${item.date}|headliner:${item.artists.join(",")}`

    let show = key ? byKey.get(key) : undefined
    if (!show && role === "opener") {
      show = [...shows]
        .reverse()
        .find(
          (existing) =>
            existing.dateISO === item.date && existing.showUrl === null
        )
    }
    if (!show) {
      show = {
        showId: "",
        dateISO: item.date,
        startTime: formatTime12(item.time),
        venueId,
        venueName,
        showUrl,
        sourceUrl,
        headliners: [],
        openers: [],
      }
      shows.push(show)
      if (key) {
        byKey.set(key, show)
      }
    }
    if (role === "opener") {
      show.openers.push(...item.artists)
    } else {
      show.headliners.push(...item.artists)
    }
  }

  const normalized = shows.map((show) => {
    const headliners = Array.from(new Set(show.headliners)).sort()
    const openers = Array.from(new Set(show.openers)).sort()
    const showId = buildShowId({
      venueId: show.venueId,
      dateISO: show.dateISO,
      showUrl: show.showUrl,
      headliners,
    })
    return {
      ...show,
      showId,
      headliners,
      openers,
    }
  })

  const deduped = new Map<string, VenueDataShow>()
  for (const show of normalized) {
    const key = buildShowKey(show)
    if (!deduped.has(key)) {
      deduped.set(key, show)
    }
  }

  const finalShows = Array.from(deduped.values())

  finalShows.sort((a, b) => {
    if (a.dateISO !== b.dateISO) {
      return a.dateISO.localeCompare(b.dateISO)
    }
    if ((a.startTime ?? "") !== (b.startTime ?? "")) {
      return (a.startTime ?? "").localeCompare(b.startTime ?? "")
    }
    return a.headliners.join(",").localeCompare(b.headliners.join(","))
  })
  return finalShows
}

// Run a venue scraper and collect streamed ScrapedShow rows, logging progress.
export const gatherScrapedShows = async (
  venueId: string,
  calendarUrl: string,
  range: { startDateISO: string; endDateISO: string }
) => {
  const scraped: ScrapedShow[] = []
  let error: string | null = null
  const emit = (message: StreamMessage) => {
    if (message.type === "progress") {
      console.log(`[${venueId}] ${message.message}`)
    }
    if (message.type === "error") {
      error = message.message
      console.error(`[${venueId}] ${message.message}`)
    }
    if (message.type === "event") {
      scraped.push(message.show)
    }
  }

  if (venueId === "the-independent") {
    for await (const message of scrapeTheIndependent(calendarUrl, range)) {
      emit(message)
    }
  } else if (venueId === "bottom-of-the-hill") {
    for await (const message of scrapeBottomOfTheHill(calendarUrl, range)) {
      emit(message)
    }
  } else {
    error = `No scraper wired for ${venueId}.`
  }

  return { scraped, error }
}

// Main CLI entrypoint: scrapes venues, compares to existing files, writes JSON.
export type RunUpdateOverrides = Partial<Args> & {
  scrapedByVenue?: Record<string, ScrapedShow[]>
}

export const runUpdate = async (argsOverride?: RunUpdateOverrides) => {
  const args = parseArgs(process.argv.slice(2))
  const mergedArgs = { ...args, ...argsOverride }
  const startDateISO = mergedArgs.startDateISO ?? "1900-01-01"
  const endDateISO = mergedArgs.endDateISO ?? "2100-12-31"

  // Resolve which venues to run based on "--venue".
  const selected =
    mergedArgs.venue === "all"
      ? venues
      : venues.filter((venue) => venue.id === mergedArgs.venue)

  if (selected.length === 0) {
    console.error(`No venues matched "${args.venue}".`)
    process.exit(1)
  }

  // Ensure output directory exists.
  await mkdir(mergedArgs.outDir, { recursive: true })
  // Single timestamp shared by all outputs for this run.
  const generatedAtISO = new Date().toISOString()

  const index: VenueIndexFile = {
    generatedAtISO,
    venues: [],
  }

  let hadFatal = false

  const todayISO = new Date().toISOString().slice(0, 10)

  // Process each venue independently so partial failures can be logged.
  for (const venue of selected) {
    // Fetch and parse the venue's calendar, collecting raw ScrapedShow rows.
    const overrideScraped = argsOverride?.scrapedByVenue?.[venue.id]
    const { scraped, error } = overrideScraped
      ? { scraped: overrideScraped, error: null }
      : await gatherScrapedShows(venue.id, venue.calendarUrl, {
          startDateISO,
          endDateISO,
        })

    if (error) {
      hadFatal = true
      continue
    }

    // Normalize the raw rows into deduped, sorted VenueDataShow entries.
    const nextShows = normalizeShows(
      venue.id,
      venue.name,
      venue.calendarUrl,
      scraped
    )

    // Load any existing output to compare with, if present.
    const filePath = path.join(mergedArgs.outDir, `${venue.id}.json`)
    let previous: VenueDataFile | null = null
    try {
      const existing = await readFile(filePath, "utf-8")
      previous = JSON.parse(existing) as VenueDataFile
    } catch (readError) {
      previous = null
    }

    const previousShows = previous?.shows ?? []
    // Preserve showId for matching shows so IDs remain stable across updates.
    const showsWithIds = preserveShowIds(nextShows, previousShows)

    // Only changes on today's date or later should trigger a rewrite.
    const futurePrevious = previousShows.filter(
      (show) => show.dateISO >= todayISO
    )
    const futureNext = showsWithIds.filter((show) => show.dateISO >= todayISO)

    // Compute diff stats for logging and for write decisions.
    const countsAll = diffShows(previousShows, showsWithIds)
    const countsFuture = diffShows(futurePrevious, futureNext)
    // Only write if there are changes in today+future shows, or if no file exists.
    const shouldWrite =
      !previous ||
      countsFuture.updated > 0 ||
      countsFuture.added > 0 ||
      countsFuture.removed > 0

    const logCounts = shouldWrite
      ? countsAll
      : { unchanged: countsAll.unchanged, updated: 0, added: 0, removed: 0 }
    console.log(
      `[${venue.id}] unchanged ${logCounts.unchanged}, updated ${logCounts.updated}, added ${logCounts.added}, removed ${logCounts.removed}`
    )

    // Build the output payload (written only when shouldWrite is true).
    const payload: VenueDataFile = {
      venue: {
        id: venue.id,
        name: venue.name,
        calendarUrl: venue.calendarUrl,
      },
      generatedAtISO,
      shows: showsWithIds,
    }

    if (shouldWrite) {
      await writeFile(filePath, JSON.stringify(payload, null, 2))
    }

    index.venues.push({
      id: venue.id,
      name: venue.name,
      calendarUrl: venue.calendarUrl,
      dataPath: `data/venues/${venue.id}.json`,
    })
  }

  const indexPath = path.join(path.dirname(mergedArgs.outDir), "index.json")
  await writeFile(indexPath, JSON.stringify(index, null, 2))

  if (hadFatal) {
    process.exit(1)
  }
}

// Only run automatically when invoked as a script, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUpdate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
