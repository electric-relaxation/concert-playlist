import { useEffect, useMemo, useState } from "react"
import "./App.css"

type VenueDataShow = {
  showId: string
  dateISO: string
  startTime: string | null
  venueId: string
  venueName: string
  showUrl: string | null
  sourceUrl: string
  headliners: string[]
  openers: string[]
}

type VenueMergedFile = {
  generatedAtISO: string
  shows: VenueDataShow[]
}

const formatDate = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const formatTime = (value: string | null) => value ?? "TBD"

function App() {
  const [data, setData] = useState<VenueMergedFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedVenues, setSelectedVenues] = useState<string[]>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [songsPerArtist, setSongsPerArtist] = useState(3)
  const [preferRecent, setPreferRecent] = useState(true)
  const [services, setServices] = useState({
    spotify: true,
    apple: false,
  })
  const [playlistName, setPlaylistName] = useState("optional")

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const response = await fetch("/data/venues/all-venues.json")
        if (!response.ok) {
          throw new Error("Failed to load venue data.")
        }
        const json = (await response.json()) as VenueMergedFile
        if (mounted) {
          setData(json)
          setError(null)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load data.")
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const venues = useMemo(() => {
    if (!data) {
      return []
    }
    const map = new Map<string, string>()
    for (const show of data.shows) {
      map.set(show.venueId, show.venueName)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [data])

  useEffect(() => {
    if (venues.length > 0 && selectedVenues.length === 0) {
      setSelectedVenues(venues.map((venue) => venue.id))
    }
  }, [venues, selectedVenues.length])

  const filteredShows = useMemo(() => {
    if (!data) {
      return []
    }
    return data.shows.filter((show) => {
      if (selectedVenues.length > 0 && !selectedVenues.includes(show.venueId)) {
        return false
      }
      if (startDate && show.dateISO < startDate) {
        return false
      }
      if (endDate && show.dateISO > endDate) {
        return false
      }
      return true
    })
  }, [data, selectedVenues, startDate, endDate])

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Concert Playlist Builder</p>
          <h1>Build playlists from upcoming shows in SF</h1>
          <p className="subhead">
            Pick venues, set your range, and generate playlists for Spotify or
            Apple Music. We’ll wire up the functionality next.
          </p>
        </div>
        <div className="hero-card">
          <p className="hero-label">Data source</p>
          <p className="hero-value">
            {loading ? "Loading…" : `${filteredShows.length} shows`}
          </p>
          <p className="hero-meta">
            {data?.generatedAtISO
              ? `Updated ${new Date(data.generatedAtISO).toLocaleString()}`
              : "—"}
          </p>
        </div>
      </header>

      <main className="layout">
        <section className="panel settings">
          <div className="panel-header">
            <h2>Settings</h2>
            <p>Choose sources and how the playlist should feel.</p>
          </div>

          <div className="setting-group">
            <div className="setting-title">Venues</div>
            <div className="venue-grid">
              {venues.map((venue) => (
                <label key={venue.id} className="check-pill">
                  <input
                    type="checkbox"
                    checked={selectedVenues.includes(venue.id)}
                    onChange={(event) => {
                      setSelectedVenues((prev) =>
                        event.target.checked
                          ? [...prev, venue.id]
                          : prev.filter((id) => id !== venue.id)
                      )
                    }}
                  />
                  <span>{venue.name}</span>
                </label>
              ))}
              {venues.length === 0 && (
                <div className="placeholder">No venues loaded yet.</div>
              )}
            </div>
          </div>

          <div className="setting-group">
            <div className="setting-title">Date range</div>
            <div className="date-grid">
              <label>
                <span>Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label>
                <span>End</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="setting-group two-col">
            <label className="input-row">
              <span>Songs per artist</span>
              <input
                type="number"
                min={1}
                max={10}
                value={songsPerArtist}
                onChange={(event) =>
                  setSongsPerArtist(Number(event.target.value))
                }
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={preferRecent}
                onChange={(event) => setPreferRecent(event.target.checked)}
              />
              <span>Prefer recent releases</span>
            </label>
          </div>

          <div className="setting-group">
            <div className="setting-title">Services</div>
            <div className="service-row">
              <label className="check-pill">
                <input
                  type="checkbox"
                  checked={services.spotify}
                  onChange={(event) =>
                    setServices((prev) => ({
                      ...prev,
                      spotify: event.target.checked,
                    }))
                  }
                />
                <span>Spotify</span>
              </label>
              <label className="check-pill">
                <input
                  type="checkbox"
                  checked={services.apple}
                  onChange={(event) =>
                    setServices((prev) => ({
                      ...prev,
                      apple: event.target.checked,
                    }))
                  }
                />
                <span>Apple Music</span>
              </label>
            </div>
          </div>

          <div className="setting-group">
            <label className="input-row">
              <span>Playlist name</span>
              <input
                type="text"
                value={playlistName}
                onChange={(event) => setPlaylistName(event.target.value)}
              />
            </label>
          </div>

          <div className="setting-group">
            <div className="setting-title">Generate playlist</div>
            <div className="button-row">
              <button type="button" className="primary">
                Spotify
              </button>
              <button type="button" className="ghost">
                Apple Music
              </button>
            </div>
            <p className="helper">
              We’ll wire up the API connections next.
            </p>
          </div>
        </section>

        <section className="panel table-panel">
          <div className="panel-header">
            <h2>Upcoming shows</h2>
            <div className="table-meta">
              {loading ? "Loading data…" : `${filteredShows.length} shows`}
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>
                    <button type="button" className="table-sort">
                      Date / Time
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort">
                      Headliner
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort">
                      Support
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort">
                      Venue
                    </button>
                  </th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredShows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      No shows found for this range.
                    </td>
                  </tr>
                )}
                {filteredShows.map((show) => (
                  <tr key={show.showId}>
                    <td>
                      <div className="date-cell">
                        <span>{formatDate(show.dateISO)}</span>
                        <span className="time">{formatTime(show.startTime)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="headliners">
                        {show.headliners.map((name) => (
                          <span key={name}>{name}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="support">
                        {show.openers.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          show.openers.map((name) => (
                            <span className="chip" key={name}>
                              {name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="venue-cell">
                        <span>{show.venueName}</span>
                      </div>
                    </td>
                    <td>
                      {show.showUrl ? (
                        <a
                          className="link-icon"
                          href={show.showUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${show.headliners[0]} show page`}
                        >
                          ↗
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
