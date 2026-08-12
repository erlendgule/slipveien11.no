/**
 * GET /api/availability
 * Slår sammen tilgjengelighet fra FINN-annonsen og Airbnb-kalenderen.
 * Helt selvstendig fil uten avhengigheter, slik at den også fungerer
 * ved manuell opplasting uten byggesteg.
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

/* ---------- FINN ---------- */
async function fetchFinn() {
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
  const info = swr["AVAILABILITY_INFO_" + FINN_CODE] || {};
  const obj = swr.objectDataKey || {};

  const days = {};
  for (const d of list) {
    if (d && typeof d.date === "string") days[d.date] = d.available !== false;
  }

  return {
    days,
    minNights: info.minRentalDuration ?? null,
    listing: {
      heading: obj.heading ?? null,
      facilities: obj.facilities ?? [],
      noOfBeds: obj.noOfBeds ?? null,
      noOfBedrooms: obj.noOfBedrooms ?? null,
      noOfBathrooms: obj.noOfBathrooms ?? null,
      images: (obj.images ?? []).map((i) => i && i.src).filter(Boolean),
    },
  };
}

/* ---------- Airbnb iCal ---------- */
function unfoldIcs(text) {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else out.push(line);
  }
  return out;
}

function icsDate(value) {
  const m = value.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Alt som ligger i Airbnb-feeden er opptatt – reservert eller manuelt sperret. */
function parseIcsBusy(text) {
  const busy = new Set();
  let start = null, end = null, inEvent = false;
  for (const line of unfoldIcs(text)) {
    if (line.startsWith("BEGIN:VEVENT")) { inEvent = true; start = end = null; continue; }
    if (!inEvent) continue;
    if (line.startsWith("END:VEVENT")) {
      inEvent = false;
      if (start && end) for (let d = start; d < end; d = addDays(d, 1)) busy.add(d);
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (key === "DTSTART") start = icsDate(value);
    else if (key === "DTEND") end = icsDate(value);
  }
  return busy;
}

async function fetchAirbnbBusy() {
  const url = Netlify.env.get("AIRBNB_ICAL_URL");
  if (!url) {
    const e = new Error("AIRBNB_ICAL_URL er ikke satt");
    e.code = "not_configured";
    throw e;
  }
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("Airbnb iCal svarte " + res.status);
  return parseIcsBusy(await res.text());
}

/* ---------- handler ---------- */
export default async (req) => {
  const url = new URL(req.url);
  const months = Math.min(24, Math.max(1, Number(url.searchParams.get("months") || 14)));

  const today = ymd(new Date());
  const horizonDate = new Date(today + "T00:00:00Z");
  horizonDate.setUTCMonth(horizonDate.getUTCMonth() + months, 1);
  const horizon = ymd(horizonDate);

  const [finnRes, airbnbRes] = await Promise.allSettled([fetchFinn(), fetchAirbnbBusy()]);

  const sources = {};
  let finnDays = {}, minNights = null, listing = null;

  if (finnRes.status === "fulfilled") {
    finnDays = finnRes.value.days;
    minNights = finnRes.value.minNights;
    listing = finnRes.value.listing;
    sources.finn = "ok";
  } else {
    sources.finn = "error";
  }

  let airbnbBusy = null;
  if (airbnbRes.status === "fulfilled") {
    airbnbBusy = airbnbRes.value;
    sources.airbnb = "ok";
  } else {
    sources.airbnb = airbnbRes.reason && airbnbRes.reason.code === "not_configured"
      ? "not_configured" : "error";
  }

  // 0 = ledig, 1 = opptatt, null = ukjent
  const days = {};
  for (let d = today; d < horizon; d = addDays(d, 1)) {
    const finn = sources.finn === "ok"
      ? (finnDays[d] === false ? 1 : finnDays[d] === true ? 0 : null)
      : null;
    const air = airbnbBusy ? (airbnbBusy.has(d) ? 1 : 0) : null;
    days[d] = [finn, air];
  }

  return Response.json(
    { updated: new Date().toISOString(), from: today, to: horizon, minNights, sources, listing, days },
    {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
};

export const config = { path: "/api/availability" };
