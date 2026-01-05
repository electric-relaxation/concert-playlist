export type VenueId = string

export type ScrapedShow = {
  date: string
  time: string
  artists: string[]
  roles: string[]
  venue: VenueId
  showUrl: string
  sourcePageUrl: string
}

export type StreamMessage =
  | {
      type: "progress"
      message: string
      venueId?: VenueId
    }
  | {
      type: "event"
      event: "show"
      show: ScrapedShow
    }
  | {
      type: "error"
      message: string
      venueId?: VenueId
    }
  | {
      type: "done"
      totalShows: number
    }

export type VenueParserInput = {
  html: string
  venue: VenueConfig
  sourcePageUrl: string
}

export type VenueParser = (
  input: VenueParserInput
) => Promise<ScrapedShow[]> | ScrapedShow[]

export type VenueConfig = {
  id: VenueId
  name: string
  calendarUrl: string
  parser: VenueParser
}
