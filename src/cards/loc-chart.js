// @ts-check

/**
 * Render a cumulative lines-of-code area chart as SVG.
 *
 * @param {import("../fetchers/loc").LocData} data
 * @param {object} options
 * @param {string} [options.bg_color]
 * @param {string} [options.line_color]
 * @param {string} [options.area_color]
 * @param {string} [options.point_color]
 * @param {string} [options.title_color]
 * @param {string} [options.text_color]
 * @param {boolean} [options.hide_border]
 * @param {string} [options.custom_title]
 * @returns {string} SVG string.
 */
const renderLocChart = (data, options = {}) => {
  const {
    bg_color = "0D1117",
    line_color = "06B6D4",
    area_color = "22C55E",
    point_color = "FEBC2E",
    title_color = "22C55E",
    text_color = "E6EDF3",
    hide_border = true,
    custom_title,
  } = options;

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

  // Build cumulative net lines series.
  let cumulative = 0;
  const points = weeklyData.map((w) => {
    cumulative += w.additions - w.deletions;
    return { week: w.week, value: cumulative, additions: w.additions, deletions: w.deletions };
  });

  const minTime = points[0].week;
  const maxTime = points[points.length - 1].week;
  const timeRange = maxTime - minTime || 1;
  const maxVal = Math.max(...points.map((p) => p.value), 0);
  const minVal = Math.min(...points.map((p) => p.value), 0);
  const valRange = maxVal - minVal || 1;

  // Non-linear (sqrt) time scale: gives more space to recent data.
  const toNorm = (t) => Math.sqrt((t - minTime) / timeRange);
  const toX = (t) => padding.left + toNorm(t) * chartW;
  const toY = (v) => padding.top + chartH - ((v - minVal) / valRange) * chartH;

  // Build SVG path for the line.
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.week).toFixed(1)} ${toY(p.value).toFixed(1)}`)
    .join(" ");

  // Build area path (line + close to bottom).
  const areaPath = `${linePath} L ${toX(maxTime).toFixed(1)} ${toY(minVal).toFixed(1)} L ${toX(minTime).toFixed(1)} ${toY(minVal).toFixed(1)} Z`;

  // Format numbers.
  const formatNum = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  // Adaptive date format: older => "2022", recent (< 12 months) => "Jan '26"
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const nowTs = Date.now() / 1000;
  const oneYearAgo = nowTs - 365 * 86400;
  const formatDate = (ts) => {
    const d = new Date(ts * 1000);
    if (ts < oneYearAgo) return `${d.getFullYear()}`;
    return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  };

  // Y-axis labels (5 ticks).
  const yTicks = 5;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = minVal + (valRange / yTicks) * i;
    return { val, y: toY(val) };
  });

  // Smart X-axis labels: month boundaries, right-to-left greedy with min spacing.
  const MIN_LABEL_PX = 85;
  const buildXLabels = () => {
    // For dates older than 1 year: only January candidates (yearly).
    // For recent dates (< 1 year): monthly candidates.
    const candidates = [];
    const sd = new Date(minTime * 1000);
    sd.setDate(1); sd.setHours(0, 0, 0, 0);
    let cur = sd.getTime() / 1000;
    while (cur <= maxTime) {
      if (cur >= minTime) {
        const cd = new Date(cur * 1000);
        if (cur >= oneYearAgo || cd.getMonth() === 0) {
          candidates.push(cur);
        }
      }
      const nd = new Date(cur * 1000);
      nd.setMonth(nd.getMonth() + 1);
      cur = nd.getTime() / 1000;
    }
    // Always consider the last data point.
    if (!candidates.length || candidates[candidates.length - 1] < maxTime) {
      candidates.push(maxTime);
    }
    // Greedy right-to-left: prioritise recent labels.
    const picked = [];
    let lastX = Infinity;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const x = toX(candidates[i]);
      if (lastX - x >= MIN_LABEL_PX && x >= padding.left) {
        picked.unshift({ week: candidates[i], x });
        lastX = x;
      }
    }
    return picked;
  };
  const xLabels = buildXLabels();

  const title = custom_title || "Lines of Code Contributed";
  const borderAttr = hide_border ? "" : `stroke="#161B22" stroke-width="1"`;

  // Highlight points at peaks (sample ~12 points for dots).
  const dotStep = Math.max(1, Math.floor(points.length / 12));
  const dotPoints = points.filter((_, i) => i % dotStep === 0 || i === points.length - 1);

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="4.5" fill="#${bg_color}" ${borderAttr} />

  <style>
    .title { font: 600 16px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${title_color}; }
    .label { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; opacity: 0.7; }
    .stat { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; }
    .stat-label { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: #${text_color}; opacity: 0.6; }
    .grid { stroke: #${text_color}; stroke-opacity: 0.08; stroke-width: 1; }
    .area { fill: #${area_color}; fill-opacity: 0.15; }
    .line { stroke: #${line_color}; stroke-width: 2; fill: none; }
    .dot { fill: #${point_color}; }
    @keyframes grow { from { stroke-dashoffset: 3000; } to { stroke-dashoffset: 0; } }
    .line-animated { stroke-dasharray: 3000; animation: grow 2s ease-out forwards; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .fade-in { animation: fadeIn 0.8s ease-in-out forwards; }
  </style>

  <!-- Title -->
  <text x="${padding.left}" y="30" class="title">${title}</text>

  <!-- Stats summary -->
  <text x="${width - padding.right}" y="22" text-anchor="end" class="stat">+${formatNum(totalAdditions)}</text>
  <text x="${width - padding.right}" y="37" text-anchor="end" class="stat-label">additions</text>
  <text x="${width - padding.right - 90}" y="22" text-anchor="end" class="stat" style="fill: #F87171;">-${formatNum(totalDeletions)}</text>
  <text x="${width - padding.right - 90}" y="37" text-anchor="end" class="stat-label">deletions</text>
  <text x="${width - padding.right - 180}" y="22" text-anchor="end" class="stat" style="fill: #${area_color};">${formatNum(netLines)} net</text>
  <text x="${width - padding.right - 180}" y="37" text-anchor="end" class="stat-label">lines</text>

  <!-- Grid lines -->
  ${yLabels.map((l) => `<line x1="${padding.left}" y1="${l.y.toFixed(1)}" x2="${width - padding.right}" y2="${l.y.toFixed(1)}" class="grid" />`).join("\n  ")}

  <!-- Y-axis labels -->
  ${yLabels.map((l) => `<text x="${padding.left - 8}" y="${(l.y + 4).toFixed(1)}" text-anchor="end" class="label">${formatNum(Math.round(l.val))}</text>`).join("\n  ")}

  <!-- X-axis labels -->
  ${xLabels.map((l) => `<text x="${l.x.toFixed(1)}" y="${height - 15}" text-anchor="middle" class="label">${formatDate(l.week)}</text>`).join("\n  ")}

  <!-- Area fill -->
  <path d="${areaPath}" class="area fade-in" />

  <!-- Line -->
  <path d="${linePath}" class="line line-animated" />

  <!-- Dots -->
  ${dotPoints.map((p) => `<circle cx="${toX(p.week).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="3" class="dot fade-in" />`).join("\n  ")}
</svg>`.trim();
};

export { renderLocChart };
export default renderLocChart;
