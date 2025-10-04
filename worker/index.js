/**
 * Cloudflare Worker - API Proxy pro Mapy.cz
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
        return jsonResponse({ error: 'API klíč není nakonfigurován' }, 500);
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

      return jsonResponse({ error: 'Endpoint nenalezen' }, 404);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Interní chyba serveru', message: error.message }, 500);
    }
  },
};

async function handleSuggest(url, apiKey) {
  const query = url.searchParams.get('query');
  const limit = url.searchParams.get('limit') || '10';

  if (!query || query.trim().length < 2) {
    return jsonResponse({ error: 'Query musí mít alespoň 2 znaky' }, 400);
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
    return jsonResponse({ error: 'Chyba při našeptávání', message: error.message }, 500);
  }
}

async function handleGeocode(url, apiKey) {
  const query = url.searchParams.get('query');

  if (!query || query.trim().length === 0) {
    return jsonResponse({ error: 'Query nesmí být prázdný' }, 400);
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
    return jsonResponse({ error: 'Chyba při geokódování', message: error.message }, 500);
  }
}

async function handleRoute(request, apiKey) {
  try {
    const body = await request.json();
    console.log('📥 Request body:', JSON.stringify(body));
    
    const { start, end, waypoints = [] } = body;

    if (!start || !end) {
      return jsonResponse({ error: 'Start a end jsou povinné parametry' }, 400);
    }

    // Frontend posílá: "50.0755,14.4378" (lat,lon)
    // API chce: "14.4378,50.0755" (lon,lat)
    
    const startCoords = start.split(',').map(c => c.trim());
    const startLon = startCoords[1];
    const startLat = startCoords[0];
    
    const endCoords = end.split(',').map(c => c.trim());
    const endLon = endCoords[1];
    const endLat = endCoords[0];

    console.log(`📍 Start: lat=${startLat}, lon=${startLon}`);
    console.log(`📍 End: lat=${endLat}, lon=${endLon}`);

    // Vytvoření URL s parametry
    const mapyUrl = new URL(`${MAPY_API_BASE}/v1/routing/route`);
    
    // Unexploded formát: "lon,lat"
    mapyUrl.searchParams.set('start', `${startLon},${startLat}`);
    mapyUrl.searchParams.set('end', `${endLon},${endLat}`);
    
    // Waypoints - semicolon-separated "lon,lat;lon,lat"
    if (waypoints.length > 0) {
      const waypointsFormatted = waypoints.map(wp => {
        const coords = wp.split(',').map(c => c.trim());
        const wpLon = coords[1];
        const wpLat = coords[0];
        console.log(`📍 Waypoint: lat=${wpLat}, lon=${wpLon}`);
        return `${wpLon},${wpLat}`;
      }).join(';');
      
      mapyUrl.searchParams.set('waypoints', waypointsFormatted);
    }
    
    mapyUrl.searchParams.set('routeType', 'car_fast_traffic');
    mapyUrl.searchParams.set('lang', 'cs');
    mapyUrl.searchParams.set('format', 'geojson');
    mapyUrl.searchParams.set('apikey', apiKey);

    const finalUrl = mapyUrl.toString();
    console.log('🌐 API URL:', finalUrl.replace(apiKey, 'XXX'));

    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    console.log('📡 Response status:', response.status);
    console.log('📡 Response headers:', JSON.stringify([...response.headers.entries()]));

    const responseText = await response.text();
    console.log('📡 Response body:', responseText.substring(0, 500));

    if (!response.ok) {
      console.error('❌ Routing API error:', response.status);
      return jsonResponse({ 
        error: 'Chyba při výpočtu trasy', 
        message: `Mapy.cz API vratilo status ${response.status}`,
        details: responseText,
        debugUrl: finalUrl.replace(apiKey, 'XXX')
      }, response.status);
    }

    const data = JSON.parse(responseText);
    console.log('✅ Success! Route length:', data.length, 'meters');
    
    return jsonResponse(data);

  } catch (error) {
    console.error('💥 Route error:', error);
    console.error('💥 Error stack:', error.stack);
    
    if (error instanceof SyntaxError) {
      return jsonResponse({ error: 'Neplatný formát požadavku' }, 400);
    }
    
    return jsonResponse({ 
      error: 'Chyba při výpočtu trasy', 
      message: error.message,
      stack: error.stack
    }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}