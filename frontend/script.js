/**
 * Plánovač cest - Mapy.cz
 * Hlavní JavaScript logika
 */

// ===== KONFIGURACE =====
// DŮLEŽITÉ: Po deployi Workeru změňte tuto URL na vaši Worker URL!
const WORKER_URL = 'https://mapy-planovac-worker.hajn-tomas.workers.dev';

// ===== GLOBÁLNÍ PROMĚNNÉ =====
let map = null;
let routeLayer = null;
let markersLayer = null;
let waypointCounter = 0;
let debounceTimer = null;
let isOnline = navigator.onLine;

// Uložení dat pro export
let routeData = null;
let scheduleData = null;

// ===== INICIALIZACE =====
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initEventListeners();
  checkOnlineStatus();
  setDefaultDepartureTime();
});

// ===== MAPA - LEAFLET + MAPY.CZ TILES =====
function initMap() {
  // Vytvoření mapy
  map = L.map('map').setView([49.8175, 15.4730], 7); // Střed ČR
  
  // Mapy.cz tiles
L.tileLayer('https://api.mapy.com/v1/maptiles/basic/256/{z}/{x}/{y}?apikey=Y1lHxkYBW0MfbJZnDFUR3rOrDePUgIcpnDUktxngjA4', {
  attribution: '&copy; <a href="https://mapy.com">Mapy.com</a>',
  maxZoom: 19
}).addTo(map);
  
  // Vrstvy pro markery a trasu
  markersLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

// ===== EVENT LISTENERS =====
function initEventListeners() {
  // Formulář
  document.getElementById('routeForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('resetForm').addEventListener('reset', handleReset);
  document.getElementById('addWaypoint').addEventListener('click', addWaypoint);
  
  // Autocomplete pro start a cíl
  setupAutocomplete('start', 'startAutocomplete');
  setupAutocomplete('end', 'endAutocomplete');
  
  // Export akce
  document.getElementById('copyToClipboard').addEventListener('click', copyToClipboard);
  document.getElementById('printSchedule').addEventListener('click', printSchedule);
  document.getElementById('openInMapy').addEventListener('click', openInMapy);
  
  // Sidebar toggle (mobil)
  document.getElementById('openSidebar').addEventListener('click', openSidebar);
  document.getElementById('closeSidebar').addEventListener('click', closeSidebar);
  
  // Online/Offline detekce
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
}

// ===== NASTAVENÍ VÝCHOZÍHO ČASU =====
function setDefaultDepartureTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('departureTime').value = `${hours}:${minutes}`;
}

// ===== AUTOCOMPLETE - NAŠEPTÁVAČ ADRES =====
function setupAutocomplete(inputId, resultsId) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // Zrušení předchozího timeru
    clearTimeout(debounceTimer);
    
    // Skrytí výsledků pokud je query příliš krátké
    if (query.length < 2) {
      results.classList.remove('active');
      return;
    }
    
    // Debounce 400ms
    debounceTimer = setTimeout(() => {
      fetchSuggestions(query, results, input);
    }, 400);
  });
  
  // Zavření autocomplete při kliknutí mimo
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.classList.remove('active');
    }
  });
}

