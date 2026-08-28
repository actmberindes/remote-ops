import React, { useEffect, useRef, useState } from 'react';
import { Play, Loader2, Video, AlertCircle, Download } from 'lucide-react';
import { api } from '../lib/api.js';

export default function LiveViewVideoPlayer({ employees = [] }) {
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const objectUrlRef = useRef('');

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const generate = async () => {
    setError('');
    if (!employeeId || !date) {
      setError('Select an employee and date first.');
      return;
    }

    setLoading(true);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    objectUrlRef.current = '';
    setVideoUrl('');

    try {
      const blob = await api.activity.liveVideo({
        employeeId: Number(employeeId),
        date,
      });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setVideoUrl(url);
    } catch (err) {
      setError(err.message || 'Unable to generate Live View video.');
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!videoUrl) return;
    const selected = employees.find(e => Number(e.id) === Number(employeeId));
    const name = (selected?.name || 'employee').replace(/[^a-z0-9-_]+/gi, '_');
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${name}-${date}-live-view.mp4`;
    a.click();
  };

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Video size={17} />
            <h3 className="font-display font-bold text-sm">Live View Timelapse</h3>
          </div>
          <p className="text-[10px] text-muted mt-1">
            Generate a temporary video from retained Live View frames. The generated MP4 is not stored permanently on the server.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-[11px] font-bold mb-1 text-muted uppercase tracking-wider">Employee</span>
          <select
            className="w-full rounded-lg px-3 py-2 text-xs input-surface font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee…</option>
            {employees.map(employee => (
              <option key={employee.id} value={employee.id}>
                {employee.name}{employee.department ? ` — ${employee.department}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[11px] font-bold mb-1 text-muted uppercase tracking-wider">Date</span>
          <input
            type="date"
            className="w-full rounded-lg px-3 py-2 text-xs input-surface font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </label>

        <button
          onClick={generate}
          disabled={loading || !employeeId || !date}
          className="py-2 rounded-lg px-4 font-bold text-xs accent-bg-solid flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? 'Generating…' : 'Generate Video'}
        </button>
      </div>

      {error && (
        <div className="mt-3 p-2.5 rounded-lg border border-[var(--border)] text-xs flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {videoUrl && (
        <div className="mt-4">
          <video
            src={videoUrl}
            controls
            playsInline
            className="w-full rounded-xl border border-[var(--border)] bg-black"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={download}
              className="px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--border)] hover-surface flex items-center gap-1.5"
            >
              <Download size={13} />
              Download MP4
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
