import { useState, useEffect } from "react";
import axios from "axios";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const API = "http://localhost:8000";

export default function App() {
  const [stats, setStats] = useState(null);
  const [violations, setViolations] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

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

  const chartData = stats
    ? Object.entries(stats.by_type).map(([type, count]) => ({ type, count }))
    : [];

  return (
    <div style={{ fontFamily: "sans-serif", padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>Traffic Violation Monitor</h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>Real-time violation dashboard</p>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: "flex", gap: "16px", marginBottom: "32px" }}>
          <StatCard label="Total Violations" value={stats.total_violations} color="#ef4444" />
          <StatCard label="Red Light" value={stats.by_type?.red_light || 0} color="#f97316" />
          <StatCard label="Wrong Way" value={stats.by_type?.wrong_way || 0} color="#eab308" />
          <StatCard label="No Helmet" value={stats.by_type?.helmet || 0} color="#8b5cf6" />
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div style={{ marginBottom: "32px", background: "#f9fafb", borderRadius: "8px", padding: "16px" }}>
          <h2 style={{ fontSize: "16px", marginBottom: "12px" }}>Violations by Type</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <XAxis dataKey="type" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filter */}
      <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
        {["", "red_light", "wrong_way", "helmet"].map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid #d1d5db",
              background: filter === type ? "#3b82f6" : "#fff",
              color: filter === type ? "#fff" : "#374151",
              cursor: "pointer",
              fontSize: "14px"
            }}
          >
            {type === "" ? "All" : type.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Violations Table */}
      {loading ? (
        <p>Loading...</p>
      ) : violations.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No violations found.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={th}>ID</th>
              <th style={th}>Type</th>
              <th style={th}>Tracker ID</th>
              <th style={th}>Frame</th>
              <th style={th}>Timestamp</th>
              <th style={th}>Snapshot</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {violations.map((v) => (
              <tr key={v.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={td}>{v.id}</td>
                <td style={td}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: typeColor(v.violation_type),
                    color: "#fff",
                    fontSize: "12px"
                  }}>
                    {v.violation_type}
                  </span>
                </td>
                <td style={td}>{v.tracker_id ?? "-"}</td>
                <td style={td}>{v.frame}</td>
                <td style={td}>{new Date(v.timestamp).toLocaleString()}</td>
                <td style={td}>
                  {v.snapshot_path ? (
                    <a href={`${API}/${v.snapshot_path}`} target="_blank" rel="noreferrer">View</a>
                  ) : "-"}
                </td>
                <td style={td}>
                  <button
                    onClick={() => deleteViolation(v.id)}
                    style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      flex: 1, padding: "16px", borderRadius: "8px",
      background: "#fff", border: `2px solid ${color}`, textAlign: "center"
    }}>
      <div style={{ fontSize: "28px", fontWeight: "bold", color }}>{value}</div>
      <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>{label}</div>
    </div>
  );
}

function typeColor(type) {
  return { red_light: "#ef4444", wrong_way: "#f97316", helmet: "#8b5cf6" }[type] || "#6b7280";
}

const th = { padding: "10px 12px", textAlign: "left", fontWeight: "600", color: "#374151" };
const td = { padding: "10px 12px", color: "#374151" };