// ===== NAŠEPTÁVAČ - API VOLÁNÍ =====
async function fetchSuggestions(query, resultsElement, inputElement) {
  if (!isOnline) {
    showNotification('Jste offline. Připojte se k internetu.', 'warning');
    return;
  }
  
  try {
    const response = await fetchWithTimeout(
      `${WORKER_URL}/api/suggest?query=${encodeURIComponent(query)}&limit=10`,
      { method: 'GET' },
      10000
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // DOČASNÉ LOGOVÁNÍ - zjistíme strukturu
    console.log('🔍 Celá odpověď:', data);
    if (data.items && data.items.length > 0) {
      console.log('🔍 První položka:', data.items[0]);
      console.log('🔍 Struktura první položky:', JSON.stringify(data.items[0], null, 2));
    }
    
    // Zobrazení výsledků
    if (data.items && data.items.length > 0) {
      displaySuggestions(data.items, resultsElement, inputElement);
    } else {
      resultsElement.innerHTML = '<div class="autocomplete-item">Žádné výsledky</div>';
      resultsElement.classList.add('active');
    }
    
  } catch (error) {
    console.error('Suggest error:', error);
    showNotification('Chyba při načítání návrhů adres.', 'error');
  }
}

// ===== ZOBRAZENÍ NÁVRHŮ =====
function displaySuggestions(items, resultsElement, inputElement) {
  resultsElement.innerHTML = '';
  
  items.forEach(item => {
    // Přeskočit položky bez souřadnic
    if (!item.position || !item.position.lat || !item.position.lon) {
      return;
    }
    
    const div = document.createElement('div');
    div.className = 'autocomplete-item';
    
    // Ikona podle typu
    const icon = getIconForType(item.type);
    
    // Zvýraznění hledaného textu
    const query = inputElement.value.toLowerCase();
    const name = item.name || '';
    const label = item.label || '';
    const location = item.location || '';
    
    const highlightedName = name.replace(
      new RegExp(query, 'gi'),
      match => `<strong>${match}</strong>`
    );
    
    // Sestavení zobrazení pro našeptávač
    let displayText = `<i class="fas ${icon}"></i> ${highlightedName}`;
    if (label) {
      displayText += ` <span class="item-label">${label}</span>`;
    }
    if (location) {
      displayText += ` <span class="item-location">${location}</span>`;
    }
    
    div.innerHTML = displayText;
    
    // Sestavení plné adresy pro input
    let fullAddress = name;
    
    // Pro firmy (POI) přidat location s plnou adresou
    if (item.type === 'poi' && location) {
      fullAddress = `${name}, ${location}`;
    }
    // Pro adresy přidat location s městem
    else if (item.type === 'regional.address' && location) {
      fullAddress = `${name}, ${location}`;
    }
    // Pro města jen název (location je jen "Česko")
    
    // Kliknutí na návrh
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      inputElement.value = fullAddress;
      inputElement.dataset.coords = `${item.position.lat},${item.position.lon}`;
      resultsElement.classList.remove('active');
      resultsElement.innerHTML = '';
    });
    
    resultsElement.appendChild(div);
  });
  
  // Pokud nezbyla žádná položka se souřadnicemi
  if (resultsElement.children.length === 0) {
    resultsElement.innerHTML = '<div class="autocomplete-item">Žádné výsledky</div>';
  }
  
  resultsElement.classList.add('active');
}

// ===== IKONA PODLE TYPU =====
function getIconForType(type) {
  if (!type) return 'fa-map-marker-alt';
  
  if (type.startsWith('poi')) {
    // POI - firmy, obchody, atd.
    if (type.includes('bus') || type.includes('tram') || type.includes('trolleybus')) {
      return 'fa-bus'; // Zastávky
    }
    return 'fa-building'; // Firmy/POI
  } else if (type.includes('address')) {
    return 'fa-home'; // Adresy
  } else if (type.includes('municipality') || type.includes('region')) {
    return 'fa-city'; // Města/obce
  }
  
  return 'fa-map-marker-alt'; // Výchozí
}

// ===== IKONA PODLE TYPU =====
function getIconForType(type) {
  if (!type) return 'fa-map-marker-alt';
  
  if (type.startsWith('poi')) {
    // POI - firmy, obchody, atd.
    if (type.includes('bus') || type.includes('tram') || type.includes('trolleybus')) {
      return 'fa-bus'; // Zastávky
    }
    return 'fa-building'; // Firmy/POI
  } else if (type.includes('address')) {
    return 'fa-home'; // Adresy
  } else if (type.includes('municipality') || type.includes('region')) {
    return 'fa-city'; // Města/obce
  }
  
  return 'fa-map-marker-alt'; // Výchozí
}

