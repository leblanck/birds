import React, { useState, useEffect, useCallback, useRef } from "react";

const CELL_SIZE = 13;
const CELL_GAP  = 3;

// ── Filson-inspired dark palette ──────────────────────────────────────────────
const C = {
  bg:          "#1e1d1b",
  surface:     "#272523",
  border:      "#3d3a35",
  borderSub:   "#332f2a",
  textPrimary: "#f0ebe0",
  textSecond:  "#d4c9b5",
  textMuted:   "#9c8f78",
  textFaint:   "#6b6055",
  accent:      "#b8913f",
  accentHover: "#d4a84b",
  accentDark:  "#96721e",
  heatEmpty:   "#2a2620",
  heatLow:     "#3d3420",
  heatMid:     "#6b5228",
  heatHigh:    "#9c7835",
  heatFull:    "#b8913f",
  chartTrack:  "#2e2b27",
  mapBg:       "#1a1814",
  mapStroke:   "#332f2a",
};

// ── Date / grid helpers ────────────────────────────────────────────────────────

function getDatesLastYear() {
  const dates = [];
  const today = new Date();
  const rawStart = new Date(today);
  rawStart.setFullYear(today.getFullYear() - 1);
  rawStart.setDate(rawStart.getDate() + 1);
  const start = new Date(rawStart);
  start.setDate(start.getDate() - start.getDay()); // roll to Sunday
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split("T")[0]);
  }
  return dates;
}

function groupByWeek(dates) {
  const weeks = [];
  let week = [];
  for (const date of dates) {
    const dow = new Date(date).getDay();
    if (dow === 0 && week.length > 0) { weeks.push(week); week = []; }
    week.push(date);
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function getMonthLabels(weeks) {
  const labels = [];
  let lastMonth = null;
  weeks.forEach((week, i) => {
    const firstReal = week.find(Boolean);
    if (firstReal) {
      const month = new Date(firstReal).getMonth();
      if (month !== lastMonth) {
        labels.push({ index: i, label: new Date(firstReal).toLocaleString("default", { month: "short" }) });
        lastMonth = month;
      }
    }
  });
  return labels;
}

function getColor(count, max) {
  if (!count || count === 0) return C.heatEmpty;
  const intensity = Math.min(count / Math.max(max, 1), 1);
  if (intensity < 0.25) return C.heatLow;
  if (intensity < 0.5)  return C.heatMid;
  if (intensity < 0.75) return C.heatHigh;
  return C.heatFull;
}

function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

function parseEbirdCSV(text) {
  const lines = text.trim().split("\n");
  const headerIdx = lines.findIndex(l => l.includes("Submission ID") || l.includes("Date"));
  if (headerIdx === -1) throw new Error("Couldn't find a header row — is this an eBird MyData CSV?");

  const headers = lines[headerIdx].split(",").map(h => h.replace(/"/g, "").trim());
  const col = (name) => headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const subIdCol    = col("Submission ID");
  const dateCol     = col("Date");
  const locationCol = headers.findIndex(h => h.toLowerCase() === "location");
  const timeCol     = col("Time");
  const durationCol = col("Duration");
  const speciesCol  = col("Common Name");
  const countCol    = col("Count");
  const allObsCol   = col("All Obs");
  const latCol      = col("Latitude");
  const lngCol      = col("Longitude");

  if (dateCol === -1 || subIdCol === -1) {
    throw new Error("CSV is missing expected columns. Make sure you exported from ebird.org/downloadMyData.");
  }

  const byDate = {};
  const checklistMeta = {};

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const cols = [];
    let cur = "", inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());

    const get = (idx) => cols[idx]?.replace(/"/g, "").trim() ?? "";

    const dateStr = get(dateCol);
    const subId   = get(subIdCol);
    if (!dateStr || !subId) continue;

    if (!checklistMeta[subId]) {
      checklistMeta[subId] = {
        subId,
        date: dateStr,
        locName: get(locationCol) || "Unknown location",
        lat: parseFloat(get(latCol)) || null,
        lng: parseFloat(get(lngCol)) || null,
        time: get(timeCol),
        duration: get(durationCol),
        allObsReported: get(allObsCol) === "1",
        obs: [],
      };
    }

    const speciesName = get(speciesCol);
    const count = get(countCol);
    if (speciesName) checklistMeta[subId].obs.push({ comName: speciesName, howManyStr: count });

    if (!byDate[dateStr]) byDate[dateStr] = new Set();
    byDate[dateStr].add(subId);
  }

  const data = {};
  for (const [date, subIds] of Object.entries(byDate)) {
    const checklists = [...subIds].map(id => checklistMeta[id]);
    data[date] = {
      checklists: checklists.length,
      species: Math.max(...checklists.map(cl => cl.obs.length)),
      checklistDetails: checklists,
    };
  }

  const allChecklists = Object.values(checklistMeta);

  const speciesCounts = {};
  for (const cl of allChecklists) {
    for (const obs of cl.obs) {
      if (!obs.comName) continue;
      const n = parseInt(obs.howManyStr, 10);
      speciesCounts[obs.comName] = (speciesCounts[obs.comName] || 0) + (isNaN(n) ? 1 : n);
    }
  }
  const topSpecies = Object.entries(speciesCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const monthCounts = Array(12).fill(0);
  for (const cl of allChecklists) {
    const m = new Date(cl.date + "T12:00:00").getMonth();
    if (!isNaN(m)) monthCounts[m]++;
  }
  const byMonth = monthCounts.map((count, i) => ({
    label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i],
    count,
  }));

  const locationCounts = {};
  for (const cl of allChecklists) {
    if (!cl.locName || cl.locName === "Unknown location") continue;
    locationCounts[cl.locName] = (locationCounts[cl.locName] || 0) + 1;
  }
  const topLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const hourCounts = Array(24).fill(0);
  for (const cl of allChecklists) {
    if (!cl.time) continue;
    const hour = parseInt(cl.time.split(":")[0], 10);
    if (!isNaN(hour)) hourCounts[hour]++;
  }
  const byHour = hourCounts.map((count, h) => ({
    label: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
    count, h,
  }));

  const locationPins = {};
  for (const cl of allChecklists) {
    if (cl.lat == null || cl.lng == null) continue;
    const key = (cl.locName || `${cl.lat.toFixed(3)},${cl.lng.toFixed(3)}`).trim().toLowerCase();
    if (!locationPins[key]) locationPins[key] = { name: cl.locName, lat: cl.lat, lng: cl.lng, count: 0 };
    locationPins[key].count++;
  }
  const pins = Object.values(locationPins);

  return { data, charts: { topSpecies, byMonth, topLocations, byHour, pins } };
}

function applyDateFilter({ data, charts }) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return {
    data: Object.fromEntries(Object.entries(data).filter(([d]) => new Date(d) >= oneYearAgo)),
    charts,
  };
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 14, height: 14,
      border: "2px solid " + C.border,
      borderTopColor: C.accent,
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
      flexShrink: 0,
    }} />
  );
}

