import type { VenueDataShow } from "../src/shared/types.ts"

export const buildShowKey = (show: VenueDataShow) =>
  [
    show.dateISO,
    show.startTime ?? "",
    show.venueId,
    show.showUrl ?? "",
    show.headliners.join(","),
    show.openers.join(","),
  ].join("|")

export const buildStableShowKey = (show: VenueDataShow) =>
  [
    show.dateISO,
    show.venueId,
    show.showUrl ?? "",
    show.headliners.join(","),
  ].join("|")

const buildUrlKey = (show: VenueDataShow) =>
  show.showUrl ? `${show.venueId}|${show.showUrl}` : ""

const buildDateTimeKey = (show: VenueDataShow) =>
  `${show.venueId}|${show.dateISO}|${show.startTime ?? ""}`

const buildHeadlinerTimeKey = (show: VenueDataShow) =>
  `${show.venueId}|${show.dateISO}|${show.startTime ?? ""}|${show.headliners.join(",")}`

type MatchState = {
  matchedPrev: Set<number>
  matchedNext: Set<number>
}

const tryMatch = (
  previous: VenueDataShow[],
  next: VenueDataShow[],
  state: MatchState,
  keyFn: (show: VenueDataShow) => string
) => {
  const map = new Map<string, number[]>()
  for (let i = 0; i < previous.length; i += 1) {
    if (state.matchedPrev.has(i)) {
      continue
    }
    const key = keyFn(previous[i])
    if (!key) {
      continue
    }
    const list = map.get(key) ?? []
    list.push(i)
    map.set(key, list)
  }

  const pairs: Array<{ prevIndex: number; nextIndex: number }> = []

  for (let j = 0; j < next.length; j += 1) {
    if (state.matchedNext.has(j)) {
      continue
    }
    const key = keyFn(next[j])
    if (!key) {
      continue
    }
    const list = map.get(key)
    if (!list || list.length !== 1) {
      continue
    }
    const prevIndex = list[0]
    state.matchedPrev.add(prevIndex)
    state.matchedNext.add(j)
    pairs.push({ prevIndex, nextIndex: j })
  }

  return pairs
}

export const preserveShowIds = (
  nextShows: VenueDataShow[],
  previousShows: VenueDataShow[]
) => {
  const result = nextShows.map((show) => ({ ...show }))
  const state: MatchState = {
    matchedPrev: new Set<number>(),
    matchedNext: new Set<number>(),
  }

  const exactPairs = tryMatch(
    previousShows,
    result,
    state,
    buildShowKey
  )
  for (const pair of exactPairs) {
    result[pair.nextIndex].showId = previousShows[pair.prevIndex].showId
  }

  const stablePairs = tryMatch(
    previousShows,
    result,
    state,
    buildStableShowKey
  )
  for (const pair of stablePairs) {
    result[pair.nextIndex].showId = previousShows[pair.prevIndex].showId
  }

  const urlPairs = tryMatch(previousShows, result, state, buildUrlKey)
  for (const pair of urlPairs) {
    result[pair.nextIndex].showId = previousShows[pair.prevIndex].showId
  }

  const dateTimePairs = tryMatch(
    previousShows,
    result,
    state,
    buildDateTimeKey
  )
  for (const pair of dateTimePairs) {
    result[pair.nextIndex].showId = previousShows[pair.prevIndex].showId
  }

  const headlinerTimePairs = tryMatch(
    previousShows,
    result,
    state,
    buildHeadlinerTimeKey
  )
  for (const pair of headlinerTimePairs) {
    result[pair.nextIndex].showId = previousShows[pair.prevIndex].showId
  }

  return result
}

export const diffShows = (
  previous: VenueDataShow[],
  next: VenueDataShow[]
) => {
  const state: MatchState = {
    matchedPrev: new Set<number>(),
    matchedNext: new Set<number>(),
  }

  const unchangedPairs = tryMatch(previous, next, state, buildShowKey)
  const updatedPairs = [
    ...tryMatch(previous, next, state, buildStableShowKey),
    ...tryMatch(previous, next, state, buildUrlKey),
    ...tryMatch(previous, next, state, buildDateTimeKey),
    ...tryMatch(previous, next, state, buildHeadlinerTimeKey),
  ]

  const removed = previous.length - state.matchedPrev.size
  const added = next.length - state.matchedNext.size

  return {
    removed,
    unchanged: unchangedPairs.length,
    updated: updatedPairs.length,
    added,
  }
}
