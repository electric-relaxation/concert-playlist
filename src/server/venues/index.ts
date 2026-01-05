import type { VenueConfig, VenueId, VenueParserInput } from "../../shared/types"
import { theIndependentParser } from "./theIndependent"

const defaultParser = ({ venue, sourcePageUrl }: VenueParserInput) => {
  throw new Error(
    `No default parser for ${venue.name}. Add a custom parser for ${sourcePageUrl}.`
  )
}

type VenueSeed = {
  name: string
  calendarUrl: string
  id?: VenueId
  parser?: VenueConfig["parser"]
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")

const createVenue = (seed: VenueSeed): VenueConfig => ({
  id: seed.id ?? slugify(seed.name),
  name: seed.name,
  calendarUrl: seed.calendarUrl,
  parser: seed.parser ?? defaultParser,
})

export const venues: VenueConfig[] = [
  createVenue({
    name: "Bottom of the Hill",
    calendarUrl: "https://www.bottomofthehill.com/calendar.html",
  }),
  createVenue({
    name: "The Independent",
    calendarUrl: "https://www.theindependentsf.com",
    parser: theIndependentParser,
  }),
]
