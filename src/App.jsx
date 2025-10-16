import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, History, Bell, Download, Timer, RotateCcw, Trophy, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast, Toaster } from "sonner";

// --- helpers ---
const PRESETS = [
  { id: "12:12", fastHours: 12, eatHours: 12 },
  { id: "14:10", fastHours: 14, eatHours: 10 },
  { id: "16:8", fastHours: 16, eatHours: 8 },
  { id: "18:6", fastHours: 18, eatHours: 6 },
  { id: "20:4", fastHours: 20, eatHours: 4 },
  { id: "OMAD", fastHours: 23, eatHours: 1 },
];

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function formatHM(ms) {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

const STORAGE_KEY = "migtoonz-fasting-tracker-v1";
const loadState = () => { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const saveState = (s) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {} };

function useInterval(callback, delay) {
  const savedRef = useRef(callback);
  useEffect(() => { savedRef.current = callback; }, [callback]);
  useEffect(() => {
    if (delay == null) return;
    const id = setInterval(() => savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

export default function App() {
  const persisted = loadState();

  const [preset, setPreset] = useState(persisted?.preset ?? "16:8");
  const [isFasting, setIsFasting] = useState(persisted?.isFasting ?? false);
  const [startTime, setStartTime] = useState(persisted?.startTime ?? null);
  const [targetEndTime, setTargetEndTime] = useState(persisted?.targetEndTime ?? null);
  const [history, setHistory] = useState(persisted?.history ?? []);
  const [notifications, setNotifications] = useState(persisted?.notifications ?? false);

  useEffect(() => { saveState({ preset, isFasting, startTime, targetEndTime, history, notifications }); },
    [preset, isFasting, startTime, targetEndTime, history, notifications]);

  const [tick, setTick] = useState(0);
  useInterval(() => setTick(t => t + 1), 1000);

  const presetObj = useMemo(() => PRESETS.find(p => p.id === preset) ?? PRESETS[2], [preset]);
  const elapsed = isFasting && startTime ? Date.now() - startTime : 0;
  const targetMs = presetObj.fastHours * 3600 * 1000;
  const remaining = Math.max(0, (targetEndTime ?? (startTime ? startTime + targetMs : 0)) - Date.now());
  const goalReached = isFasting && elapsed >= targetMs;

  useEffect(() => {
    if (!notifications || !isFasting || !targetEndTime) return;
    const timeLeft = targetEndTime - Date.now();
    if (timeLeft <= 0) return;
    const id = setTimeout(() => {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Fasting goal reached!", { body: `${presetObj.fastHours}h complete. Great job 👏` });
      }
      toast.success("Fasting goal reached! You can open your eating window.");
    }, timeLeft);
    return () => clearTimeout(id);
  }, [notifications, isFasting, targetEndTime, presetObj.fastHours, tick]);

  function ensureNotificationPermission(next) {
    if (!next) return;
    if (!("Notification" in window)) { toast.error("Notifications not supported in this browser."); setNotifications(false); return; }
    if (Notification.permission === "default") {
      Notification.requestPermission().then(p => { if (p !== "granted") { setNotifications(false); toast.error("Notifications denied."); } });
    }
  }

  function handleStart(nowMs = Date.now()) {
    const end = nowMs + presetObj.fastHours * 3600 * 1000;
    setIsFasting(true); setStartTime(nowMs); setTargetEndTime(end);
    toast("Fast started.");
  }
  function handleEnd(endMs = Date.now()) {
    if (!isFasting || !startTime) return;
    const duration = Math.max(0, endMs - startTime);
    setHistory(h => [{ start: startTime, end: endMs, duration }, ...h].slice(0, 200));
    setIsFasting(false); setStartTime(null); setTargetEndTime(null);
    toast.success("Fast saved to history.");
  }
  function handleReset() { setIsFasting(false); setStartTime(null); setTargetEndTime(null); }

  const chartData = useMemo(() => {
    const byDay = new Map();
    for (const e of history) {
      const d = new Date(e.end || e.start);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + e.duration);
    }
    return Array.from(byDay.entries())
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, ms]) => ({ date, hours: Math.round(ms / 360000) / 10 }));
  }, [history]);

  const stats = useMemo(() => {
    const total = history.reduce((s, e) => s + e.duration, 0);
    const avg = history.length ? total / history.length : 0;
    const dayOk = new Set();
    history.forEach(e => {
      const d = new Date(e.end || e.start).toISOString().slice(0, 10);
      if (e.duration >= presetObj.fastHours * 3600000) dayOk.add(d);
    });
    let streak = 0; const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (dayOk.has(key)) streak++; else break;
    }
    return { avg, streak };
  }, [history, presetObj.fastHours]);

  function exportCSV() {
    const rows = [["start","end","duration_ms","duration_hm"]]
      .concat(history.map(e => [
        new Date(e.start).toISOString(),
        new Date(e.end).toISOString(),
        String(e.duration),
        formatHM(e.duration)
      ]));
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `fasting_history_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function importStartFromText(value) {
    const dt = new Date(value);
    if (isNaN(+dt)) { toast.error("Could not parse date/time."); return; }
    handleStart(+dt);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", color: "#111" }}>
      <Toaster richColors position="top-center" />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Migtoonz Fasting Tracker</h1>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Fast smarter. Simple timer, history, stats & reminders.</div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#6b7280" }}>
            <Bell size={16}/> Goal alerts
            <input type="checkbox" checked={notifications} onChange={e => { const v = e.target.checked; setNotifications(v); ensureNotificationPermission(v); }} />
          </label>
        </header>

        <hr style={{ margin: "24px 0", borderColor: "#eee" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: 24 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Plan</label>
                  <select value={preset} onChange={e => {
                    const v = e.target.value; setPreset(v);
                    const found = PRESETS.find(p => p.id === v);
                    if (isFasting && startTime && found) setTargetEndTime(startTime + found.fastHours*3600*1000);
                  }} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                    {PRESETS.map(p => <option key={p.id} value={p.id}>{p.id} – {p.fastHours}h fast / {p.eatHours}h eat</option>)}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {!isFasting ? (
                    <button onClick={() => handleStart()} style={btnPrimary}><Play size={18} style={{ marginRight: 8 }}/>Start Fast</button>
                  ) : (
                    <button onClick={() => handleEnd()} style={{ ...btnPrimary, background: "#ef4444" }}><Pause size={18} style={{ marginRight: 8 }}/>End Fast</button>
                  )}
                  <button onClick={handleReset} style={btnGhost}><RotateCcw size={18} style={{ marginRight: 8 }}/>Reset</button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 16, marginTop: 24 }}>
                <StatTile icon={<Timer size={18}/>} label="Elapsed" value={isFasting ? formatDuration(elapsed) : "00:00:00"} sub={isFasting && startTime ? new Date(startTime).toLocaleString() : "—"} />
                <StatTile icon={<TrendingUp size={18}/>} label="Target" value={`${presetObj.fastHours}h`} sub={goalReached ? "Goal reached!" : `${formatDuration(remaining)} left`} highlight={goalReached} />
                <StatTile icon={<Trophy size={18}/>} label="Streak" value={`${stats.streak} days`} sub={`Avg ${Math.round(stats.avg/36)/100} h`} />
              </div>

              <div style={{ marginTop: 24 }}>
                <details open>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>Manual start</summary>
                  <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Start time</label>
                      <input type="datetime-local" id="manualStart" onKeyDown={e => { if (e.key === "Enter") importStartFromText(e.currentTarget.value); }}
                        style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e5e7eb" }}/>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Press Enter to start from a past time.</div>
                    </div>
                    <button onClick={() => {
                      const el = document.getElementById("manualStart");
                      if (el && el.value) importStartFromText(el.value);
                    }} style={btnGhost}>Start from time</button>
                  </div>
                </details>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}><Download size={16} style={{ marginRight: 6 }}/> Export CSV</summary>
                  <div style={{ marginTop: 12 }}>
                    <button onClick={exportCSV} style={btnGhost}>Download</button>
                  </div>
                </details>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>Last 14 days</h3>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis unit="h" tick={{ fontSize: 12 }} domain={[0, 'dataMax + 2']} />
                  <Tooltip formatter={(v)=>`${v} h`} />
                  <Line type="monotone" dataKey="hours" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* History */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}><History size={16}/> History</h3>
              {history.length>0 && (
                <button onClick={()=>setHistory([])} style={btnGhost}>Clear</button>
              )}
            </div>
            {history.length === 0 ? (
              <div style={{ fontSize: 14, color: "#6b7280" }}>No past fasts yet. Start one to see it here.</div>
            ) : (
              <ul style={{ maxHeight: 300, overflow: "auto", margin: 0, padding: 0, listStyle: "none" }}>
                {history.map((e, i) => (
                  <li key={i} style={{ padding: "12px 0", display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{formatHM(e.duration)}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>{new Date(e.start).toLocaleString()} → {new Date(e.end).toLocaleString()}</div>
                    </div>
                    <button onClick={()=>{
                      const hours = Math.round(e.duration/3600000);
                      setPreset(`${hours}:${24-hours}`);
                      handleStart();
                    }} style={btnGhost}>Repeat</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer style={{ marginTop: 24, textAlign: "center", fontSize: 12, color: "#6b7280" }}>
          Built for Miguel (Migtoonz). Data stays in your browser (localStorage).
        </footer>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, sub, highlight }) {
  return (
    <div style={{
      border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, background: "#fff",
      boxShadow: highlight ? "0 0 0 2px #34d399" : "0 1px 2px rgba(0,0,0,0.04)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6b7280", marginBottom: 6 }}>
        {icon}<span style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>{sub}</div>
    </div>
  );
}

const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "10px 14px", borderRadius: 10, border: "1px solid #111",
  background: "#111", color: "#fff", fontWeight: 600, cursor: "pointer"
};
const btnGhost = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb",
  background: "#fff", color: "#111", fontWeight: 600, cursor: "pointer"
};
