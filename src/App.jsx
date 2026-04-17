import { useState, useEffect, useCallback, useRef } from "react";

const CELL_SIZE = 13;
const CELL_GAP = 3;

// ── Date / grid helpers ────────────────────────────────────────────────────────

function getDatesLastYear() {
  const dates = [];
  const today = new Date();
  const start = new Date(today);
  start.setFullYear(today.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d).toISOString().split("T")[0]);
  }
  return dates;
}

function groupByWeek(dates) {
  const weeks = [];
  const firstDate = new Date(dates[0]);
  const dayOfWeek = firstDate.getDay();
  let week = [];
  for (let i = 0; i < dayOfWeek; i++) week.push(null);
  for (const date of dates) {
    const d = new Date(date);
    if (d.getDay() === 0 && week.length > 0) { weeks.push(week); week = []; }
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
  if (!count || count === 0) return "#1a1f2e";
  const intensity = Math.min(count / Math.max(max, 1), 1);
  if (intensity < 0.25) return "#0d3b2e";
  if (intensity < 0.5)  return "#1a6b4a";
  if (intensity < 0.75) return "#2d9e6b";
  return "#45d08c";
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
  const locationCol = col("Location");
  const timeCol     = col("Time");
  const durationCol = col("Duration");
  const speciesCol  = col("Common Name");
  const countCol    = col("Count");
  const allObsCol   = col("All Obs");

  if (dateCol === -1 || subIdCol === -1) {
    throw new Error("CSV is missing expected columns. Make sure you exported from ebird.org/downloadMyData.");
  }

  const byDate = {};
  const checklistMeta = {};

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Parse CSV line respecting quoted fields
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
        time: get(timeCol),
        duration: get(durationCol),
        allObsReported: get(allObsCol) === "1",
        obs: [],
      };
    }

    const speciesName = get(speciesCol);
    const count = get(countCol);
    if (speciesName) {
      checklistMeta[subId].obs.push({ comName: speciesName, howManyStr: count });
    }

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

  return data;
}