// ===== IKONA PODLE TYPU =====
function getIconForType(type) {
  if (!type) return 'fa-map-marker-alt';
  
  if (type.startsWith('poi')) {
    // POI - firmy, obchody, atd.
    if (type.includes('bus') || type.includes('tram') || type.includes('trolleybus')) {
      return 'fa-bus'; // Zastávky
    }
    return 'fa-building'; // Firmy/POI
  } else if (type.includes('address')) {
    return 'fa-home'; // Adresy
  } else if (type.includes('municipality') || type.includes('region')) {
    return 'fa-city'; // Města/obce
  }
  
  return 'fa-map-marker-alt'; // Výchozí
}

// ===== PŘIDÁNÍ ZASTÁVKY =====
function addWaypoint() {
  waypointCounter++;
  const container = document.getElementById('waypointsContainer');
  
  const waypointDiv = document.createElement('div');
  waypointDiv.className = 'waypoint-group';
  waypointDiv.dataset.waypointId = waypointCounter;
  
  waypointDiv.innerHTML = `
    <div class="waypoint-header">
      <h3><i class="fas fa-map-pin"></i> Zastávka ${waypointCounter}</h3>
      <button type="button" class="remove-waypoint" onclick="removeWaypoint(${waypointCounter})">
        <i class="fas fa-trash"></i> Odebrat
      </button>
    </div>
    
    <div class="form-group">
      <label>Adresa</label>
      <div class="autocomplete-wrapper">
        <input 
          type="text" 
          id="waypoint-${waypointCounter}" 
          placeholder="Zadejte adresu zastávky..."
          autocomplete="off"
          required
        >
        <div class="autocomplete-results" id="waypoint-${waypointCounter}-autocomplete"></div>
      </div>
    </div>
    
    <div class="waypoint-options">
      <div class="checkbox-group">
        <input type="checkbox" id="waypoint-${waypointCounter}-fixed">
        <label for="waypoint-${waypointCounter}-fixed">Fixovat čas příjezdu</label>
      </div>
    </div>
    
    <div class="waypoint-options">
      <div class="time-group">
        <label>Čas příjezdu (pokud fixován)</label>
        <input type="time" id="waypoint-${waypointCounter}-time" disabled>
      </div>
      <div class="break-group">
        <label>Přestávka (minuty)</label>
        <input type="number" id="waypoint-${waypointCounter}-break" value="30" min="0">
      </div>
    </div>
  `;
  
  container.appendChild(waypointDiv);
  
  // Setup autocomplete pro novou zastávku
  setupAutocomplete(`waypoint-${waypointCounter}`, `waypoint-${waypointCounter}-autocomplete`);
  
  // Event listener pro checkbox fixace času
  const checkbox = document.getElementById(`waypoint-${waypointCounter}-fixed`);
  const timeInput = document.getElementById(`waypoint-${waypointCounter}-time`);
  
  checkbox.addEventListener('change', (e) => {
    timeInput.disabled = !e.target.checked;
    if (!e.target.checked) {
      timeInput.value = '';
    }
  });
}

// ===== ODEBRÁNÍ ZASTÁVKY =====
function removeWaypoint(id) {
  const waypoint = document.querySelector(`[data-waypoint-id="${id}"]`);
  if (waypoint) {
    waypoint.remove();
  }
}

// ===== ZPRACOVÁNÍ FORMULÁŘE =====
async function handleFormSubmit(e) {
  e.preventDefault();
  
  if (!isOnline) {
    showNotification('Jste offline. Připojte se k internetu.', 'warning');
    return;
  }
  
  // Validace
  const validation = validateForm();
  if (!validation.valid) {
    showNotification(validation.message, 'error');
    return;
  }
  
  // Zobrazení loaderu
  showLoader(true);
  
  try {
    // Získání dat z formuláře
    const formData = getFormData();
    
    // Geokódování adres (pokud nemají souřadnice)
    await geocodeAddresses(formData);
    
    // Výpočet trasy
    const route = await calculateRoute(formData);
    
    // Výpočet časového harmonogramu
    const schedule = calculateSchedule(formData, route);
    
    // Uložení dat pro export
    routeData = route;
    scheduleData = schedule;
    
    // Zobrazení výsledků
    displayResults(schedule);
    
    // Vykreslení na mapě
    displayRouteOnMap(route, formData);
    
    showNotification('Trasa úspěšně naplánována!', 'success');
    
  } catch (error) {
    console.error('Route calculation error:', error);
    showNotification(error.message || 'Chyba při výpočtu trasy.', 'error');
  } finally {
    showLoader(false);
  }
}

