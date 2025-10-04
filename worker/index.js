/**
 * Cloudflare Worker - API Proxy pro Mapy.cz
 * 
 * Tento Worker slouží jako bezpečný prostředník mezi frontendem a Mapy.cz API.
 * API klíč je uložen v environment variables a nikdy není vystaven klientovi.
 * 
 * Endpointy:
 * - GET  /api/suggest?query=Praha&limit=10
 * - GET  /api/geocode?query=Václavské náměstí, Praha
 * - POST /api/route (body: {start, end, waypoints})
 */

// CORS headers pro povolení volání z frontendu
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Základní URL pro Mapy.cz API
const MAPY_API_BASE = 'https://api.mapy.com/v1';

// Možné routing endpointy - zkusíme postupně
const ROUTING_ENDPOINTS = [
  'plan-route',
  'routing', 
  'route',
  'routes',
  'directions'
];

/**
 * Hlavní handler Workeru
 */
export default {
  async fetch(request, env, ctx) {
    // Zpracování OPTIONS požadavků (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Kontrola, zda je API klíč nastaven
      if (!env.MAPY_API_KEY) {
        return jsonResponse(
          { error: 'API klíč není nakonfigurován' },
          500
        );
      }

      // Routing na jednotlivé endpointy
      if (path === '/api/suggest' && request.method === 'GET') {
        return handleSuggest(url, env.MAPY_API_KEY);
      }

      if (path === '/api/geocode' && request.method === 'GET') {
        return handleGeocode(url, env.MAPY_API_KEY);
      }

      if (path === '/api/route' && request.method === 'POST') {
        return handleRoute(request, env.MAPY_API_KEY);
      }

      // Neznámý endpoint
      return jsonResponse(
        { error: 'Endpoint nenalezen' },
        404
      );

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(
        { error: 'Interní chyba serveru', message: error.message },
        500
      );
    }
  },
};

/**
 * Handler pro našeptávač adres (Suggest API)
 */
async function handleSuggest(url, apiKey) {
  const query = url.searchParams.get('query');
  const limit = url.searchParams.get('limit') || '10';

  if (!query || query.trim().length < 2) {
    return jsonResponse(
      { error: 'Query musí mít alespoň 2 znaky' },
      400
    );
  }

  try {
    const mapyUrl = new URL(`${MAPY_API_BASE}/suggest`);
    mapyUrl.searchParams.set('query', query.trim());
    mapyUrl.searchParams.set('limit', limit);
    mapyUrl.searchParams.set('lang', 'cs');
    mapyUrl.searchParams.set('apikey', apiKey);

    const response = await fetch(mapyUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Mapy.cz API error: ${response.status}`);
    }

    const data = await response.json();
    return jsonResponse(data);

  } catch (error) {
    console.error('Suggest error:', error);
    return jsonResponse(
      { error: 'Chyba při našeptávání', message: error.message },
      500
    );
  }
}

/**
 * Handler pro převod adresy na souřadnice (Geocode API)
 */
async function handleGeocode(url, apiKey) {
  const query = url.searchParams.get('query');

  if (!query || query.trim().length === 0) {
    return jsonResponse(
      { error: 'Query nesmí být prázdný' },
      400
    );
  }

  try {
    const mapyUrl = new URL(`${MAPY_API_BASE}/geocode`);
    mapyUrl.searchParams.set('query', query.trim());
    mapyUrl.searchParams.set('lang', 'cs');
    mapyUrl.searchParams.set('apikey', apiKey);

    const response = await fetch(mapyUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Mapy.cz API error: ${response.status}`);
    }

    const data = await response.json();
    return jsonResponse(data);

  } catch (error) {
    console.error('Geocode error:', error);
    return jsonResponse(
      { error: 'Chyba při geokódování', message: error.message },
      500
    );
  }
}

/**
 * Handler pro výpočet trasy (Routing API)
 * ZKUSÍ POSTUPNĚ VŠECHNY MOŽNÉ ENDPOINTY
 */
async function handleRoute(request, apiKey) {
  try {
    const body = await request.json();
    const { start, end, waypoints = [] } = body;

    if (!start || !end) {
      return jsonResponse(
        { error: 'Start a end jsou povinné parametry' },
        400
      );
    }

    // Převod souřadnic z lat,lon na lon,lat
    const startCoords = start.split(',');
    const startLonLat = `${startCoords[1].trim()},${startCoords[0].trim()}`;
    
    const endCoords = end.split(',');
    const endLonLat = `${endCoords[1].trim()},${endCoords[0].trim()}`;

    // Waypoints
    let waypointsParam = null;
    if (waypoints.length > 0) {
      const waypointsLonLat = waypoints.map(wp => {
        const coords = wp.split(',');
        return `${coords[1].trim()},${coords[0].trim()}`;
      });
      waypointsParam = waypointsLonLat.join(';');
    }

    // ZKUSÍME POSTUPNĚ VŠECHNY MOŽNÉ ENDPOINTY
    let lastError = null;
    
    for (const endpoint of ROUTING_ENDPOINTS) {
      try {
        console.log(`Trying endpoint: ${endpoint}`);
        
        const mapyUrl = new URL(`${MAPY_API_BASE}/${endpoint}`);
        mapyUrl.searchParams.set('start', startLonLat);
        mapyUrl.searchParams.set('end', endLonLat);
        
        if (waypointsParam) {
          mapyUrl.searchParams.set('waypoints', waypointsParam);
        }
        
        mapyUrl.searchParams.set('routeType', 'car_fast_traffic');
        mapyUrl.searchParams.set('lang', 'cs');
        mapyUrl.searchParams.set('format', 'geojson');
        mapyUrl.searchParams.set('apikey', apiKey);

        console.log(`Calling: ${mapyUrl.toString()}`);

        const response = await fetch(mapyUrl.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        console.log(`Endpoint ${endpoint} returned: ${response.status}`);

        // Pokud není 404, vrátíme odpověď (ať už úspěšnou nebo chybovou)
        if (response.status !== 404) {
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Routing API error on ${endpoint}:`, response.status, errorText);
            return jsonResponse(
              { 
                error: 'Chyba při výpočtu trasy', 
                message: `Mapy.cz API error: ${response.status}`,
                endpoint: endpoint,
                details: errorText
              },
              response.status
            );
          }

          const data = await response.json();
          console.log(`SUCCESS with endpoint: ${endpoint}`);
          
          // Přidáme info o správném endpointu do odpovědi
          return jsonResponse({
            ...data,
            _debug: { correctEndpoint: endpoint }
          });
        }
        
        // 404 - zkusíme další endpoint
        lastError = `Endpoint ${endpoint} not found (404)`;
        
      } catch (error) {
        console.error(`Error trying endpoint ${endpoint}:`, error);
        lastError = error.message;
        // Pokračujeme na další endpoint
      }
    }

    // Žádný endpoint nefungoval
    return jsonResponse(
      { 
        error: 'Routing endpoint nenalezen',
        message: 'Zkusili jsme všechny známé endpointy, ale žádný nefunguje.',
        triedEndpoints: ROUTING_ENDPOINTS,
        lastError: lastError,
        note: 'Kontaktujte podporu Mapy.cz pro zjištění správného endpointu.'
      },
      404
    );

  } catch (error) {
    console.error('Route error:', error);
    
    if (error instanceof SyntaxError) {
      return jsonResponse(
        { error: 'Neplatný formát požadavku' },
        400
      );
    }
    
    return jsonResponse(
      { error: 'Chyba při výpočtu trasy', message: error.message },
      500
    );
  }
}

/**
 * Pomocná funkce pro vytvoření JSON response s CORS headers
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}