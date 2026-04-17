import { useState, useEffect, useCallback } from "react";

const CELL_SIZE = 13;
const CELL_GAP = 3;

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
  if (intensity < 0.5) return "#1a6b4a";
  if (intensity < 0.75) return "#2d9e6b";
  return "#45d08c";
}

function formatDate(dateStr) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
}

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

function DayPanel({ date, dayData, apiKey, allChecklists, onClose, useProxy }) {
  const [checklists, setChecklists] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!date || !dayData) { setLoading(false); return; }
    async function load() {
      setLoading(true);
      setError("");
      try {
        const dayItems = (allChecklists || []).filter(c => c.obsDt?.startsWith(date));
        const detailed = await Promise.all(
          dayItems.slice(0, 6).map(async (c) => {
            try {
              const res = useProxy
                ? await fetch(`/api/ebird-checklist?checklistId=${c.subId}`)
                : await fetch(
                    `https://api.ebird.org/v2/product/checklist/view/${c.subId}`,
                    { headers: { "X-eBirdApiToken": apiKey } }
                  );
              if (!res.ok) return { ...c, obs: [], locName: c.loc?.name || "Unknown location" };
              const json = await res.json();
              return { ...c, obs: json.obs || [], locName: json.loc?.name || c.loc?.name || "Unknown location", durationHrs: json.durationHrs };
            } catch {
              return { ...c, obs: [], locName: c.loc?.name || "Unknown location" };
            }
          })
        );
        setChecklists(detailed);
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    }
    load();
  }, [date, apiKey, allChecklists, dayData]);

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
        {/* Header */}
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
              <div style={{
                background: "#0d3b2e", border: "1px solid #2d9e6b44",
                borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#45d08c",
              }}>
                🗒 {dayData.checklists} checklist{dayData.checklists !== 1 ? "s" : ""}
              </div>
              <div style={{
                background: "#0d3b2e", border: "1px solid #2d9e6b44",
                borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#45d08c",
              }}>
                🐦 {dayData.species} species
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: "18px 24px", flex: 1 }}>
          {!dayData && (
            <div style={{ color: "#7d8590", fontSize: 13, textAlign: "center", paddingTop: 48 }}>
              No birding activity recorded on this day.
            </div>
          )}

          {loading && dayData && (
            <div style={{ color: "#7d8590", fontSize: 13, display: "flex", alignItems: "center", gap: 10 }}>
              <Spinner /> Loading checklist details...
            </div>
          )}

          {error && (
            <div style={{ color: "#f47c7c", fontSize: 13, background: "#2d1b1b", border: "1px solid #6e3030", borderRadius: 8, padding: "10px 14px" }}>
              ⚠️ {error}
            </div>
          )}

          {!loading && checklists && checklists.map((cl, i) => (
            <div key={cl.subId || i} style={{
              marginBottom: 16,
              background: "#161b22",
              border: "1px solid #21262d",
              borderRadius: 10,
              overflow: "hidden",
            }}>
              {/* Checklist header */}
              <div style={{ padding: "12px 14px", borderBottom: cl.obs?.length ? "1px solid #21262d" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#e6edf3", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      📍 {cl.locName}
                    </div>
                    <div style={{ fontSize: 11, color: "#7d8590" }}>
                      {[
                        cl.obsDt?.split(" ")[1],
                        cl.durationHrs ? `${Math.round(cl.durationHrs * 60)} min` : null,
                        `${cl.obs?.length || cl.numSpecies || 0} species`,
                        cl.allObsReported ? "Complete" : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {cl.subId && (
                    <a href={`https://ebird.org/checklist/${cl.subId}`} target="_blank" rel="noreferrer"
                      style={{
                        fontSize: 10, color: "#45d08c",
                        border: "1px solid #2d9e6b44", borderRadius: 4,
                        padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0,
                      }}>
                      View ↗
                    </a>
                  )}
                </div>
              </div>

              {/* Species list */}
              {cl.obs && cl.obs.length > 0 && (
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {cl.obs.map((obs, j) => (
                    <div key={j} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "6px 14px",
                      borderBottom: j < cl.obs.length - 1 ? "1px solid #21262d" : "none",
                      fontSize: 12,
                    }}>
                      <span style={{ color: "#c9d1d9" }}>{obs.comName || obs.speciesCode}</span>
                      <span style={{ color: "#45d08c", fontVariantNumeric: "tabular-nums", marginLeft: 12, flexShrink: 0 }}>
                        {obs.howManyStr === "X" ? "✓" : obs.howManyStr || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {cl.obs && cl.obs.length === 0 && (
                <div style={{ padding: "10px 14px", fontSize: 12, color: "#7d8590" }}>
                  No species detail available.
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const ENV_API_KEY = typeof import.meta !== "undefined" ? (import.meta.env?.VITE_EBIRD_API_KEY || "") : "";
const ENV_USERNAME = typeof import.meta !== "undefined" ? (import.meta.env?.VITE_EBIRD_USERNAME || "") : "";
const HAS_ENV = !!(ENV_API_KEY && ENV_USERNAME);

export default function App() {
  const [apiKey, setApiKey] = useState(ENV_API_KEY);
  const [inputKey, setInputKey] = useState("");
  const [subId, setSubId] = useState(ENV_USERNAME);
  const [data, setData] = useState({});
  const [allChecklists, setAllChecklists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState(null);
  const [stats, setStats] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  // guestMode: true when a visitor wants to enter their own credentials
  const [guestMode, setGuestMode] = useState(false);

  const dates = getDatesLastYear();
  const weeks = groupByWeek(dates);
  const monthLabels = getMonthLabels(weeks);
  const maxChecklists = Math.max(...Object.values(data).map(d => d.checklists || 0), 1);

  const fetchData = useCallback(async (key) => {
    setLoading(true);
    setError("");
    try {
      if (!subId) { setLoading(false); setError("NEED_SUBID"); return; }
      const result = {};
      const raw = [];
      let offset = 0, done = false;
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      // Use server-side proxy when env vars are set (keeps API key off the browser).
      // Fall back to direct eBird call for guest mode with a user-supplied key.
      const useProxy = HAS_ENV && !guestMode;

      while (!done) {
        let res;
        if (useProxy) {
          res = await fetch(`/api/ebird-lists?subId=${subId}&offset=${offset}`);
        } else {
          res = await fetch(
            `https://ebird.org/api/v2/product/lists/${subId}?maxResults=200&offset=${offset}`,
            { headers: { "X-eBirdApiToken": key } }
          );
        }
        if (!res.ok) throw new Error(`API error: ${res.status} — check your API key and eBird username.`);
        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) break;

        for (const cl of json) {
          const dateStr = cl.obsDt?.split(" ")[0];
          if (!dateStr) continue;
          if (new Date(dateStr) < oneYearAgo) { done = true; break; }
          raw.push(cl);
          if (!result[dateStr]) result[dateStr] = { checklists: 0, species: 0 };
          result[dateStr].checklists += 1;
          result[dateStr].species = Math.max(result[dateStr].species, cl.numSpecies || 0);
        }
        if (json.length < 200) done = true;
        else offset += 200;
      }

      setData(result);
      setAllChecklists(raw);
      setStats({
        totalChecklists: Object.values(result).reduce((s, d) => s + d.checklists, 0),
        totalDays: Object.keys(result).length,
      });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [subId, guestMode]);

  useEffect(() => { if (apiKey && subId) fetchData(apiKey); }, [apiKey, subId, fetchData]);

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideIn { from { transform:translateX(100%) } to { transform:translateX(0) } }
        @keyframes spin { to { transform:rotate(360deg) } }
        .cell {
          width: ${CELL_SIZE}px; height: ${CELL_SIZE}px;
          border-radius: 2px;
          transition: transform 0.1s ease, filter 0.1s ease;
          flex-shrink: 0;
        }
        .cell-active { cursor: pointer; }
        .cell-active:hover {
          transform: scale(1.4); filter: brightness(1.3);
          z-index: 10; position: relative;
        }
        .cell-selected { outline: 2px solid #45d08c; outline-offset: 1px; }
        input {
          background: #161b22; border: 1px solid #30363d; color: #e6edf3;
          padding: 10px 16px; border-radius: 6px;
          font-family: 'DM Mono', monospace; font-size: 13px;
          outline: none; width: 100%; transition: border-color 0.2s;
        }
        input:focus { border-color: #45d08c; }
        button {
          background: #45d08c; color: #0d1117; border: none;
          padding: 10px 24px; border-radius: 6px;
          font-family: 'DM Mono', monospace; font-weight: 500; font-size: 13px;
          cursor: pointer; transition: background 0.2s, transform 0.1s; white-space: nowrap;
        }
        button:hover { background: #5de0a0; transform: translateY(-1px); }
        button:active { transform: translateY(0); }
        button:disabled { background: #2d9e6b; opacity: 0.5; cursor: not-allowed; transform: none; }
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
        <p style={{ color: "#7d8590", fontSize: 13, margin: 0 }}>Personal checklist heatmap · Last 12 months</p>
      </div>

      {/* Step 1: API Key */}
      {(!apiKey || guestMode) && guestMode && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 28, width: "100%", maxWidth: 480, marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ fontSize: 13, color: "#7d8590", margin: 0 }}>
              Enter your eBird API key.{" "}
              <a href="https://ebird.org/api/keygen" target="_blank" rel="noreferrer">Get one here →</a>
            </p>
            {HAS_ENV && (
              <button onClick={() => { setGuestMode(false); setApiKey(ENV_API_KEY); setSubId(ENV_USERNAME); setData({}); setStats(null); setError(""); }}
                style={{ background: "transparent", border: "1px solid #30363d", color: "#7d8590", fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 12 }}>
                ← Back
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="password" placeholder="API key..." value={inputKey}
              onChange={e => setInputKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && inputKey.trim() && setApiKey(inputKey.trim())}
            />
            <button onClick={() => inputKey.trim() && setApiKey(inputKey.trim())} disabled={!inputKey.trim()}>Next</button>
          </div>
        </div>
      )}

      {/* Step 2: Username */}
      {(guestMode || !HAS_ENV) && apiKey && (error === "NEED_SUBID" || !subId) && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 28, width: "100%", maxWidth: 480, marginBottom: 32 }}>
          <p style={{ fontSize: 13, color: "#7d8590", marginTop: 0 }}>
            Enter your eBird username (from{" "}
            <a href="https://ebird.org/profile" target="_blank" rel="noreferrer">ebird.org/profile</a>
            ). Looks like <code style={{ color: "#45d08c" }}>firstname-lastname-123</code>.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="text" placeholder="eBird username..." id="subid-input"
              onKeyDown={e => { if (e.key === "Enter") { setSubId(e.target.value.trim()); setError(""); } }}
            />
            <button onClick={() => { const v = document.getElementById("subid-input").value.trim(); if (v) { setSubId(v); setError(""); } }}>
              Load
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ color: "#7d8590", fontSize: 13, marginBottom: 32, display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner /> Fetching your checklists...
        </div>
      )}

      {error && error !== "NEED_SUBID" && (
        <div style={{ background: "#2d1b1b", border: "1px solid #6e3030", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#f47c7c", marginBottom: 24, maxWidth: 560, width: "100%" }}>
          ⚠️ {error}
        </div>
      )}

      {/* Try yourself button — only shown when env vars are powering the view */}
      {HAS_ENV && !guestMode && stats && !loading && (
        <button
          onClick={() => { setGuestMode(true); setApiKey(""); setSubId(""); setData({}); setStats(null); setError(""); setInputKey(""); }}
          style={{
            background: "transparent",
            border: "1px solid #30363d",
            color: "#7d8590",
            fontSize: 12,
            padding: "7px 16px",
            borderRadius: 8,
            cursor: "pointer",
            marginBottom: 24,
            transition: "border-color 0.2s, color 0.2s",
          }}
          onMouseEnter={e => { e.target.style.borderColor = "#45d08c"; e.target.style.color = "#45d08c"; }}
          onMouseLeave={e => { e.target.style.borderColor = "#30363d"; e.target.style.color = "#7d8590"; }}
        >
          🔭 Try with your own account
        </button>
      )}

      {/* Stats */}
      {stats && !loading && (
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
      {Object.keys(data).length > 0 && !loading && (
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

      {/* Hover Tooltip */}
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

      {/* Day Detail Panel */}
      {selectedDate && (
        <DayPanel
          date={selectedDate}
          dayData={data[selectedDate] || null}
          apiKey={apiKey}
          allChecklists={allChecklists}
          onClose={() => setSelectedDate(null)}
          useProxy={HAS_ENV && !guestMode}
        />
      )}

      <p style={{ fontSize: 11, color: "#484f58", marginTop: 32, textAlign: "center" }}>
        Data via eBird API · Your API key is never stored
      </p>
    </div>
  );
}