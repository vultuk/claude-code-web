// Minimal SVG icon helper. Returns inline SVG strings using currentColor.
// Usage: window.icons.name(size)

(function () {
  const toSvg = (pathOrContent, attrs = {}) => {
    const base = {
      width: attrs.width || 16,
      height: attrs.height || 16,
      viewBox: attrs.viewBox || '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': attrs.strokeWidth || 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    };
    const attrStr = Object.entries(base)
      .map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<svg ${attrStr}>${pathOrContent}</svg>`;
  };

  const circle = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;

  const icons = {
    check: (s = 16) => toSvg('<polyline points="20 6 9 17 4 12"/>', { width: s, height: s }),
    x: (s = 16) => toSvg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', { width: s, height: s }),
    clipboard: (s = 16) => toSvg('<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/>', { width: s, height: s }),
    folder: (s = 16) => toSvg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', { width: s, height: s }),
    download: (s = 16) => toSvg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 21h14"/>', { width: s, height: s }),
    chartLine: (s = 16) => toSvg('<polyline points="3 17 9 11 13 15 21 7"/><line x1="3" y1="17" x2="3" y2="21"/><line x1="21" y1="7" x2="21" y2="11"/>', { width: s, height: s }),
    dot: (s = 10) => toSvg(circle(12, 12, 5), { width: s, height: s, viewBox: '0 0 24 24', strokeWidth: 0 }),
  };

  window.icons = icons;
})();

