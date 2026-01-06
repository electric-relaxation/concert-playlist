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

const venueId: VenueId = "bottom-of-the-hill"

type ParsedShow = {
  dateISO: string
  time24: string
  headliner: string
  openers: string[]
  showUrl: string
  sourcePageUrl: string
}

const pickShowBlocks = (root: HTMLElement) => {
  const namedAnchors = root
    .querySelectorAll("a")
    .filter((link) => /\d{8}/.test(link.getAttribute("name") ?? ""))
  if (namedAnchors.length > 0) {
    const rows = new Set<HTMLElement>()
    for (const anchor of namedAnchors) {
      let current: HTMLElement | null = anchor
      while (current && current.parentNode) {
        if (current.tagName.toLowerCase() === "tr") {
          rows.add(current)
          break
        }
        current = current.parentNode as HTMLElement
      }
    }
    if (rows.size > 0) {
      return Array.from(rows)
    }
  }

  const selectors = [
    ".calendaritem",
    ".calendar-item",
    ".showlisting",
    ".show-listing",
    ".event",
    ".event-item",
    ".listing",
  ]
  const blocks = selectors.flatMap((selector) =>
    root.querySelectorAll(selector)
  )
  if (blocks.length > 0) {
    return blocks
  }

  const candidates = new Set<HTMLElement>()
  const links = root
    .querySelectorAll("a")
    .filter((link) => (link.getAttribute("href") ?? "").includes("bottomofthehill"))
  for (const link of links) {
    const text = normalizeWhitespace(link.text)
    if (!text) {
      continue
    }
    let current: HTMLElement | null = link
    while (current && current.parentNode) {
      if (
        /show|event|listing|calendar|gig/i.test(
          current.getAttribute("class") ?? ""
        )
      ) {
        candidates.add(current)
        break
      }
      current = current.parentNode as HTMLElement
    }
    if (link.parentNode) {
      candidates.add(link.parentNode as HTMLElement)
    }
  }
  return Array.from(candidates)
}

export const parseBottomOfTheHillHtml = (
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
        block
          .querySelectorAll(".date")
          .map((node) => node.text)
          .join(" ") ||
        textLines.find((line) =>
          /(\d{1,2})\.(\d{1,2})|(\d{1,2})\/(\d{1,2})|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(
            line
          )
        ) ||
        ""
      let dateISO = parseDateISOFromText(dateText, referenceDate)
      if (!dateISO) {
        const anchorName =
          block
            .querySelectorAll("a")
            .map((link) => link.getAttribute("name") ?? "")
            .find((name) => /^\d{8}$/.test(name)) ?? ""
        if (anchorName) {
          dateISO = `${anchorName.slice(0, 4)}-${anchorName.slice(
            4,
            6
          )}-${anchorName.slice(6, 8)}`
        }
      }

      const bandNames = block
        .querySelectorAll(".band")
        .map((node) => normalizeWhitespace(node.text))
        .filter(
          (name) => name && name.toLowerCase() !== "tba"
        )
      const headliner =
        bandNames[0] ??
        normalizeWhitespace(block.querySelector(".title")?.text ?? "")

      const openerLine =
        bandNames.length > 0
          ? bandNames.slice(1).join(", ")
          : block.querySelector(".support")?.text ||
            textLines.find((line) => /with\s+|w\//i.test(line)) ||
            ""

      const timeLine =
        block
          .querySelectorAll(".time")
          .map((node) => node.text)
          .find((line) => /(\d{1,2})(?::\d{2})?\s*[ap]m/i.test(line)) ||
        textLines.find((line) =>
          /(\d{1,2})(?::\d{2})?\s*[ap]m/i.test(line)
        ) ||
        ""

      const musicAtLine =
        textLines.find((line) => /music at/i.test(line)) || ""
      const meridiemMatch = timeLine.match(/[ap]m/i)
      const musicAtMatch = musicAtLine.match(
        /music at\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i
      )
      const musicAtTime = musicAtMatch
        ? `show: ${musicAtMatch[1]}${
            musicAtMatch[2] ? `:${musicAtMatch[2]}` : ""
          } ${musicAtMatch[3] ?? meridiemMatch?.[0] ?? ""}`.trim()
        : ""

      const showLink =
        block
          .querySelectorAll("a")
          .find((link) =>
            /\/\d{8}\.html$/i.test(link.getAttribute("href") ?? "")
          ) ??
        block
          .querySelectorAll("a")
          .find((link) =>
            /\/\d{8}\.html$/i.test(
              new URL(
                link.getAttribute("href") ?? "",
                options.sourcePageUrl
              ).pathname
            )
          )

      const showUrl = resolveUrl(
        showLink?.getAttribute("href") ?? null,
        options.sourcePageUrl
      )

      return {
        dateISO,
        time24: parseShowTime(musicAtTime || timeLine),
        headliner,
        openers: splitOpeners(openerLine),
        showUrl,
        sourcePageUrl: options.sourcePageUrl,
      }
    })
    .filter((show) => show.dateISO && show.headliner)
}

export const buildBottomShows = (
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

export async function* scrapeBottomOfTheHill(
  calendarUrl: string,
  options: { startDateISO: string; endDateISO: string }
): AsyncGenerator<StreamMessage> {
  yield { type: "progress", message: "Fetching Bottom of the Hill page." }

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
      message: `Bottom of the Hill fetch failed with ${response.status}.`,
      venueId,
    }
    return
  }

  const html = await response.text()
  yield { type: "progress", message: "Parsing shows." }

  let parsed: ParsedShow[] = []
  try {
    parsed = parseBottomOfTheHillHtml(html, {
      sourcePageUrl: calendarUrl,
      referenceDateISO: new Date().toISOString().slice(0, 10),
    })
  } catch (error) {
    yield {
      type: "error",
      message:
        "Parsing failed for Bottom of the Hill. Add or adjust selectors in bottomOfTheHill.ts.",
      venueId,
    }
    return
  }

  if (parsed.length === 0) {
    yield {
      type: "error",
      message:
        "Parsed 0 shows for Bottom of the Hill. Update selectors or add a custom parser.",
      venueId,
    }
    return
  }

  const shows = buildBottomShows(parsed, {
    startDateISO: options.startDateISO,
    endDateISO: options.endDateISO,
  })

  let totalShows = 0
  for (const item of shows) {
    totalShows += 1
    yield { type: "event", event: "show", show: item }
  }

  yield {
    type: "done",
    totalShows,
  }
}

export const bottomOfTheHillParser = ({
  html,
  sourcePageUrl,
}: VenueParserInput) =>
  buildBottomShows(
    parseBottomOfTheHillHtml(html, {
      sourcePageUrl,
      referenceDateISO: new Date().toISOString().slice(0, 10),
    }),
    {
      startDateISO: new Date().toISOString().slice(0, 10),
      endDateISO: "2100-12-31",
    }
  )
