/**
 * Cloudflare Worker - API Proxy pro Mapy.cz
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAPY_API_BASE = 'https://api.mapy.cz';

// Společné headers pro API požadavky - autentizace přes header
function apiHeaders(apiKey, accept = 'application/json') {
  return {
    'Accept': accept,
    'X-Mapy-Api-Key': apiKey,
  };
}

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

      // Diagnostický endpoint - otevřete v prohlížeči pro zjištění problémů
      if (path === '/api/debug' && request.method === 'GET') {
        return handleDebug(env.MAPY_API_KEY);
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

      // NOVÝ endpoint pro tiles
      if (path.startsWith('/tiles/') && request.method === 'GET') {
        return handleTiles(url, env.MAPY_API_KEY);
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
      headers: apiHeaders(apiKey),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Suggest API error:', response.status, text);
      throw new Error(`Mapy.cz API error: ${response.status} - ${text}`);
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
      headers: apiHeaders(apiKey),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Geocode API error:', response.status, text);
      throw new Error(`Mapy.cz API error: ${response.status} - ${text}`);
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

    const startCoords = start.split(',').map(c => c.trim());
    const startLon = startCoords[1];
    const startLat = startCoords[0];
    
    const endCoords = end.split(',').map(c => c.trim());
    const endLon = endCoords[1];
    const endLat = endCoords[0];

    console.log(`📍 Start: lat=${startLat}, lon=${startLon}`);
    console.log(`📍 End: lat=${endLat}, lon=${endLon}`);

    const mapyUrl = new URL(`${MAPY_API_BASE}/v1/routing/route`);
    
    mapyUrl.searchParams.set('start', `${startLon},${startLat}`);
    mapyUrl.searchParams.set('end', `${endLon},${endLat}`);
    
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
    console.log('🌐 API URL:', finalUrl);

    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: apiHeaders(apiKey),
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
        details: responseText
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

// Tiles proxy
async function handleTiles(url, apiKey) {
  try {
    // Očekáváme URL ve formátu: /tiles/z/x/y
    const pathParts = url.pathname.split('/').filter(p => p);

    if (pathParts.length !== 4 || pathParts[0] !== 'tiles') {
      return new Response('Invalid tiles path', { status: 400, headers: CORS_HEADERS });
    }

    const [, z, x, y] = pathParts;

    // Sestavit URL pro Mapy.cz - apikey v URL i headeru pro spolehlivost
    const mapyTileUrl = `${MAPY_API_BASE}/v1/maptiles/basic/256/${z}/${x}/${y}?apikey=${apiKey}`;

    // Stáhnout tile z Mapy.cz
    const response = await fetch(mapyTileUrl, {
      method: 'GET',
      headers: apiHeaders(apiKey, 'image/png'),
    });

    if (!response.ok) {
      console.error('Tiles error:', response.status);
      return new Response('Tile not found', { status: response.status, headers: CORS_HEADERS });
    }

    // Vrátit obrázek s CORS hlavičkami
    return new Response(response.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });

  } catch (error) {
    console.error('Tiles error:', error);
    return new Response('Tile error', { status: 500, headers: CORS_HEADERS });
  }
}

// Diagnostika - otestuje všechny API endpointy
async function handleDebug(apiKey) {
  const results = { timestamp: new Date().toISOString(), tests: {} };

  // Test 1: Suggest
  try {
    const suggestUrl = new URL(`${MAPY_API_BASE}/v1/suggest`);
    suggestUrl.searchParams.set('query', 'Praha');
    suggestUrl.searchParams.set('limit', '2');
    suggestUrl.searchParams.set('lang', 'cs');

    const suggestRes = await fetch(suggestUrl.toString(), {
      method: 'GET',
      headers: apiHeaders(apiKey),
    });
    const suggestText = await suggestRes.text();
    results.tests.suggest = {
      status: suggestRes.status,
      ok: suggestRes.ok,
      body: suggestText.substring(0, 500),
    };
  } catch (e) {
    results.tests.suggest = { error: e.message };
  }

  // Test 2: Geocode
  try {
    const geoUrl = new URL(`${MAPY_API_BASE}/v1/geocode`);
    geoUrl.searchParams.set('query', 'Brno');
    geoUrl.searchParams.set('lang', 'cs');

    const geoRes = await fetch(geoUrl.toString(), {
      method: 'GET',
      headers: apiHeaders(apiKey),
    });
    const geoText = await geoRes.text();
    results.tests.geocode = {
      status: geoRes.status,
      ok: geoRes.ok,
      body: geoText.substring(0, 500),
    };
  } catch (e) {
    results.tests.geocode = { error: e.message };
  }

  // Test 3: Suggest s apikey v query (fallback test)
  try {
    const suggestUrl2 = new URL(`${MAPY_API_BASE}/v1/suggest`);
    suggestUrl2.searchParams.set('query', 'Praha');
    suggestUrl2.searchParams.set('limit', '2');
    suggestUrl2.searchParams.set('lang', 'cs');
    suggestUrl2.searchParams.set('apikey', apiKey);

    const suggestRes2 = await fetch(suggestUrl2.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    const suggestText2 = await suggestRes2.text();
    results.tests.suggest_with_query_param = {
      status: suggestRes2.status,
      ok: suggestRes2.ok,
      body: suggestText2.substring(0, 500),
    };
  } catch (e) {
    results.tests.suggest_with_query_param = { error: e.message };
  }

  // Test 4: Tiles
  try {
    const tileUrl = `${MAPY_API_BASE}/v1/maptiles/basic/256/7/68/43`;
    const tileRes = await fetch(tileUrl, {
      method: 'GET',
      headers: apiHeaders(apiKey, 'image/png'),
    });
    results.tests.tiles = {
      status: tileRes.status,
      ok: tileRes.ok,
      contentType: tileRes.headers.get('content-type'),
    };
  } catch (e) {
    results.tests.tiles = { error: e.message };
  }

  results.apiBase = MAPY_API_BASE;
  results.authMethod = 'X-Mapy-Api-Key header';

  return jsonResponse(results);
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