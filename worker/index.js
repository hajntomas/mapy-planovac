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
 * 
 * @param {URL} url - URL objektu s query parametry
 * @param {string} apiKey - Mapy.cz API klíč
 * @returns {Response}
 */
async function handleSuggest(url, apiKey) {
  const query = url.searchParams.get('query');
  const limit = url.searchParams.get('limit') || '10';

  // Validace vstupů
  if (!query || query.trim().length < 2) {
    return jsonResponse(
      { error: 'Query musí mít alespoň 2 znaky' },
      400
    );
  }

  try {
    // Sestavení URL pro Mapy.cz Suggest API
    const mapyUrl = new URL(`${MAPY_API_BASE}/suggest`);
    mapyUrl.searchParams.set('query', query.trim());
    mapyUrl.searchParams.set('limit', limit);
    mapyUrl.searchParams.set('lang', 'cs');
    mapyUrl.searchParams.set('apikey', apiKey);

    // Volání Mapy.cz API
    const response = await fetch(mapyUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
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
 * 
 * @param {URL} url - URL objekt s query parametry
 * @param {string} apiKey - Mapy.cz API klíč
 * @returns {Response}
 */
async function handleGeocode(url, apiKey) {
  const query = url.searchParams.get('query');

  // Validace vstupů
  if (!query || query.trim().length === 0) {
    return jsonResponse(
      { error: 'Query nesmí být prázdný' },
      400
    );
  }

  try {
    // Sestavení URL pro Mapy.cz Geocode API
    const mapyUrl = new URL(`${MAPY_API_BASE}/geocode`);
    mapyUrl.searchParams.set('query', query.trim());
    mapyUrl.searchParams.set('lang', 'cs');
    mapyUrl.searchParams.set('apikey', apiKey);

    // Volání Mapy.cz API
    const response = await fetch(mapyUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
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
 * 
 * @param {Request} request - Request objekt
 * @param {string} apiKey - Mapy.cz API klíč
 * @returns {Response}
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

    // OPRAVA: Mapy.cz chce souřadnice jako lon,lat (ne lat,lon)
    // Frontend posílá: "50.0755,14.4378" (Praha: lat,lon)
    // Musíme převést na: "14.4378,50.0755" (Praha: lon,lat)
    
    const startCoords = start.split(',');
    const startLonLat = `${startCoords[1].trim()},${startCoords[0].trim()}`;
    
    const endCoords = end.split(',');
    const endLonLat = `${endCoords[1].trim()},${endCoords[0].trim()}`;

    // Sestavení URL - zkusíme /plan-route
    const mapyUrl = new URL(`${MAPY_API_BASE}/plan-route`);
    mapyUrl.searchParams.set('start', startLonLat);
    mapyUrl.searchParams.set('end', endLonLat);
    
    // Waypoints - také převést na lon,lat a použít ; jako oddělovač
    if (waypoints.length > 0) {
      const waypointsLonLat = waypoints.map(wp => {
        const coords = wp.split(',');
        return `${coords[1].trim()},${coords[0].trim()}`;
      });
      mapyUrl.searchParams.set('waypoints', waypointsLonLat.join(';'));
    }
    
    mapyUrl.searchParams.set('routeType', 'car_fast_traffic');
    mapyUrl.searchParams.set('lang', 'cs');
    mapyUrl.searchParams.set('format', 'geojson');
    mapyUrl.searchParams.set('apikey', apiKey);

    console.log('Calling Mapy.cz routing API:', mapyUrl.toString());

    const response = await fetch(mapyUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log('Mapy.cz response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Routing API error:', response.status, errorText);
      return jsonResponse(
        { 
          error: 'Chyba při výpočtu trasy', 
          message: `Mapy.cz API error: ${response.status}`,
          details: errorText
        },
        response.status
      );
    }

    const data = await response.json();
    return jsonResponse(data);

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
 * 
 * @param {Object} data - Data pro response
 * @param {number} status - HTTP status kód (default: 200)
 * @returns {Response}
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