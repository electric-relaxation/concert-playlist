import { parse, HTMLElement } from "node-html-parser"
import type {
  ScrapedShow,
  StreamMessage,
  VenueId,
  VenueParserInput,
} from "../../shared/types"
import {
  isWithinRange,
  normalizeWhitespace,
  parseDateISOFromText,
  parseShowTime,
  resolveUrl,
  splitOpeners,
} from "./utils"

const venueId: VenueId = "rickshaw-stop"

type ParsedShow = {
  dateISO: string
  time24: string
  headliner: string
  openers: string[]
  showUrl: string
  sourcePageUrl: string
}

const findEventBlocks = (root: HTMLElement) => {
  const listBlocks = root.querySelectorAll(".seetickets-list-event-container")
  if (listBlocks.length > 0) {
    return listBlocks
  }
  return root.querySelectorAll(".seetickets-calendar-event-container")
}

const extractCalendarBlocks = (html: string) => {
  const marker = 'class="seetickets-calendar-event-container"'
  const blocks: HTMLElement[] = []
  let index = 0
  while (index !== -1) {
    const start = html.indexOf(marker, index)
    if (start === -1) {
      break
    }
    const before = html.lastIndexOf("<div", start)
    if (before === -1) {
      break
    }
    const end = html.indexOf(marker, start + marker.length)
    const snippet = html.slice(before, end === -1 ? html.length : end)
    const root = parse(snippet)
    const block = root.querySelector(".seetickets-calendar-event-container")
    if (block) {
      blocks.push(block)
    }
    index = start + marker.length
  }
  return blocks
}

const extractBlocksFromHtml = (html: string, selector: string) => {
  const className = selector.replace(".", "")
  const openTagRegex = /<div\b[^>]*>/gi
  const closeTagRegex = /<\/div\s*>/gi
  const blocks: HTMLElement[] = []

  let match: RegExpExecArray | null
  while ((match = openTagRegex.exec(html))) {
    const tag = match[0]
    if (!new RegExp(`class="[^"]*${className}[^"]*"`).test(tag)) {
      continue
    }

    const startIndex = match.index
    const scanOpen = new RegExp(openTagRegex.source, "gi")
    const scanClose = new RegExp(closeTagRegex.source, "gi")
    scanOpen.lastIndex = match.index + tag.length
    scanClose.lastIndex = match.index + tag.length

    let depth = 1
    let endIndex = -1
    while (depth > 0) {
      const nextOpen = scanOpen.exec(html)
      const nextClose = scanClose.exec(html)
      if (!nextClose) {
        break
      }
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth += 1
        continue
      }
      depth -= 1
      if (depth === 0) {
        endIndex = scanClose.lastIndex
        break
      }
    }

    if (endIndex === -1) {
      continue
    }

    const snippet = html.slice(startIndex, endIndex)
    const root = parse(snippet)
    const block = root.querySelector(selector)
    if (block) {
      blocks.push(block)
    }
  }

  return blocks
}

const pickHeadliner = (block: HTMLElement) => {
  const link =
    block.querySelector("p.title a") ??
    block
      .querySelectorAll("p.fs-12.bold.m-0 a")
      .find((node) => /seetickets\.us/i.test(node.getAttribute("href") ?? ""))
  return normalizeWhitespace(link?.text ?? "")
}

const pickShowUrl = (block: HTMLElement, sourcePageUrl: string) => {
  const link = block
    .querySelectorAll("a")
    .find((node) => /seetickets\.us/i.test(node.getAttribute("href") ?? ""))
  return resolveUrl(link?.getAttribute("href") ?? null, sourcePageUrl)
}

const parseSupportingTalent = (block: HTMLElement) => {
  const supportText = block.querySelector(".supporting-talent")?.text ?? ""
  if (!supportText) {
    return []
  }
  return splitOpeners(supportText.replace(/^supporting talent:\s*/i, ""))
}

const normalizeHeadliner = (value: string) => {
  const cleaned = normalizeWhitespace(value)
  const match = cleaned.match(/emo nite/i)
  if (match) {
    return "EMO NITE"
  }
  return cleaned
}

const parseShowTimeLine = (block: HTMLElement) => {
  const timeText =
    block.querySelector(".doortime-showtime")?.text ||
    block.querySelector(".show-time")?.text ||
    ""
  const match = timeText.match(/show at\s*([0-9: ]+[ap]m)/i)
  if (match) {
    return parseShowTime(`show: ${match[1]}`)
  }
  return parseShowTime(timeText)
}

const monthMap: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

const parseCalendarTables = (
  root: HTMLElement,
  sourcePageUrl: string
): ParsedShow[] => {
  const monthHeaders = root.querySelectorAll(
    ".seetickets-calendar-year-month-container"
  )
  if (monthHeaders.length === 0) {
    return []
  }

  const parsed: ParsedShow[] = []
  for (const header of monthHeaders) {
    const headerText = normalizeWhitespace(header.text)
    const match = headerText.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
    )
    if (!match) {
      continue
    }
    const month = monthMap[match[1].toLowerCase()]
    const year = Number.parseInt(match[2], 10)

    let table = header.nextElementSibling
    while (table && table.tagName.toLowerCase() !== "table") {
      table = table.nextElementSibling
    }
    if (!table) {
      continue
    }

    const cells = table.querySelectorAll("td")
    for (const cell of cells) {
      const dayText = cell.querySelector(".date-number")?.text ?? ""
      const day = Number.parseInt(dayText, 10)
      if (!day) {
        continue
      }
      const dateISO = `${year}-${String(month).padStart(2, "0")}-${String(
        day
      ).padStart(2, "0")}`

      const events = cell.querySelectorAll(
        ".seetickets-calendar-event-container"
      )
      for (const event of events) {
        const headliner =
          normalizeHeadliner(pickHeadliner(event)) ||
          normalizeHeadliner(
            event.querySelector(".headliners")?.text ?? ""
          )
        if (!headliner) {
          continue
        }
        const openers = parseSupportingTalent(event)
        const showUrl = pickShowUrl(event, sourcePageUrl)
        parsed.push({
          dateISO,
          time24: parseShowTimeLine(event),
          headliner,
          openers,
          showUrl,
          sourcePageUrl,
        })
      }
    }
  }

  return parsed
}

