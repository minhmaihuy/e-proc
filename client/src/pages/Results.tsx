import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { StudentRecordings, adminApi } from '../services/api';
import AdminNav from '../components/AdminNav';
import PracticeResultsTable, { PracticeResultRow } from './results/PracticeResultsTable';
import ViolationDetailModal from './results/ViolationDetailModal';
import { ArrowLeft, Download, Search, FileText, CheckCircle2, FileJson, X, Settings2, ShieldAlert, Cpu, KeyRound } from 'lucide-react';
import DOMPurify from 'dompurify';

function Results() {
  const { id } = useParams<{ id: string }>();
  // Xem lại video ghi màn hình trên S3 của MỘT học viên. Link presigned hết hạn ngắn
  // nên luôn tải mới mỗi lần mở, không cache lại giữa các lần xem.
  const [recordingsFor, setRecordingsFor] = useState<{ studentId: number; email: string } | null>(null);
  const [recordings, setRecordings] = useState<StudentRecordings | null>(null);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsError, setRecordingsError] = useState('');
  const [identityFor, setIdentityFor] = useState<{ studentId: number; email: string } | null>(null);
  const [identityEvidence, setIdentityEvidence] = useState<{ status: string; id_url: string; face_url: string; review_token: string } | null>(null);
  const [identityError, setIdentityError] = useState('');
  const [identityLoading, setIdentityLoading] = useState(false);

  const openIdentity = async (studentId: number, email: string) => {
    setIdentityFor({ studentId, email });
    setIdentityEvidence(null);
    setIdentityError('');
    setIdentityLoading(true);
    try {
      const response = await adminApi.getStudentIdentity(Number(id), studentId);
      setIdentityEvidence(response.data);
    } catch (error: any) {
      setIdentityError(error.response?.data?.error || 'Unable to load identity evidence.');
    } finally {
      setIdentityLoading(false);
    }
  };

  const reviewIdentity = async (decision: 'verified' | 'rejected') => {
    if (!identityFor) return;
    setIdentityLoading(true);
    try {
      if (!identityEvidence) return;
      const response = await adminApi.reviewStudentIdentity(Number(id), identityFor.studentId, decision, identityEvidence.review_token);
      setIdentityEvidence(current => current ? { ...current, status: response.data.status } : current);
      await loadResults();
    } catch (error: any) {
      setIdentityError(error.response?.data?.error || 'Unable to save identity review.');
    } finally {
      setIdentityLoading(false);
    }
  };

  const openRecordings = async (studentId: number, email: string) => {
    setRecordingsFor({ studentId, email });
    setRecordings(null);
    setRecordingsError('');
    setRecordingsLoading(true);
    try {
      const res = await adminApi.getStudentRecordings(Number(id), studentId);
      setRecordings(res.data);
    } catch (err: any) {
      setRecordingsError(err.response?.data?.error || 'Không tải được danh sách bản ghi.');
    } finally {
      setRecordingsLoading(false);
    }
  };
  const [results, setResults] = useState<any[]>([]);
  // Đợt thi Practice có hình dạng kết quả khác hẳn: một dòng mỗi học viên thay vì
  // một khối câu hỏi mỗi học viên, nên giữ riêng chứ không nhồi vào `results`.
  const [practiceResults, setPracticeResults] = useState<PracticeResultRow[]>([]);
  const [batch, setBatch] = useState<any>(null);
  const isPracticeBatch = Boolean(batch?.practice_exam_id);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [editScore, setEditScore] = useState<number | null>(null);
  const [editFeedback, setEditFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Forensic popup: xem chi tiết các lần vi phạm (kèm nội dung paste) của 1 học viên
  const [violationDetail, setViolationDetail] = useState<{ email: string; events: any[] } | null>(null);

  useEffect(() => {
    loadBatch();
    loadResults();
  }, [id]);

  const loadBatch = async () => {
    try {
      const res = await adminApi.getBatch(parseInt(id!));
      setBatch(res.data);
      // Chỉ đợt thi Practice mới có practice_exam_id; đợt thường bỏ qua hẳn lời gọi này.
      if (res.data?.practice_exam_id) await loadPracticeResults();
    } catch (error) {
      console.error(error);
    }
  };

  const loadPracticeResults = async () => {
    try {
      const res = await adminApi.getPracticeResults(parseInt(id!));
      setPracticeResults(res.data);
    } catch (error) {
      console.error('[Results] loadPracticeResults error:', error);
    }
  };

  const handleSavePracticeScore = async (studentId: number, score: number, feedback: string) => {
    await adminApi.updatePracticeResult(studentId, { trainer_score: score, trainer_feedback: feedback });
    await loadPracticeResults();
  };

  const loadResults = async () => {
    setLoading(true);
    try {
      const res = await adminApi.getResults(parseInt(id!));
      setResults(res.data);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  const handleExport = async () => {
    try {
      // Hai loại đợt thi có hình dạng file khác nhau: practice là một sheet, mỗi học
      // viên một dòng; đợt thường là mỗi học viên một sheet, mỗi câu một dòng.
      const res = isPracticeBatch
        ? await adminApi.exportPracticeResults(parseInt(id!))
        : await adminApi.exportResults(parseInt(id!));
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${isPracticeBatch ? 'practice-results' : 'results'}-${id}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSaveScore = async (studentId: number) => {
    setSaving(true);
    try {
      await adminApi.updateResult(studentId, {
        trainer_score: editScore,
        trainer_feedback: editFeedback
      });
      setSelectedStudent(null);
      loadResults();
    } catch (error) {
      console.error(error);
    }
    setSaving(false);
  };

  const getAverageScore = (student: any) => {
    const scores = student.questions?.filter((q: any) => q.ai_score !== null).map((q: any) => q.trainer_score ?? q.ai_score) || [];
    if (scores.length === 0) return '0.0';
    return (scores.reduce((a: number, b: number) => a + Number(b), 0) / scores.length).toFixed(1);
  };

  const sanitizeQuestion = (html: string): string => {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'br', 'p', 'strong', 'em', 'b', 'i', 'u',
        'pre', 'code', 'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'span', 'div', 'blockquote',
        'table', 'thead', 'tbody', 'tr', 'th', 'td'
      ],
      ALLOWED_ATTR: ['class', 'style'],
      FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
    });
  };

  return (
    <div className="container">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 pb-4 border-b border-slate-200 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <FileText size={24} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight m-0 border-none pb-0">Results {batch ? `- ${batch.name}` : ''}</h1>
        </div>
        <Link
          to="/admin/batches"
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors shadow-sm"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Back to Batches</span>
        </Link>
      </div>

      <AdminNav />

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-bold text-slate-800 m-0 border-none pb-0">Student Results ({isPracticeBatch ? practiceResults.length : results.length})</h2>
        <button
          onClick={handleExport}
          disabled={(isPracticeBatch ? practiceResults.length : results.length) === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
        >
          <Download size={16} />
          Export Excel
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
          <p className="text-slate-500 font-medium">Loading results...</p>
        </div>
      ) : isPracticeBatch ? (
        // Đề .docx là một bài duy nhất nên không có khung xem theo từng câu hỏi.
        <PracticeResultsTable rows={practiceResults} onSave={handleSavePracticeScore} />
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 font-semibold text-slate-600">Student</th>
                    <th className="px-6 py-4 font-semibold text-slate-600 text-center">Status</th>
                    <th className="px-6 py-4 font-semibold text-slate-600">Violations</th>
                    <th className="px-6 py-4 font-semibold text-slate-600 text-center">Avg Score</th>
                    <th className="px-6 py-4 font-semibold text-slate-600 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map(r => (
                    <tr key={r.student.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900">{r.student.email}</div>
                        {/* Mật khẩu giải nén video record (mode local). HV không thấy — chỉ admin. */}
                        {r.student.recording_password && (
                          <div className="mt-1.5 flex flex-col gap-1 text-xs text-slate-500">
                            <span className="flex items-center gap-1"><KeyRound size={12} /> Decryption password:</span>
                            <code className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200 font-mono break-all inline-block w-fit">
                              {r.student.recording_password}
                            </code>
                          </div>
                        )}
                        {batch?.record_mode === 's3' && (
                          <div className={`mt-1.5 text-xs font-semibold ${r.recording_parts?.length ? 'text-emerald-700' : 'text-red-700'}`}>
                            {r.recording_parts?.length
                              ? `Recording evidence: ${r.recording_parts.length} part(s), ${r.recording_parts.reduce((sum: number, part: any) => sum + Number(part.byte_size || 0), 0).toLocaleString()} bytes`
                              : 'Recording evidence missing'}
                          </div>
                        )}
                        {batch?.record_mode === 's3' && !!r.recording_parts?.length && (
                          <button
                            type="button"
                            onClick={() => openRecordings(r.student.id, r.student.email)}
                            className="mt-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-2"
                          >
                            ▶ Xem lại video ({r.recording_parts.length} phần)
                          </button>
                        )}
                        {batch?.identity_verification === 'photo' && ['captured', 'verified', 'rejected'].includes(r.student.identity_status) && (
                          <button type="button" onClick={() => openIdentity(r.student.id, r.student.email)} className="mt-1.5 block text-xs font-semibold text-indigo-700 underline underline-offset-2">
                            Review identity photos ({r.student.identity_status})
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${r.student.status === 'submitted'
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-100 text-amber-700 border border-amber-200'
                          }`}>
                          {r.student.status === 'submitted' && <CheckCircle2 size={12} />}
                          {r.student.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {r.violations > 0 ? (
                          <div className="space-y-2">
                            <span className="inline-flex items-center gap-1.5 text-red-600 font-semibold text-sm">
                              <ShieldAlert size={14} />
                              {r.violations} total
                            </span>
                            {/* Breakdown chi tiết theo type — mọi type đều lockable (badge cam) */}
                            {r.violations_breakdown && Object.keys(r.violations_breakdown).length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {Object.entries(r.violations_breakdown as Record<string, number>)
                                  .sort(([, a], [, b]) => b - a)
                                  .map(([type, count]) => (
                                    <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-orange-50 border border-orange-200 text-orange-700 rounded text-[10px] font-mono font-semibold">
                                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                                      {type}: {count}
                                    </span>
                                  ))}
                              </div>
                            )}
                            {/* Cảnh báo nổi bật: phát hiện phiên thi đồng thời từ nhiều IP/client */}
                            {r.violation_events && (() => {
                              const cs = (r.violation_events as any[]).filter((e) => e.type === 'concurrent_session');
                              if (cs.length === 0) return null;
                              const ipSet = new Set<string>();
                              cs.forEach((e) => {
                                try {
                                  const m = typeof e.metadata_json === 'string' ? JSON.parse(e.metadata_json) : e.metadata_json;
                                  (m?.ips || []).forEach((ip: string) => ipSet.add(ip));
                                } catch (_) { /* ignore */ }
                              });
                              return (
                                <div className="mt-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 border border-red-300 text-red-800 rounded text-[10px] font-bold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>
                                    ⚠️ Multi-session{ipSet.size > 0 ? ` (${ipSet.size} IP)` : ''} ×{cs.length}
                                  </span>
                                </div>
                              );
                            })()}
                            {/* Forensic: xem nội dung paste / thời điểm từng lần vi phạm */}
                            {r.violation_events && r.violation_events.length > 0 && (
                              <button
                                onClick={() => setViolationDetail({ email: r.student.email, events: r.violation_events })}
                                className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors"
                              >
                                <Search size={12} /> View details ({r.violation_events.length})
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-medium">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-block px-3 py-1 bg-slate-100 text-slate-800 font-bold rounded-lg border border-slate-200">
                          {getAverageScore(r)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            setSelectedStudent(r);
                            const firstQ = r.questions[0];
                            setEditScore(firstQ?.trainer_score ?? firstQ?.ai_score ?? 0);
                            setEditFeedback(firstQ?.trainer_feedback ?? '');
                            // scroll to review section
                            setTimeout(() => {
                              document.getElementById('review-section')?.scrollIntoView({ behavior: 'smooth' });
                            }, 100);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
                        >
                          <Settings2 size={14} />
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                  {results.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <FileJson size={32} className="text-slate-300" />
                          <p>No results available for this batch yet.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedStudent && (
            <div id="review-section" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-24">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-900 m-0 border-none pb-0">Review: <span className="text-blue-600 font-mono text-sm">{selectedStudent.student.email}</span></h3>
                <button onClick={() => setSelectedStudent(null)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* All Questions */}
                {selectedStudent.questions.map((q: any, index: number) => (
                  <div key={q.id} className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 bg-slate-100/50 border-b border-slate-200 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                          {index + 1}
                        </span>
                        <strong className="text-slate-800 text-sm">
                          {q.module} ({q.level}) - {q.type}
                        </strong>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold border ${q.ai_score >= 7 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          q.ai_score >= 5 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-red-50 text-red-700 border-red-200'
                        }`}>
                        <Cpu size={12} /> AI Score: {q.ai_score ?? '-'}
                      </span>
                    </div>

                    <div className="p-5 space-y-4">
                      <div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Question</span>
                        <div
                          className="prose prose-sm prose-slate max-w-none text-slate-900 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: sanitizeQuestion(q.question_sample || '') }}
                        />
                      </div>

                      <div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Student Answer</span>
                        {q.answer ? (
                          <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                            <pre className="text-slate-300 font-mono text-sm m-0 leading-relaxed whitespace-pre-wrap break-words">
                              {q.answer}
                            </pre>
                          </div>
                        ) : (
                          <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-lg text-slate-500 text-sm italic">
                            No answer provided
                          </div>
                        )}
                      </div>

                      <details className="group border border-slate-200 rounded-lg bg-white overflow-hidden [&_summary::-webkit-details-marker]:hidden">
                        <summary className="flex items-center justify-between cursor-pointer px-4 py-3 bg-slate-50 text-slate-700 font-medium text-sm hover:bg-slate-100 transition-colors">
                          <span className="flex items-center gap-2"><FileText size={16} className="text-slate-400" /> Rubric & AI Feedback</span>
                          <span className="text-slate-400 transition-transform group-open:rotate-180">▼</span>
                        </summary>
                        <div className="p-4 border-t border-slate-100 text-sm space-y-4">
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                              <div className="md:col-span-3 text-emerald-700 font-semibold text-xs uppercase tracking-wide">Must-have (70%)</div>
                              <div className="md:col-span-9 text-slate-700">{q.rubric_must_have}</div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                              <div className="md:col-span-3 text-amber-700 font-semibold text-xs uppercase tracking-wide">Nice-to-have (20%)</div>
                              <div className="md:col-span-9 text-slate-700">{q.rubric_nice_to_have}</div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                              <div className="md:col-span-3 text-slate-500 font-semibold text-xs uppercase tracking-wide">Optional (10%)</div>
                              <div className="md:col-span-9 text-slate-700">{q.rubric_optional}</div>
                            </div>
                          </div>

                          {q.ai_feedback && (
                            <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                              <strong className="flex items-center gap-2 text-indigo-900 text-xs uppercase tracking-wide mb-2"><Cpu size={14} /> AI Feedback Analysis</strong>
                              <div className="text-indigo-800 leading-relaxed">{q.ai_feedback}</div>
                            </div>
                          )}
                        </div>
                      </details>
                    </div>
                  </div>
                ))}

                {/* Trainer Score Override Form - AT THE BOTTOM */}
                <div className="mt-8 p-6 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                    <CheckCircle2 size={120} className="text-emerald-600" />
                  </div>

                  <div className="relative z-10">
                    <h4 className="text-lg font-bold text-emerald-900 mb-1 m-0 border-none pb-0">Trainer Score Override</h4>
                    <p className="text-emerald-700 text-sm mb-6">
                      Review all answers above before making your final decision.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-1">
                        <label className="block text-sm font-bold text-emerald-900 mb-2">Final Score (0-10)</label>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="0.1"
                          value={editScore ?? ''}
                          onChange={e => setEditScore(parseFloat(e.target.value))}
                          className="block w-full px-4 py-3 bg-white border border-emerald-300 rounded-lg text-emerald-900 text-xl font-bold text-center focus:ring-2 focus:ring-emerald-500 shadow-inner"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-bold text-emerald-900 mb-2">Trainer Feedback (Optional)</label>
                        <textarea
                          rows={3}
                          value={editFeedback}
                          onChange={e => setEditFeedback(e.target.value)}
                          placeholder="Enter your feedback for the student..."
                          className="block w-full px-4 py-3 bg-white border border-emerald-300 rounded-lg text-emerald-900 focus:ring-2 focus:ring-emerald-500 shadow-inner text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-6 flex items-center gap-3">
                      <button
                        onClick={() => handleSaveScore(selectedStudent.student.id)}
                        disabled={saving}
                        className="inline-flex items-center justify-center px-6 py-2.5 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save & Apply to All Questions'}
                      </button>
                      <button
                        onClick={() => setSelectedStudent(null)}
                        className="inline-flex items-center justify-center px-4 py-2.5 bg-white text-slate-700 border border-slate-300 font-medium rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Popup pháp chứng: chi tiết từng lần vi phạm kèm nội dung dán. Tách sang
          results/ViolationDetailModal.tsx để trang này chỉ còn phần điều phối. */}
      {violationDetail && (
        <ViolationDetailModal
          email={violationDetail.email}
          events={violationDetail.events}
          onClose={() => setViolationDetail(null)}
        />
      )}

      {/* Xem lại video ghi màn hình (S3) của một học viên */}
      {identityFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="presentation" onMouseDown={() => setIdentityFor(null)}>
          <section role="dialog" aria-modal="true" aria-label={`Identity evidence for ${identityFor.email}`} className="w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl" onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-900">Manual identity review</h3><p className="text-sm text-slate-500">{identityFor.email}</p></div><button type="button" aria-label="Close" onClick={() => setIdentityFor(null)}><X size={18} /></button></div>
            {identityLoading && !identityEvidence && <p className="mt-6 text-sm text-slate-500">Loading short-lived image links…</p>}
            {identityError && <p className="mt-6 text-sm font-medium text-red-700">{identityError}</p>}
            {identityEvidence && <><div className="mt-5 grid gap-4 md:grid-cols-2"><figure><figcaption className="mb-2 font-semibold">Government ID</figcaption><img src={identityEvidence.id_url} alt="Government ID supplied by candidate" className="max-h-[55vh] w-full rounded-xl border object-contain" /></figure><figure><figcaption className="mb-2 font-semibold">Current face photo</figcaption><img src={identityEvidence.face_url} alt="Current face supplied by candidate" className="max-h-[55vh] w-full rounded-xl border object-contain" /></figure></div>{identityEvidence.status === 'captured' ? <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={identityLoading} onClick={() => reviewIdentity('rejected')} className="rounded-lg border border-red-300 px-4 py-2 font-semibold text-red-700">Reject</button><button type="button" disabled={identityLoading} onClick={() => reviewIdentity('verified')} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">Approve</button></div> : <p className="mt-5 text-right text-sm font-semibold text-slate-600">Review status: {identityEvidence.status}</p>}</>}
          </section>
        </div>
      )}
      {recordingsFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="presentation"
          onMouseDown={() => setRecordingsFor(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Bản ghi màn hình của ${recordingsFor.email}`}
            className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Bản ghi màn hình</h3>
                <p className="text-sm text-slate-500">{recordingsFor.email}</p>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setRecordingsFor(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {recordingsLoading && <p className="mt-6 text-sm text-slate-500">Đang tạo link xem…</p>}
            {recordingsError && <p className="mt-6 text-sm font-medium text-red-700">{recordingsError}</p>}

            {recordings && !recordingsLoading && (
              <>
                {recordings.parts.length === 0 ? (
                  <p className="mt-6 text-sm text-slate-600">{recordings.message || 'Không có phần nào.'}</p>
                ) : (
                  <>
                    <p className="mt-4 text-xs text-slate-500">
                      Mỗi phần là một đoạn 5 phút. Link xem hết hạn sau{' '}
                      {Math.round((recordings.url_expires_seconds || 300) / 60)} phút — đóng và mở lại
                      để lấy link mới.
                    </p>
                    <ul className="mt-4 space-y-4">
                      {recordings.parts.map(part => (
                        <li key={part.part_index} className="rounded-xl border border-slate-200 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                            <span className="font-semibold text-slate-800">
                              Phần {part.part_index}
                              {part.is_final && ' (cuối)'}
                            </span>
                            <span>
                              {(part.byte_size / (1024 * 1024)).toFixed(1)} MB ·{' '}
                              {part.uploaded_at ? new Date(part.uploaded_at).toLocaleString() : '—'}
                            </span>
                          </div>
                          <video src={part.url} controls preload="none" className="w-full rounded-lg bg-black" />
                          <a
                            href={part.url}
                            download
                            className="mt-2 inline-block text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
                          >
                            Tải phần này về
                          </a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

    </div>

  );
}

export default Results;
