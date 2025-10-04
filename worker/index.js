/**
 * Cloudflare Worker - API Proxy pro Mapy.cz
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// OPRAVA: Base URL bez /v1
const MAPY_API_BASE = 'https://api.mapy.com';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (!env.MAPY_API_KEY) {
        return jsonResponse(
          { error: 'API klíč není nakonfigurován' },
          500
        );
      }

      if (path === '/api/suggest' && request.method === 'GET') {
        return handleSuggest(url, env.MAPY_API_KEY);
      }

      if (path === '/api/geocode' && request.method === 'GET') {
        return handleGeocode(url, env.MAPY_API_KEY);
      }

      if (path === '/api/route' && request.method === 'POST') {
        return handleRoute(request, env.MAPY_API_KEY);
      }

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
    const mapyUrl = new URL(`${MAPY_API_BASE}/v1/suggest`);
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

async function handleGeocode(url, apiKey) {
  const query = url.searchParams.get('query');

  if (!query || query.trim().length === 0) {
    return jsonResponse(
      { error: 'Query nesmí být prázdný' },
      400
    );
  }

  try {
    const mapyUrl = new URL(`${MAPY_API_BASE}/v1/geocode`);
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

    // OPRAVA: Převod z lat,lon na lon,lat
    const startCoords = start.split(',');
    const startLonLat = `${startCoords[1].trim()},${startCoords[0].trim()}`;
    
    const endCoords = end.split(',');
    const endLonLat = `${endCoords[1].trim()},${endCoords[0].trim()}`;

    // SPRÁVNÝ ENDPOINT: /v1/routing/route
    const mapyUrl = new URL(`${MAPY_API_BASE}/v1/routing/route`);
    mapyUrl.searchParams.set('start', startLonLat);
    mapyUrl.searchParams.set('end', endLonLat);
    
    // Waypoints - převést a použít semicolon
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
      headers: { 'Accept': 'application/json' },
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}