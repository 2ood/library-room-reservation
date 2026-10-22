# Library Room Finder

An alternative view of the [GIST Library facility reservation](https://library.gist.ac.kr/#/facilityReservation) page.

The official page makes you pick one room from a dropdown and read its calendar, room by room. This app turns that around: **pick a time window, and the floor map shows which rooms are free for it.** You can then book (and cancel) straight from the map.

![Overview: a time window picked on the clock, rooms coloured by availability](thumbnail/overview.png)

## Features

- **Floor map of 2F and 3F.** An abstract map of every reservable room (group study rooms, carrels), coloured for the selected window:
  free, partly free, taken, yours, or not bookable for your account.
- **24-hour clock picker.** Drag around the ring to choose a time window. A dark inner arc shows how many rooms are free each hour.
  The library's 00:00–02:00 slots count as the end of the evening before, so a window can run across midnight (e.g. 22:00–02:00).
- **Hover tooltip.** A one-line heatmap of the room's whole day.
- **Click to book.** Clicking a room opens its day strip with a pre-selected bookable stretch that fits your daily and monthly quota.
  Adjust it by dragging (Shift+click extends, Ctrl/⌘+click adds or removes hours), then press **Reserve**.
- **My reservations.** Your bookings this month. Tick rows and press **Cancel** to cancel several at once.
- **Near-live data.** Refreshes in the background every 20 seconds, with a manual refresh button.
- **Per-tab login.** You log in with your own library account; the session ends when the tab is closed.

![Booking: a partly free room with a picked stretch and the Reserve button](thumbnail/booking.png)

| Date picker | Login |
| --- | --- |
| ![Sunday-first date picker](thumbnail/calendar.png) | ![Login screen](thumbnail/login.png) |

## Running it

Requires Python 3.8 or newer. No packages to install; it uses only the standard library.

```sh
python server.py
```

Then open <http://localhost:8000> and log in with your GIST library ID and password.

To use another port, create a `.env` file next to `server.py` containing `PORT=8080`.

## How it works

`server.py` serves the page from `static/` and talks to the library's own JSON API (`https://library.gist.ac.kr:8443`)
using the same calls the official site makes:

| Library endpoint | Used for |
| --- | --- |
| `/hello/login`, `/hello/getAccount` | Log in, read your name and account flags |
| `/work/getFacilityInfo` | Room list, your quotas, the bookable date range |
| `/work/getRoom` | One room's hours on one date |
| `/work/getMyReservation` | Your reservations |
| `/work/makeFacilityreservation` | Book one hour |
| `/work/cancelFacilityreservation` | Cancel one hour |

For each date it fetches every 2F/3F room in parallel and merges them into one response for the page.
Your password is only sent to the library's server and kept in memory for the session; nothing is written to disk.

```
server.py         local server + library API client
static/
  index.html      page layout
  app.js          clock, map, booking and reservation logic
  map.js          abstract floor-map geometry (edit this to rearrange rooms)
  style.css       styles and colour palette
thumbnail/        screenshots for this README
```

## Notes

- This is an unofficial tool, not affiliated with the GIST Library. It books through your own account and follows the
  library's rules (daily/monthly limits, no 1-hour gap between your own bookings); the library's server has the final say.
- The 20-second refresh makes about 35–70 small requests to the library server each time. Please don't lower the interval.
