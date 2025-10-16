import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Play, Pause, History, Bell, Download, Timer, RotateCcw, Trophy, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function useInterval(callback, delay) {
  const savedRef = useRef(callback);
  useEffect(() => { savedRef.current = callback }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// --- main component ---
export default function FastingApp() {
  const now = Date.now();
  const persisted = loadState();

  const [preset, setPreset] = useState(persisted?.preset ?? "16:8");
  const [isFasting, setIsFasting] = useState(persisted?.isFasting ?? false);
  const [startTime, setStartTime] = useState(persisted?.startTime ?? null); // ms epoch
  const [targetEndTime, setTargetEndTime] = useState(persisted?.targetEndTime ?? null); // ms epoch
  const [history, setHistory] = useState(persisted?.history ?? []); // {start,end,duration}
  const [notifications, setNotifications] = useState(persisted?.notifications ?? false);

  // persist
  useEffect(() => {
    saveState({ preset, isFasting, startTime, targetEndTime, history, notifications });
  }, [preset, isFasting, startTime, targetEndTime, history, notifications]);

  // tick
  const [tick, setTick] = useState(0);
  useInterval(() => setTick(t => t + 1), 1000);

  // derived
  const presetObj = useMemo(() => PRESETS.find(p => p.id === preset) ?? PRESETS[2], [preset]);
  const elapsed = isFasting && startTime ? Date.now() - startTime : 0;
  const targetMs = presetObj.fastHours * 3600 * 1000;
  const remaining = Math.max(0, (targetEndTime ?? (startTime ? startTime + targetMs : 0)) - Date.now());
  const goalReached = isFasting && elapsed >= targetMs;

  // notifications
  useEffect(() => {
    if (!notifications || !isFasting || !targetEndTime) return;
    const timeLeft = targetEndTime - Date.now();
    if (timeLeft <= 0) return;
    const id = setTimeout(() => {
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification("Fasting goal reached!", { body: `${presetObj.fastHours}h complete. Great job 👏` });
        }
      }
      toast.success("Fasting goal reached! You can open your eating window.");
    }, timeLeft);
    return () => clearTimeout(id);
  }, [notifications, isFasting, targetEndTime, presetObj.fastHours, tick]);

  function ensureNotificationPermission(next) {
    if (!next) return;
    if (!("Notification" in window)) {
      toast.error("Notifications not supported in this browser.");
      setNotifications(false);
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm !== "granted") {
          setNotifications(false);
          toast.error("Notifications denied.");
        }
      });
    }
  }

  function handleStart(nowMs = Date.now()) {
    const end = nowMs + presetObj.fastHours * 3600 * 1000;
    setIsFasting(true);
    setStartTime(nowMs);
    setTargetEndTime(end);
    toast("Fast started.");
  }

  function handleEnd(endMs = Date.now()) {
    if (!isFasting || !startTime) return;
    const duration = Math.max(0, endMs - startTime);
    const entry = { start: startTime, end: endMs, duration };
    setHistory((h) => [entry, ...h].slice(0, 200));
    setIsFasting(false);
    setStartTime(null);
    setTargetEndTime(null);
    toast.success("Fast saved to history.");
  }

  function handleReset() {
    setIsFasting(false);
    setStartTime(null);
    setTargetEndTime(null);
  }

  const chartData = useMemo(() => {
    // last 14 entries by calendar day (sum if multiple)
    const byDay = new Map();
    for (const e of history) {
      const d = new Date(e.end || e.start);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + e.duration);
    }
    const entries = Array.from(byDay.entries()).sort((a,b)=>a[0].localeCompare(b[0])).slice(-14);
    return entries.map(([date, ms]) => ({ date, hours: Math.round(ms / 360000) / 10 }));
  }, [history]);

  const stats = useMemo(() => {
    const total = history.reduce((s, e) => s + e.duration, 0);
    const avg = history.length ? total / history.length : 0;
    // streak: consecutive days with >= target hours, counting back from today
    const dayOk = new Set();
    history.forEach((e) => {
      const d = new Date(e.end || e.start).toISOString().slice(0, 10);
      if (e.duration >= presetObj.fastHours * 3600000) dayOk.add(d);
    });
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (dayOk.has(key)) streak++; else break;
    }
    return { avg, streak };
  }, [history, presetObj.fastHours]);

  function exportCSV() {
    const rows = [["start","end","duration_ms","duration_hm"]].concat(
      history.map(e => [
        new Date(e.start).toISOString(),
        new Date(e.end).toISOString(),
        String(e.duration),
        formatHM(e.duration)
      ])
    );
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fasting_history_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importStartFromText(value) {
    // accepts ISO or "YYYY-MM-DDTHH:MM"
    const dt = new Date(value);
    if (isNaN(+dt)) {
      toast.error("Could not parse date/time.");
      return;
    }
    handleStart(+dt);
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-5xl p-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Migtoonz Fasting Tracker</h1>
            <p className="text-sm text-neutral-500">Fast smarter. Simple timer, history, stats & reminders.</p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="notif" className="flex items-center gap-2 text-sm"><Bell className="h-4 w-4"/> Goal alerts</Label>
            <Switch id="notif" checked={notifications} onCheckedChange={(v)=>{ setNotifications(v); ensureNotificationPermission(v); }} />
          </div>
        </header>

        <Separator className="my-6" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: controls */}
          <Card className="lg:col-span-2 shadow-sm">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-end gap-4">
                <div className="flex-1">
                  <Label className="mb-1 block">Plan</Label>
                  <Select value={preset} onValueChange={setPreset}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRESETS.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.id} – {p.fastHours}h fast / {p.eatHours}h eat</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {!isFasting ? (
                    <Button onClick={() => handleStart()} className="h-11 text-base"><Play className="mr-2 h-5 w-5"/>Start Fast</Button>
                  ) : (
                    <Button variant="destructive" onClick={() => handleEnd()} className="h-11 text-base"><Pause className="mr-2 h-5 w-5"/>End Fast</Button>
                  )}
                  <Button variant="secondary" onClick={handleReset} className="h-11 text-base"><RotateCcw className="mr-2 h-5 w-5"/>Reset</Button>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatTile icon={<Timer className="h-5 w-5"/>} label="Elapsed" value={isFasting ? formatDuration(elapsed) : "00:00:00"} sub={isFasting && startTime ? new Date(startTime).toLocaleString() : "—"} />
                <StatTile icon={<TrendingUp className="h-5 w-5"/>} label="Target" value={`${presetObj.fastHours}h`} sub={goalReached ? "Goal reached!" : `${formatDuration(remaining)} left`} highlight={goalReached} />
                <StatTile icon={<Trophy className="h-5 w-5"/>} label="Streak" value={`${stats.streak} days`} sub={`Avg ${Math.round(stats.avg/36)/100} h`} />
              </div>

              <div className="mt-6">
                <Tabs defaultValue="quick">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="quick">Quick Actions</TabsTrigger>
                    <TabsTrigger value="manual">Manual Start</TabsTrigger>
                    <TabsTrigger value="export">Export</TabsTrigger>
                  </TabsList>
                  <TabsContent value="quick" className="mt-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                      {PRESETS.map(p => (
                        <Button key={p.id} variant={preset===p.id?"default":"outline"} onClick={()=>{ setPreset(p.id); if(isFasting && startTime){ setTargetEndTime(startTime + p.fastHours*3600*1000) }}}>{p.id}</Button>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="manual" className="mt-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                      <div className="flex-1">
                        <Label className="mb-1 block">Start time</Label>
                        <Input type="datetime-local" onKeyDown={(e)=>{ if(e.key==='Enter'){ importStartFromText(e.currentTarget.value) } }} />
                        <p className="text-xs text-neutral-500 mt-1">Press Enter to start from a past time.</p>
                      </div>
                      <Button onClick={()=>{
                        const el = document.querySelector('input[type="datetime-local"]');
                        if (el && el.value) importStartFromText(el.value);
                      }}>Start from time</Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="export" className="mt-4">
                    <div className="flex items-center gap-3">
                      <Button onClick={exportCSV}><Download className="mr-2 h-5 w-5"/>Export CSV</Button>
                      <p className="text-sm text-neutral-500">Download your fasting history.</p>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </CardContent>
          </Card>

          {/* Right: chart & history */}
          <div className="flex flex-col gap-6">
            <Card className="shadow-sm">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-3">Last 14 days</h3>
                <div className="h-48">
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
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold flex items-center gap-2"><History className="h-4 w-4"/> History</h3>
                  {history.length>0 && (
                    <Button variant="ghost" size="sm" onClick={()=>setHistory([])}>Clear</Button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-sm text-neutral-500">No past fasts yet. Start one to see it here.</p>
                ) : (
                  <ul className="max-h-72 overflow-auto divide-y">
                    {history.map((e, i) => (
                      <li key={i} className="py-3 text-sm flex items-center justify-between">
                        <div>
                          <p className="font-medium">{formatHM(e.duration)}</p>
                          <p className="text-neutral-500">{new Date(e.start).toLocaleString()} → {new Date(e.end).toLocaleString()}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={()=>{
                          // repeat this fast as a new one starting now
                          setPreset(`${Math.round(e.duration/3600000)}:${24-Math.round(e.duration/3600000)}`);
                          handleStart();
                        }}>Repeat</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <footer className="mt-8 text-center text-xs text-neutral-500">
          Built for Miguel (Migtoonz). Data stays in your browser (localStorage).
        </footer>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, sub, highlight }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm ${highlight ? 'ring-2 ring-emerald-400' : ''}`}>
      <div className="flex items-center gap-2 text-neutral-500 mb-1">{icon}<span className="text-xs uppercase tracking-wide">{label}</span></div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
    </div>
  );
}