function applyDateFilter(parsed) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return Object.fromEntries(
    Object.entries(parsed).filter(([d]) => new Date(d) >= oneYearAgo)
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 14, height: 14,
      border: "2px solid #30363d",
      borderTopColor: "#45d08c",
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
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 200, backdropFilter: "blur(2px)", animation: "fadeIn 0.15s ease",
      }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: "min(460px, 100vw)",
        background: "#0d1117",
        borderLeft: "1px solid #30363d",
        zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideIn 0.22s cubic-bezier(0.16,1,0.3,1)",
        overflowY: "auto",
      }}>
        <div style={{
          padding: "24px 24px 18px",
          borderBottom: "1px solid #21262d",
          position: "sticky", top: 0,
          background: "#0d1117", zIndex: 1,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "#484f58", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                Daily Summary
              </div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 19, color: "#e6edf3", lineHeight: 1.3 }}>
                {formatDate(date)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: "1px solid #30363d",
              color: "#7d8590", width: 30, height: 30, borderRadius: 6,
              padding: 0, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>✕</button>
          </div>
          {dayData && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <div style={{ background: "#0d3b2e", border: "1px solid #2d9e6b44", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#45d08c" }}>
                🗒 {dayData.checklists} checklist{dayData.checklists !== 1 ? "s" : ""}
              </div>
              <div style={{ background: "#0d3b2e", border: "1px solid #2d9e6b44", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#45d08c" }}>
                🐦 {dayData.species} species
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "18px 24px", flex: 1 }}>
          {!dayData && (
            <div style={{ color: "#7d8590", fontSize: 13, textAlign: "center", paddingTop: 48 }}>
              No birding activity recorded on this day.
            </div>
          )}
          {checklists.map((cl, i) => (
            <div key={cl.subId || i} style={{ marginBottom: 16, background: "#161b22", border: "1px solid #21262d", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: cl.obs?.length ? "1px solid #21262d" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#e6edf3", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      📍 {cl.locName}
                    </div>
                    <div style={{ fontSize: 11, color: "#7d8590" }}>
                      {[cl.time, cl.duration ? `${cl.duration} min` : null, `${cl.obs?.length || 0} species`, cl.allObsReported ? "Complete" : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {cl.subId && (
                    <a href={`https://ebird.org/checklist/${cl.subId}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, color: "#45d08c", border: "1px solid #2d9e6b44", borderRadius: 4, padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
                      View ↗
                    </a>
                  )}
                </div>
              </div>
              {cl.obs && cl.obs.length > 0 && (
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {cl.obs.map((obs, j) => (
                    <div key={j} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "6px 14px",
                      borderBottom: j < cl.obs.length - 1 ? "1px solid #21262d" : "none",
                      fontSize: 12,
                    }}>
                      <span style={{ color: "#c9d1d9" }}>{obs.comName}</span>
                      <span style={{ color: "#45d08c", fontVariantNumeric: "tabular-nums", marginLeft: 12, flexShrink: 0 }}>
                        {obs.howManyStr === "X" ? "✓" : obs.howManyStr || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Set to true if you want to allow visitors to upload their own CSV as a fallback
const ALLOW_VISITOR_UPLOAD = true;

export default function App() {
  const [data, setData]                 = useState({});
  const [stats, setStats]               = useState(null);
  const [error, setError]               = useState("");
  const [loading, setLoading]           = useState(true);
  const [csvSource, setCsvSource]       = useState(null); // "bundled" | "uploaded"
  const [tooltip, setTooltip]           = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dragging, setDragging]         = useState(false);
  const fileInputRef                    = useRef(null);

  const dates         = getDatesLastYear();
  const weeks         = groupByWeek(dates);
  const monthLabels   = getMonthLabels(weeks);
  const maxChecklists = Math.max(...Object.values(data).map(d => d.checklists || 0), 1);
  const hasData       = Object.keys(data).length > 0;

  // ── Try to load bundled CSV from public/ on mount ──────────────────────────
  useEffect(() => {
    fetch("/ebird-data.csv")
      .then(res => {
        if (!res.ok) throw new Error("no bundled csv");
        return res.text();
      })
      .then(text => {
        const parsed = parseEbirdCSV(text);
        const filtered = applyDateFilter(parsed);
        setData(filtered);
        setStats({
          totalChecklists: Object.values(filtered).reduce((s, d) => s + d.checklists, 0),
          totalDays: Object.keys(filtered).length,
        });
        setCsvSource("bundled");
        setLoading(false);
      })
      .catch(() => {
        // No bundled CSV — show upload UI instead
        setLoading(false);
      });
  }, []);

  // ── Process an uploaded file ───────────────────────────────────────────────
  const processFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setError("Please upload a .csv file exported from ebird.org/downloadMyData");
      return;
    }
    setLoading(true);
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseEbirdCSV(e.target.result);
        const filtered = applyDateFilter(parsed);
        setData(filtered);
        setStats({
          totalChecklists: Object.values(filtered).reduce((s, d) => s + d.checklists, 0),
          totalDays: Object.keys(filtered).length,
        });
        setCsvSource("uploaded");
        setSelectedDate(null);
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    };
    reader.onerror = () => { setError("Failed to read file."); setLoading(false); };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1117",
      fontFamily: "'DM Mono', 'Fira Mono', monospace",
      color: "#e6edf3",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "40px 20px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Playfair+Display:wght@700&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #45d08c33; }
        @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes slideIn { from { transform:translateX(100%) } to { transform:translateX(0) } }
        @keyframes spin    { to { transform:rotate(360deg) } }
        .cell {
          width: ${CELL_SIZE}px; height: ${CELL_SIZE}px;
          border-radius: 2px;
          transition: transform 0.1s ease, filter 0.1s ease;
          flex-shrink: 0;
        }
        .cell-active { cursor: pointer; }
        .cell-active:hover { transform: scale(1.4); filter: brightness(1.3); z-index: 10; position: relative; }
        .cell-selected { outline: 2px solid #45d08c; outline-offset: 1px; }
        .drop-zone {
          border: 1.5px dashed #30363d;
          border-radius: 12px; padding: 40px 32px;
          text-align: center; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          width: 100%; max-width: 480px;
        }
        .drop-zone:hover, .drop-zone.dragging { border-color: #45d08c; background: #45d08c08; }
        button {
          background: #45d08c; color: #0d1117; border: none;
          padding: 10px 24px; border-radius: 6px;
          font-family: 'DM Mono', monospace; font-weight: 500; font-size: 13px;
          cursor: pointer; transition: background 0.2s, transform 0.1s; white-space: nowrap;
        }
        button:hover { background: #5de0a0; transform: translateY(-1px); }
        button:active { transform: translateY(0); }
        a { color: #45d08c; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .tooltip {
          position: fixed; background: #161b22; border: 1px solid #30363d;
          border-radius: 8px; padding: 10px 14px; font-size: 12px;
          pointer-events: none; z-index: 100; min-width: 160px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🦅</div>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: "clamp(24px, 5vw, 38px)", fontWeight: 700,
          margin: "0 0 8px",
          background: "linear-gradient(135deg, #45d08c, #2d9e6b)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: "-0.5px",
        }}>Birding Activity</h1>
        <p style={{ color: "#7d8590", fontSize: 13, margin: 0 }}>
          Personal checklist heatmap · Last 12 months
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ color: "#7d8590", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner /> Loading your data...
        </div>
      )}

      {/* Upload zone — shown when no bundled CSV found and not yet loaded */}
      {!loading && !hasData && (
        <>
          <div
            className={`drop-zone${dragging ? " dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
              onChange={e => processFile(e.target.files[0])} />
            <>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
              <div style={{ fontSize: 14, color: "#e6edf3", marginBottom: 8, fontWeight: 500 }}>
                No data file found
              </div>
              <div style={{ fontSize: 12, color: "#7d8590", marginBottom: 16, lineHeight: 1.7 }}>
                To host your own heatmap, place your eBird CSV at<br />
                <code style={{ color: "#45d08c" }}>public/ebird-data.csv</code> in your project.<br /><br />
                {ALLOW_VISITOR_UPLOAD && (
                  <>Or upload a CSV below to preview it now.<br />
                  Download yours from{" "}
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
            </>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#2d1b1b", border: "1px solid #6e3030",
          borderRadius: 8, padding: "12px 16px",
          fontSize: 13, color: "#f47c7c",
          marginTop: 16, maxWidth: 560, width: "100%",
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Stats bar */}
      {stats && hasData && (
        <div style={{ display: "flex", gap: 0, marginBottom: 28, background: "#161b22", borderRadius: 10, border: "1px solid #30363d", overflow: "hidden" }}>
          {[
            { value: stats.totalChecklists, label: "checklists" },
            { value: stats.totalDays, label: "active days" },
            { value: stats.totalChecklists > 0 ? (stats.totalChecklists / 52).toFixed(1) : "0", label: "avg / week" },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ textAlign: "center", padding: "14px 28px" }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: "#45d08c" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#7d8590", marginTop: 2 }}>{s.label}</div>
              </div>
              {i < arr.length - 1 && <div style={{ width: 1, height: 36, background: "#30363d" }} />}
            </div>
          ))}
        </div>
      )}

      {/* Heatmap */}
      {hasData && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: "24px 28px", overflowX: "auto", maxWidth: "100%" }}>
          {/* Month labels */}
          <div style={{ display: "flex", marginLeft: 30, marginBottom: 6 }}>
            {weeks.map((_, i) => {
              const label = monthLabels.find(m => m.index === i);
              return (
                <div key={i} style={{ width: CELL_SIZE + CELL_GAP, fontSize: 10, color: "#7d8590", flexShrink: 0 }}>
                  {label ? label.label : ""}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex" }}>
            {/* Day labels */}
            <div style={{ display: "flex", flexDirection: "column", gap: CELL_GAP, marginRight: 6 }}>
              {DAY_LABELS.map((day, i) => (
                <div key={day} style={{ height: CELL_SIZE, fontSize: 9, color: "#7d8590", display: "flex", alignItems: "center", width: 24, justifyContent: "flex-end" }}>
                  {i % 2 === 1 ? day.slice(0, 3) : ""}
                </div>
              ))}
            </div>

            {/* Grid */}
            <div style={{ display: "flex", gap: CELL_GAP }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: "flex", flexDirection: "column", gap: CELL_GAP }}>
                  {week.map((date, di) => {
                    const dayData = date ? data[date] : null;
                    const color = date ? getColor(dayData?.checklists || 0, maxChecklists) : "transparent";
                    const isSelected = date === selectedDate;
                    return (
                      <div
                        key={di}
                        className={`cell${date ? " cell-active" : ""}${isSelected ? " cell-selected" : ""}`}
                        style={{ background: color }}
                        onClick={() => { if (!date) return; setSelectedDate(date === selectedDate ? null : date); setTooltip(null); }}
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

          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#484f58" }}>Click any active day for details</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "#7d8590" }}>Less</span>
              {["#1a1f2e", "#0d3b2e", "#1a6b4a", "#2d9e6b", "#45d08c"].map(c => (
                <div key={c} className="cell" style={{ background: c }} />
              ))}
              <span style={{ fontSize: 10, color: "#7d8590" }}>More</span>
            </div>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && !selectedDate && (
        <div className="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 70 }}>
          <div style={{ color: "#e6edf3", fontWeight: 500, marginBottom: 6, fontSize: 12 }}>
            {new Date(tooltip.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
          </div>
          {tooltip.checklists === 0 ? (
            <div style={{ color: "#7d8590", fontSize: 11 }}>No activity</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "#7d8590" }}>🗒 <span style={{ color: "#45d08c" }}>{tooltip.checklists}</span> checklist{tooltip.checklists !== 1 ? "s" : ""}</div>
              <div style={{ fontSize: 11, color: "#7d8590", marginTop: 3 }}>🐦 <span style={{ color: "#45d08c" }}>{tooltip.species}</span> species (best)</div>
              <div style={{ fontSize: 10, color: "#484f58", marginTop: 6 }}>Click for details →</div>
            </>
          )}
        </div>
      )}

      {/* Day detail panel */}
      {selectedDate && (
        <DayPanel
          date={selectedDate}
          dayData={data[selectedDate] || null}
          onClose={() => setSelectedDate(null)}
        />
      )}

      <p style={{ fontSize: 11, color: "#484f58", marginTop: 32, textAlign: "center" }}>
        {csvSource === "bundled"
          ? "Data from bundled eBird export · Parsed locally in your browser"
          : "Data from eBird MyData export · Parsed locally, nothing uploaded to any server"}
      </p>
    </div>
  );
}