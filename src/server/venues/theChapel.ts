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
  readResponseText,
  resolveUrl,
  splitOpeners,
} from "./utils"

const venueId: VenueId = "the-chapel"

type ParsedShow = {
  dateISO: string
  time24: string
  headliner: string
  openers: string[]
  showUrl: string
  sourcePageUrl: string
}

const dateLineRegex =
  /(mon|tue|wed|thu|fri|sat|sun)\s+[a-z]{3}\s+\d{1,2}/i

const findEventBlocks = (root: HTMLElement) => {
  const listBlocks = root
    .querySelectorAll(".seetickets-list-event-container")
    .filter((block) => !block.closest("#just-announced-events-list"))
  if (listBlocks.length > 0) {
    return listBlocks
  }

  const links = root
    .querySelectorAll("a")
    .filter(
      (link) =>
        /buy tickets/i.test(link.text) &&
        /seetickets\.us/i.test(link.getAttribute("href") ?? "")
    )

  const blocks = new Set<HTMLElement>()
  for (const link of links) {
    let current: HTMLElement | null = link
    let depth = 0
    while (current && current.parentNode && depth < 8) {
      const text = normalizeWhitespace(current.text)
      if (dateLineRegex.test(text) && /show at/i.test(text)) {
        blocks.add(current)
        break
      }
      current = current.parentNode as HTMLElement
      depth += 1
    }
  }

  return Array.from(blocks)
}

const pickTitleLink = (block: HTMLElement) =>
  block.querySelector(".title a") ??
  block
    .querySelectorAll("a")
    .find(
      (link) =>
        /seetickets\.us/i.test(link.getAttribute("href") ?? "") &&
        !/buy tickets/i.test(link.text)
    ) ?? null

const parseShowTimeLine = (lines: string[], block: HTMLElement) => {
  const showLine =
    block.querySelector(".doortime-showtime")?.text ||
    lines.find((line) => /show at/i.test(line)) ||
    lines.find((line) => /doors at/i.test(line)) ||
    ""
  const showMatch = showLine.match(/show at\s*([0-9: ]+[ap]m)/i)
  if (showMatch) {
    return parseShowTime(`show: ${showMatch[1]}`)
  }
  return parseShowTime(showLine)
}

const parseSupportingTalent = (lines: string[], block: HTMLElement) => {
  const supportText = block.querySelector(".supporting-talent")?.text ?? ""
  if (supportText) {
    return splitOpeners(supportText.replace(/^supporting talent:\s*/i, ""))
  }
  const supportIndex = lines.findIndex((line) =>
    /^supporting talent:/i.test(line)
  )
  if (supportIndex === -1) {
    return []
  }
  const line = lines[supportIndex].replace(/^supporting talent:\s*/i, "")
  if (line) {
    return splitOpeners(line)
  }
  const next = lines[supportIndex + 1] ?? ""
  return splitOpeners(next)
}

export const parseChapelHtml = (
  html: string,
  options: { sourcePageUrl: string; referenceDateISO: string }
): ParsedShow[] => {
  const referenceDate = Number.isNaN(Date.parse(options.referenceDateISO))
    ? new Date()
    : new Date(options.referenceDateISO)
  const root = parse(html)
  const blocks = findEventBlocks(root)

  return blocks
    .map((block) => {
      const lines = block.text
        .split("\n")
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean)

      const dateText =
        block.querySelector(".date")?.text ||
        lines.find((line) => dateLineRegex.test(line)) ||
        ""
      const dateISO = parseDateISOFromText(dateText, referenceDate)

      const titleLink = pickTitleLink(block)
      const titleText = normalizeWhitespace(titleLink?.text ?? "")
      const title = titleText.replace(/\s+with\s+.+$/i, "").trim()

      const supporting = parseSupportingTalent(lines, block)
      const withOpeners =
        supporting.length === 0 && /\s+with\s+/i.test(titleText)
          ? splitOpeners(titleText.split(/\s+with\s+/i)[1] ?? "")
          : supporting

      const showUrl = resolveUrl(
        titleLink?.getAttribute("href") ?? null,
        options.sourcePageUrl
      )

      return {
        dateISO,
        time24: parseShowTimeLine(lines, block),
        headliner: title || titleText,
        openers: withOpeners,
        showUrl,
        sourcePageUrl: options.sourcePageUrl,
      }
    })
    .filter((show) => show.dateISO && show.headliner)
}

export const buildChapelShows = (
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

export async function* scrapeTheChapel(
  calendarUrl: string,
  options: { startDateISO: string; endDateISO: string }
): AsyncGenerator<StreamMessage> {
  yield { type: "progress", message: "Fetching The Chapel pages." }

  const referenceDateISO = new Date().toISOString().slice(0, 10)
  const parsed: ParsedShow[] = []
  const seenKeys = new Set<string>()
  const hasPageParam = new URL(calendarUrl).searchParams.has("list1page")

  for (let page = 1; ; page += 1) {
    const pageUrl = new URL(calendarUrl)
    if (hasPageParam) {
      pageUrl.searchParams.set("list1page", String(page))
    } else if (page > 1) {
      break
    }

    let response: Response
    try {
      response = await fetchWithTimeout(pageUrl.toString(), 15000)
    } catch (error) {
      yield {
        type: "error",
        message: `Failed to fetch ${pageUrl.toString()}.`,
        venueId,
      }
      return
    }

    if (!response.ok) {
      yield {
        type: "error",
        message: `The Chapel fetch failed with ${response.status}.`,
        venueId,
      }
      return
    }

    const html = await readResponseText(response)
    yield {
      type: "progress",
      message: `Parsing shows (page ${page}).`,
    }

    let pageParsed: ParsedShow[] = []
    try {
      pageParsed = parseChapelHtml(html, {
        sourcePageUrl: pageUrl.toString(),
        referenceDateISO,
      })
    } catch (error) {
      yield {
        type: "error",
        message:
          "Parsing failed for The Chapel. Add or adjust selectors in theChapel.ts.",
        venueId,
      }
      return
    }

    const beforeCount = seenKeys.size
    for (const show of pageParsed) {
      const key = `${show.dateISO}|${show.showUrl}`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        parsed.push(show)
      }
    }

    const hasEvents = findEventBlocks(parse(html)).length > 0
    const addedCount = seenKeys.size - beforeCount

    if (!hasEvents || addedCount === 0) {
      break
    }
  }

  if (parsed.length === 0) {
    yield {
      type: "error",
      message:
        "Parsed 0 shows for The Chapel. Update selectors or add a custom parser.",
      venueId,
    }
    return
  }

  const shows = buildChapelShows(parsed, {
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

export const theChapelParser = ({
  html,
  sourcePageUrl,
}: VenueParserInput) =>
  buildChapelShows(
    parseChapelHtml(html, {
      sourcePageUrl,
      referenceDateISO: new Date().toISOString().slice(0, 10),
    }),
    {
      startDateISO: new Date().toISOString().slice(0, 10),
      endDateISO: "2100-12-31",
    }
  )
