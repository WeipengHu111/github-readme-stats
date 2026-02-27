// @ts-check

import { getCardColors } from "../common/color.js";

// Chart-specific color presets per theme brightness.
const CHART_PRESETS = {
  light: { add_color: "10B981", del_color: "DC2626" },
  dark:  { add_color: "22C55E", del_color: "F87171" },
};

/**
 * Heuristic: treat a background as "dark" when its luminance is low.
 * @param {string} hex  6-char hex color (no #).
 * @returns {boolean}
 */
const isDarkBg = (hex) => {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
};

/**
 * Format large numbers compactly.
 * @param {number} n
 * @returns {string}
 */
const formatNum = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Render a monthly lines-of-code bar chart as SVG.
 *
 * @param {import("../fetchers/loc").LocData} data
 * @param {object} options
 * @param {string} [options.theme]
 * @param {string} [options.bg_color]
 * @param {string} [options.line_color]
 * @param {string} [options.area_color]
 * @param {string} [options.point_color]
 * @param {string} [options.title_color]
 * @param {string} [options.text_color]
 * @param {string} [options.border_color]
 * @param {boolean} [options.hide_border]
 * @param {string} [options.custom_title]
 * @param {number} [options.months] - Only show the last N months of data.
 * @returns {string} SVG string.
 */