// ===== VALIDACE FORMULÁŘE =====
function validateForm() {
  const start = document.getElementById('start').value.trim();
  const end = document.getElementById('end').value.trim();
  const departureTime = document.getElementById('departureTime').value;
  
  if (!start) {
    return { valid: false, message: 'Zadejte prosím adresu startu.' };
  }
  
  if (!end) {
    return { valid: false, message: 'Zadejte prosím adresu cíle.' };
  }
  
  if (!departureTime) {
    return { valid: false, message: 'Zadejte prosím čas odjezdu.' };
  }
  
  // Validace zastávek
  const waypoints = document.querySelectorAll('.waypoint-group');
  let previousTime = timeToMinutes(departureTime);
  
  for (let i = 0; i < waypoints.length; i++) {
    const id = waypoints[i].dataset.waypointId;
    const address = document.getElementById(`waypoint-${id}`).value.trim();
    const isFixed = document.getElementById(`waypoint-${id}-fixed`).checked;
    const fixedTime = document.getElementById(`waypoint-${id}-time`).value;
    const breakMinutes = parseInt(document.getElementById(`waypoint-${id}-break`).value);
    
    if (!address) {
      return { valid: false, message: `Zadejte prosím adresu zastávky ${i + 1}.` };
    }
    
    if (breakMinutes < 0) {
      return { valid: false, message: `Přestávka na zastávce ${i + 1} nesmí být záporná.` };
    }
    
    if (isFixed) {
      if (!fixedTime) {
        return { valid: false, message: `Zadejte fixovaný čas pro zastávku ${i + 1}.` };
      }
      
      const fixedMinutes = timeToMinutes(fixedTime);
      
      if (fixedMinutes <= previousTime) {
        return { 
          valid: false, 
          message: `Fixovaný čas zastávky ${i + 1} (${fixedTime}) musí být po předchozím času (${minutesToTime(previousTime)}).` 
        };
      }
      
      previousTime = fixedMinutes + breakMinutes;
    }
  }
  
  return { valid: true };
}

// ===== ZÍSKÁNÍ DAT Z FORMULÁŘE =====
function getFormData() {
  const data = {
    start: {
      address: document.getElementById('start').value.trim(),
      coords: document.getElementById('start').dataset.coords || null
    },
    end: {
      address: document.getElementById('end').value.trim(),
      coords: document.getElementById('end').dataset.coords || null
    },
    departureTime: document.getElementById('departureTime').value,
    waypoints: []
  };
  
  // Zastávky
  const waypointGroups = document.querySelectorAll('.waypoint-group');
  waypointGroups.forEach(group => {
    const id = group.dataset.waypointId;
    const waypoint = {
      address: document.getElementById(`waypoint-${id}`).value.trim(),
      coords: document.getElementById(`waypoint-${id}`).dataset.coords || null,
      isFixed: document.getElementById(`waypoint-${id}-fixed`).checked,
      fixedTime: document.getElementById(`waypoint-${id}-time`).value,
      breakMinutes: parseInt(document.getElementById(`waypoint-${id}-break`).value)
    };
    data.waypoints.push(waypoint);
  });
  
  return data;
}

