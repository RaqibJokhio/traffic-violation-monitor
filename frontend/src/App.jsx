import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const API = "http://localhost:8000";
const WS  = "ws://localhost:8000";

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [violations, setViolations] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [liveStats, setLiveStats] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(null);
  const fileRef = useRef();
  const wsRef = useRef();

  useEffect(() => {
    fetchStats();
    fetchViolations();
  }, [filter]);

  const fetchStats = async () => {
    const res = await axios.get(`${API}/dashboard/stats`);
    setStats(res.data);
  };

  const fetchViolations = async () => {
    setLoading(true);
    const url = filter
      ? `${API}/violations/?violation_type=${filter}&limit=50`
      : `${API}/violations/?limit=50`;
    const res = await axios.get(url);
    setViolations(res.data.violations);
    setLoading(false);
  };

  const deleteViolation = async (id) => {
    await axios.delete(`${API}/violations/${id}`);
    fetchViolations();
    fetchStats();
  };

  const handleUpload = async () => {
    const file = fileRef.current.files[0];
    if (!file) return;
    setUploading(true);
    setJobStatus("uploading");
    setCurrentFrame(null);
    setLiveStats(null);

    const formData = new FormData();
    formData.append("file", file);
    const res = await axios.post(`${API}/process`, formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });

    const jid = res.data.job_id;
    setJobId(jid);
    setUploading(false);
    setJobStatus("connecting");
    setPage("live");

    // Connect WebSocket
    const ws = new WebSocket(`${WS}/ws/${jid}`);
    wsRef.current = ws;

    ws.onopen = () => setJobStatus("processing");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "frame") {
        setCurrentFrame(`data:image/jpeg;base64,${data.frame}`);
        setLiveStats(data.stats);
      }
      if (data.type === "done") {
        setJobStatus("done");
        fetchStats();
        fetchViolations();
      }
    };

    ws.onerror = () => setJobStatus("error");
    ws.onclose = () => {
      if (jobStatus !== "done") setJobStatus("disconnected");
    };
  };

  const chartData = stats
    ? Object.entries(stats.by_type).map(([type, count]) => ({ type, count }))
    : [];

  return (
    <div style={{ fontFamily: "sans-serif", padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px" }}>Traffic Violation Monitor</h1>
        <div style={{ display: "flex", gap: "8px" }}>
          {["dashboard", "upload", "live"].map((p) => (
            <button key={p} onClick={() => setPage(p)} style={{
              padding: "6px 16px", borderRadius: "6px", border: "1px solid #d1d5db",
              background: page === p ? "#3b82f6" : "#fff",
              color: page === p ? "#fff" : "#374151",
              cursor: "pointer", fontSize: "14px", textTransform: "capitalize"
            }}>
              {p === "live" ? "Live View" : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Upload Page */}
      {page === "upload" && (
        <div style={{ maxWidth: "500px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "16px" }}>Upload Video for Processing</h2>
          <div style={{ border: "2px dashed #d1d5db", borderRadius: "8px", padding: "32px", textAlign: "center", marginBottom: "16px" }}>
            <input ref={fileRef} type="file" accept="video/*" style={{ display: "block", margin: "0 auto 12px" }} />
            <p style={{ color: "#6b7280", fontSize: "13px" }}>Supported: MP4, AVI, MOV</p>
          </div>
          <button onClick={handleUpload} disabled={uploading} style={{
            width: "100%", padding: "10px", borderRadius: "6px", border: "none",
            background: uploading ? "#93c5fd" : "#3b82f6", color: "#fff",
            fontSize: "15px", cursor: uploading ? "not-allowed" : "pointer"
          }}>
            {uploading ? "Uploading..." : "Upload & Process"}
          </button>
        </div>
      )}

      {/* Live View Page */}
      {page === "live" && (
        <div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "center" }}>
            <span style={{
              padding: "4px 12px", borderRadius: "20px", fontSize: "13px", fontWeight: "600",
              background: jobStatus === "processing" ? "#dcfce7" : jobStatus === "done" ? "#dbeafe" : "#fef9c3",
              color: jobStatus === "processing" ? "#166534" : jobStatus === "done" ? "#1e40af" : "#854d0e"
            }}>
              {jobStatus === "processing" ? "⚡ Live Processing" : jobStatus === "done" ? "✓ Done" : jobStatus}
            </span>
          </div>

          {/* Live Stats */}
          {liveStats && (
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <MiniStat label="Total" value={liveStats.total} color="#ef4444" />
              <MiniStat label="Red Light" value={liveStats.red_light} color="#f97316" />
              <MiniStat label="Wrong Way" value={liveStats.wrong_way} color="#eab308" />
              <MiniStat label="Helmet" value={liveStats.helmet} color="#8b5cf6" />
            </div>
          )}

          {/* Video Feed */}
          {currentFrame ? (
            <img
              src={currentFrame}
              alt="Live feed"
              style={{ width: "100%", borderRadius: "8px", border: "2px solid #e5e7eb" }}
            />
          ) : (
            <div style={{
              width: "100%", height: "400px", background: "#1f2937",
              borderRadius: "8px", display: "flex", alignItems: "center",
              justifyContent: "center", color: "#9ca3af"
            }}>
              Waiting for video stream...
            </div>
          )}
        </div>
      )}

      {/* Dashboard Page */}
      {page === "dashboard" && (
        <>
          {stats && (
            <div style={{ display: "flex", gap: "16px", marginBottom: "32px" }}>
              <StatCard label="Total Violations" value={stats.total_violations} color="#ef4444" />
              <StatCard label="Red Light" value={stats.by_type?.red_light || 0} color="#f97316" />
              <StatCard label="Wrong Way" value={stats.by_type?.wrong_way || 0} color="#eab308" />
              <StatCard label="No Helmet" value={stats.by_type?.helmet || 0} color="#8b5cf6" />
            </div>
          )}

          {chartData.length > 0 && (
            <div style={{ marginBottom: "32px", background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
              <h2 style={{ fontSize: "16px", marginBottom: "12px" }}>Violations by Type</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <XAxis dataKey="type" /><YAxis /><Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
            {["", "red_light", "wrong_way", "helmet"].map((type) => (
              <button key={type} onClick={() => setFilter(type)} style={{
                padding: "6px 14px", borderRadius: "6px", border: "1px solid #d1d5db",
                background: filter === type ? "#3b82f6" : "#fff",
                color: filter === type ? "#fff" : "#374151",
                cursor: "pointer", fontSize: "14px"
              }}>
                {type === "" ? "All" : type.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
              </button>
            ))}
          </div>

          {loading ? <p>Loading...</p> : violations.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No violations found.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  {["ID", "Type", "Tracker ID", "Frame", "Timestamp", "Snapshot", "Action"].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={td}>{v.id}</td>
                    <td style={td}>
                      <span style={{ padding: "2px 8px", borderRadius: "4px", background: typeColor(v.violation_type), color: "#fff", fontSize: "12px" }}>
                        {v.violation_type}
                      </span>
                    </td>
                    <td style={td}>{v.tracker_id ?? "-"}</td>
                    <td style={td}>{v.frame}</td>
                    <td style={td}>{new Date(v.timestamp).toLocaleString()}</td>
                    <td style={td}>
                      {v.snapshot_path
                        ? <a href={`${API}/${v.snapshot_path}`} target="_blank" rel="noreferrer">View</a>
                        : "-"}
                    </td>
                    <td style={td}>
                      <button onClick={() => deleteViolation(v.id)} style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ flex: 1, padding: "16px", borderRadius: "8px", background: "#fff", border: `2px solid ${color}`, textAlign: "center" }}>
      <div style={{ fontSize: "28px", fontWeight: "bold", color }}>{value}</div>
      <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ flex: 1, padding: "10px", borderRadius: "8px", background: "#fff", border: `2px solid ${color}`, textAlign: "center" }}>
      <div style={{ fontSize: "22px", fontWeight: "bold", color }}>{value}</div>
      <div style={{ fontSize: "12px", color: "#6b7280" }}>{label}</div>
    </div>
  );
}

function typeColor(type) {
  return { red_light: "#ef4444", wrong_way: "#f97316", helmet: "#8b5cf6" }[type] || "#6b7280";
}

const th = { padding: "10px 12px", textAlign: "left", fontWeight: "600", color: "#374151" };
const td = { padding: "10px 12px", color: "#374151" };