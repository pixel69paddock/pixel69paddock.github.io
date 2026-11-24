# Daily Derby site

The link-in-bio page for [@dailyderby_horse](https://www.instagram.com/dailyderby_horse/). It's a static site with no build step: `index.html` reads `data/derby.json`.

**Sections:** find your horse · rankings (medal table, most wins, most races) · race history · Hall of Fame · sponsor spots · how it works.

## Updating after each race

**After every posted race day, run `shorts-pipeline/scripts/publish_results.py --day N --reel <shortcode>` (dry run, then `--write --push`).** It adds the race to `races[]`, recomputes every horse's races and medals, and moves `nextRace` on; the standings and points come from `races[]`, so this updates the rankings. The 5-hourly check-in runs it automatically if a posted race is missing.

Edit `data/derby.json`, then commit and push. GitHub Pages republishes within about a minute.

| Field | What to change |
|---|---|
| `updated` | Today's date, `YYYY-MM-DD` |
| `latestReel` | Link to the newest reel. The "Enter the next race" button points here |
| `nextRace` | `day`, `date`, and `entrants`: every current follower plus everyone who liked a reel in the last 48 hours, without the @ (a like or a follow locks you in; like-only horses carry `"via": "like"`). The check-in (every 5 hours) updates this and pushes it |
| `races[]` | Add one per race: `day`, `date`, `title`, `track`, `runners`, `reel`, `results: [{handle, place}]` |
| `horses[]` | One per entrant: `handle`, `races` (count), `medals: [{day, place}]` for 1st–3rd, optional `status: "removed"` |
| `sponsorSpots[]` | Set `status` to `taken` and `sponsor` to the brand name once a spot is agreed |
| `stable` | The 10,000-stall stable. Stalls are followers from `nextRace.entrants` (horses without `via: "like"`), numbered in follow order. Set `name` once the stable is named; `nameLeaders[]` (`name`, `by`, `likes`) and `nameVoteAsOf` feed the "Name the stable" card |
| `horses[].name` | Optional horse name (max 18 chars) from a `HORSE dddd Name` comment, set by the hourly look sync. Shown on the standings and medal table as NAME over @handle, and in race boards |

- **Removal requests:** set the horse's `status` to `"removed"`. It disappears from search, rankings and the stable count. Also remove the handle from `nextRace.entrants`.
- **Handles:** always copy handles from the check-in logs (`shorts-pipeline/content/daily/roster.csv`). Never type them by hand.
- **Sponsor hotspots:** `x`, `y`, `w` and `h` are percentages of `assets/k2_track.png`. Spots without them show only in the list.

## Local preview

```
python -m http.server 8765
```
Then open http://localhost:8765. Opening `index.html` directly doesn't work, because the browser blocks loading `data/derby.json` from a file.