const renderLocChart = (data, options = {}) => {
  const {
    theme,
    area_color: userAddColor,
    hide_border,
    custom_title,
    months,
  } = options;

  // Resolve standard colors via the project-wide theme system.
  const { titleColor, textColor, bgColor, borderColor } = getCardColors({
    title_color: options.title_color,
    text_color: options.text_color,
    bg_color: options.bg_color,
    border_color: options.border_color,
    theme,
  });

  const bgHex = typeof bgColor === "string" ? bgColor.replace(/^#/, "") : "fffefe";
  const preset = isDarkBg(bgHex) ? CHART_PRESETS.dark : CHART_PRESETS.light;

  const bg_color = typeof bgColor === "string" ? bgColor.replace(/^#/, "") : bgHex;
  const title_color = titleColor.replace(/^#/, "");
  const text_color = textColor.replace(/^#/, "");
  const border_color = borderColor.replace(/^#/, "");
  const add_color = userAddColor || preset.add_color;
  const del_color = preset.del_color;

  const width = 850;
  const height = 300;
  const padding = { top: 50, right: 30, bottom: 50, left: 70 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { weeklyData, totalAdditions, totalDeletions, netLines } = data;

  if (weeklyData.length === 0) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#${bg_color}" />
      <text x="50%" y="50%" fill="#${text_color}" text-anchor="middle" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="14">No data available</text>
    </svg>`;
  }

  // --- Aggregate weekly data into monthly buckets ---
  /** @type {Map<string, { year: number, month: number, additions: number, deletions: number }>} */
  const monthlyMap = new Map();
  for (const w of weeklyData) {
    const d = new Date(w.week * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const entry = monthlyMap.get(key) || { year: d.getFullYear(), month: d.getMonth(), additions: 0, deletions: 0 };
    entry.additions += w.additions;
    entry.deletions += w.deletions;
    monthlyMap.set(key, entry);
  }

  let monthlyData = [...monthlyMap.values()].sort((a, b) => a.year - b.year || a.month - b.month);

  // Filter to last N months if specified.
  if (months && months > 0) {
    monthlyData = monthlyData.slice(-months);
  }

  if (monthlyData.length === 0) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#${bg_color}" />
      <text x="50%" y="50%" fill="#${text_color}" text-anchor="middle" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="14">No data available</text>
    </svg>`;
  }

  // Find max values for scaling.
  const maxAdd = Math.max(...monthlyData.map((m) => m.additions), 1);
  const maxDel = Math.max(...monthlyData.map((m) => m.deletions), 1);
  const maxVal = Math.max(maxAdd, maxDel);

  // The chart is split: additions go up from baseline, deletions go down.
  // Baseline is at a ratio that balances the visual weight.
  const addRatio = maxAdd / (maxAdd + maxDel);
  const baselineY = padding.top + chartH * addRatio;

  const toAddY = (v) => baselineY - (v / maxVal) * chartH * addRatio;
  const toDelY = (v) => baselineY + (v / maxVal) * chartH * (1 - addRatio);

  // Bar layout.
  const n = monthlyData.length;
  const barGroupW = chartW / n;
  const barW = Math.min(barGroupW * 0.6, 40);
  const gap = (barGroupW - barW) / 2;

  const title = custom_title || "Monthly Code Contributions";
  const borderAttr = hide_border ? "" : `stroke="#${border_color}" stroke-width="1"`;

  // Y-axis ticks: additions side (positive) and deletions side (negative).
  const addTicks = 3;
  const delTicks = 2;
  const yLabels = [];
  for (let i = 0; i <= addTicks; i++) {
    const val = (maxAdd / addTicks) * i;
    yLabels.push({ val, y: toAddY(val), label: `+${formatNum(Math.round(val))}` });
  }
  for (let i = 1; i <= delTicks; i++) {
    const val = (maxDel / delTicks) * i;
    yLabels.push({ val, y: toDelY(val), label: `-${formatNum(Math.round(val))}` });
  }

  // Build bars SVG.
  const bars = monthlyData.map((m, i) => {
    const x = padding.left + i * barGroupW + gap;
    const addH = (m.additions / maxVal) * chartH * addRatio;
    const delH = (m.deletions / maxVal) * chartH * (1 - addRatio);
    const delay = (i / n * 0.8).toFixed(2);

    let svg = "";
    // Addition bar (goes up from baseline).
    if (m.additions > 0) {
      svg += `<rect x="${x.toFixed(1)}" y="${(baselineY - addH).toFixed(1)}" width="${barW.toFixed(1)}" height="${addH.toFixed(1)}" rx="3" fill="url(#addGrad)" class="bar-anim" style="animation-delay: ${delay}s;" />`;
    }
    // Deletion bar (goes down from baseline).
    if (m.deletions > 0) {
      svg += `\n    <rect x="${x.toFixed(1)}" y="${baselineY.toFixed(1)}" width="${barW.toFixed(1)}" height="${delH.toFixed(1)}" rx="3" fill="url(#delGrad)" class="bar-anim" style="animation-delay: ${delay}s;" />`;
    }
    return svg;
  }).join("\n    ");

  // X-axis month labels.
  const xLabels = monthlyData.map((m, i) => {
    const x = padding.left + i * barGroupW + barGroupW / 2;
    const label = n <= 12 ? MONTHS[m.month] : `${MONTHS[m.month]} '${String(m.year).slice(2)}`;
    return `<text x="${x.toFixed(1)}" y="${height - 15}" text-anchor="middle" class="label">${label}</text>`;
  }).join("\n  ");

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="4.5" fill="#${bg_color}" ${borderAttr} />

  <defs>
    <linearGradient id="addGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#${add_color}" stop-opacity="0.9" />
      <stop offset="100%" stop-color="#${add_color}" stop-opacity="0.4" />
    </linearGradient>
    <linearGradient id="delGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#${del_color}" stop-opacity="0.4" />
      <stop offset="100%" stop-color="#${del_color}" stop-opacity="0.9" />
    </linearGradient>
  </defs>

  <style>
    .title { font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${title_color}; }
    .label { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; opacity: 0.5; }
    .stat { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; }
    .stat-label { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; opacity: 0.45; }
    .grid { stroke: #${text_color}; stroke-opacity: 0.06; stroke-width: 1; stroke-dasharray: 4 4; }
    .baseline { stroke: #${text_color}; stroke-opacity: 0.15; stroke-width: 1; }
    .val-label { font: 600 9px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; opacity: 0.6; }
    @keyframes barFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .bar-anim { opacity: 0; animation: barFadeIn 0.4s ease-out forwards; }
  </style>

  <!-- Title -->
  <text x="${padding.left}" y="30" class="title">${title}</text>

  <!-- Stats summary -->
  <text x="${width - padding.right}" y="22" text-anchor="end" class="stat" style="fill: #${add_color};">+${formatNum(totalAdditions)}</text>
  <text x="${width - padding.right}" y="37" text-anchor="end" class="stat-label">additions</text>
  <text x="${width - padding.right - 90}" y="22" text-anchor="end" class="stat" style="fill: #${del_color};">-${formatNum(totalDeletions)}</text>
  <text x="${width - padding.right - 90}" y="37" text-anchor="end" class="stat-label">deletions</text>
  <text x="${width - padding.right - 180}" y="22" text-anchor="end" class="stat">${formatNum(netLines)} net</text>
  <text x="${width - padding.right - 180}" y="37" text-anchor="end" class="stat-label">lines</text>

  <!-- Grid lines (dashed) -->
  ${yLabels.map((l) => `<line x1="${padding.left}" y1="${l.y.toFixed(1)}" x2="${width - padding.right}" y2="${l.y.toFixed(1)}" class="grid" />`).join("\n  ")}

  <!-- Baseline -->
  <line x1="${padding.left}" y1="${baselineY.toFixed(1)}" x2="${width - padding.right}" y2="${baselineY.toFixed(1)}" class="baseline" />

  <!-- Y-axis labels -->
  ${yLabels.map((l) => `<text x="${padding.left - 10}" y="${(l.y + 4).toFixed(1)}" text-anchor="end" class="label">${l.label}</text>`).join("\n  ")}

  <!-- Bars -->
  ${bars}

  <!-- X-axis month labels -->
  ${xLabels}
</svg>`.trim();
};

export { renderLocChart };
export default renderLocChart;
