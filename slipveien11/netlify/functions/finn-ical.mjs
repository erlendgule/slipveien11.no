/**
 * GET /finn.ics
 * FINN har ingen iCal-eksport. Denne funksjonen lager en, slik at Airbnb kan
 * importere FINN-kalenderen og sperre de datoene automatisk.
 */

const FINN_CODE = "188449276";
const FINN_URL =
  `https://www.finn.no/reise/feriehus-hytteutleie/ad.html?finnkode=${FINN_CODE}`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const ymd = (d) => d.toISOString().slice(0, 10);
function addDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

async function fetchFinnDays() {
  const res = await fetch(FINN_URL, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error("FINN svarte " + res.status);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Fant ikke __NEXT_DATA__ på FINN-siden");
  const data = JSON.parse(m[1]);
  const swr = (data && data.props && data.props.pageProps &&
    data.props.pageProps.swrFallback) || {};
  const list = swr.availabilityPerDateKey || [];
  const days = {};
  for (const d of list) {
    if (d && typeof d.date === "string") days[d.date] = d.available !== false;
  }
  return days;
}

export default async () => {
  let days;
  try {
    days = await fetchFinnDays();
  } catch (err) {
    return new Response("Kunne ikke lese FINN-kalenderen: " + err.message, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Slå sammenhengende opptatte dager til perioder
  const dates = Object.keys(days).sort();
  const blocks = [];
  let start = null, prev = null;
  for (const d of dates) {
    if (days[d] === false) {
      if (start === null) start = d;
      else if (prev && addDays(prev, 1) !== d) {
        blocks.push([start, addDays(prev, 1)]);
        start = d;
      }
      prev = d;
    } else if (start !== null && prev !== null) {
      blocks.push([start, addDays(prev, 1)]);
      start = null; prev = null;
    }
  }
  if (start !== null && prev !== null) blocks.push([start, addDays(prev, 1)]);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Slipveien 11//FINN-eksport//NO",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Det lille huset i Slipveien - FINN",
  ];
  for (const [from, to] of blocks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:finn-${from}-${to}@slipveien`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${from.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${to.replace(/-/g, "")}`,
      "SUMMARY:Opptatt (FINN)",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, s-maxage=900",
    },
  });
};

export const config = { path: "/finn.ics" };
