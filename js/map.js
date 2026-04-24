(function () {
  'use strict';

  // Default view: Carrigtwohill, Co. Cork.
  // MapLibre uses [lng, lat] order (GeoJSON), which is the opposite of Leaflet.
  const DEFAULT_CENTER = [-8.2660, 51.9080];
  const DEFAULT_ZOOM = 12;
  const DEFAULT_PITCH = 30; // slight tilt → "curved globe" feel
  const DEFAULT_BEARING = 0;
  const FIT_MAX_ZOOM = 15;

  // Pin icon registry. Add new entries here to support more pin types without
  // code changes on the calling side — places.json just references the key.
  const PIN_ICONS = {
    fort: {
      iconUrl: 'assets/icons/fort.svg',
      iconSize: [36, 42]
    }
  };

  function getIconConfig(kind) {
    return (kind && PIN_ICONS[kind]) ? PIN_ICONS[kind] : PIN_ICONS.fort;
  }

  function showError(msg) {
    const el = document.getElementById('map-error');
    el.textContent = msg;
    el.hidden = false;
  }

  function showLoading(on) {
    document.getElementById('map-loading').hidden = !on;
  }

  // --- Modal -------------------------------------------------------------

  const modalEl = document.getElementById('preview-modal');
  const modalPanel = modalEl.querySelector('.modal-panel');
  let lastFocused = null;

  function openModal(place) {
    lastFocused = document.activeElement;

    document.getElementById('preview-title').textContent = place.name || '';
    document.getElementById('preview-text').textContent = place.preview || '';

    const figure = modalEl.querySelector('.modal-figure');
    const img = document.getElementById('preview-image');
    const cap = document.getElementById('preview-caption');
    const hero = (place.images && place.images[0]) || null;

    if (hero && hero.src) {
      img.src = hero.src;
      img.alt = hero.alt || place.name || '';
      const parts = [];
      if (hero.caption) parts.push(hero.caption);
      if (hero.attribution) parts.push('Image: ' + hero.attribution);
      cap.textContent = parts.join(' — ');
      figure.hidden = false;
    } else {
      figure.hidden = true;
      img.removeAttribute('src');
    }

    const link = document.getElementById('preview-link');
    link.href = PlacesData.placeUrl(place.id);

    modalEl.hidden = false;
    requestAnimationFrame(() => modalPanel.focus());
    document.addEventListener('keydown', onKeydown);
  }

  function closeModal() {
    modalEl.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }

  modalEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal();
  });

  // --- Styles ------------------------------------------------------------
  // Raster tile styles; no API key required. The top-level `projection: globe`
  // gives the curved-earth aesthetic on zoomed-out views while automatically
  // falling back to a flat projection as the user zooms in.

  const SATELLITE_STYLE = {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      'esri-imagery': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      },
      'esri-reference': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
      { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' },
      { id: 'esri-reference', type: 'raster', source: 'esri-reference' }
    ]
  };

  const SIMPLE_STYLE = {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f6f1e6' } },
      { id: 'osm', type: 'raster', source: 'osm' }
    ]
  };

  // --- Base layer switcher (custom IControl) ----------------------------
  // MapLibre has no built-in layer switcher. This small control swaps the
  // entire style when the user picks Satellite vs Simple. Markers are DOM
  // elements owned by the Map instance and persist across setStyle() calls.

  class BaseLayerSwitcher {
    constructor(layers, initialId) {
      this._layers = layers;
      this._current = initialId;
    }
    onAdd(map) {
      this._map = map;
      const el = document.createElement('div');
      el.className = 'maplibregl-ctrl maplibregl-ctrl-group base-layer-switcher';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Base layer');
      this._buttons = this._layers.map((layer) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = layer.label;
        btn.className = 'base-layer-btn' + (layer.id === this._current ? ' is-active' : '');
        btn.setAttribute('aria-pressed', layer.id === this._current ? 'true' : 'false');
        btn.addEventListener('click', () => this._switch(layer.id));
        el.appendChild(btn);
        return { id: layer.id, el: btn };
      });
      this._el = el;
      return el;
    }
    _switch(id) {
      if (id === this._current) return;
      const layer = this._layers.find((l) => l.id === id);
      if (!layer) return;
      this._current = id;
      this._map.setStyle(layer.style, { diff: false });
      this._buttons.forEach((b) => {
        const active = b.id === id;
        b.el.classList.toggle('is-active', active);
        b.el.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    onRemove() {
      if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
      this._map = undefined;
    }
  }

  // --- Edit mode: user-placed pins --------------------------------------
  // Client-side only. No persistence, no places.json mutation. Pins exist
  // for the lifetime of the page; Jim's workflow is "drop, copy, paste to
  // WhatsApp, forget".

  const USER_PIN_ICON = 'assets/icons/user-pin.svg';
  const USER_PIN_SIZE = [36, 42];
  const STORAGE_KEY = 'jimmap_user_pins';

  const userPins = new Map(); // id -> { marker, el, name, description, lng, lat }
  let userPinSeq = 0;
  let editMode = false;
  let pendingLngLat = null; // lng/lat of pin awaiting the name/description form

  const editToggleBtn = document.getElementById('edit-toggle-btn');
  editToggleBtn.addEventListener('click', () => toggleEditMode());

  function setEditToggleActive(active) {
    editToggleBtn.classList.toggle('is-active', active);
    editToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    editToggleBtn.textContent = active ? 'Exit edit' : 'Edit';
  }

  function toggleEditMode(force) {
    const next = typeof force === 'boolean' ? force : !editMode;
    if (next === editMode) return;
    editMode = next;
    setEditToggleActive(editMode);
    document.getElementById('edit-mode-indicator').hidden = !editMode;
    if (editMode) {
      // Reclaim double-click from MapLibre's default zoom
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
    } else {
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      closePinContextMenu();
    }
  }

  // --- localStorage persistence -----------------------------------------
  // Stored shape: [{ name, description, lat, lng }, ...]. In-memory ids
  // are regenerated on each load — they're purely for lookup, not identity.

  function persistUserPins() {
    try {
      const arr = Array.from(userPins.values()).map((p) => ({
        name: p.name,
        description: p.description,
        lat: p.lat,
        lng: p.lng
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('Could not save user pins to localStorage:', e);
    }
  }

  function restoreUserPins() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { return; }
    if (!raw) return;
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch (e) {
      console.warn('Stored user pins were not valid JSON; clearing.', e);
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return;
    }
    if (!Array.isArray(arr)) return;
    arr.forEach((p) => {
      if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') return;
      if (typeof p.name !== 'string' || !p.name.trim()) return;
      createUserPin({
        lng: p.lng,
        lat: p.lat,
        name: p.name,
        description: typeof p.description === 'string' ? p.description : '',
        skipPersist: true
      });
    });
  }

  function onMapDblClick(e) {
    if (!editMode) return;
    openEditPinModal(e.lngLat);
  }

  // --- Edit-pin modal ----------------------------------------------------

  const editpinModal = document.getElementById('editpin-modal');
  const editpinPanel = editpinModal.querySelector('.modal-panel');
  const editpinForm = document.getElementById('editpin-form');
  const editpinNameInput = document.getElementById('editpin-name');
  const editpinDescInput = document.getElementById('editpin-desc');
  let editpinPrevFocus = null;

  function openEditPinModal(lngLat) {
    pendingLngLat = lngLat;
    editpinNameInput.value = '';
    editpinDescInput.value = '';
    editpinPrevFocus = document.activeElement;
    editpinModal.hidden = false;
    requestAnimationFrame(() => editpinNameInput.focus());
    document.addEventListener('keydown', onEditpinKey);
  }

  function closeEditPinModal() {
    editpinModal.hidden = true;
    pendingLngLat = null;
    document.removeEventListener('keydown', onEditpinKey);
    if (editpinPrevFocus && typeof editpinPrevFocus.focus === 'function') {
      editpinPrevFocus.focus();
    }
  }

  function onEditpinKey(e) {
    if (e.key === 'Escape') closeEditPinModal();
  }

  editpinModal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]') || e.target.matches('[data-cancel]')) {
      closeEditPinModal();
    }
  });

  editpinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = editpinNameInput.value.trim();
    if (!name) {
      editpinNameInput.focus();
      return;
    }
    const description = editpinDescInput.value.trim();
    if (pendingLngLat) {
      createUserPin({
        lng: pendingLngLat.lng,
        lat: pendingLngLat.lat,
        name: name,
        description: description
      });
    }
    closeEditPinModal();
  });

  // --- User-pin creation + context menu ---------------------------------

  function createUserPin(opts) {
    const id = 'user-pin-' + (++userPinSeq);
    const el = document.createElement('div');
    el.className = 'map-pin map-pin-user';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'User pin: ' + opts.name);
    el.title = opts.description ? opts.name + ' — ' + opts.description : opts.name;
    el.style.width = USER_PIN_SIZE[0] + 'px';
    el.style.height = USER_PIN_SIZE[1] + 'px';
    el.style.backgroundImage = 'url("' + USER_PIN_ICON + '")';
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPinContextMenu(e.clientX, e.clientY, id);
    });
    // Left-click does nothing — user pins are temporary, no detail page.
    el.addEventListener('click', (e) => { e.stopPropagation(); });

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([opts.lng, opts.lat])
      .addTo(map);

    userPins.set(id, {
      marker: marker,
      el: el,
      name: opts.name,
      description: opts.description,
      lng: opts.lng,
      lat: opts.lat
    });

    if (!opts.skipPersist) persistUserPins();
  }

  const pinContextEl = document.getElementById('pin-context');
  let pinContextId = null;

  function openPinContextMenu(x, y, id) {
    pinContextId = id;
    pinContextEl.hidden = false;
    // Measure after unhiding to clamp within the viewport
    const rect = pinContextEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 6;
    const maxY = window.innerHeight - rect.height - 6;
    pinContextEl.style.left = Math.max(6, Math.min(x, maxX)) + 'px';
    pinContextEl.style.top = Math.max(6, Math.min(y, maxY)) + 'px';
    document.addEventListener('mousedown', onOutsidePinContext, true);
    document.addEventListener('keydown', onPinContextKey);
  }

  function closePinContextMenu() {
    pinContextEl.hidden = true;
    pinContextId = null;
    document.removeEventListener('mousedown', onOutsidePinContext, true);
    document.removeEventListener('keydown', onPinContextKey);
  }

  function onOutsidePinContext(e) {
    if (!pinContextEl.contains(e.target)) closePinContextMenu();
  }

  function onPinContextKey(e) {
    if (e.key === 'Escape') closePinContextMenu();
  }

  pinContextEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !pinContextId) return;
    const action = btn.getAttribute('data-action');
    const pin = userPins.get(pinContextId);
    const id = pinContextId;
    closePinContextMenu();
    if (!pin) return;
    if (action === 'copy') {
      copyPinData(pin);
    } else if (action === 'delete') {
      pin.marker.remove();
      userPins.delete(id);
      persistUserPins();
    }
  });

  function formatPinText(pin) {
    // "Place Name | longitude, latitude | Description"
    // Description omitted when empty to avoid a dangling separator.
    const lng = Number(pin.lng).toFixed(7);
    const lat = Number(pin.lat).toFixed(7);
    const parts = [pin.name, lng + ', ' + lat];
    if (pin.description) parts.push(pin.description);
    return parts.join(' | ');
  }

  function copyPinData(pin) {
    const text = formatPinText(pin);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* best-effort */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
  }

  // --- Map ---------------------------------------------------------------

  function buildMap() {
    const map = new maplibregl.Map({
      container: 'map',
      style: SATELLITE_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxPitch: 75,
      hash: false,
      attributionControl: { compact: true }
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
      'top-right'
    );
    map.addControl(
      new BaseLayerSwitcher(
        [
          { id: 'satellite', label: 'Satellite', style: SATELLITE_STYLE },
          { id: 'simple', label: 'Simple', style: SIMPLE_STYLE }
        ],
        'satellite'
      ),
      'top-right'
    );
    map.on('dblclick', onMapDblClick);

    return map;
  }

  function createPinElement(place) {
    const cfg = getIconConfig(place.pinType);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-pin';
    btn.setAttribute('aria-label', place.name || 'Historical place');
    btn.title = place.name || '';
    btn.style.width = cfg.iconSize[0] + 'px';
    btn.style.height = cfg.iconSize[1] + 'px';
    btn.style.backgroundImage = 'url("' + cfg.iconUrl + '")';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(place);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(place);
      }
    });
    return btn;
  }

  function addMarkers(map, places) {
    const bounds = new maplibregl.LngLatBounds();
    let count = 0;

    places.forEach((place) => {
      if (!place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') {
        console.warn('Skipping place with no location:', place.id);
        return;
      }
      const el = createPinElement(place);
      new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([place.location.lng, place.location.lat])
        .addTo(map);
      bounds.extend([place.location.lng, place.location.lat]);
      count++;
    });

    const applyBounds = () => {
      if (count > 1) {
        map.fitBounds(bounds, {
          padding: 60,
          maxZoom: FIT_MAX_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 0
        });
      } else if (count === 1) {
        map.jumpTo({
          center: bounds.getCenter(),
          zoom: 14,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING
        });
      }
    };

    if (map.loaded()) applyBounds();
    else map.once('load', applyBounds);
  }

  // --- Boot --------------------------------------------------------------

  showLoading(true);
  const map = buildMap();
  restoreUserPins();

  PlacesData.load()
    .then((data) => {
      addMarkers(map, data.places);
    })
    .catch((err) => {
      console.error(err);
      showError('Could not load places: ' + err.message);
    })
    .finally(() => showLoading(false));
})();