// ===== GEOKÓDOVÁNÍ ADRES =====
async function geocodeAddresses(formData) {
  // Geokódování startu
  if (!formData.start.coords) {
    const coords = await geocodeAddress(formData.start.address);
    formData.start.coords = coords;
  }
  
  // Geokódování cíle
  if (!formData.end.coords) {
    const coords = await geocodeAddress(formData.end.address);
    formData.end.coords = coords;
  }
  
  // Geokódování zastávek
  for (let waypoint of formData.waypoints) {
    if (!waypoint.coords) {
      waypoint.coords = await geocodeAddress(waypoint.address);
    }
  }
}

// ===== GEOKÓDOVÁNÍ JEDNÉ ADRESY =====
async function geocodeAddress(address) {
  try {
    const response = await fetchWithTimeout(
      `${WORKER_URL}/api/geocode?query=${encodeURIComponent(address)}`,
      { method: 'GET' },
      10000
    );
    
    if (!response.ok) {
      throw new Error(`Nelze geokódovat adresu: ${address}`);
    }
    
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      return `${item.location.lat},${item.location.lon}`;
    } else {
      throw new Error(`Adresa nenalezena: ${address}`);
    }
    
  } catch (error) {
    throw new Error(`Chyba při geokódování adresy "${address}": ${error.message}`);
  }
}