// ── Day detail panel ───────────────────────────────────────────────────────────

function DayPanel({ date, dayData, onClose }) {
  if (!date) return null;
  const checklists = dayData?.checklistDetails || [];

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        zIndex: 200, backdropFilter: "blur(2px)", animation: "fadeIn 0.15s ease",
      }} />
      <div className="day-panel" style={{
        position: "fixed",
        bottom: 0, left: 0, right: 0,
        maxHeight: "85vh",
        background: C.bg,
        zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)",
        overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border }} />
        </div>

        <div style={{
          padding: "12px 20px 16px",
          borderBottom: "1px solid " + C.borderSub,
          position: "sticky", top: 0,
          background: C.bg, zIndex: 1,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: C.textFaint, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 6, fontFamily: "DM Sans, sans-serif" }}>
                Field Log
              </div>
              <div style={{ fontFamily: "Libre Baskerville, serif", fontSize: 20, fontStyle: "italic", color: C.textPrimary, lineHeight: 1.3 }}>
                {formatDate(date)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: "1px solid " + C.border,
              color: C.textMuted, width: 32, height: 32, borderRadius: 0,
              padding: 0, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>✕</button>
          </div>

          {dayData && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <div style={{ background: C.heatLow, border: "1px solid " + C.accentDark + "44", borderRadius: 3, padding: "4px 12px", fontSize: 12, color: C.accent }}>
                ✦ {dayData.checklists} checklist{dayData.checklists !== 1 ? "s" : ""}
              </div>
              <div style={{ background: C.heatLow, border: "1px solid " + C.accentDark + "44", borderRadius: 3, padding: "4px 12px", fontSize: 12, color: C.accent }}>
                ◈ {dayData.species} species
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
          {!dayData && (
            <div style={{ color: C.textMuted, fontSize: 13, textAlign: "center", paddingTop: 32 }}>
              No birding activity recorded on this day.
            </div>
          )}

          {checklists.map((cl, i) => (
            <div key={cl.subId || i} style={{ marginBottom: 14, background: "transparent", border: "1px solid " + C.border, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: cl.obs?.length ? "1px solid " + C.borderSub : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "DM Sans, sans-serif" }}>
                      {cl.locName}
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>
                      {[cl.time, cl.duration ? cl.duration + " min" : null, (cl.obs?.length || 0) + " species", cl.allObsReported ? "Complete" : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {cl.subId && (
                    <a href={"https://ebird.org/checklist/" + cl.subId} target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, color: C.accent, border: "1px solid " + C.accentDark + "44", borderRadius: 2, padding: "4px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
                      View ↗
                    </a>
                  )}
                </div>
              </div>

              {cl.obs && cl.obs.length > 0 && (
                <div>
                  {cl.obs.map((obs, j) => (
                    <div key={j} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 14px",
                      borderBottom: j < cl.obs.length - 1 ? "1px solid " + C.borderSub : "none",
                      fontSize: 13,
                    }}>
                      <span style={{ color: C.textSecond, fontFamily: "Libre Baskerville, serif", fontStyle: "italic", fontSize: 12 }}>{obs.comName}</span>
                      <span style={{ color: C.accent, fontVariantNumeric: "tabular-nums", marginLeft: 12, flexShrink: 0, fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}>
                        {obs.howManyStr === "X" ? "✓" : obs.howManyStr || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
        </div>
      </div>
    </>
  );
}

// ── Chart helpers ──────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: C.textFaint, fontFamily: "DM Sans, sans-serif", whiteSpace: "nowrap" }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: C.borderSub }} />
    </div>
  );
}

function HBarChart({ items, maxVal, color = C.accent, labelWidth = 130 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.map(({ name, count }) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: labelWidth, flexShrink: 0, fontSize: 11, color: C.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right", fontStyle: "italic", fontFamily: "Libre Baskerville, serif" }}>
            {name}
          </div>
          <div style={{ flex: 1, height: 10, background: C.chartTrack, borderRadius: 0, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 0,
              width: Math.max(2, (count / maxVal) * 100) + "%",
              background: color,
              transition: "width 0.4s ease",
            }} />
          </div>
          <div style={{ width: 36, flexShrink: 0, fontSize: 11, color: C.textMuted, textAlign: "right" }}>
            {count}
          </div>
        </div>
      ))}
    </div>
  );
}

function VBarChart({ items, maxVal, color = C.accent, highlightFn }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
      {items.map(({ label, count, h }) => {
        const pct = maxVal > 0 ? (count / maxVal) * 100 : 0;
        const highlight = highlightFn ? highlightFn(h ?? label) : true;
        return (
          <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ width: "100%", height: 68, display: "flex", alignItems: "flex-end" }}>
              <div style={{
                width: "100%", borderRadius: "1px 1px 0 0",
                height: Math.max(pct > 0 ? 4 : 0, pct) + "%",
                background: highlight ? color : C.borderSub,
                transition: "height 0.4s ease",
              }} />
            </div>
            <div style={{ fontSize: 8, color: C.textFaint, textAlign: "center", lineHeight: 1, letterSpacing: "0.05em" }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div style={{
      background: "transparent",
      border: "1px solid " + C.border,
      borderRadius: 0,
      padding: "20px 20px 18px",
      flex: "1 1 300px",
      minWidth: 0,
    }}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </div>
  );
}

// ── Location map ───────────────────────────────────────────────────────────────

const COORD_SIZE = 1000;

function mercatorProject(lat, lng) {
  const toRad = d => d * Math.PI / 180;
  return {
    x: lng,
    y: Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2)) * (180 / Math.PI),
  };
}

function makeProjector(minLat, maxLat, minLng, maxLng) {
  const tl = mercatorProject(maxLat, minLng);
  const br = mercatorProject(minLat, maxLng);
  const projW = br.x - tl.x;
  const projH = tl.y - br.y;
  const scale = COORD_SIZE / Math.max(projW, projH);
  const offsetX = (COORD_SIZE - projW * scale) / 2;
  const offsetY = (COORD_SIZE - projH * scale) / 2;
  return (lat, lng) => {
    const p = mercatorProject(lat, lng);
    return {
      x: offsetX + (p.x - tl.x) * scale,
      y: offsetY + (tl.y - p.y) * scale,
    };
  };
}

function ringToPath(ring, project) {
  return ring.map(([lng, lat], i) => {
    const { x, y } = project(lat, lng);
    return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ") + " Z";
}

function geometryToPaths(geometry, project) {
  const paths = [];
  if (geometry.type === "Polygon") {
    paths.push(geometry.coordinates.map(ring => ringToPath(ring, project)).join(" "));
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      paths.push(poly.map(ring => ringToPath(ring, project)).join(" "));
    }
  }
  return paths;
}

function LocationMap({ pins }) {
  const [hoveredPin, setHoveredPin] = React.useState(null);
  const [geoData, setGeoData]       = React.useState(null);
  const [geoError, setGeoError]     = React.useState(false);
  const [zoom, setZoom]             = React.useState(1);

  React.useEffect(() => {
    fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
      .then(r => r.json())
      .then(topo => {
        const obj = topo.objects["states"];
        const arcs = topo.arcs;
        const scale = topo.transform?.scale || [1, 1];
        const translate = topo.transform?.translate || [0, 0];
        const decodedArcs = arcs.map(arc => {
          let x = 0, y = 0;
          return arc.map(([dx, dy]) => {
            x += dx; y += dy;
            return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
          });
        });
        function stitchArcs(arcIndices) {
          const ring = [];
          for (const idx of arcIndices) {
            const arc = idx < 0 ? [...decodedArcs[~idx]].reverse() : decodedArcs[idx];
            ring.push(...(ring.length ? arc.slice(1) : arc));
          }
          return ring;
        }
        const features = obj.geometries.map(geom => {
          let geometry;
          if (geom.type === "Polygon") {
            geometry = { type: "Polygon", coordinates: geom.arcs.map(stitchArcs) };
          } else if (geom.type === "MultiPolygon") {
            geometry = { type: "MultiPolygon", coordinates: geom.arcs.map(p => p.map(stitchArcs)) };
          }
          return { type: "Feature", properties: geom.properties, geometry };
        });
        setGeoData(features);
      })
      .catch(() => setGeoError(true));
  }, []);

  if (!pins || pins.length === 0) return null;

  const lats = pins.map(p => p.lat);
  const lngs = pins.map(p => p.lng);
  const rawMinLat = Math.min(...lats), rawMaxLat = Math.max(...lats);
  const rawMinLng = Math.min(...lngs), rawMaxLng = Math.max(...lngs);
  const basePad = 1.2 / zoom;
  const latSpan = Math.max(rawMaxLat - rawMinLat, 1.5);
  const lngSpan = Math.max(rawMaxLng - rawMinLng, 1.5);
  const minLat = rawMinLat - latSpan * basePad;
  const maxLat = rawMaxLat + latSpan * basePad;
  const minLng = rawMinLng - lngSpan * basePad;
  const maxLng = rawMaxLng + lngSpan * basePad;

  const project  = makeProjector(minLat, maxLat, minLng, maxLng);
  const maxCount = Math.max(...pins.map(p => p.count), 1);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={"0 0 " + COORD_SIZE + " " + COORD_SIZE}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: 260, display: "block", borderRadius: 0, background: C.mapBg }}
      >
        <rect x={0} y={0} width={COORD_SIZE} height={COORD_SIZE} fill={C.mapBg} />

        {geoData && geoData.map((feature, i) => {
          if (!feature.geometry) return null;
          const paths = geometryToPaths(feature.geometry, project);
          return paths.map((d, j) => (
            <path key={i + "-" + j} d={d} fill={C.chartTrack} stroke={C.mapStroke} strokeWidth="0.5" />
          ));
        })}

        {!geoData && !geoError && (
          <text x={COORD_SIZE / 2} y={COORD_SIZE / 2} textAnchor="middle" fontSize="28" fill={C.textFaint}>Loading map…</text>
        )}

        {[...pins].sort((a, b) => b.count - a.count).map((pin) => {
          const { x, y } = project(pin.lat, pin.lng);
          const r = Math.max(6, Math.min(24, 6 + (pin.count / maxCount) * 18));
          const isHovered = hoveredPin === pin.name;
          if (x < 0 || x > COORD_SIZE || y < 0 || y > COORD_SIZE) return null;
          return (
            <g key={pin.name}
              onMouseEnter={() => setHoveredPin(pin.name)}
              onMouseLeave={() => setHoveredPin(null)}
              onTouchStart={() => setHoveredPin(hoveredPin === pin.name ? null : pin.name)}
              style={{ cursor: "pointer" }}>
              <circle cx={x} cy={y} r={r + 6} fill="transparent" />
              <circle cx={x} cy={y} r={r}
                fill={isHovered ? C.accentHover : C.accent}
                fillOpacity={isHovered ? 1 : 0.85}
                stroke={isHovered ? C.textPrimary : C.bg}
                strokeWidth={isHovered ? 1.5 : 0.75}
              />
            </g>
          );
        })}
      </svg>

      <div style={{ position: "absolute", bottom: 12, left: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <button onClick={() => setZoom(z => Math.min(z * 1.5, 8))} style={{
          width: 36, height: 36, borderRadius: 0,
          background: C.surface, border: "1px solid " + C.border,
          color: C.textSecond, fontSize: 20, lineHeight: 1,
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "center", padding: 0, fontFamily: "monospace", minHeight: "unset",
        }}>+</button>
        <button onClick={() => setZoom(z => Math.max(z / 1.5, 0.3))} style={{
          width: 36, height: 36, borderRadius: 0,
          background: C.surface, border: "1px solid " + C.border,
          color: C.textSecond, fontSize: 20, lineHeight: 1,
          cursor: "pointer", display: "flex", alignItems: "center",
          justifyContent: "center", padding: 0, fontFamily: "monospace", minHeight: "unset",
        }}>−</button>
      </div>

      {hoveredPin !== null && pins.find(p => p.name === hoveredPin) && (() => {
        const pin = pins.find(p => p.name === hoveredPin);
        return (
          <div style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
            background: C.surface, border: "1px solid " + C.border,
            borderRadius: 0, padding: "8px 12px", fontSize: 12,
            pointerEvents: "none", whiteSpace: "nowrap", zIndex: 10,
          }}>
            <div style={{ color: C.textPrimary, fontWeight: 500 }}>{pin.name}</div>
            <div style={{ color: C.textMuted, marginTop: 2 }}>
              <span style={{ color: C.accent }}>{pin.count}</span> checklist{pin.count !== 1 ? "s" : ""}
            </div>
          </div>
        );
      })()}

      <div style={{ fontSize: 10, color: C.textFaint, marginTop: 8 }}>
        {pins.length} location{pins.length !== 1 ? "s" : ""} · Dot size = checklist count · Hover for details
      </div>
    </div>
  );
}

// ── Charts section ─────────────────────────────────────────────────────────────

function ChartsSection({ charts }) {
  if (!charts) return null;
  const { topSpecies, byMonth, topLocations, byHour, pins } = charts;
  const maxSpecies  = Math.max(...topSpecies.map(s => s.count), 1);
  const maxMonth    = Math.max(...byMonth.map(m => m.count), 1);
  const maxLocation = Math.max(...topLocations.map(l => l.count), 1);
  const maxHour     = Math.max(...byHour.map(h => h.count), 1);
  const isDaytime   = (h) => h >= 5 && h <= 20;

  return (
    <div style={{ width: "100%", marginTop: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1, height: 1, background: C.borderSub }} />
        <div style={{ fontSize: 10, letterSpacing: "0.3em", color: C.textFaint, textTransform: "uppercase", fontFamily: "DM Sans, sans-serif", fontWeight: 500 }}>
          Field Data
        </div>
        <div style={{ flex: 1, height: 1, background: C.borderSub }} />
      </div>

      {pins && pins.length > 0 && (
        <div style={{ background: "transparent", border: "1px solid " + C.border, padding: "20px 20px 18px", marginBottom: 16 }}>
          <SectionTitle>Birding locations</SectionTitle>
          <LocationMap pins={pins} />
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <ChartCard title="Checklists by month">
          <VBarChart items={byMonth} maxVal={maxMonth} />
        </ChartCard>

        <ChartCard title="Time of day">
          <VBarChart items={byHour} maxVal={maxHour} highlightFn={isDaytime} />
          <div style={{ fontSize: 10, color: C.textFaint, marginTop: 8 }}>Muted bars = nighttime hours</div>
        </ChartCard>

        {topSpecies.length > 0 && (
          <ChartCard title="Top species (by count)">
            <HBarChart items={topSpecies} maxVal={maxSpecies} />
          </ChartCard>
        )}

        {topLocations.length > 0 && (
          <ChartCard title="Top locations (by checklists)">
            <HBarChart items={topLocations} maxVal={maxLocation} color={C.heatHigh} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────

const DAY_LABELS        = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALLOW_VISITOR_UPLOAD = true;

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { box-sizing: border-box; }
  ::selection { background: #b8913f33; }
  @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
  @keyframes slideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
  @keyframes slideIn { from { transform:translateX(100%) } to { transform:translateX(0) } }
  @keyframes spin    { to   { transform:rotate(360deg) } }
  .cell { width: CELL_SIZEpx; height: CELL_SIZEpx; border-radius: 1px; transition: transform 0.1s ease, filter 0.1s ease; flex-shrink: 0; }
  .cell-active { cursor: pointer; }
  @media (hover: hover) { .cell-active:hover { transform: scale(1.4); filter: brightness(1.3); z-index: 10; position: relative; } }
  .heatmap-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: #3d3a35 transparent; }
  .heatmap-scroll::-webkit-scrollbar { height: 4px; }
  .heatmap-scroll::-webkit-scrollbar-track { background: transparent; }
  .heatmap-scroll::-webkit-scrollbar-thumb { background: #3d3a35; border-radius: 1px; }
  .day-panel { border-top: 1px solid #3d3a35; border-radius: 4px 4px 0 0; max-height: 85vh; max-height: 85dvh; }
  @media (min-width: 600px) {
    .day-panel { top: 0; bottom: 0; left: auto; right: 0; width: min(460px, 100vw); max-height: 100vh; max-height: 100dvh; border-top: none; border-left: 1px solid #3d3a35; border-radius: 0; animation: slideIn 0.22s cubic-bezier(0.16,1,0.3,1) !important; }
  }
  .drop-zone { border: 1.5px dashed #3d3a35; padding: 36px 24px; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s; width: 100%; max-width: 480px; }
  .drop-zone:hover, .drop-zone.dragging { border-color: #b8913f; background: rgba(184,145,63,0.04); }
  button { background: #b8913f; color: #1e1d1b; border: none; padding: 12px 28px; border-radius: 0; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; transition: background 0.2s; white-space: nowrap; min-height: 44px; }
  @media (hover: hover) { button:hover { background: #d4a84b; } }
  button:active { background: #96721e; transform: scale(0.98); }
  a { color: #b8913f; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .tooltip { position: fixed; background: #272523; border: 1px solid #3d3a35; padding: 10px 14px; font-size: 12px; pointer-events: none; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
  @media (hover: none) { .tooltip { display: none !important; } }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #3d3a35; border-radius: 1px; }
`.replace(/CELL_SIZE/g, String(CELL_SIZE));

export default function App() {
  const [data, setData]                 = useState({});
  const [charts, setCharts]             = useState(null);
  const [stats, setStats]               = useState(null);
  const [error, setError]               = useState("");
  const [loading, setLoading]           = useState(true);
  const [csvSource, setCsvSource]       = useState(null);
  const [tooltip, setTooltip]           = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dragging, setDragging]         = useState(false);
  const fileInputRef                    = useRef(null);
  const scrollRef                       = useRef(null);

  const dates         = getDatesLastYear();
  const weeks         = groupByWeek(dates);
  const monthLabels   = getMonthLabels(weeks);
  const maxChecklists = Math.max(...Object.values(data).map(d => d.checklists || 0), 1);
  const hasData       = Object.keys(data).length > 0;

  useEffect(() => {
    if (hasData && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [hasData]);

  useEffect(() => {
    fetch("/ebird-data.csv")
      .then(res => { if (!res.ok) throw new Error("no csv"); return res.text(); })
      .then(text => {
        const { data: filtered, charts: c } = applyDateFilter(parseEbirdCSV(text));
        setData(filtered);
        setCharts(c);
        setStats({
          totalChecklists: Object.values(filtered).reduce((s, d) => s + d.checklists, 0),
          totalDays: Object.keys(filtered).length,
        });
        setCsvSource("bundled");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const processFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.endsWith(".csv")) { setError("Please upload a .csv file from ebird.org/downloadMyData"); return; }
    setLoading(true); setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { data: filtered, charts: c } = applyDateFilter(parseEbirdCSV(e.target.result));
        setData(filtered);
        setCharts(c);
        setStats({
          totalChecklists: Object.values(filtered).reduce((s, d) => s + d.checklists, 0),
          totalDays: Object.keys(filtered).length,
        });
        setCsvSource("uploaded");
        setSelectedDate(null);
      } catch (err) { setError(err.message); }
      setLoading(false);
    };
    reader.onerror = () => { setError("Failed to read file."); setLoading(false); };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  return (
    <div style={{
      minHeight: "100dvh",
      background: C.bg,
      fontFamily: "DM Sans, sans-serif",
      color: C.textPrimary,
      display: "flex", flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      padding: "48px 16px 24px",
      paddingTop: "max(48px, env(safe-area-inset-top, 48px))",
    }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 44, width: "100%", maxWidth: 640 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.35em", color: C.textFaint, textTransform: "uppercase", fontFamily: "DM Sans, sans-serif", marginBottom: 14 }}>
          Personal Field Journal
        </div>

        <h1 style={{
          fontFamily: "Libre Baskerville, serif",
          fontSize: "clamp(38px, 9vw, 68px)",
          fontWeight: 700,
          fontStyle: "italic",
          margin: "0 0 0",
          color: C.textPrimary,
          letterSpacing: "-1px",
          lineHeight: 1,
        }}>Field Notes</h1>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <div style={{ flex: 1, height: 1, background: C.border }} />
          <div style={{ fontSize: 10, letterSpacing: "0.2em", color: C.textFaint, textTransform: "uppercase", fontFamily: "DM Sans, sans-serif", whiteSpace: "nowrap" }}>
            eBird · Last 12 Months
          </div>
          <div style={{ flex: 1, height: 1, background: C.border }} />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ color: C.textFaint, fontSize: 12, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 10, marginTop: 40 }}>
          <Spinner /> Loading your data...
        </div>
      )}

      {/* Upload zone */}
      {!loading && !hasData && (
        <div
          className={"drop-zone" + (dragging ? " dragging" : "")}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={e => processFile(e.target.files[0])} />
          <div style={{ fontSize: 32, marginBottom: 12 }}>⬆</div>
          <div style={{ fontSize: 14, color: C.textPrimary, marginBottom: 8, fontWeight: 500, fontFamily: "Libre Baskerville, serif", fontStyle: "italic" }}>
            Load Your Field Data
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.7 }}>
            Place your eBird CSV at{" "}
            <code style={{ color: C.accent }}>public/ebird-data.csv</code> in your project.
            {ALLOW_VISITOR_UPLOAD && (
              <><br /><br />Or upload a CSV to preview now. Download from{" "}
              <a href="https://ebird.org/downloadMyData" target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                ebird.org/downloadMyData
              </a>.</>
            )}
          </div>
          {ALLOW_VISITOR_UPLOAD && (
            <button onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
              Choose CSV file
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#2a2218", border: "1px solid #6e5030",
          padding: "12px 16px", fontSize: 13, color: "#e8a87c",
          marginTop: 16, width: "100%", maxWidth: 560,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Stats bar */}
      {stats && hasData && (
        <div style={{
          display: "flex", gap: 0, marginBottom: 28,
          background: "transparent", border: "1px solid " + C.border,
          width: "100%", maxWidth: 480,
        }}>
          {[
            { value: stats.totalChecklists, label: "Checklists" },
            { value: stats.totalDays,       label: "Days Afield" },
            { value: stats.totalChecklists > 0 ? (stats.totalChecklists / 52).toFixed(1) : "0", label: "Per Week" },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ textAlign: "center", padding: "16px 8px", flex: 1 }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: C.textPrimary, fontFamily: "Libre Baskerville, serif", fontStyle: "italic" }}>{s.value}</div>
                <div style={{ fontSize: 9, color: C.textFaint, marginTop: 5, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "DM Sans, sans-serif", fontWeight: 500 }}>{s.label}</div>
              </div>
              {i < arr.length - 1 && <div style={{ width: 1, alignSelf: "stretch", background: C.border, flexShrink: 0 }} />}
            </div>
          ))}
        </div>
      )}

      {/* Heatmap */}
      {hasData && (
        <div style={{
          background: "transparent", border: "1px solid " + C.border,
          padding: "20px 16px", width: "100%", maxWidth: "100%",
        }}>
          <div className="heatmap-scroll" ref={scrollRef}>
            <div style={{ display: "inline-block", minWidth: "min-content" }}>
              <div style={{ display: "flex", marginLeft: 30, marginBottom: 6 }}>
                {weeks.map((_, i) => {
                  const label = monthLabels.find(m => m.index === i);
                  return (
                    <div key={i} style={{ width: CELL_SIZE + CELL_GAP, fontSize: 10, color: C.textMuted, flexShrink: 0 }}>
                      {label ? label.label : ""}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: CELL_GAP, marginRight: 6 }}>
                  {DAY_LABELS.map((day, i) => (
                    <div key={day} style={{ height: CELL_SIZE, fontSize: 8, color: C.textMuted, display: "flex", alignItems: "center", width: 28, justifyContent: "flex-end" }}>
                      {i < 6 ? DAY_LABELS[i + 1].slice(0, 3) : ""}
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: CELL_GAP }}>
                  {weeks.map((week, wi) => (
                    <div key={wi} style={{ display: "flex", flexDirection: "column", gap: CELL_GAP }}>
                      {week.map((date, di) => {
                        const dayData = date ? data[date] : null;
                        const color = date ? getColor(dayData?.checklists || 0, maxChecklists) : "transparent";
                        return (
                          <div
                            key={di}
                            className={"cell" + (date ? " cell-active" : "")}
                            style={{ background: color }}
                            onClick={() => {
                              if (!date) return;
                              setSelectedDate(date === selectedDate ? null : date);
                              setTooltip(null);
                            }}
                            onMouseEnter={e => {
                              if (!date || selectedDate) return;
                              setTooltip({ x: e.clientX, y: e.clientY, date, checklists: dayData?.checklists || 0, species: dayData?.species || 0 });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                            onMouseMove={e => { if (tooltip && !selectedDate) setTooltip(t => ({ ...t, x: e.clientX, y: e.clientY })); }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 10, color: C.textFaint }}>Tap any day to open field notes</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: C.textMuted }}>Less</span>
              {[C.heatEmpty, C.heatLow, C.heatMid, C.heatHigh, C.heatFull].map(c => (
                <div key={c} className="cell" style={{ background: c }} />
              ))}
              <span style={{ fontSize: 10, color: C.textMuted }}>More</span>
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && !selectedDate && (() => {
        const TIP_W = 180, TIP_H = 90, MARGIN = 12;
        const left = tooltip.x + MARGIN + TIP_W > window.innerWidth ? tooltip.x - TIP_W - MARGIN : tooltip.x + MARGIN;
        const top  = tooltip.y - TIP_H - MARGIN < 0 ? tooltip.y + MARGIN : tooltip.y - TIP_H - MARGIN;
        return (
          <div className="tooltip" style={{ left, top, width: TIP_W }}>
            <div style={{ color: C.textPrimary, fontWeight: 700, marginBottom: 6, fontSize: 12, fontFamily: "Libre Baskerville, serif", fontStyle: "italic" }}>
              {new Date(tooltip.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </div>
            {tooltip.checklists === 0 ? (
              <div style={{ color: C.textMuted, fontSize: 11 }}>No activity</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: C.textMuted }}>✦ <span style={{ color: C.accent }}>{tooltip.checklists}</span> checklist{tooltip.checklists !== 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>◈ <span style={{ color: C.accent }}>{tooltip.species}</span> species (best)</div>
                <div style={{ fontSize: 10, color: C.textFaint, marginTop: 6 }}>Click for details →</div>
              </>
            )}
          </div>
        );
      })()}

      {/* Day detail panel */}
      {selectedDate && (
        <DayPanel
          date={selectedDate}
          dayData={data[selectedDate] || null}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {/* Charts */}
      <ChartsSection charts={charts} />

      {/* Footer */}
      <div style={{ marginTop: 40, width: "100%", maxWidth: 640 }}>
        <div style={{ height: 1, background: C.borderSub, marginBottom: 20 }} />
        <div style={{ fontSize: 10, color: C.textFaint, textAlign: "center", lineHeight: 2, letterSpacing: "0.05em", fontFamily: "DM Sans, sans-serif" }}>
          <div>
            {csvSource === "bundled"
              ? "Data from bundled eBird export · Parsed locally in your browser"
              : "Data from eBird MyData export · Parsed locally, nothing uploaded to any server"}
          </div>
          <div>
            © {new Date().getFullYear()} · Made with ♥ in Maine by{" "}
            <a href="https://leblanc.sh" target="_blank" rel="noreferrer" style={{ color: C.textMuted }}>
              LeBlanc Engineering
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}