# 🗺️ Plánovač cest s Mapy.cz API

Moderní webová aplikace pro plánování automobilových cest s využitím Mapy.cz REST API, hostovaná na Cloudflare Pages s Cloudflare Worker jako bezpečným API proxy.

## 🎯 Funkce

- ✅ Plánování trasy s libovolným počtem zastávek
- ✅ Fixace času příjezdu na zastávky
- ✅ Nastavení doby přestávky na zastávkách
- ✅ Real-time našeptávač adres
- ✅ Vizualizace trasy na mapě (Leaflet + Mapy.cz tiles)
- ✅ Časový harmonogram s detaily
- ✅ Export do schránky a tisku
- ✅ Responzivní design (mobil, tablet, desktop)
- ✅ Offline detekce a error handling

## 🏗️ Architektura

```
GitHub Repository
    ↓ (auto-deploy)
Cloudflare Pages (frontend: HTML, CSS, JS)
    ↓ (API volání)
Cloudflare Worker (API proxy s API klíčem)
    ↓
Mapy.cz REST API
```

**Bezpečnostní model:**
- API klíč je uložen pouze v Cloudflare Worker environment variables
- Frontend volá Worker endpointy
- Worker přidává API klíč a volá Mapy.cz API
- API klíč NIKDY není v GitHubu nebo v kódu

## 📁 Struktura projektu

```
mapy-planovac/
├── frontend/
│   ├── index.html          # Frontend aplikace
│   ├── style.css           # Styly (responzivní)
│   └── script.js           # Frontend logika
│
├── worker/
│   └── index.js            # Cloudflare Worker (API proxy)
│
├── wrangler.toml           # Cloudflare konfigurace
├── .gitignore              # Git ignore
├── .dev.vars.example       # Příklad env variables
└── README.md               # Tato dokumentace
```

## 🚀 Deployment

### 1. Příprava

**Požadavky:**
- GitHub účet
- Cloudflare účet (zdarma)
- Mapy.cz API klíč (registrace na https://developer.mapy.cz/)

### 2. GitHub

1. Vytvořte nový repository na GitHubu
2. Pushněte tento kód:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mapy-planovac.git
git push -u origin main
```

### 3. Cloudflare Worker

**Instalace Wrangler CLI:**
```bash
npm install -g wrangler
```

**Přihlášení:**
```bash
wrangler login
```

**Nastavení API klíče:**
```bash
wrangler secret put MAPY_API_KEY
# Zadejte váš Mapy.cz API klíč
```

**Deploy Workeru:**
```bash
wrangler deploy
```

Po deployi si poznamenejte URL Workeru (např. `https://mapy-planovac-worker.YOUR_ACCOUNT.workers.dev`)

### 4. Cloudflare Pages

1. Přihlaste se do Cloudflare Dashboard
2. Přejděte na **Pages**
3. Klikněte **Create a project**
4. Připojte GitHub repository
5. Nastavte:
   - **Build directory:** `frontend`
   - **Build command:** (nechte prázdné)
6. Klikněte **Save and Deploy**

### 5. Konfigurace Worker URL

Po deployi Workeru upravte v souboru `frontend/script.js` řádek:

```javascript
const WORKER_URL = 'https://mapy-planovac-worker.YOUR_ACCOUNT.workers.dev';
```

Nahraďte `YOUR_ACCOUNT` vaším Cloudflare account jménem.

Commitněte a pushněte změnu na GitHub - Pages se automaticky aktualizují.

## 🔧 Lokální vývoj

### Worker

1. Vytvořte soubor `.dev.vars` (nekopíruje se do Gitu):
```
MAPY_API_KEY=your_actual_api_key
```

2. Spusťte Worker lokálně:
```bash
wrangler dev
```

### Frontend

Otevřete `frontend/index.html` v prohlížeči nebo použijte live server.

## 📚 API Dokumentace

Worker poskytuje 3 endpointy:

### GET /api/suggest
Našeptávač adres
- **Query parametry:** `query` (min. 2 znaky), `limit` (výchozí 10)
- **Příklad:** `/api/suggest?query=Praha&limit=10`

### GET /api/geocode
Převod adresy na souřadnice
- **Query parametry:** `query` (adresa)
- **Příklad:** `/api/geocode?query=Václavské náměstí, Praha`

### POST /api/route
Výpočet trasy
- **Body:** `{start: "lat,lon", end: "lat,lon", waypoints: ["lat,lon"]}`
- **Příklad:**
```json
{
  "start": "50.0755,14.4378",
  "end": "49.1951,16.6068",
  "waypoints": ["49.9484,15.2551"]
}
```

## 🛠️ Technologie

- **Frontend:** Vanilla JavaScript, Leaflet.js, Font Awesome
- **Backend:** Cloudflare Workers
- **API:** Mapy.cz REST API v1
- **Hosting:** Cloudflare Pages
- **Verzování:** GitHub

## 📝 Licence

Tento projekt je open-source. Mapy.cz API podléhá podmínkám použití Seznam.cz.

## 🔗 Odkazy

- [Mapy.cz API Dokumentace](https://developer.mapy.com/rest-api-mapy-cz/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Pages](https://developers.cloudflare.com/pages/)
- [Leaflet.js](https://leafletjs.com/)