# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- The page now talks to the library's API directly from the browser (`static/library.js`), so it can be hosted as
  static files, e.g. on GitHub Pages.
- GitHub Actions workflow (`.github/workflows/pages.yml`) that publishes `static/` to GitHub Pages on every push to `main`.
- Throttling to go easy on the library's server: auto-refresh once a minute (was every 20 s) and only while the tab is
  visible, pause after 10 minutes without input, back off up to 5 minutes after failures, at most 6 requests at a time,
  a 30-second per-date cache, and at most one manual refresh every 5 seconds.
- "Unofficial" badge next to the title, and a notice on the login card stating the tool is not affiliated with the
  GIST Library and that the ID and password are sent only to `library.gist.ac.kr`.
- A "Session expired" message when the library's login token (about 13 hours) runs out.
- "How to use" walkthrough: a six-step guided tour that highlights the date picker, clock, map, room panel,
  reservations and limits. Open it from the "How to use" button next to your name, or tick
  "Show tutorial after login" on the login card (ticked until the tour has been seen once in that browser).
  It only explains; it never books or cancels anything.

### Changed
- `server.py` is now an optional local server: it serves `static/` and passes `/lib/*` requests through to the library
  unchanged. On localhost the page uses it, so the local version keeps working even if the library stops accepting
  calls from other websites.
- The library's login token is kept in the tab's `sessionStorage` instead of a session on `server.py`; it still ends
  when the tab is closed.
- README documents GitHub Pages hosting, the new file layout and the request limits.

### Removed
- The server-side `/api/*` endpoints (`/api/day`, `/api/login`, `/api/logout`, `/api/me`, `/api/reserve`,
  `/api/cancel`), replaced by the browser client.

## [0.1.0] - 2026-10-22

### Added
- Abstract map of the reservable 2F and 3F rooms (group study rooms 202–210 and 302–307, carrels 219–240),
  coloured by availability for the selected time window: free, partly free, taken, yours, or unavailable.
- 24-hour clock picker for the time window, with an inner arc showing how many rooms are free each hour.
- Hover tooltip with a one-line heatmap of the room's whole day.
- Room panel with a day strip and a nested hour selection: defaults to the earliest bookable stretch that fits the
  daily and monthly quota; drag, Shift+click and Ctrl/⌘+click to adjust; selecting outside the clock window widens it.
- Booking with a Reserve button, checked against the library's rules (daily/monthly limits, no 1-hour gap).
- "My reservations" table with multi-select batch cancel.
- The library's 00:00–02:00 slots shown as the end of the evening before, so a window can run across midnight.
- Sunday-first date picker limited to the bookable range.
- In-page login with a blurred "Log in first" gate; the login lasts for the browser tab only.
- Background refresh, a manual refresh button, and a single blocking spinner overlay while loading.
- Local Python server (standard library only) proxying the library's API.
- README with screenshots.
