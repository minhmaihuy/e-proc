import { BlueprintMode } from './types';

/** Chuyển giữa hai cách lập blueprint: theo module, hoặc theo module × loại câu. */
interface BlueprintModeToggleProps {
  value: BlueprintMode;
  onChange: (mode: BlueprintMode) => void;
}

function BlueprintModeToggle({ value, onChange }: BlueprintModeToggleProps) {
  return (
    <div className="mb-4 flex w-fit overflow-hidden rounded-lg border-[1.5px] border-indigo-500">
      {(['module', 'type'] as BlueprintMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`cursor-pointer border-none px-[22px] py-[7px] text-[13px] font-semibold transition-colors ${
            value === mode ? 'bg-indigo-500 text-white' : 'bg-violet-50 text-indigo-500'
          }`}
        >
          {mode === 'module' ? '🗂 By Module' : '🏷 By Type'}
        </button>
      ))}
    </div>
  );
}

export default BlueprintModeToggle;
