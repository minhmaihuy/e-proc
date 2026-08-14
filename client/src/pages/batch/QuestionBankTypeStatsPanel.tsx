import { ModuleTypeStats } from './types';

const TYPE_EMOJI: Record<string, string> = {
  Coding: '💻',
  Conceptual: '🧠',
  'Fill-in': '✏️',
  Debug: '🐛',
};

/**
 * Bảng số câu có sẵn theo module × loại câu.
 *
 * Nhận dữ liệu qua props thay vì đọc state của cha, để component có kiểu ổn định và
 * không bị dựng lại sau mỗi lần cha render.
 */
interface QuestionBankTypeStatsPanelProps {
  modules: string[];
  moduleTypeStats: ModuleTypeStats[];
}

function QuestionBankTypeStatsPanel({ modules, moduleTypeStats }: QuestionBankTypeStatsPanelProps) {
  if (moduleTypeStats.length === 0) return null;

  const grouped = modules.reduce<Record<string, ModuleTypeStats[]>>((acc, module) => {
    acc[module] = moduleTypeStats.filter((stat) => stat.module === module);
    return acc;
  }, {});

  return (
    <div className="mb-5 rounded-[10px] border border-violet-300 bg-gradient-to-br from-violet-50 to-green-50 px-[18px] py-3.5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">🏷</span>
        <strong className="text-sm text-violet-700">Question Bank – By Module + Type</strong>
        <span className="ml-1 text-xs text-slate-500">
          — Available question counts by Module × Type
        </span>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-violet-500/10">
            <th className="px-2.5 py-1.5 text-left text-violet-900">Module</th>
            <th className="px-2.5 py-1.5 text-left text-violet-900">Type</th>
            <th className="px-2.5 py-1.5 text-center text-green-700">🟢 Easy</th>
            <th className="px-2.5 py-1.5 text-center text-amber-700">🟡 Medium</th>
            <th className="px-2.5 py-1.5 text-center text-red-700">🔴 Hard</th>
            <th className="px-2.5 py-1.5 text-center text-slate-700">Total</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(grouped).map(([module, stats]) =>
            stats.map((stat, index) => (
              <tr
                key={`${module}-${stat.type}`}
                className={`border-t border-slate-200 ${index % 2 === 0 ? '' : 'bg-white/50'}`}
              >
                {index === 0 && (
                  <td
                    rowSpan={stats.length}
                    className="border-r border-slate-200 px-2.5 py-1 align-top font-semibold text-slate-800"
                  >
                    {module}
                  </td>
                )}
                <td className="px-2.5 py-1 text-slate-700">
                  {TYPE_EMOJI[stat.type] || '❓'} {stat.type}
                </td>
                <td className="px-2.5 py-1 text-center font-semibold text-green-800">{stat.easy}</td>
                <td className="px-2.5 py-1 text-center font-semibold text-amber-800">{stat.medium}</td>
                <td className="px-2.5 py-1 text-center font-semibold text-red-800">{stat.hard}</td>
                <td className="px-2.5 py-1 text-center font-bold text-slate-700">
                  {stat.easy + stat.medium + stat.hard}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default QuestionBankTypeStatsPanel;