export const parseRickshawHtml = (
  html: string,
  options: { sourcePageUrl: string; referenceDateISO: string; debug?: boolean }
): ParsedShow[] => {
  const referenceDate = Number.isNaN(Date.parse(options.referenceDateISO))
    ? new Date()
    : new Date(options.referenceDateISO)
  const root = parse(html)
  const calendarParsed = parseCalendarTables(root, options.sourcePageUrl)

  if (calendarParsed.length > 0) {
    if (options.debug) {
      console.log(
        `[rickshaw-stop] debug calendar parsed=${calendarParsed.length}`
      )
    }
    return calendarParsed
  }

  const listBlocks = extractBlocksFromHtml(
    html,
    ".seetickets-list-event-container"
  )
  const calendarBlocks = extractCalendarBlocks(html)
  let blocks = listBlocks
  if (calendarBlocks.length > listBlocks.length) {
    blocks = calendarBlocks
  } else if (blocks.length === 0) {
    blocks = calendarBlocks
  }
  if (blocks.length === 0) {
    blocks = findEventBlocks(root)
  }
  if (options.debug) {
    console.log(
      `[rickshaw-stop] debug blocks list=${listBlocks.length}, calendar=${calendarBlocks.length}, final=${blocks.length}`
    )
  }

  return blocks
    .map((block) => {
      const dateText =
        block.querySelector(".date")?.text ||
        block.querySelector(".event-date")?.text ||
        normalizeWhitespace(block.text).match(/[A-Za-z]{3}\s+\d{1,2}/)?.[0] ||
        ""
      const dateISO = parseDateISOFromText(dateText, referenceDate)

      const headliner =
        pickHeadliner(block) ||
        normalizeWhitespace(block.querySelector(".headliners")?.text ?? "")

      const openers = parseSupportingTalent(block)
      const showUrl = pickShowUrl(block, options.sourcePageUrl)

      return {
        dateISO,
        time24: parseShowTimeLine(block),
        headliner,
        openers,
        showUrl,
        sourcePageUrl: options.sourcePageUrl,
      }
    })
    .filter((show) => show.dateISO && show.headliner)
}

export const buildRickshawShows = (
  parsed: ParsedShow[],
  options: { startDateISO: string; endDateISO: string; venueId?: VenueId }
): ScrapedShow[] => {
  const resolvedVenue = options.venueId ?? venueId
  return parsed
    .filter((show) =>
      isWithinRange(show.dateISO, options.startDateISO, options.endDateISO)
    )
    .flatMap((show) => {
      const base = {
        date: show.dateISO,
        time: show.time24,
        venue: resolvedVenue,
        showUrl: show.showUrl,
        sourcePageUrl: show.sourcePageUrl,
      }

      const shows: ScrapedShow[] = [
        {
          ...base,
          artists: [show.headliner],
          roles: ["headliner"],
        },
      ]

      for (const opener of show.openers) {
        shows.push({
          ...base,
          artists: [opener],
          roles: ["opener"],
        })
      }
      return shows
    })
}

const fetchWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      headers: {
        "user-agent":
          "concert-playlist-bot/1.0 (+https://example.com) scraper for personal use",
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function* scrapeRickshawStop(
  calendarUrl: string,
  options: { startDateISO: string; endDateISO: string }
): AsyncGenerator<StreamMessage> {
  yield { type: "progress", message: "Fetching Rickshaw Stop page." }

  let response: Response
  try {
    response = await fetchWithTimeout(calendarUrl, 15000)
  } catch (error) {
    yield {
      type: "error",
      message: `Failed to fetch ${calendarUrl}.`,
      venueId,
    }
    return
  }

  if (!response.ok) {
    yield {
      type: "error",
      message: `Rickshaw Stop fetch failed with ${response.status}.`,
      venueId,
    }
    return
  }

  const html = await response.text()
  yield { type: "progress", message: "Parsing shows." }

  let parsed: ParsedShow[] = []
  try {
    parsed = parseRickshawHtml(html, {
      sourcePageUrl: calendarUrl,
      referenceDateISO: new Date().toISOString().slice(0, 10),
    })
  } catch (error) {
    yield {
      type: "error",
      message:
        "Parsing failed for Rickshaw Stop. Add or adjust selectors in rickshawStop.ts.",
      venueId,
    }
    return
  }

  if (parsed.length === 0) {
    yield {
      type: "error",
      message:
        "Parsed 0 shows for Rickshaw Stop. Update selectors or add a custom parser.",
      venueId,
    }
    return
  }

  const shows = buildRickshawShows(parsed, {
    startDateISO: options.startDateISO,
    endDateISO: options.endDateISO,
  })

  let totalShows = 0
  for (const item of shows) {
    totalShows += 1
    yield { type: "event", event: "show", show: item }
  }

  yield { type: "done", totalShows }
}

export const rickshawStopParser = ({
  html,
  sourcePageUrl,
}: VenueParserInput) =>
  buildRickshawShows(
    parseRickshawHtml(html, {
      sourcePageUrl,
      referenceDateISO: new Date().toISOString().slice(0, 10),
    }),
    {
      startDateISO: new Date().toISOString().slice(0, 10),
      endDateISO: "2100-12-31",
    }
  )