// ===== VÝPOČET TRASY =====
async function calculateRoute(formData) {
  const waypoints = formData.waypoints.map(w => w.coords);
  
  const body = {
    start: formData.start.coords,
    end: formData.end.coords,
    waypoints: waypoints
  };
  
  try {
    const response = await fetchWithTimeout(
      `${WORKER_URL}/api/route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      15000
    );
    
    if (!response.ok) {
      throw new Error(`Chyba při výpočtu trasy (HTTP ${response.status})`);
    }
    
    const data = await response.json();
    
    // OPRAVENO: API vrací přímo length/duration/geometry, ne data.route
    if (!data.length || !data.duration || !data.geometry) {
      throw new Error('Trasa nebyla nalezena.');
    }
    
    // Přeformátování odpovědi do očekávané struktury
    return {
      route: {
        length: data.length,
        duration: data.duration,
        geometry: data.geometry.geometry, // geometry je zanořené
        legs: [] // TODO: API nevrací legs, musíme to vyřešit jinak
      }
    };
    
  } catch (error) {
    throw new Error(`Výpočet trasy selhal: ${error.message}`);
  }
}

// ===== VÝPOČET ČASOVÉHO HARMONOGRAMU =====
function calculateSchedule(formData, routeData) {
  const schedule = [];
  let currentTime = timeToMinutes(formData.departureTime);
  
  // Celková vzdálenost a čas z API
  const totalDistance = (routeData.route.length / 1000).toFixed(1); // metry na km
  const totalDuration = Math.round(routeData.route.duration / 60); // sekundy na minuty
  
  // Start
  schedule.push({
    type: 'start',
    place: formData.start.address,
    arrival: null,
    departure: minutesToTime(currentTime),
    segmentDistance: 0,
    totalDistance: 0
  });
  
  // Zastávky - bez legs musíme počítat proporcionálně
  // (Pro správné fungování by bylo potřeba volat API pro každý úsek zvlášť)
  const numSegments = formData.waypoints.length + 1;
  const avgSegmentDistance = parseFloat(totalDistance) / numSegments;
  const avgSegmentDuration = totalDuration / numSegments;
  
  let cumulativeDistance = 0;
  
  for (let i = 0; i < formData.waypoints.length; i++) {
    const waypoint = formData.waypoints[i];
    
    currentTime += avgSegmentDuration;
    cumulativeDistance += avgSegmentDistance;
    
    const arrival = minutesToTime(Math.round(currentTime));
    
    // Pokud je fixovaný čas, použij ho
    if (waypoint.isFixed && waypoint.fixedTime) {
      const fixedMinutes = timeToMinutes(waypoint.fixedTime);
      currentTime = fixedMinutes;
    }
    
    const departure = minutesToTime(Math.round(currentTime + waypoint.breakMinutes));
    currentTime += waypoint.breakMinutes;
    
    schedule.push({
      type: waypoint.isFixed ? 'waypoint-fixed' : 'waypoint',
      place: waypoint.address,
      arrival: arrival,
      departure: departure,
      segmentDistance: avgSegmentDistance.toFixed(1),
      totalDistance: cumulativeDistance.toFixed(1),
      breakMinutes: waypoint.breakMinutes
    });
  }
  
  // Cíl
  currentTime += avgSegmentDuration;
  cumulativeDistance += avgSegmentDistance;
  
  schedule.push({
    type: 'end',
    place: formData.end.address,
    arrival: minutesToTime(Math.round(currentTime)),
    departure: null,
    segmentDistance: avgSegmentDistance.toFixed(1),
    totalDistance: totalDistance
  });
  
  return {
    items: schedule,
    totalDistance: totalDistance,
    totalTime: Math.round((currentTime - timeToMinutes(formData.departureTime)))
  };
}

// ===== ZOBRAZENÍ VÝSLEDKŮ =====
function displayResults(schedule) {
  // Souhrn
  document.getElementById('totalDistance').textContent = `${schedule.totalDistance} km`;
  document.getElementById('totalTime').textContent = `${schedule.totalTime} min`;
  
  // Tabulka
  const tbody = document.getElementById('scheduleBody');
  tbody.innerHTML = '';
  
  schedule.items.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = `row-${item.type}`;
    
    tr.innerHTML = `
      <td class="place-cell">${item.place}</td>
      <td>${item.arrival || '-'}</td>
      <td>${item.departure || '-'}</td>
      <td>${item.segmentDistance > 0 ? item.segmentDistance + ' km' : '-'}</td>
      <td>${item.totalDistance > 0 ? item.totalDistance + ' km' : '-'}</td>
    `;
    
    tbody.appendChild(tr);
  });
  
  // Zobrazení sekce výsledků
  document.getElementById('results').style.display = 'block';
}

// ===== VYKRESLENÍ TRASY NA MAPĚ =====
function displayRouteOnMap(routeData, formData) {
  // Vyčištění předchozích vrstev
  markersLayer.clearLayers();
  routeLayer.clearLayers();
  
  // Vykreslení trasy
  if (routeData.route && routeData.route.geometry) {
    const coordinates = routeData.route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    L.polyline(coordinates, {
      color: '#2c7be5',
      weight: 5,
      opacity: 0.7
    }).addTo(routeLayer);
  }
  
  // Markery
  const startCoords = formData.start.coords.split(',').map(Number);
  const endCoords = formData.end.coords.split(',').map(Number);
  
  // Start marker (zelená vlajka)
  L.marker(startCoords, {
    icon: createCustomIcon('success', 'fa-flag-checkered')
  }).addTo(markersLayer).bindPopup(`<strong>Start:</strong><br>${formData.start.address}`);
  
  // Zastávky (modré piny)
  formData.waypoints.forEach((waypoint, index) => {
    const coords = waypoint.coords.split(',').map(Number);
    L.marker(coords, {
      icon: createCustomIcon(waypoint.isFixed ? 'warning' : 'primary', 'fa-map-pin')
    }).addTo(markersLayer).bindPopup(`<strong>Zastávka ${index + 1}:</strong><br>${waypoint.address}`);
  });
  
  // Cíl (červený marker)
  L.marker(endCoords, {
    icon: createCustomIcon('danger', 'fa-map-marker-alt')
  }).addTo(markersLayer).bindPopup(`<strong>Cíl:</strong><br>${formData.end.address}`);
  
  // Zoom na celou trasu
  const bounds = L.latLngBounds([startCoords]);
  formData.waypoints.forEach(w => {
    bounds.extend(w.coords.split(',').map(Number));
  });
  bounds.extend(endCoords);
  
  map.fitBounds(bounds, { padding: [50, 50] });
}

// ===== VLASTNÍ IKONY PRO MARKERY =====
function createCustomIcon(color, iconClass) {
  const colorMap = {
    success: '#00b074',
    primary: '#2c7be5',
    warning: '#f6c343',
    danger: '#e63757'
  };
  
  const html = `
    <div style="
      background: ${colorMap[color]};
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    ">
      <i class="fas ${iconClass}" style="font-size: 16px;"></i>
    </div>
  `;
  
  return L.divIcon({
    html: html,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

// ===== EXPORT - KOPÍROVÁNÍ DO SCHRÁNKY =====
async function copyToClipboard() {
  if (!scheduleData) return;
  
  let text = '🗺️ PLÁN CESTY\n\n';
  text += `📍 Celková vzdálenost: ${scheduleData.totalDistance} km\n`;
  text += `⏱️ Celkový čas: ${scheduleData.totalTime} min\n\n`;
  text += '─'.repeat(50) + '\n\n';
  
  scheduleData.items.forEach(item => {
    text += `📌 ${item.place}\n`;
    if (item.arrival) text += `   Příjezd: ${item.arrival}\n`;
    if (item.departure) text += `   Odjezd: ${item.departure}\n`;
    if (item.segmentDistance > 0) text += `   Úsek: ${item.segmentDistance} km\n`;
    text += '\n';
  });
  
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Harmonogram zkopírován do schránky!', 'success');
  } catch (error) {
    showNotification('Nepodařilo se zkopírovat do schránky.', 'error');
  }
}

// ===== EXPORT - TISK =====
function printSchedule() {
  window.print();
}

// ===== EXPORT - OTEVŘENÍ V MAPY.CZ =====
function openInMapy() {
  if (!routeData) return;
  
  const formData = getFormData();
  
  // Sestavení URL pro Mapy.cz
  let url = 'https://mapy.cz/zakladni?';
  
  // Trasa
  url += `x=${formData.start.coords.split(',')[1]}`;
  url += `&y=${formData.start.coords.split(',')[0]}`;
  
  // Více bodů trasy - Mapy.cz formát
  // Bohužel Mapy.cz nemají veřejné API pro přímé otevření trasy s waypoints
  // Otevřeme alespoň základní mapu se startem
  
  window.open(url, '_blank');
  showNotification('Otevírám v Mapy.cz...', 'success');
}

// ===== RESET FORMULÁŘE =====
function handleReset() {
  document.getElementById('waypointsContainer').innerHTML = '';
  waypointCounter = 0;
  document.getElementById('results').style.display = 'none';
  
  markersLayer.clearLayers();
  routeLayer.clearLayers();
  
  routeData = null;
  scheduleData = null;
  
  setDefaultDepartureTime();
}

// ===== SIDEBAR TOGGLE (MOBIL) =====
function openSidebar() {
  document.querySelector('.sidebar').classList.add('active');
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('active');
}

// ===== ONLINE/OFFLINE DETEKCE =====
function checkOnlineStatus() {
  if (!isOnline) {
    showNotification('Jste offline. Některé funkce nemusí fungovat.', 'warning');
  }
}

function handleOnline() {
  isOnline = true;
  showNotification('Připojení k internetu bylo obnoveno.', 'success');
}

function handleOffline() {
  isOnline = false;
  showNotification('Ztratili jste připojení k internetu.', 'warning');
}

// ===== NOTIFIKACE =====
function showNotification(message, type = 'error') {
  const container = document.getElementById('notifications');
  
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  
  const icons = {
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    success: 'fa-check-circle'
  };
  
  notification.innerHTML = `
    <i class="fas ${icons[type]}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(notification);
  
  // Kliknutí pro zavření
  notification.addEventListener('click', () => {
    notification.remove();
  });
  
  // Auto-hide po 5 sekundách
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// ===== LOADER =====
function showLoader(show) {
  document.getElementById('loadingSpinner').style.display = show ? 'flex' : 'none';
}

// ===== POMOCNÉ FUNKCE =====

// Převod času HH:MM na minuty od půlnoci
function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Převod minut od půlnoci na HH:MM
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Fetch s timeoutem
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Požadavek vypršel. Zkuste to znovu.');
    }
    throw error;
  }
}