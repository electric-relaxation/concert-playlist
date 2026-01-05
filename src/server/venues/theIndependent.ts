import { parse, HTMLElement } from "node-html-parser"
import type {
  ScrapedShow,
  StreamMessage,
  VenueId,
  VenueParserInput,
} from "../../shared/types"

const venueId: VenueId = "the-independent"

type ParsedShow = {
  dateISO: string
  time24: string
  headliner: string
  openers: string[]
  showUrl: string
  sourcePageUrl: string
}

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").trim()

const parseShowTime = (value: string) => {
  const match = value.match(/show:\s*(\d{1,2}):(\d{2})\s*([ap]m)/i)
  if (!match) {
    return ""
  }
  let hour = Number.parseInt(match[1], 10)
  const minutes = match[2]
  const meridiem = match[3].toLowerCase()
  if (meridiem === "pm" && hour < 12) {
    hour += 12
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0
  }
  return `${hour.toString().padStart(2, "0")}:${minutes}`
}

const inferYear = (month: number, day: number, referenceDate: Date) => {
  const referenceUTC = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  )
  const candidateUTC = Date.UTC(referenceDate.getUTCFullYear(), month - 1, day)
  return candidateUTC < referenceUTC
    ? referenceDate.getUTCFullYear() + 1
    : referenceDate.getUTCFullYear()
}

const parseDateISO = (value: string, referenceDate: Date) => {
  const match = value.match(/(\d{1,2})\.(\d{1,2})/)
  if (!match) {
    return ""
  }
  const month = Number.parseInt(match[1], 10)
  const day = Number.parseInt(match[2], 10)
  const year = inferYear(month, day, referenceDate)
  const monthText = month.toString().padStart(2, "0")
  const dayText = day.toString().padStart(2, "0")
  return `${year}-${monthText}-${dayText}`
}

const splitOpeners = (value: string) => {
  const cleaned = value.replace(/^with\s+/i, "").trim()
  if (!cleaned) {
    return []
  }
  return cleaned
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

const resolveUrl = (href: string | null, baseUrl: string) => {
  if (!href) {
    return baseUrl
  }
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return baseUrl
  }
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
      const dateISO = parseDateISO(dateText, referenceDate)

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

const isWithinRange = (
  dateISO: string,
  startDateISO: string,
  endDateISO: string
) => {
  const dateValue = Date.parse(dateISO)
  const startValue = Date.parse(startDateISO)
  const endValue = Date.parse(endDateISO)
  return dateValue >= startValue && dateValue <= endValue
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
    referenceDateISO: options.startDateISO,
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
