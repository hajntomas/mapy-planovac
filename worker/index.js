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
  const MAPY_API_BASE = 'https://api.mapy.cz/v1';
  
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
      // Parsování JSON těla požadavku
      const body = await request.json();
      const { start, end, waypoints = [] } = body;
  
      // Validace vstupů
      if (!start || !end) {
        return jsonResponse(
          { error: 'Start a end jsou povinné parametry' },
          400
        );
      }
  
      // Sestavení URL pro Mapy.cz Routing API
      const mapyUrl = new URL(`${MAPY_API_BASE}/routing`);
      mapyUrl.searchParams.set('start', start);
      mapyUrl.searchParams.set('end', end);
      
      // Přidání zastávek pokud existují
      if (waypoints.length > 0) {
        mapyUrl.searchParams.set('waypoints', waypoints.join('|'));
      }
      
      mapyUrl.searchParams.set('routeType', 'car_fast_traffic');
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
        const errorText = await response.text();
        console.error('Routing API error:', response.status, errorText);
        throw new Error(`Mapy.cz API error: ${response.status}`);
      }
  
      const data = await response.json();
      return jsonResponse(data);
  
    } catch (error) {
      console.error('Route error:', error);
      
      // Specifická chybová hláška pokud je problém s parsováním JSON
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