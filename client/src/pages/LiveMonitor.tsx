import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, MonitorPlay, RefreshCw, Square, Wifi } from 'lucide-react';
import AdminNav from '../components/AdminNav';
import { useAuth } from '../contexts/AuthContext';
import { adminApi } from '../services/api';
import { startLiveViewer, type LiveViewer, type LiveViewerStatus } from '../services/liveViewer';

interface ActiveStudent { id: number; email: string; status: string; exam_started_at: string | null; }
interface ViewerTile { student: ActiveStudent; status: LiveViewerStatus; error?: string; }
interface ActiveViewer { viewer: LiveViewer; viewerSessionId: string; outcome: string; }

const AUDIT_OUTCOME: Record<LiveViewerStatus, string> = { connecting: 'connecting', 'connected-direct': 'connected_direct', 'connected-relay': 'connected_relay', failed: 'failed', ended: 'ended' };
const STATUS_TEXT: Record<LiveViewerStatus, string> = { connecting: 'Đang chờ học viên kết nối…', 'connected-direct': 'Đang xem kết nối trực tiếp', 'connected-relay': 'Đang xem qua TURN relay', failed: 'Không thể kết nối', ended: 'Đã dừng' };

function LiveMonitor() {
  const { id } = useParams<{ id: string }>();
  const { isLoading, isTenantAdmin } = useAuth();
  const batchId = Number(id);
  const activeViewersRef = useRef(new Map<number, ActiveViewer>());
  const videoRefs = useRef(new Map<number, HTMLVideoElement>());
  const streamsRef = useRef(new Map<number, MediaStream>());
  const [students, setStudents] = useState<ActiveStudent[]>([]);
  const [tiles, setTiles] = useState<Record<number, ViewerTile>>({});
  const [loading, setLoading] = useState(true);
  const [openingAll, setOpeningAll] = useState(false);
  const [error, setError] = useState('');

  const updateTile = useCallback((student: ActiveStudent, patch: Partial<ViewerTile>) => setTiles((current) => ({
    ...current, [student.id]: { ...current[student.id], student, ...patch },
  })), []);

  const load = useCallback(async () => {
    if (!Number.isInteger(batchId) || batchId < 1) { setError('Mã đợt thi không hợp lệ.'); setLoading(false); return; }
    try { const response = await adminApi.getLiveStudents(batchId); setStudents(response.data.students || []); setError(''); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'Không tải được danh sách đang thi.'); }
    finally { setLoading(false); }
  }, [batchId]);

  useEffect(() => { void load(); const interval = window.setInterval(() => void load(), 10_000); return () => window.clearInterval(interval); }, [load]);

  const stop = useCallback(async (studentId: number) => {
    const active = activeViewersRef.current.get(studentId);
    activeViewersRef.current.delete(studentId); streamsRef.current.delete(studentId);
    const video = videoRefs.current.get(studentId); if (video) video.srcObject = null;
    if (active) { await active.viewer.stop(); void adminApi.endLiveSession(active.viewerSessionId, active.outcome).catch(() => undefined); }
    setTiles((current) => { const next = { ...current }; delete next[studentId]; return next; });
  }, []);
  const stopAll = useCallback(async () => { await Promise.all([...activeViewersRef.current.keys()].map((studentId) => stop(studentId))); }, [stop]);
  useEffect(() => () => { void stopAll(); }, [stopAll]);

  const setVideo = useCallback((studentId: number, node: HTMLVideoElement | null) => {
    if (!node) { videoRefs.current.delete(studentId); return; }
    videoRefs.current.set(studentId, node);
    const stream = streamsRef.current.get(studentId);
    if (stream) { node.srcObject = stream; void node.play().catch(() => undefined); }
  }, []);

  const view = useCallback(async (student: ActiveStudent) => {
    if (activeViewersRef.current.has(student.id)) return;
    updateTile(student, { status: 'connecting', error: undefined });
    try {
      const response = await adminApi.createLiveSession(batchId, student.id);
      const { viewerSessionId } = response.data;
      const viewer = await startLiveViewer(response.data, {
        onStream: (stream) => { streamsRef.current.set(student.id, stream); const video = videoRefs.current.get(student.id); if (video) { video.srcObject = stream; void video.play().catch(() => undefined); } },
        onStatus: (status) => { const active = activeViewersRef.current.get(student.id); if (active) active.outcome = AUDIT_OUTCOME[status]; updateTile(student, { status }); if (status === 'failed') void adminApi.endLiveSession(viewerSessionId, 'failed').catch(() => undefined); },
      });
      activeViewersRef.current.set(student.id, { viewer, viewerSessionId, outcome: 'connecting' });
    } catch (requestError: any) { updateTile(student, { status: 'failed', error: requestError.response?.data?.error || 'Không thể mở phiên xem live.' }); }
  }, [batchId, updateTile]);

  const viewAll = async () => { setOpeningAll(true); try { await Promise.all(students.map((student) => view(student))); } finally { setOpeningAll(false); } };
  if (!isLoading && !isTenantAdmin) return <Navigate to="/admin/dashboard" replace />;
  const activeCount = Object.keys(tiles).length;

  return <div className="min-h-screen bg-slate-50 p-4 md:p-8"><div className="mx-auto max-w-7xl">
    <AdminNav />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><Link to={`/admin/batches/${id}/students`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-700"><ArrowLeft size={15} /> Học viên</Link><h1 className="mt-2 text-2xl font-bold text-slate-900">Live Monitor</h1><p className="text-sm text-slate-500">Mỗi ô là một luồng P2P riêng. Bạn có thể xem đồng thời tất cả học viên đang thi.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"><RefreshCw size={15} /> Làm mới</button><button type="button" disabled={openingAll || students.length === 0} onClick={() => void viewAll()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"><MonitorPlay size={15} /> {openingAll ? 'Đang mở…' : `Xem tất cả (${students.length})`}</button>{activeCount > 0 && <button type="button" onClick={() => void stopAll()} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm text-white"><Square size={15} /> Dừng tất cả</button>}</div></div>
    {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading && <p className="text-sm text-slate-500">Đang tải…</p>}
    {!loading && students.length === 0 && <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">Chưa có học viên đang thi.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{students.map((student) => { const tile = tiles[student.id]; return <section key={student.id} className="overflow-hidden rounded-xl border bg-slate-950 text-white shadow-sm"><div className="flex items-start justify-between gap-3 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{student.email}</p><p className="mt-1 text-xs text-slate-400">{student.exam_started_at ? new Date(student.exam_started_at).toLocaleString() : 'Đang khởi tạo'}</p></div>{tile ? <button type="button" onClick={() => void stop(student.id)} className="shrink-0 rounded-md bg-red-600 px-2 py-1 text-xs"><Square size={13} className="inline" /> Dừng</button> : <button type="button" onClick={() => void view(student)} className="shrink-0 rounded-md bg-blue-600 px-2 py-1 text-xs"><MonitorPlay size={13} className="inline" /> Xem</button>}</div><div className="aspect-video bg-black"><video ref={(node) => setVideo(student.id, node)} autoPlay playsInline muted className="h-full w-full object-contain" /></div><div className="min-h-10 p-3 text-xs text-slate-300"><span className="inline-flex items-center gap-1"><Wifi size={13} />{tile ? STATUS_TEXT[tile.status] : 'Chưa mở luồng'}</span>{tile?.error && <p className="mt-1 text-red-300">{tile.error}</p>}</div></section>; })}</div>
  </div></div>;
}

export default LiveMonitor;
