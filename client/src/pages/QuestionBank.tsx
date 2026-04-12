import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../services/api';

function QuestionBank() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const auth = localStorage.getItem('adminAuth');
    if (!auth) {
      window.location.href = '/admin';
      return;
    }
    loadQuestions();
    loadModules();
  }, []);

  const loadQuestions = async () => {
    try {
      const res = await adminApi.getQuestions();
      setQuestions(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const loadModules = async () => {
    try {
      const res = await adminApi.getModules();
      setModules(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await adminApi.importQuestions(formData);
      setMessage(`Imported: ${res.data.imported}, Updated: ${res.data.updated}`);
      loadQuestions();
      loadModules();
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: any) {
      setMessage('Error: ' + (error.response?.data?.error || error.message));
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this question?')) return;
    try {
      await adminApi.deleteQuestion(id);
      loadQuestions();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>Question Bank</h1>
        <Link to="/admin/dashboard" className="btn btn-secondary">Back to Dashboard</Link>
      </div>

      <div className="nav">
        <Link to="/admin/dashboard">Dashboard</Link>
        <Link to="/admin/questions">Question Bank</Link>
        <Link to="/admin/batches">Batches</Link>
        <Link to="/admin/settings">AI Settings</Link>
      </div>

      <div className="card">
        <h3>Import Questions from Excel</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
          <input 
            ref={fileInputRef}
            type="file" 
            accept=".xlsx,.xls" 
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ width: 'auto' }}
          />
          <button onClick={handleImport} disabled={!file || loading} className="btn btn-primary">
            {loading ? 'Importing...' : 'Import'}
          </button>
        </div>
        {message && <p className={message.includes('Error') ? 'error' : 'success'}>{message}</p>}
      </div>

      <div className="card">
        <h3>Questions ({questions.length})</h3>
        <p style={{ color: 'var(--text-light)', marginBottom: 15 }}>Available modules: {modules.join(', ')}</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Level</th>
              <th>Module</th>
              <th>Question</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {questions.map(q => (
              <tr key={q.id}>
                <td style={{ fontFamily: 'monospace' }}>{q.id}</td>
                <td>{q.type}</td>
                <td>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 12,
                    background: q.level === 'Easy' ? '#dcfce7' : q.level === 'Medium' ? '#fef3c7' : '#fee2e2',
                    color: q.level === 'Easy' ? '#166534' : q.level === 'Medium' ? '#92400e' : '#dc2626'
                  }}>
                    {q.level}
                  </span>
                </td>
                <td>{q.module}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q.question_sample}
                </td>
                <td>
                  <button onClick={() => handleDelete(q.id)} className="btn btn-danger" style={{ fontSize: 12, padding: '5px 10px' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {questions.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-light)' }}>No questions yet. Import from Excel.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default QuestionBank;