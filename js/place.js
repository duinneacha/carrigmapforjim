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

  function renderMeta(place) {
    const bits = [];
    if (place.category) bits.push({ label: 'Category', value: place.category });
    if (place.type) bits.push({ label: 'Type', value: place.type });
    if (place.dates) {
      if (place.dates.range) bits.push({ label: 'Period', value: place.dates.range });
      else if (place.dates.from || place.dates.to) {
        bits.push({
          label: 'Period',
          value: [place.dates.from, place.dates.to].filter(Boolean).join(' — ')
        });
      }
    }

    if (!bits.length) return null;
    const p = document.createElement('p');
    p.className = 'place-meta';
    bits.forEach((b) => {
      const span = document.createElement('span');
      span.className = 'meta-item';
      const label = document.createElement('span');
      label.className = 'meta-label';
      label.textContent = b.label;
      span.appendChild(label);
      span.appendChild(document.createTextNode(b.value));
      p.appendChild(span);
    });
    return p;
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

    root.appendChild(textNode('h1', place.name)).className = 'place-title';
    const meta = renderMeta(place);
    if (meta) root.appendChild(meta);

    // Hero image — first image in the place's images array
    const hero = (place.images && place.images[0]) || null;
    const heroFig = renderFigure(hero, 'place-hero');
    if (heroFig) root.appendChild(heroFig);

    // Optional top-level preview / lead paragraph
    if (place.lead) {
      const lead = textNode('p', place.lead);
      lead.className = 'place-lead';
      lead.style.fontSize = '1.1rem';
      lead.style.fontStyle = 'italic';
      lead.style.color = 'var(--ink-soft)';
      lead.style.whiteSpace = 'pre-wrap';
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
