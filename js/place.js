(function () {
  'use strict';

  const root = document.getElementById('place-root');

  function getId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function renderError(msg) {
    root.innerHTML = '';
    const p = document.createElement('div');
    p.className = 'error';
    p.textContent = msg;
    root.appendChild(p);
  }

  /** Build a DOM node from text, preserving the historian's prose verbatim.
   *  Newlines are preserved via CSS `white-space: pre-wrap`. */
  function textNode(tag, value) {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  }

  function renderFigure(img, cls) {
    if (!img || !img.src) return null;
    const fig = document.createElement('figure');
    fig.className = cls || 'place-figure';

    const image = document.createElement('img');
    image.src = img.src;
    image.alt = img.alt || '';
    if (img.width) image.width = img.width;
    if (img.height) image.height = img.height;
    image.loading = 'lazy';
    fig.appendChild(image);

    if (img.caption || img.attribution) {
      const cap = document.createElement('figcaption');
      if (img.caption) cap.appendChild(document.createTextNode(img.caption));
      if (img.attribution) {
        const attr = document.createElement('span');
        attr.className = 'attribution';
        attr.textContent = 'Image: ' + img.attribution;
        cap.appendChild(attr);
      }
      fig.appendChild(cap);
    }
    return fig;
  }

  /** A section is a flexible content block. It may contain:
   *   - title (h2)
   *   - subsections (array of { title, blocks })
   *   - blocks (array of content blocks)
   *   Content blocks: { type: 'paragraph' | 'heading' | 'quote' | 'list' | 'image', ... } */
  function renderBlock(block) {
    if (!block || !block.type) return null;

    switch (block.type) {
      case 'paragraph':
        return textNode('p', block.text || '');

      case 'heading': {
        const level = Math.min(Math.max(parseInt(block.level, 10) || 3, 2), 4);
        return textNode('h' + level, block.text || '');
      }

      case 'quote':
        return textNode('blockquote', block.text || '');

      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const list = document.createElement(tag);
        (block.items || []).forEach((item) => {
          list.appendChild(textNode('li', item));
        });
        return list;
      }

      case 'image':
        return renderFigure(block.image || block, 'place-figure');

      default:
        console.warn('Unknown block type:', block.type);
        return null;
    }
  }

  function renderSection(section) {
    const wrap = document.createElement('section');
    wrap.className = 'place-section';

    if (section.title) wrap.appendChild(textNode('h2', section.title));

    (section.blocks || []).forEach((b) => {
      const el = renderBlock(b);
      if (el) wrap.appendChild(el);
    });

    (section.subsections || []).forEach((sub) => {
      if (sub.title) wrap.appendChild(textNode('h3', sub.title));
      (sub.blocks || []).forEach((b) => {
        const el = renderBlock(b);
        if (el) wrap.appendChild(el);
      });
    });

    return wrap;
  }

  /** Build the short tagline shown directly under the place name.
   *  e.g. "Castle — Tower house · late 15th c." */
  function renderTagline(place) {
    const parts = [];
    if (place.category && place.type) {
      parts.push(place.category + ' — ' + place.type);
    } else if (place.category) {
      parts.push(place.category);
    } else if (place.type) {
      parts.push(place.type);
    }
    if (place.dates) {
      if (place.dates.range) parts.push(place.dates.range);
      else if (place.dates.from || place.dates.to) {
        parts.push([place.dates.from, place.dates.to].filter(Boolean).join(' — '));
      }
    }
    if (!parts.length) return null;
    const p = document.createElement('p');
    p.className = 'place-tagline';
    p.textContent = parts.join(' · ');
    return p;
  }

  function renderCoords(place) {
    if (!place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') {
      return null;
    }
    const { lat, lng } = place.location;
    const wrap = document.createElement('p');
    wrap.className = 'place-coords';

    const label = document.createElement('span');
    label.className = 'meta-label';
    label.textContent = 'Coordinates';
    wrap.appendChild(label);

    const value = document.createElement('span');
    value.className = 'coord-value';
    value.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    wrap.appendChild(value);

    const sep = document.createElement('span');
    sep.className = 'coord-sep';
    sep.textContent = '·';
    wrap.appendChild(sep);

    const a = document.createElement('a');
    a.href = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open in Google Maps';
    wrap.appendChild(a);

    return wrap;
  }

  function renderRelated(place, all) {
    if (!Array.isArray(place.relatedPlaces) || place.relatedPlaces.length === 0) return null;
    const wrap = document.createElement('section');
    wrap.className = 'place-section related-places';
    wrap.appendChild(textNode('h2', 'Related Places'));
    const ul = document.createElement('ul');
    place.relatedPlaces.forEach((relId) => {
      const rel = PlacesData.findById(all, relId);
      if (!rel) return;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = PlacesData.placeUrl(rel.id);
      a.textContent = rel.name;
      li.appendChild(a);
      ul.appendChild(li);
    });
    if (!ul.children.length) return null;
    wrap.appendChild(ul);
    return wrap;
  }

  function renderSources(place) {
    if (!Array.isArray(place.sources) || place.sources.length === 0) return null;
    const wrap = document.createElement('section');
    wrap.className = 'place-section sources';
    wrap.appendChild(textNode('h2', 'Sources'));
    const ol = document.createElement('ol');
    place.sources.forEach((src) => {
      const li = document.createElement('li');
      if (typeof src === 'string') {
        li.textContent = src;
      } else if (src && typeof src === 'object') {
        const parts = [];
        if (src.author) parts.push(src.author);
        if (src.title) parts.push('“' + src.title + '”');
        if (src.publication) parts.push(src.publication);
        if (src.year) parts.push('(' + src.year + ')');
        const textPart = parts.join(', ');
        if (src.url) {
          const a = document.createElement('a');
          a.href = src.url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = textPart || src.url;
          li.appendChild(a);
        } else {
          li.textContent = textPart;
        }
        if (src.note) {
          li.appendChild(document.createTextNode(' — ' + src.note));
        }
      }
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }

  function renderPlace(place, all) {
    document.title = place.name + ' — Carrigtwohill Historical Places';

    root.innerHTML = '';

    const titleBlock = document.createElement('header');
    titleBlock.className = 'place-titleblock';
    const h1 = textNode('h1', place.name);
    h1.className = 'place-title';
    titleBlock.appendChild(h1);
    const tagline = renderTagline(place);
    if (tagline) titleBlock.appendChild(tagline);
    const coords = renderCoords(place);
    if (coords) titleBlock.appendChild(coords);
    root.appendChild(titleBlock);

    // Hero image — first image in the place's images array
    const hero = (place.images && place.images[0]) || null;
    const heroFig = renderFigure(hero, 'place-hero');
    if (heroFig) root.appendChild(heroFig);

    // Optional top-level preview / lead paragraph
    if (place.lead) {
      const lead = textNode('p', place.lead);
      lead.className = 'place-lead';
      root.appendChild(lead);
    }

    // Sections (flexible)
    (place.sections || []).forEach((s) => root.appendChild(renderSection(s)));

    const rel = renderRelated(place, all);
    if (rel) root.appendChild(rel);

    const sources = renderSources(place);
    if (sources) root.appendChild(sources);
  }

  // --- Boot --------------------------------------------------------------

  const id = getId();
  if (!id) {
    renderError('No place specified. Return to the map and choose a pin.');
    return;
  }

  PlacesData.load()
    .then((data) => {
      const place = PlacesData.findById(data.places, id);
      if (!place) {
        renderError('Place not found: ' + id);
        return;
      }
      renderPlace(place, data.places);
    })
    .catch((err) => {
      console.error(err);
      renderError('Could not load place: ' + err.message);
    });
})();
