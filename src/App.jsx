import { useState, useEffect, useCallback, useRef } from "react";

// On mobile, cells are slightly larger for easier tapping
const CELL_SIZE = 13;
const CELL_GAP  = 3;

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
  if (!count || count === 0) return "#2a1500";
  const intensity = Math.min(count / Math.max(max, 1), 1);
  if (intensity < 0.25) return "#3d1500";
  if (intensity < 0.5)  return "#a83000";
  if (intensity < 0.75) return "#d93e00";
  return "#fc4c02";
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
  return data;
}

function applyDateFilter(parsed) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return Object.fromEntries(Object.entries(parsed).filter(([d]) => new Date(d) >= oneYearAgo));
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 14, height: 14,
      border: "2px solid #333333",
      borderTopColor: "#fc4c02",
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
      <div style={{
        position: "fixed",
        // On mobile: full-width bottom sheet. On desktop: right side panel.
        bottom: 0, left: 0, right: 0,
        maxHeight: "85vh",
        background: "#1a1a1a",
        borderTop: "1px solid #333333",
        borderRadius: "16px 16px 0 0",
        zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp 0.25s cubic-bezier(0.16,1,0.3,1)",
        overflowY: "auto",
        // On wider screens, switch to side panel
        // (handled via media query in <style>)
      }} className="day-panel">
        {/* Drag handle — mobile affordance */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333333" }} />
        </div>

        {/* Header */}
        <div style={{
          padding: "12px 20px 16px",
          borderBottom: "1px solid #2e2e2e",
          position: "sticky", top: 0,
          background: "#1a1a1a", zIndex: 1,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "#555555", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                Daily Summary
              </div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, color: "#f0f0f0", lineHeight: 1.3 }}>
                {formatDate(date)}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: "transparent", border: "1px solid #333333",
              color: "#999999", width: 32, height: 32, borderRadius: 6,
              padding: 0, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>✕</button>
          </div>

          {dayData && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <div style={{ background: "#3d1500", border: "1px solid #d93e0044", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#fc4c02" }}>
                🗒 {dayData.checklists} checklist{dayData.checklists !== 1 ? "s" : ""}
              </div>
              <div style={{ background: "#3d1500", border: "1px solid #d93e0044", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#fc4c02" }}>
                🐦 {dayData.species} species
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
          {!dayData && (
            <div style={{ color: "#999999", fontSize: 13, textAlign: "center", paddingTop: 32 }}>
              No birding activity recorded on this day.
            </div>
          )}

          {checklists.map((cl, i) => (
            <div key={cl.subId || i} style={{ marginBottom: 14, background: "#242424", border: "1px solid #2e2e2e", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", borderBottom: cl.obs?.length ? "1px solid #2e2e2e" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#f0f0f0", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      📍 {cl.locName}
                    </div>
                    <div style={{ fontSize: 11, color: "#999999" }}>
                      {[cl.time, cl.duration ? `${cl.duration} min` : null, `${cl.obs?.length || 0} species`, cl.allObsReported ? "Complete" : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {cl.subId && (
                    <a href={`https://ebird.org/checklist/${cl.subId}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, color: "#fc4c02", border: "1px solid #d93e0044", borderRadius: 4, padding: "4px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
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
                      borderBottom: j < cl.obs.length - 1 ? "1px solid #2e2e2e" : "none",
                      fontSize: 13, // slightly larger for mobile readability
                    }}>
                      <span style={{ color: "#dddddd" }}>{obs.comName}</span>
                      <span style={{ color: "#fc4c02", fontVariantNumeric: "tabular-nums", marginLeft: 12, flexShrink: 0 }}>
                        {obs.howManyStr === "X" ? "✓" : obs.howManyStr || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Safe area padding for home indicator on iOS */}
          <div style={{ height: "env(safe-area-inset-bottom, 16px)" }} />
        </div>
      </div>
    </>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALLOW_VISITOR_UPLOAD = true;

export default function App() {
  const [data, setData]                 = useState({});
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

  // Scroll heatmap to the right (most recent dates) on mount/data load
  useEffect(() => {
    if (hasData && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [hasData]);

  // Load bundled CSV on mount
  useEffect(() => {
    fetch("/ebird-data.csv")
      .then(res => { if (!res.ok) throw new Error("no csv"); return res.text(); })
      .then(text => {
        const filtered = applyDateFilter(parseEbirdCSV(text));
        setData(filtered);
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
        const filtered = applyDateFilter(parseEbirdCSV(e.target.result));
        setData(filtered);
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
      minHeight: "100vh",
      minHeight: "100dvh", // dynamic viewport height — accounts for mobile browser chrome
      background: "#1a1a1a",
      fontFamily: "'Barlow', sans-serif",
      color: "#f0f0f0",
      display: "flex", flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start", // top-align on mobile; centered via padding
      padding: "40px 16px 24px",
      paddingTop: "max(40px, env(safe-area-inset-top, 40px))",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #fc4c0233; }
        @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes slideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
        @keyframes spin    { to { transform:rotate(360deg) } }

        .cell {
          width: ${CELL_SIZE}px; height: ${CELL_SIZE}px;
          border-radius: 2px;
          transition: transform 0.1s ease, filter 0.1s ease;
          flex-shrink: 0;
        }
        .cell-active { cursor: pointer; }
        /* Only apply hover scale on non-touch devices */
        @media (hover: hover) {
          .cell-active:hover { transform: scale(1.4); filter: brightness(1.3); z-index: 10; position: relative; }
        }

        /* Heatmap scroll container — smooth momentum on iOS */
        .heatmap-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: #333333 transparent;
        }
        .heatmap-scroll::-webkit-scrollbar { height: 4px; }
        .heatmap-scroll::-webkit-scrollbar-track { background: transparent; }
        .heatmap-scroll::-webkit-scrollbar-thumb { background: #333333; border-radius: 2px; }

        /* Day panel: bottom sheet on mobile, side panel on wider screens */
        .day-panel {
          border-top: 1px solid #333333;
          border-radius: 16px 16px 0 0;
          max-height: 85vh;
          max-height: 85dvh;
        }
        @media (min-width: 600px) {
          .day-panel {
            top: 0; bottom: 0; left: auto; right: 0;
            width: min(460px, 100vw);
            max-height: 100vh;
            max-height: 100dvh;
            border-top: none;
            border-left: 1px solid #333333;
            border-radius: 0;
            animation: slideIn 0.22s cubic-bezier(0.16,1,0.3,1) !important;
          }
          @keyframes slideIn { from { transform:translateX(100%) } to { transform:translateX(0) } }
        }

        .drop-zone {
          border: 1.5px dashed #333333;
          border-radius: 12px; padding: 36px 24px;
          text-align: center; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          width: 100%; max-width: 480px;
        }
        .drop-zone:hover, .drop-zone.dragging { border-color: #fc4c02; background: #fc4c0208; }

        button {
          background: #fc4c02; color: #1a1a1a; border: none;
          padding: 12px 24px; border-radius: 6px;
          font-family: 'Barlow', sans-serif; font-weight: 500; font-size: 14px; letter-spacing: 0.03em; text-transform: uppercase;
          cursor: pointer; transition: background 0.2s; white-space: nowrap;
          /* Larger tap target on mobile */
          min-height: 44px;
        }
        @media (hover: hover) {
          button:hover { background: #ff6a33; transform: translateY(-1px); }
        }
        button:active { background: #e04400; transform: scale(0.98); }

        a { color: #fc4c02; text-decoration: none; }
        a:hover { text-decoration: underline; }

        /* Tooltip — desktop only */
        .tooltip {
          position: fixed; background: #242424; border: 1px solid #333333;
          border-radius: 8px; padding: 10px 14px; font-size: 12px;
          pointer-events: none; z-index: 100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        @media (hover: none) { .tooltip { display: none !important; } }

        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333333; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32, width: "100%" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🦅</div>
        <h1 style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontSize: "clamp(26px, 7vw, 38px)", fontWeight: 700,
          margin: "0 0 8px",
          background: "linear-gradient(135deg, #fc4c02, #d93e00)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          letterSpacing: "0.5px", textTransform: "uppercase",
        }}>Birding Activity</h1>
        <p style={{ color: "#999999", fontSize: 13, margin: 0 }}>
          Personal checklist heatmap · Last 12 months
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ color: "#999999", fontSize: 13, display: "flex", alignItems: "center", gap: 10, marginTop: 40 }}>
          <Spinner /> Loading your data...
        </div>
      )}

      {/* Upload zone */}
      {!loading && !hasData && (
        <div
          className={`drop-zone${dragging ? " dragging" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
            onChange={e => processFile(e.target.files[0])} />
          <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 14, color: "#f0f0f0", marginBottom: 8, fontWeight: 500 }}>
            No data file found
          </div>
          <div style={{ fontSize: 12, color: "#999999", marginBottom: 16, lineHeight: 1.7 }}>
            To host your own heatmap, place your eBird CSV at{" "}
            <code style={{ color: "#fc4c02" }}>public/ebird-data.csv</code> in your project.
            {ALLOW_VISITOR_UPLOAD && (
              <><br /><br />Or upload a CSV to preview it now. Download yours from{" "}
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
          background: "#2d1b1b", border: "1px solid #6e3030",
          borderRadius: 8, padding: "12px 16px",
          fontSize: 13, color: "#f47c7c",
          marginTop: 16, width: "100%", maxWidth: 560,
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Stats bar */}
      {stats && hasData && (
        <div style={{
          display: "flex", gap: 0, marginBottom: 24,
          background: "#242424", borderRadius: 10,
          border: "1px solid #333333", overflow: "hidden",
          width: "100%", maxWidth: 420,
        }}>
          {[
            { value: stats.totalChecklists, label: "checklists" },
            { value: stats.totalDays, label: "active days" },
            { value: stats.totalChecklists > 0 ? (stats.totalChecklists / 52).toFixed(1) : "0", label: "avg / week" },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ textAlign: "center", padding: "12px 8px", flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 500, color: "#fc4c02" }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#999999", marginTop: 2 }}>{s.label}</div>
              </div>
              {i < arr.length - 1 && <div style={{ width: 1, height: 32, background: "#333333", flexShrink: 0 }} />}
            </div>
          ))}
        </div>
      )}

      {/* Heatmap */}
      {hasData && (
        <div style={{
          background: "#242424", border: "1px solid #333333",
          borderRadius: 12, padding: "20px 16px",
          width: "100%", maxWidth: "100%",
        }}>
          <div className="heatmap-scroll" ref={scrollRef}>
            <div style={{ display: "inline-block", minWidth: "min-content" }}>
              {/* Month labels */}
              <div style={{ display: "flex", marginLeft: 30, marginBottom: 6 }}>
                {weeks.map((_, i) => {
                  const label = monthLabels.find(m => m.index === i);
                  return (
                    <div key={i} style={{ width: CELL_SIZE + CELL_GAP, fontSize: 10, color: "#999999", flexShrink: 0 }}>
                      {label ? label.label : ""}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex" }}>
                {/* Day labels */}
                <div style={{ display: "flex", flexDirection: "column", gap: CELL_GAP, marginRight: 6 }}>
                  {DAY_LABELS.map((day, i) => (
                    <div key={day} style={{ height: CELL_SIZE, fontSize: 9, color: "#999999", display: "flex", alignItems: "center", width: 24, justifyContent: "flex-end" }}>
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
                            return (
                          <div
                            key={di}
                            className={`cell${date ? " cell-active" : ""}`}
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

          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#555555" }}>Tap any active day for details</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: "#999999" }}>Less</span>
              {["#2a1500", "#3d1500", "#a83000", "#d93e00", "#fc4c02"].map(c => (
                <div key={c} className="cell" style={{ background: c }} />
              ))}
              <span style={{ fontSize: 10, color: "#999999" }}>More</span>
            </div>
          </div>
        </div>
      )}

      {/* Hover tooltip — hidden on touch devices via CSS */}
      {tooltip && !selectedDate && (() => {
        const TIP_W = 180;
        const TIP_H = 90;
        const MARGIN = 12;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Horizontal: prefer right of cursor, flip left if it would overflow
        const left = tooltip.x + MARGIN + TIP_W > vw
          ? tooltip.x - TIP_W - MARGIN
          : tooltip.x + MARGIN;
        // Vertical: prefer above cursor, flip below if it would overflow top
        const top = tooltip.y - TIP_H - MARGIN < 0
          ? tooltip.y + MARGIN
          : tooltip.y - TIP_H - MARGIN;
        return (
          <div className="tooltip" style={{ left, top, width: TIP_W }}>
            <div style={{ color: "#f0f0f0", fontWeight: 500, marginBottom: 6, fontSize: 12 }}>
              {new Date(tooltip.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </div>
            {tooltip.checklists === 0 ? (
              <div style={{ color: "#999999", fontSize: 11 }}>No activity</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "#999999" }}>🗒 <span style={{ color: "#fc4c02" }}>{tooltip.checklists}</span> checklist{tooltip.checklists !== 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11, color: "#999999", marginTop: 3 }}>🐦 <span style={{ color: "#fc4c02" }}>{tooltip.species}</span> species (best)</div>
                <div style={{ fontSize: 10, color: "#555555", marginTop: 6 }}>Click for details →</div>
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

      {/* Footer */}
      <div style={{ fontSize: 11, color: "#555555", marginTop: 28, textAlign: "center", lineHeight: 1.8 }}>
        <div>
          {csvSource === "bundled"
            ? "Data from bundled eBird export · Parsed locally in your browser"
            : "Data from eBird MyData export · Parsed locally, nothing uploaded to any server"}
        </div>
        <div>
          © {new Date().getFullYear()} · Made with ♥ in Maine by{" "}
          <a href="https://leblanc.sh" target="_blank" rel="noreferrer" style={{ color: "#999999" }}>
            LeBlanc Engineering
          </a>
        </div>
      </div>
    </div>
  );
}