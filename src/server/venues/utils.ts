export const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").trim()

export const splitOpeners = (value: string) => {
  const cleaned = value
    .replace(/^with\s+/i, "")
    .replace(/^w\/\s*/i, "")
    .replace(/\bwith\s+/gi, "")
    .trim()
  if (!cleaned) {
    return []
  }
  return cleaned
    .split(",")
    .map((item) => item.trim())
    .filter(
      (item) =>
        Boolean(item) &&
        !/^tba$/i.test(item) &&
        !/^support\s*tba$/i.test(item) &&
        !/^more\s*tba$/i.test(item)
    )
}

export const parseShowTime = (value: string) => {
  const match = value.match(/(?:show:\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i)
  if (!match) {
    return ""
  }
  let hour = Number.parseInt(match[1], 10)
  const minutes = match[2] ?? "00"
  const meridiem = match[3].toLowerCase()
  if (meridiem === "pm" && hour < 12) {
    hour += 12
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0
  }
  return `${hour.toString().padStart(2, "0")}:${minutes}`
}

export const resolveUrl = (href: string | null, baseUrl: string) => {
  if (!href) {
    return baseUrl
  }
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return baseUrl
  }
}

const inferYear = (month: number, day: number, referenceDate: Date) => {
  const referenceUTC = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  )
  const candidateUTC = Date.UTC(referenceDate.getUTCFullYear(), month - 1, day)
  const oneMonthMs = 31 * 24 * 60 * 60 * 1000
  return candidateUTC < referenceUTC - oneMonthMs
    ? referenceDate.getUTCFullYear() + 1
    : referenceDate.getUTCFullYear()
}

const monthMap: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export const parseDateISOFromText = (
  value: string,
  referenceDate: Date
) => {
  const normalized = value.toLowerCase()

  let match = normalized.match(/(\d{1,2})\.(\d{1,2})/)
  if (match) {
    const month = Number.parseInt(match[1], 10)
    const day = Number.parseInt(match[2], 10)
    const year = inferYear(month, day, referenceDate)
    return `${year}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`
  }

  match = normalized.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (match) {
    const month = Number.parseInt(match[1], 10)
    const day = Number.parseInt(match[2], 10)
    const year = match[3]
      ? Number.parseInt(match[3].length === 2 ? `20${match[3]}` : match[3], 10)
      : inferYear(month, day, referenceDate)
    return `${year}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`
  }

  match = normalized.match(
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/
  )
  if (match) {
    const month = monthMap[match[1]]
    const day = Number.parseInt(match[2], 10)
    const year = match[3]
      ? Number.parseInt(match[3], 10)
      : inferYear(month, day, referenceDate)
    return `${year}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`
  }

  return ""
}

export const isWithinRange = (
  dateISO: string,
  startDateISO: string,
  endDateISO: string
) => {
  const dateValue = Date.parse(dateISO)
  const startValue = Date.parse(startDateISO)
  const endValue = Date.parse(endDateISO)
  return dateValue >= startValue && dateValue <= endValue
}

export const readResponseText = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? ""
  const match = contentType.match(/charset=([^;]+)/i)
  const charset = match?.[1]?.trim().toLowerCase()
  const buffer = await response.arrayBuffer()
  try {
    if (charset && charset !== "utf-8" && charset !== "utf8") {
      return new TextDecoder(charset).decode(buffer)
    }
  } catch {
    // fall back to utf-8
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer)
  if (utf8.includes("\uFFFD")) {
    try {
      return new TextDecoder("iso-8859-1").decode(buffer)
    } catch {
      // ignore
    }
  }
  return utf8
}
