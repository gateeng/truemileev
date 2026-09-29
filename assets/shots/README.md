# Real screenshots for the carousel

Drop PNGs in this folder and the carousel uses them. Nothing else changes: each frame already
carries the drawn screen underneath, and a photo simply covers it once it has loaded. A file that
is not here leaves the drawing in place, so this can be filled in one screen at a time.

## Still needed (9/29 review)

| File | Why | Where it comes from |
|---|---|---|
| `live-dark.png`, `live-light.png` | The Live screen has no capture yet, so the carousel shows a drawing of it. The owner's 9/29 review read that drawing as "no bottom menu"; the drawing now carries the app's own bottom bar, but a real capture should replace it. | The phone, tour / Explore mode, Live tab, with the app's bottom bar in the picture (the same crop as `board-*.png`). |
| `car-launch-menu.png` | The Android Auto slide must show only what ships on launch day: the production car app (`CAR_FULL_SCOPE=false`), whose menu is **Charging Locations**, **Bookmarks** and, while the truck charges, **Charging**. Until this file exists the slide draws that menu. Never use a capture that shows the Live Dashboard grid, Journey or the Vehicle row: those are closed-testing only. | The Desktop Head Unit, running a **release (production-scope)** build, on the car app's home menu, ideally while a charge is live so the Charging row shows. 16:9 landscape (the DHU's 1920×1080 is right); one file, not per theme. Crop out the head unit's own app rail if it shows other apps. |

Not usable as they are: the earlier Desktop Head Unit captures were taken from the full-scope debug
build (Live Dashboard, Journey, Vehicle) and from a live account's map. A fresh capture from the
production-scope build in demo mode is the one to use.

## Names

`<screen>-<theme>.png` — one per screen, per theme:

```
board-dark.png    board-light.png
charge-dark.png   charge-light.png
live-dark.png     live-light.png
map-dark.png      map-light.png
report-dark.png   report-light.png
wear-dark.png     wear-light.png
car-launch-menu.png            (Android Auto: one file, both themes)
```

Both themes matter: the page follows the browser's preference, or the clock when it states none
(light 06:00–18:00, dark after), and a dark screenshot on the ivory page looks like a mistake. If
only one theme is available, supply the dark set — that is what most visitors will see in the
evening — and the drawings cover the other one.

Charge and Map cycle through several faces while they are centred. They look for a numbered file
first and fall back to the plain name above, so per-face photos are optional:

```
charge-1-…  charging now       map-1-…  chargers nearby
charge-2-…  plugged in, idle   map-2-…  a past drive
charge-3-…  session complete   map-3-…  navigating
charge-4-…  the session curve
```

## Shape

- Phone screens (board, charge, live, map, report): portrait, any height, **with the app's bottom
  bar at the bottom of the picture**. The phone frame is fitted to each picture once it loads (the
  frame is the screenshot plus a 6px bezel, nothing more), so the bottom bar always sits on the
  frame's bottom edge — whatever the crop, no strip is left under it. The current captures are 540
  wide and 804–990 tall; keep them 540 wide so the page stays light.
- `wear-*`: the watch face, square or round; it is masked to a circle.
- `car-launch-menu.png`: **landscape 16:9** — the Android Auto screen, not a phone. The car frame is
  16:9 and the picture covers it.

## Before taking them

Take them from a device in the app's **tutorial / demo mode**, not from a live account. Real screens
carry the home address, drive routes, charger locations and the VIN. The privacy policy discloses
those as *stored*; publishing them on the product page is a different promise, and once a PNG is on
the live site it is public and cached.

Anything that slips through anyway — a street name in a map screen, a plate, a charger that is the
driveway — crop it out before the file lands here.
