# Det lille huset i Slipveien – fellesside

Én nettside som viser ledige datoer for huset i Bud fra **både FINN og Airbnb**,
pluss bilder og informasjon om huset og området.

## Slik henger det sammen

| Kilde | Hvordan den leses | Merknad |
|---|---|---|
| FINN | Serverfunksjonen henter annonsesiden og leser `__NEXT_DATA__`, der FINN legger hele tilgjengelighetstabellen | FINN har ingen offisiell iCal-eksport. Dette er en udokumentert kilde og kan i teorien endre seg. |
| Airbnb | Offisiell iCal-eksport fra vertskalenderen | Krever at du legger inn URL-en som miljøvariabel (se under) |

Filer:

```
public/index.html                  # hele nettsiden (norsk + engelsk)
netlify/lib/sources.mts            # henting og parsing av FINN + Airbnb
netlify/functions/availability.mts # GET /api/availability  → JSON til kalenderen
netlify/functions/finn-ical.mts    # GET /finn.ics          → FINN-kalenderen som iCal
netlify.toml
```

## Oppsett – ett steg du må gjøre selv

Airbnb-kalenderen kan bare leses med din personlige eksportlenke:

1. Logg inn på Airbnb → **Kalender** → velg annonsen
2. **Tilgjengelighet** → *Koble til en annen nettside* → **Eksporter kalender**
3. Kopier URL-en (den ser ut som `https://www.airbnb.com/calendar/ical/43412539.ics?s=…`)
4. Legg den inn på Netlify: *Site configuration → Environment variables* →
   nøkkel `AIRBNB_ICAL_URL`, merk den som **secret**
5. Kjør en ny deploy (eller *Clear cache and deploy*)

Uten denne variabelen fungerer siden fint, men kalenderen viser bare FINN-data
og sier ifra om at Airbnb ikke er koblet til.

## Bonus: la FINN blokkere datoer på Airbnb automatisk

Siden serverer FINN-kalenderen som en ekte iCal-feed på `/finn.ics`.
Lim den URL-en inn i Airbnb → **Kalender → Tilgjengelighet → Koble til en annen
nettside → Importer kalender**. Da blir datoer som er opptatt på FINN
automatisk sperret på Airbnb, og du unngår dobbeltbooking den veien.

(Motsatt vei – Airbnb inn i FINN – går dessverre ikke, siden FINN ikke støtter
import av eksterne kalendere. Der må du fortsatt blokkere manuelt, eller bruke
denne siden som fasit.)

## Vedlikehold

- Bilder og beskrivelse hentes live fra FINN-annonsen, så galleriet oppdaterer
  seg av seg selv når nye bilder legges ut. Siden har en innebygd reservekopi av
  17 bilder hvis FINN skulle være utilgjengelig.
- Tekstene om Bud og «praktisk info» ligger i språkordboken `T` nederst i
  `public/index.html` – én blokk for `no` og én for `en`.
- Svar fra `/api/availability` caches i 15 minutter på Netlify sitt CDN.
