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

const venueId: VenueId = "the-independent"

type ParsedShow = {
  dateISO: string
  time24: string
  headliner: string
  openers: string[]
  showUrl: string
  sourcePageUrl: string
}

const pickShowBlocks = (root: HTMLElement) => {
  const twItems = root.querySelectorAll(".tw-event-item")
  if (twItems.length > 0) {
    return twItems
  }

  const cards = root.querySelectorAll(".show-card")
  if (cards.length > 0) {
    return cards
  }

  const moreLinks = root
    .querySelectorAll("a")
    .filter((link) => /more info/i.test(link.text))

  if (moreLinks.length === 0) {
    return []
  }

  const blocks = new Set<HTMLElement>()
  for (const link of moreLinks) {
    let current: HTMLElement | null = link
    while (current && current.parentNode) {
      const className = current.getAttribute("class") ?? ""
      if (/(show|event|listing|card)/i.test(className)) {
        blocks.add(current)
        break
      }
      current = current.parentNode as HTMLElement
    }
    if (link.parentNode && !blocks.has(link.parentNode as HTMLElement)) {
      blocks.add(link.parentNode as HTMLElement)
    }
  }

  return Array.from(blocks)
}

export const parseIndependentHtml = (
  html: string,
  options: { sourcePageUrl: string; referenceDateISO: string }
): ParsedShow[] => {
  const referenceDate = Number.isNaN(Date.parse(options.referenceDateISO))
    ? new Date()
    : new Date(options.referenceDateISO)
  const root = parse(html)
  const blocks = pickShowBlocks(root)

  return blocks
    .map((block) => {
      const textLines = block.text
        .split("\n")
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean)

      const dateText =
        block.querySelector(".tw-event-date")?.text ||
        block.querySelector(".show-date")?.text ||
        textLines.find((line) => /(\d{1,2})\.(\d{1,2})/.test(line)) ||
        ""
      const dateISO = parseDateISOFromText(dateText, referenceDate)

      const title =
        block.querySelector(".tw-name a")?.text ||
        block.querySelector(".tw-name")?.text ||
        block.querySelector(".show-title")?.text ||
        block.querySelector(".event-title")?.text ||
        block.querySelector(".title")?.text ||
        block.querySelector("h1")?.text ||
        block.querySelector("h2")?.text ||
        block.querySelector("h3")?.text ||
        ""

      const openerLine =
        block.querySelector(".tw-attractions")?.text ||
        block.querySelector(".show-support")?.text ||
        block
          .querySelectorAll("p")
          .map((node) => node.text)
          .find((line) => /with\s+/i.test(line)) ||
        textLines.find((line) => /with\s+/i.test(line)) ||
        ""

      const timeLine =
        block.querySelector(".tw-event-time")?.text ||
        block.querySelector(".show-time")?.text ||
        textLines.find((line) => /show:\s*\d{1,2}:\d{2}\s*[ap]m/i.test(line)) ||
        ""

      const moreLink =
        block.querySelector(".tw-name a") ??
        block
          .querySelectorAll("a")
          .find((link) => /more info/i.test(link.text)) ?? null

      const showUrl = resolveUrl(
        moreLink?.getAttribute("href") ?? null,
        options.sourcePageUrl
      )

      return {
        dateISO,
        time24: parseShowTime(timeLine),
        headliner: normalizeWhitespace(title),
        openers: splitOpeners(openerLine),
        showUrl,
        sourcePageUrl: options.sourcePageUrl,
      }
    })
    .filter((show) => show.dateISO && show.headliner)
}

export const toScrapedShows = (
  show: ParsedShow,
  venue: VenueId
): ScrapedShow[] => {
  const base = {
    date: show.dateISO,
    time: show.time24,
    venue,
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
}

export const buildIndependentShows = (
  parsed: ParsedShow[],
  options: { startDateISO: string; endDateISO: string; venueId?: VenueId }
): ScrapedShow[] => {
  const resolvedVenue = options.venueId ?? venueId
  return parsed
    .filter((show) =>
      isWithinRange(show.dateISO, options.startDateISO, options.endDateISO)
    )
    .flatMap((show) => toScrapedShows(show, resolvedVenue))
}

export async function* scrapeTheIndependent(
  calendarUrl: string,
  options: { startDateISO: string; endDateISO: string }
): AsyncGenerator<StreamMessage> {
  yield { type: "progress", message: "Fetching The Independent page." }

  let response: Response
  try {
    response = await fetch(calendarUrl)
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
      message: `The Independent fetch failed with ${response.status}.`,
      venueId,
    }
    return
  }

  const html = await response.text()
  yield { type: "progress", message: "Parsing shows." }

  const parsed = parseIndependentHtml(html, {
    sourcePageUrl: calendarUrl,
    referenceDateISO: new Date().toISOString().slice(0, 10),
  })
  const filtered = buildIndependentShows(parsed, {
    startDateISO: options.startDateISO,
    endDateISO: options.endDateISO,
  })

  let totalShows = 0
  for (const item of filtered) {
    totalShows += 1
    yield { type: "event", event: "show", show: item }
  }

  yield {
    type: "done",
    totalShows,
  }
}

export const theIndependentParser = ({
  html,
  sourcePageUrl,
}: VenueParserInput) =>
  buildIndependentShows(
    parseIndependentHtml(html, {
      sourcePageUrl,
      referenceDateISO: new Date().toISOString().slice(0, 10),
    }),
    {
      startDateISO: new Date().toISOString().slice(0, 10),
      endDateISO: "2100-12-31",
    }
  )
