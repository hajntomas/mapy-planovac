/**
 * Plánovač cest - Mapy.cz
 * Hlavní JavaScript logika
 */

// ===== KONFIGURACE =====
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

// Drag & Drop
let draggedElement = null;

// ===== INICIALIZACE =====
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initEventListeners();
  checkOnlineStatus();
  setDefaultDepartureTime();
});

// ===== MAPA - LEAFLET + MAPY.CZ TILES =====
function initMap() {
  map = L.map('map').setView([49.8175, 15.4730], 7);
  
  L.tileLayer('https://api.mapy.com/v1/maptiles/basic/256/{z}/{x}/{y}?apikey=Y1lHxkYBW0MfbJZnDFUR3rOrDePUgIcpnDUktxngjA4', {
    attribution: '&copy; <a href="https://mapy.com">Mapy.com</a>',
    maxZoom: 19
  }).addTo(map);
  
  markersLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

// ===== EVENT LISTENERS =====
function initEventListeners() {
  document.getElementById('routeForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('resetForm').addEventListener('click', handleReset);
  document.getElementById('addWaypoint').addEventListener('click', addWaypoint);
  
  setupAutocomplete('start', 'startAutocomplete');
  setupAutocomplete('end', 'endAutocomplete');
  
  document.getElementById('copyToClipboard').addEventListener('click', copyToClipboard);
  document.getElementById('printSchedule').addEventListener('click', printSchedule);
  document.getElementById('openInMapy').addEventListener('click', openInMapy);
  
  document.getElementById('openSidebar').addEventListener('click', openSidebar);
  document.getElementById('closeSidebar').addEventListener('click', closeSidebar);
  
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
    
    clearTimeout(debounceTimer);
    
    if (query.length < 2) {
      results.classList.remove('active');
      return;
    }
    
    debounceTimer = setTimeout(() => {
      fetchSuggestions(query, results, input);
    }, 400);
  });
  
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
    if (!item.position || !item.position.lat || !item.position.lon) {
      return;
    }
    
    const div = document.createElement('div');
    div.className = 'autocomplete-item';
    
    const icon = getIconForType(item.type);
    
    const query = inputElement.value.toLowerCase();
    const name = item.name || '';
    const label = item.label || '';
    const location = item.location || '';
    
    const highlightedName = name.replace(
      new RegExp(query, 'gi'),
      match => `<strong>${match}</strong>`
    );
    
    let displayText = `<i class="fas ${icon}"></i> ${highlightedName}`;
    if (label) {
      displayText += ` <span class="item-label">${label}</span>`;
    }
    if (location) {
      displayText += ` <span class="item-location">${location}</span>`;
    }
    
    div.innerHTML = displayText;
    
    let fullAddress = name;
    
    if (item.type === 'poi' && location) {
      fullAddress = `${name}, ${location}`;
    } else if (item.type === 'regional.address' && location) {
      fullAddress = `${name}, ${location}`;
    }
    
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      inputElement.value = fullAddress;
      inputElement.dataset.coords = `${item.position.lat},${item.position.lon}`;
      resultsElement.classList.remove('active');
      resultsElement.innerHTML = '';
    });
    
    resultsElement.appendChild(div);
  });
  
  if (resultsElement.children.length === 0) {
    resultsElement.innerHTML = '<div class="autocomplete-item">Žádné výsledky</div>';
  }
  
  resultsElement.classList.add('active');
}

// ===== IKONA PODLE TYPU =====
function getIconForType(type) {
  if (!type) return 'fa-map-marker-alt';
  
  if (type.startsWith('poi')) {
    if (type.includes('bus') || type.includes('tram') || type.includes('trolleybus')) {
      return 'fa-bus';
    }
    return 'fa-building';
  } else if (type.includes('address')) {
    return 'fa-home';
  } else if (type.includes('municipality') || type.includes('region')) {
    return 'fa-city';
  }
  
  return 'fa-map-marker-alt';
}

