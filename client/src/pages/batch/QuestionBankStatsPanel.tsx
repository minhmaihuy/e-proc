import { ModuleStats } from './types';

/**
 * Bảng số câu có sẵn theo module.
 *
 * Nhận dữ liệu qua props thay vì đọc state của cha, để component có kiểu ổn định và
 * không bị dựng lại sau mỗi lần cha render.
 */
interface QuestionBankStatsPanelProps {
  moduleStats: ModuleStats[];
}

function QuestionBankStatsPanel({ moduleStats }: QuestionBankStatsPanelProps) {
  if (moduleStats.length === 0) return null;

  return (
    <div className="mb-5 rounded-[10px] border border-blue-300 bg-gradient-to-br from-blue-50 to-green-50 px-[18px] py-3.5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">📊</span>
        <strong className="text-sm text-blue-800">Question Bank – By Module</strong>
        <span className="ml-1 text-xs text-slate-500">
          — Available question counts by Module
        </span>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-blue-500/10">
            <th className="px-2.5 py-1.5 text-left text-slate-800">Module</th>
            <th className="px-2.5 py-1.5 text-center text-green-700">🟢 Easy</th>
            <th className="px-2.5 py-1.5 text-center text-amber-700">🟡 Medium</th>
            <th className="px-2.5 py-1.5 text-center text-red-700">🔴 Hard</th>
            <th className="px-2.5 py-1.5 text-center text-slate-700">Total</th>
          </tr>
        </thead>
        <tbody>
          {moduleStats.map((stat, index) => (
            <tr
              key={stat.module}
              className={`border-t border-slate-200 ${index % 2 === 0 ? '' : 'bg-white/50'}`}
            >
              <td className="px-2.5 py-1 font-medium text-slate-800">{stat.module}</td>
              <td className="px-2.5 py-1 text-center font-semibold text-green-800">{stat.easy}</td>
              <td className="px-2.5 py-1 text-center font-semibold text-amber-800">{stat.medium}</td>
              <td className="px-2.5 py-1 text-center font-semibold text-red-800">{stat.hard}</td>
              <td className="px-2.5 py-1 text-center font-bold text-slate-700">
                {stat.easy + stat.medium + stat.hard}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default QuestionBankStatsPanel;
