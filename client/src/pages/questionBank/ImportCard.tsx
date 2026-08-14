import { RefObject } from 'react';
import { AlertCircle, FileQuestion, FileSpreadsheet, Upload } from 'lucide-react';

/**
 * Khối nhập câu hỏi từ Excel.
 *
 * Hai nút riêng cho hai loại đề vì backend có hai route import khác nhau
 * (`/questions/import` và `/questions/quiz/import`) với cấu trúc cột khác nhau —
 * không phải một cờ trong cùng một luồng.
 */
interface ImportCardProps {
  fileInputRef: RefObject<HTMLInputElement>;
  file: File | null;
  loading: boolean;
  message: string;
  isError: boolean;
  onFileChange: (file: File | null) => void;
  onImport: (mode: 'essay' | 'quiz') => void;
}

function ImportCard({
  fileInputRef,
  file,
  loading,
  message,
  isError,
  onFileChange,
  onImport,
}: ImportCardProps) {
  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4">
        <h3 className="m-0 flex items-center gap-2 border-none pb-0 font-bold text-slate-900">
          <Upload size={18} className="text-slate-500" />
          Import Questions from Excel
        </h3>
      </div>

      <div className="p-6">
        <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <div className="relative max-w-md flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              aria-label="Chọn file Excel"
              onChange={(event) => onFileChange(event.target.files?.[0] || null)}
              className="block w-full cursor-pointer rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onImport('essay')}
              disabled={!file || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <FileSpreadsheet size={16} />
              {loading ? 'Importing…' : 'Import Essay'}
            </button>
            <button
              onClick={() => onImport('quiz')}
              disabled={!file || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <FileQuestion size={16} />
              {loading ? 'Importing…' : 'Import Quiz'}
            </button>
          </div>
        </div>

        <div className="inline-block w-full rounded-lg border border-slate-100 bg-slate-50 p-3 md:w-auto">
          <p className="m-0 flex items-center gap-1.5 text-xs text-slate-500">
            <AlertCircle size={14} className="text-slate-400" />
            <span className="font-semibold text-slate-700">Quiz template:</span> ID | Type
            (SingleChoice/MultipleChoice) | Level | Topic | Question Sample | Option A…F | Correct | Score
          </p>
        </div>

        {message && (
          <div
            role={isError ? 'alert' : 'status'}
            className={`mt-4 rounded-lg border p-3 text-sm font-medium ${
              isError
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportCard;