// ===== PŘIDÁNÍ ZASTÁVKY =====
function addWaypoint() {
  waypointCounter++;
  const container = document.getElementById('waypointsContainer');
  
  const waypointDiv = document.createElement('div');
  waypointDiv.className = 'waypoint-group';
  waypointDiv.dataset.waypointId = waypointCounter;
  waypointDiv.draggable = true;
  
  waypointDiv.innerHTML = `
    <div class="waypoint-header">
      <div class="drag-handle">
        <i class="fas fa-grip-vertical"></i>
      </div>
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
  
  setupAutocomplete(`waypoint-${waypointCounter}`, `waypoint-${waypointCounter}-autocomplete`);
  
  const checkbox = document.getElementById(`waypoint-${waypointCounter}-fixed`);
  const timeInput = document.getElementById(`waypoint-${waypointCounter}-time`);
  
  checkbox.addEventListener('change', (e) => {
    timeInput.disabled = !e.target.checked;
    if (!e.target.checked) {
      timeInput.value = '';
    }
  });
  
  // Drag & Drop event listeners
  setupDragAndDrop(waypointDiv);
  
  // Přečíslovat zastávky
  renumberWaypoints();
}

// ===== DRAG & DROP SETUP =====
function setupDragAndDrop(element) {
  element.addEventListener('dragstart', handleDragStart);
  element.addEventListener('dragend', handleDragEnd);
  element.addEventListener('dragover', handleDragOver);
  element.addEventListener('drop', handleDrop);
  element.addEventListener('dragenter', handleDragEnter);
  element.addEventListener('dragleave', handleDragLeave);
}

function handleDragStart(e) {
  draggedElement = this;
  this.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.style.opacity = '1';
  
  // Odstranit všechny drag-over třídy
  document.querySelectorAll('.waypoint-group').forEach(item => {
    item.classList.remove('drag-over');
  });
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  if (this !== draggedElement) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
  if (draggedElement !== this) {
    const container = document.getElementById('waypointsContainer');
    const allWaypoints = Array.from(container.children);
    
    const draggedIndex = allWaypoints.indexOf(draggedElement);
    const targetIndex = allWaypoints.indexOf(this);
    
    if (draggedIndex < targetIndex) {
      container.insertBefore(draggedElement, this.nextSibling);
    } else {
      container.insertBefore(draggedElement, this);
    }
    
    // Přečíslovat zastávky
    renumberWaypoints();
  }
  
  return false;
}

// ===== PŘEČÍSLOVÁNÍ ZASTÁVEK =====
function renumberWaypoints() {
  const waypoints = document.querySelectorAll('.waypoint-group');
  waypoints.forEach((waypoint, index) => {
    const header = waypoint.querySelector('h3');
    const icon = header.querySelector('i');
    header.innerHTML = `${icon.outerHTML} Zastávka ${index + 1}`;
  });
}

// ===== ODEBRÁNÍ ZASTÁVKY =====
function removeWaypoint(id) {
  const waypoint = document.querySelector(`[data-waypoint-id="${id}"]`);
  if (waypoint) {
    waypoint.remove();
    renumberWaypoints();
  }
}

// ===== ZPRACOVÁNÍ FORMULÁŘE =====
async function handleFormSubmit(e) {
  e.preventDefault();
  
  if (!isOnline) {
    showNotification('Jste offline. Připojte se k internetu.', 'warning');
    return;
  }
  
  const validation = validateForm();
  if (!validation.valid) {
    showNotification(validation.message, 'error');
    return;
  }
  
  // Kontrola časů po případném přesunutí
  const timeCheck = checkFixedTimesOrder();
  if (!timeCheck.valid) {
    showNotification(timeCheck.message, 'warning');
    
    // Nabídnout automatickou opravu
    if (confirm(timeCheck.message + '\n\nChcete automaticky upravit fixované časy podle nového pořadí?')) {
      adjustFixedTimes();
      showNotification('Časy byly upraveny. Zkontrolujte je prosím a naplánujte trasu znovu.', 'success');
      return;
    } else {
      return;
    }
  }
  
  showLoader(true);
  
  try {
    const formData = getFormData();
    
    await geocodeAddresses(formData);
    
    const route = await calculateRoute(formData);
    
    const schedule = calculateSchedule(formData, route);
    
    routeData = route;
    scheduleData = schedule;
    
    displayResults(schedule);
    
    displayRouteOnMap(route, formData);
    
    showNotification('Trasa úspěšně naplánována!', 'success');
    
  } catch (error) {
    console.error('Route calculation error:', error);
    showNotification(error.message || 'Chyba při výpočtu trasy.', 'error');
  } finally {
    showLoader(false);
  }
}

// ===== KONTROLA POŘADÍ FIXOVANÝCH ČASŮ =====
function checkFixedTimesOrder() {
  const departureTime = document.getElementById('departureTime').value;
  let previousTime = timeToMinutes(departureTime);
  let previousLabel = 'odjezd';
  
  const waypoints = document.querySelectorAll('.waypoint-group');
  const issues = [];
  
  for (let i = 0; i < waypoints.length; i++) {
    const id = waypoints[i].dataset.waypointId;
    const address = document.getElementById(`waypoint-${id}`).value.trim();
    const isFixed = document.getElementById(`waypoint-${id}-fixed`).checked;
    const fixedTime = document.getElementById(`waypoint-${id}-time`).value;
    const breakMinutes = parseInt(document.getElementById(`waypoint-${id}-break`).value);
    
    if (isFixed && fixedTime) {
      const fixedMinutes = timeToMinutes(fixedTime);
      
      if (fixedMinutes <= previousTime) {
        issues.push({
          waypointNumber: i + 1,
          address: address,
          currentTime: fixedTime,
          previousTime: minutesToTime(previousTime),
          previousLabel: previousLabel,
          minimalTime: minutesToTime(previousTime + 1)
        });
      }
      
      previousTime = fixedMinutes + breakMinutes;
      previousLabel = `zastávka ${i + 1}`;
    }
  }
  
  if (issues.length > 0) {
    let message = 'Fixované časy nejsou v správném pořadí po přesunutí zastávek:\n\n';
    issues.forEach(issue => {
      message += `• Zastávka ${issue.waypointNumber} (${issue.address}): \n`;
      message += `  Fixovaný čas ${issue.currentTime} je dřív nebo roven času ${issue.previousTime} na ${issue.previousLabel}\n`;
      message += `  Doporučený minimální čas: ${issue.minimalTime}\n\n`;
    });
    
    return { valid: false, message: message.trim(), issues: issues };
  }
  
  return { valid: true };
}

// ===== AUTOMATICKÁ ÚPRAVA FIXOVANÝCH ČASŮ =====
function adjustFixedTimes() {
  const departureTime = document.getElementById('departureTime').value;
  let previousTime = timeToMinutes(departureTime);
  
  const waypoints = document.querySelectorAll('.waypoint-group');
  
  for (let i = 0; i < waypoints.length; i++) {
    const id = waypoints[i].dataset.waypointId;
    const isFixed = document.getElementById(`waypoint-${id}-fixed`).checked;
    const timeInput = document.getElementById(`waypoint-${id}-time`);
    const breakMinutes = parseInt(document.getElementById(`waypoint-${id}-break`).value);
    
    if (isFixed && timeInput.value) {
      const fixedMinutes = timeToMinutes(timeInput.value);
      
      // Pokud je čas dřív než předchozí, nastavit na předchozí + 30 minut
      if (fixedMinutes <= previousTime) {
        const newTime = previousTime + 30;
        timeInput.value = minutesToTime(newTime);
        previousTime = newTime + breakMinutes;
      } else {
        previousTime = fixedMinutes + breakMinutes;
      }
    }
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
  
  const waypoints = document.querySelectorAll('.waypoint-group');
  
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
    
    if (isFixed && !fixedTime) {
      return { valid: false, message: `Zadejte fixovaný čas pro zastávku ${i + 1}.` };
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
  if (!formData.start.coords) {
    const coords = await geocodeAddress(formData.start.address);
    formData.start.coords = coords;
  }
  
  if (!formData.end.coords) {
    const coords = await geocodeAddress(formData.end.address);
    formData.end.coords = coords;
  }
  
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
      return `${item.position.lat},${item.position.lon}`;
    } else {
      throw new Error(`Adresa nenalezena: ${address}`);
    }
    
  } catch (error) {
    throw new Error(`Chyba při geokódování adresy "${address}": ${error.message}`);
  }
}

// ===== VÝPOČET TRASY S JEDNOTLIVÝMI ÚSEKY =====
async function calculateRoute(formData) {
  try {
    const allPoints = [
      { coords: formData.start.coords, address: formData.start.address },
      ...formData.waypoints.map(w => ({ coords: w.coords, address: w.address })),
      { coords: formData.end.coords, address: formData.end.address }
    ];
    
    const legs = [];
    
    for (let i = 0; i < allPoints.length - 1; i++) {
      const from = allPoints[i];
      const to = allPoints[i + 1];
      
      console.log(`🚗 Počítám úsek ${i + 1}: ${from.address} → ${to.address}`);
      
      const body = {
        start: from.coords,
        end: to.coords,
        waypoints: []
      };
      
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
        throw new Error(`Chyba při výpočtu úseku ${i + 1} (HTTP ${response.status})`);
      }
      
      const data = await response.json();
      
      if (!data.length || !data.duration) {
        throw new Error(`Úsek ${i + 1} nebyl nalezen`);
      }
      
      legs.push({
        from: from.address,
        to: to.address,
        distance: data.length,
        duration: data.duration,
        geometry: data.geometry
      });
      
      console.log(`✅ Úsek ${i + 1}: ${(data.length / 1000).toFixed(1)} km, ${Math.round(data.duration / 60)} min`);
    }
    
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const totalDuration = legs.reduce((sum, leg) => sum + leg.duration, 0);
    
    const allCoordinates = [];
    legs.forEach(leg => {
      if (leg.geometry && leg.geometry.geometry && leg.geometry.geometry.coordinates) {
        allCoordinates.push(...leg.geometry.geometry.coordinates);
      }
    });
    
    return {
      route: {
        length: totalDistance,
        duration: totalDuration,
        geometry: {
          type: 'LineString',
          coordinates: allCoordinates
        },
        legs: legs
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
  
  const legs = routeData.route.legs || [];
  let cumulativeDistance = 0;
  
  schedule.push({
    type: 'start',
    place: formData.start.address,
    arrival: null,
    departure: minutesToTime(currentTime),
    segmentDistance: 0,
    segmentDuration: 0,
    totalDistance: 0
  });
  
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const distance = (leg.distance / 1000).toFixed(1);
    const duration = Math.round(leg.duration / 60);
    
    cumulativeDistance += parseFloat(distance);
    
    if (i < formData.waypoints.length) {
      const waypoint = formData.waypoints[i];
      
      currentTime += duration;
      const calculatedArrival = currentTime;
      let actualArrival = calculatedArrival;
      let waitTime = 0;
      
      if (waypoint.isFixed && waypoint.fixedTime) {
        const fixedMinutes = timeToMinutes(waypoint.fixedTime);
        
        if (fixedMinutes < calculatedArrival) {
          showNotification(
            `Varování: Fixovaný čas na zastávce "${waypoint.address}" (${waypoint.fixedTime}) je dřív než možný příjezd (${minutesToTime(calculatedArrival)}). Trasa nebude včasná.`,
            'warning'
          );
        } else {
          waitTime = fixedMinutes - calculatedArrival;
        }
        
        actualArrival = fixedMinutes;
        currentTime = fixedMinutes;
      }
      
      const departure = minutesToTime(currentTime + waypoint.breakMinutes);
      currentTime += waypoint.breakMinutes;
      
      schedule.push({
        type: waypoint.isFixed ? 'waypoint-fixed' : 'waypoint',
        place: waypoint.address,
        arrival: minutesToTime(actualArrival),
        calculatedArrival: minutesToTime(calculatedArrival),
        departure: departure,
        segmentDistance: distance,
        segmentDuration: duration,
        totalDistance: cumulativeDistance.toFixed(1),
        breakMinutes: waypoint.breakMinutes,
        waitTime: waitTime,
        isFixed: waypoint.isFixed
      });
      
    } else {
      currentTime += duration;
      
      schedule.push({
        type: 'end',
        place: formData.end.address,
        arrival: minutesToTime(currentTime),
        departure: null,
        segmentDistance: distance,
        segmentDuration: duration,
        totalDistance: cumulativeDistance.toFixed(1)
      });
    }
  }
  
  const totalTime = currentTime - timeToMinutes(formData.departureTime);
  
  return {
    items: schedule,
    totalDistance: cumulativeDistance.toFixed(1),
    totalTime: totalTime
  };
}

// ===== ZOBRAZENÍ VÝSLEDKŮ =====
function displayResults(schedule) {
  document.getElementById('totalDistance').textContent = `${schedule.totalDistance} km`;
  document.getElementById('totalTime').textContent = formatDuration(schedule.totalTime);
  
  const tbody = document.getElementById('scheduleBody');
  tbody.innerHTML = '';
  
  schedule.items.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = `row-${item.type}`;
    
    let arrivalText = item.arrival || '-';
    if (item.isFixed && item.waitTime > 0) {
      arrivalText += ` <small style="color: #f6c343;">(čeká ${item.waitTime} min)</small>`;
    }
    
    tr.innerHTML = `
      <td class="place-cell">${item.place}</td>
      <td>${arrivalText}</td>
      <td>${item.departure || '-'}</td>
      <td>${item.segmentDistance > 0 ? item.segmentDistance + ' km' : '-'}</td>
      <td>${item.totalDistance > 0 ? item.totalDistance + ' km' : '-'}</td>
    `;
    
    tbody.appendChild(tr);
  });
  
  document.getElementById('results').style.display = 'block';
}

// ===== VYKRESLENÍ TRASY NA MAPĚ =====
function displayRouteOnMap(routeData, formData) {
  markersLayer.clearLayers();
  routeLayer.clearLayers();
  
  if (routeData.route && routeData.route.geometry) {
    const coordinates = routeData.route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    L.polyline(coordinates, {
      color: '#2c7be5',
      weight: 5,
      opacity: 0.7
    }).addTo(routeLayer);
  }
  
  const startCoords = formData.start.coords.split(',').map(Number);
  const endCoords = formData.end.coords.split(',').map(Number);
  
  L.marker(startCoords, {
    icon: createCustomIcon('success', 'fa-flag-checkered')
  }).addTo(markersLayer).bindPopup(`<strong>Start:</strong><br>${formData.start.address}`);
  
  formData.waypoints.forEach((waypoint, index) => {
    const coords = waypoint.coords.split(',').map(Number);
    L.marker(coords, {
      icon: createCustomIcon(waypoint.isFixed ? 'warning' : 'primary', 'fa-map-pin')
    }).addTo(markersLayer).bindPopup(`<strong>Zastávka ${index + 1}:</strong><br>${waypoint.address}`);
  });
  
  L.marker(endCoords, {
    icon: createCustomIcon('danger', 'fa-map-marker-alt')
  }).addTo(markersLayer).bindPopup(`<strong>Cíl:</strong><br>${formData.end.address}`);
  
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
  text += `⏱️ Celkový čas: ${formatDuration(scheduleData.totalTime)}\n\n`;
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
  // Najdi původní výsledky
  const results = document.getElementById('results');
  if (!results) return;
  
  // Vytvoř print kontejner
  const printContainer = document.createElement('div');
  printContainer.className = 'print-container';
  
  // Přidej hlavičku
  const header = document.createElement('h1');
  header.textContent = 'Plán cesty - Itinerář';
  printContainer.appendChild(header);
  
  // Naklonuj souhrn (celková vzdálenost a čas)
  const summary = results.querySelector('.summary');
  if (summary) {
    const summaryClone = summary.cloneNode(true);
    printContainer.appendChild(summaryClone);
  }
  
  // Naklonuj tabulku
  const scheduleTable = results.querySelector('.schedule-table');
  if (scheduleTable) {
    const tableClone = scheduleTable.cloneNode(true);
    printContainer.appendChild(tableClone);
  }
  
  // Přidej datum tisku
  const now = new Date();
  const dateStr = `Vytištěno: ${now.getDate()}. ${now.getMonth() + 1}. ${now.getFullYear()} v ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const printDate = document.createElement('div');
  printDate.className = 'print-date';
  printDate.textContent = dateStr;
  printContainer.appendChild(printDate);
  
  // Přidej do body
  document.body.appendChild(printContainer);
  
  // Počkej na vykreslení a tiskni
  setTimeout(() => {
    window.print();
    
    // Po tisku (nebo zavření dialogu) ukliď
    setTimeout(() => {
      document.body.removeChild(printContainer);
    }, 100);
  }, 100);
}

// ===== EXPORT - OTEVŘENÍ V MAPY.CZ =====
function openInMapy() {
  if (!routeData) return;
  
  const formData = getFormData();
  
  let url = 'https://mapy.cz/zakladni?';
  url += `x=${formData.start.coords.split(',')[1]}`;
  url += `&y=${formData.start.coords.split(',')[0]}`;
  
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
  
  notification.addEventListener('click', () => {
    notification.remove();
  });
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// ===== LOADER =====
function showLoader(show) {
  document.getElementById('loadingSpinner').style.display = show ? 'flex' : 'none';
}

// ===== POMOCNÉ FUNKCE =====

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours === 0) {
    return `${minutes} min`;
  } else if (minutes === 0) {
    return `${hours} h`;
  } else {
    return `${hours} h ${minutes} min`;
  }
}

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