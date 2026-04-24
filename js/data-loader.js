/**
 * Shared data loader for the map and place pages.
 * Exposes a global `PlacesData` object; no build step required.
 */
(function (global) {
  'use strict';

  const DATA_URL = 'data/places.json';
  const PLACE_PAGE_PATH = 'place.html';

  let cache = null;
  let inflight = null;

  function load() {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;

    inflight = fetch(DATA_URL, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load places data (' + res.status + ')');
        return res.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.places)) {
          throw new Error('Invalid places.json: expected { "places": [...] }');
        }
        cache = data;
        return data;
      })
      .finally(() => { inflight = null; });

    return inflight;
  }

  function findById(places, id) {
    return places.find((p) => p.id === id) || null;
  }

  function placeUrl(id) {
    return PLACE_PAGE_PATH + '?id=' + encodeURIComponent(id);
  }

  global.PlacesData = { load, findById, placeUrl };
})(window);
