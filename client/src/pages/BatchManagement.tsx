import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import AdminNav from '../components/AdminNav';
import { ArrowLeft, FolderKanban, ListChecks, Plus } from 'lucide-react';

const BATCH_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type BatchPageSize = typeof BATCH_PAGE_SIZE_OPTIONS[number];

// Convert "YYYY-MM-DDTHH:mm" (treated as GMT+7 input) → UTC ISO string
const localToUTC = (localStr: string): string => {
  if (!localStr) return localStr;
  // Append +07:00 so browser parses as GMT+7, then convert to UTC
  return new Date(`${localStr}:00+07:00`).toISOString();
};

// Convert UTC ISO string → "YYYY-MM-DDTHH:mm" in GMT+7 (for datetime-local input)
const utcToLocalInput = (utcStr: string): string => {
  if (!utcStr) return '';
  const date = new Date(utcStr);
  // Shift to GMT+7
  const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return gmt7.toISOString().slice(0, 16);
};

// Format UTC ISO string → human-readable GMT+7 (for display in table)
const formatGMT7 = (utcStr: string): string => {
  if (!utcStr) return '';
  return new Date(utcStr).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
};

type BlueprintMode = 'module' | 'type';

const QUESTION_TYPES = ['Coding', 'Conceptual', 'Fill-in', 'Debug'] as const;
type QuestionType = typeof QUESTION_TYPES[number];

interface BlueprintItem {
  /**
   * Khóa React ổn định, CHỈ tồn tại phía client. Các bảng blueprint xóa dòng theo
   * index, nên nếu key cũng là index thì sau khi xóa dòng giữa React sẽ gán state DOM
   * của dòng bị xóa cho dòng kế tiếp. Bị strip trước khi gửi lên server.
   */
  rowId?: string;
  module: string;
  /** Bộ đề: thiếu trường này thì đề sẽ trộn câu từ mọi bộ có cùng tên module. */
  question_group?: string;
  easy: number;
  medium: number;
  hard: number;
}

interface BlueprintItemByType {
  rowId?: string;
  module: string;
  question_group?: string;
  type: QuestionType;
  easy: number;
  medium: number;
  hard: number;
}

interface ModuleStats {
  module: string;
  easy: number;
  medium: number;
  hard: number;
}

interface TypeStats {
  type: string;
  easy: number;
  medium: number;
  hard: number;
}

interface ModuleTypeStats {
  module: string;
  type: string;
  easy: number;
  medium: number;
  hard: number;
}


/**
 * Một <option> chỉ mang được MỘT chuỗi, nhưng blueprint cần cả module lẫn bộ đề —
 * cùng tên module có thể tồn tại ở nhiều bộ và số câu có sẵn khác nhau. Nên mã hóa
 * cặp đó thành một khóa duy nhất cho dropdown.
 */
/** Id ổn định cho một dòng blueprint (chỉ dùng phía client, xem BlueprintItem.rowId). */
let rowIdCounter = 0;
const newRowId = () => `row_${Date.now().toString(36)}_${rowIdCounter++}`;

const comboKey = (module: string, group: string) => `${module}|||${group || ''}`;
const decodeComboKey = (key: string) => {
  const i = key.indexOf('|||');
  return i === -1
    ? { module: key, question_group: '' }
    : { module: key.slice(0, i), question_group: key.slice(i + 3) };
};
const comboLabel = (module: string, group: string) => (group ? `${module} (${group})` : module);

interface ModuleGroupOption { module: string; question_group: string }
interface ModuleGroupStats extends ModuleGroupOption { easy: number; medium: number; hard: number }
interface ModuleGroupTypeStats extends ModuleGroupStats { type: string }

function BatchManagement() {
  const { isAdmin, userId } = useAuth();
  const [batches, setBatches] = useState<any[]>([]);
  // Chế độ ghi màn hình superadmin cấp cho tenant này. Backend chặn độc lập; đây chỉ để
  // không bày ra lựa chọn chắc chắn bị từ chối.
  const [recordingConfig, setRecordingConfig] = useState<{ allowed: string[]; canChange: boolean; s3Configured: boolean }>({
    allowed: ['none'],
    canChange: false,
    s3Configured: false,
  });
  const [modules, setModules] = useState<string[]>([]);
  // Cặp (module, bộ đề) — dropdown blueprint phải chọn theo cặp, không chỉ module.
  const [moduleGroups, setModuleGroups] = useState<ModuleGroupOption[]>([]);
  const [moduleGroupStats, setModuleGroupStats] = useState<ModuleGroupStats[]>([]);
  const [moduleGroupTypeStats, setModuleGroupTypeStats] = useState<ModuleGroupTypeStats[]>([]);
  const [moduleStats, setModuleStats] = useState<ModuleStats[]>([]);
  const [typeStats, setTypeStats] = useState<TypeStats[]>([]);
  const [moduleTypeStats, setModuleTypeStats] = useState<ModuleTypeStats[]>([]);
  // Pagination
  const [batchPageSize, setBatchPageSize] = useState<BatchPageSize>(10);
  const [batchCurrentPage, setBatchCurrentPage] = useState(1);
  // Create form state
  const [blueprintMode, setBlueprintMode] = useState<BlueprintMode>('module');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    start_time: '',
    end_time: '',
    duration: 30,
    blueprint: [] as BlueprintItem[],
    blueprintByType: [] as BlueprintItemByType[],
    record_mode: 'none' as 'none' | 'local' | 's3',
    exam_type: 'essay' as 'essay' | 'quiz',
  });
  // Edit form state
  const [editBlueprintMode, setEditBlueprintMode] = useState<BlueprintMode>('module');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [editingBatch, setEditingBatch] = useState<any>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [emails, setEmails] = useState('');
  const [inviteResult, setInviteResult] = useState<{ success: number; emails: { email: string; code: string }[] } | null>(null);
  const [feasibilityErrors, setFeasibilityErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Số câu có sẵn cho một cặp (module, bộ đề) */
  const getStatsForModuleGroup = (moduleName: string, group: string): ModuleGroupStats =>
    moduleGroupStats.find(s => s.module === moduleName && (s.question_group || '') === (group || ''))
    ?? { module: moduleName, question_group: group || '', easy: 0, medium: 0, hard: 0 };

  const getStatsForModuleGroupType = (moduleName: string, group: string, typeName: string): ModuleGroupTypeStats =>
    moduleGroupTypeStats.find(s => s.module === moduleName && (s.question_group || '') === (group || '') && s.type === typeName)
    ?? { module: moduleName, question_group: group || '', type: typeName, easy: 0, medium: 0, hard: 0 };

  /** Cập nhật cùng lúc module + bộ đề (dropdown chọn một combo) */
  const updateBlueprintModuleGroup = (index: number, module: string, question_group: string) => {
    const next = [...formData.blueprint];
    next[index] = { ...next[index], module, question_group };
    setFormData(prev => ({ ...prev, blueprint: next }));
  };
  const updateTypeBlueprintModuleGroup = (index: number, module: string, question_group: string) => {
    const next = [...formData.blueprintByType];
    next[index] = { ...next[index], module, question_group };
    setFormData(prev => ({ ...prev, blueprintByType: next }));
  };

  /** Validate blueprint (by module) against available question counts */
  const validateBlueprintAgainstStats = (blueprint: BlueprintItem[]): string[] => {
    const errors: string[] = [];
    for (const item of blueprint) {
      const stats = getStatsForModuleGroup(item.module, item.question_group || '');
      if (item.easy > stats.easy)
        errors.push(`Module "${item.module}": Easy requires ${item.easy}, only ${stats.easy} available.`);
      if (item.medium > stats.medium)
        errors.push(`Module "${item.module}": Medium requires ${item.medium}, only ${stats.medium} available.`);
      if (item.hard > stats.hard)
        errors.push(`Module "${item.module}": Hard requires ${item.hard}, only ${stats.hard} available.`);
    }
    return errors;
  };

  /** Validate blueprint (by module+type) against available question counts */
  const validateTypesBlueprintAgainstStats = (blueprint: BlueprintItemByType[]): string[] => {
    const errors: string[] = [];
    for (const item of blueprint) {
      const stats = getStatsForModuleGroupType(item.module, item.question_group || '', item.type);
      if (item.easy > stats.easy)
        errors.push(`Module "${item.module}" / Type "${item.type}": Easy requires ${item.easy}, only ${stats.easy} available.`);
      if (item.medium > stats.medium)
        errors.push(`Module "${item.module}" / Type "${item.type}": Medium requires ${item.medium}, only ${stats.medium} available.`);
      if (item.hard > stats.hard)
        errors.push(`Module "${item.module}" / Type "${item.type}": Hard requires ${item.hard}, only ${stats.hard} available.`);
    }
    return errors;
  };

  /**
   * Build the blueprint payload to send to the server.
   * Wraps into { blueprintMode, items } object.
   */
  const buildBlueprintPayload = (mode: BlueprintMode, moduleItems: BlueprintItem[], typeItems: BlueprintItemByType[]) => ({
    blueprintMode: mode,
    // rowId chỉ phục vụ React; đừng để nó rơi vào blueprint lưu trong database.
    items: (mode === 'type' ? typeItems : moduleItems).map(({ rowId, ...item }) => item),
  });

  // ─── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    adminApi
      .getRecordingConfig()
      .then(res => setRecordingConfig({
        allowed: res.data.allowed_record_modes || ['none'],
        canChange: Boolean(res.data.can_change),
        s3Configured: Boolean(res.data.s3_configured),
      }))
      .catch(() => { /* giữ mặc định chỉ 'none' nếu không lấy được */ });
    loadBatches();
    loadModules();
    loadModuleGroups();
    loadModuleStats();
    loadTypeStats();
    loadModuleTypeStats();
  }, []);


  useEffect(() => {
    if (modules.length > 0 && formData.blueprint.length === 0) {
      setFormData(prev => ({
        ...prev,
        blueprint: [{ rowId: newRowId(), module: moduleGroups[0]?.module || modules[0], question_group: moduleGroups[0]?.question_group || '', easy: 0, medium: 0, hard: 0 }]
      }));
    }
  }, [modules]);

  // ─── Loaders ────────────────────────────────────────────────────────────────

  const loadBatches = async () => {
    try {
      const res = await adminApi.getBatches();
      setBatches(res.data);
    } catch (error) {
      console.error(error);
    }
  };

  const loadModuleGroups = async () => {
    try {
      const [groups, stats, typeStats] = await Promise.all([
        adminApi.getModuleGroups(),
        adminApi.getModuleGroupStats(),
        adminApi.getModuleGroupTypeStats(),
      ]);
      setModuleGroups(groups.data);
      setModuleGroupStats(stats.data);
      setModuleGroupTypeStats(typeStats.data);
    } catch (error) {
      console.error('[BatchManagement] loadModuleGroups error:', error);
    }
  };

  const loadModules = async () => {
    try {
      const res = await adminApi.getModules();
      console.log('[BatchManagement] Modules loaded:', res.data);
      setModules(res.data);
    } catch (error) {
      console.error('[BatchManagement] loadModules error:', error);
    }
  };

  const loadModuleStats = async () => {
    try {
      const res = await adminApi.getModuleStats();
      console.log('[BatchManagement] Module stats loaded:', res.data);
      setModuleStats(res.data);
    } catch (error) {
      console.error('[BatchManagement] loadModuleStats error:', error);
    }
  };

  const loadTypeStats = async () => {
    try {
      const res = await adminApi.getTypeStats();
      console.log('[BatchManagement] Type stats loaded:', res.data);
      setTypeStats(res.data);
    } catch (error) {
      console.error('[BatchManagement] loadTypeStats error:', error);
    }
  };

  const loadModuleTypeStats = async () => {
    try {
      const res = await adminApi.getModuleTypeStats();
      console.log('[BatchManagement] Module-type stats loaded:', res.data);
      setModuleTypeStats(res.data);
    } catch (error) {
      console.error('[BatchManagement] loadModuleTypeStats error:', error);
    }
  };

  // ─── Blueprint helpers (Create form) ────────────────────────────────────────

  const addBlueprintRow = () => {
    console.log('[BatchManagement] addBlueprintRow, modules:', modules);
    setFormData(prev => ({
      ...prev,
      blueprint: [...prev.blueprint, { rowId: newRowId(), module: moduleGroups[0]?.module || modules[0] || '', question_group: moduleGroups[0]?.question_group || '', easy: 0, medium: 0, hard: 0 }]
    }));
  };

  const updateBlueprint = (index: number, field: keyof BlueprintItem, value: any) => {
    const newBlueprint = [...formData.blueprint];
    const convertedValue = field === 'module' ? value : Number(value);
    newBlueprint[index] = { ...newBlueprint[index], [field]: convertedValue };
    setFormData(prev => ({ ...prev, blueprint: newBlueprint }));
  };

  const removeBlueprintRow = (index: number) => {
    setFormData(prev => ({
      ...prev,
      blueprint: prev.blueprint.filter((_, i) => i !== index)
    }));
  };

  // ─── Blueprint helpers (By Type – Create form) ───────────────────────────────

  /** (module, type) combos already used in By Type blueprint */
  const usedModuleTypeCombos = formData.blueprintByType.map(i => `${i.module}||${i.question_group || ''}||${i.type}`);

  /** Find first available (module, type) combo not yet used */
  const getNextAvailableModuleType = (): { module: string; question_group: string; type: QuestionType } | null => {
    for (const mg of moduleGroups) {
      for (const t of QUESTION_TYPES) {
        if (!usedModuleTypeCombos.includes(`${mg.module}||${mg.question_group}||${t}`)) {
          return { module: mg.module, question_group: mg.question_group, type: t };
        }
      }
    }
    return null;
  };
  const nextAvailableModuleType = getNextAvailableModuleType();

  const addTypeBlueprintRow = () => {
    if (!nextAvailableModuleType) return;
    setFormData(prev => ({
      ...prev,
      blueprintByType: [...prev.blueprintByType, { rowId: newRowId(), module: nextAvailableModuleType.module, question_group: nextAvailableModuleType.question_group, type: nextAvailableModuleType.type, easy: 0, medium: 0, hard: 0 }]
    }));
  };

  const updateTypeBlueprint = (index: number, field: keyof BlueprintItemByType, value: any) => {
    const newBlueprint = [...formData.blueprintByType];
    const convertedValue = (field === 'module' || field === 'type') ? value : Number(value);
    newBlueprint[index] = { ...newBlueprint[index], [field]: convertedValue };
    setFormData(prev => ({ ...prev, blueprintByType: newBlueprint }));
  };

  const removeTypeBlueprintRow = (index: number) => {
    setFormData(prev => ({
      ...prev,
      blueprintByType: prev.blueprintByType.filter((_, i) => i !== index)
    }));
  };

  /** Switch blueprint mode in Create form – resets rows */
  const switchBlueprintMode = (newMode: BlueprintMode) => {
    setBlueprintMode(newMode);
    setFormData(prev => ({ ...prev, blueprint: [], blueprintByType: [] }));
    setFeasibilityErrors([]);
  };

  // ─── Blueprint helpers (Edit form) ───────────────────────────────────────────

  const usedModuleTypeCombosEdit = ((editingBatch?.blueprintByType || []) as BlueprintItemByType[]).map(i => `${i.module}||${i.type}`);
  const getNextAvailableModuleTypeEdit = (): { module: string; type: QuestionType } | null => {
    for (const m of modules) {
      for (const t of QUESTION_TYPES) {
        if (!usedModuleTypeCombosEdit.includes(`${m}||${t}`)) {
          return { module: m, type: t };
        }
      }
    }
    return null;
  };
  const nextAvailableModuleTypeEdit = getNextAvailableModuleTypeEdit();

  /** Switch blueprint mode in Edit form – resets rows */
  const switchEditBlueprintMode = (newMode: BlueprintMode) => {
    setEditBlueprintMode(newMode);
    setEditingBatch((prev: any) => ({ ...prev, blueprint: [], blueprintByType: [] }));
  };

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleEditBatch = (batch: any) => {
    const rawBlueprint = typeof batch.blueprint === 'string' ? JSON.parse(batch.blueprint) : (batch.blueprint || []);
    // Detect blueprint mode from saved data
    let detectedMode: BlueprintMode = 'module';
    let moduleItems: BlueprintItem[] = [];
    let typeItems: BlueprintItemByType[] = [];

    if (Array.isArray(rawBlueprint)) {
      // Legacy format: plain array → by module
      detectedMode = 'module';
      moduleItems = rawBlueprint;
    } else if (rawBlueprint && rawBlueprint.blueprintMode) {
      detectedMode = rawBlueprint.blueprintMode;
      if (detectedMode === 'type') {
        typeItems = rawBlueprint.items || [];
      } else {
        moduleItems = rawBlueprint.items || [];
      }
    }

    // Batch lưu TRƯỚC khi có bộ đề không mang question_group, nên comboKey của nó
    // không khớp option nào và dropdown sẽ hiển thị sai. Gán về bộ đầu tiên có cùng
    // module để người sửa thấy đúng thứ đang được chọn.
    const withGroup = <T extends { module: string; question_group?: string }>(items: T[]): T[] =>
      items.map(item => item.question_group !== undefined && item.question_group !== ''
        ? item
        : { ...item, question_group: moduleGroups.find(mg => mg.module === item.module)?.question_group ?? '' });
    // Dòng nạp từ DB chưa có rowId — gán ngay để key ổn định suốt phiên chỉnh sửa.
    moduleItems = withGroup(moduleItems).map(item => ({ ...item, rowId: item.rowId ?? newRowId() }));
    typeItems = withGroup(typeItems).map(item => ({ ...item, rowId: item.rowId ?? newRowId() }));

    setEditBlueprintMode(detectedMode);
    setEditingBatch({
      ...batch,
      start_time: utcToLocalInput(batch.start_time),
      end_time: utcToLocalInput(batch.end_time),
      blueprint: moduleItems,
      blueprintByType: typeItems,
    });
  };

  const handleUpdateBatch = async () => {
    if (!editingBatch) return;

    // Validate against question bank availability based on edit mode
    let statsErrors: string[] = [];
    if (editBlueprintMode === 'type') {
      statsErrors = validateTypesBlueprintAgainstStats(editingBatch.blueprintByType || []);
    } else {
      statsErrors = validateBlueprintAgainstStats(editingBatch.blueprint || []);
    }
    if (statsErrors.length > 0) {
      alert('Cannot save because the blueprint exceeds the available question count:\n\n' + statsErrors.join('\n'));
      return;
    }

    const blueprintPayload = buildBlueprintPayload(
      editBlueprintMode,
      editingBatch.blueprint || [],
      editingBatch.blueprintByType || []
    );

    setLoading(true);
    try {
      await adminApi.updateBatch(editingBatch.id, {
        name: editingBatch.name,
        start_time: localToUTC(editingBatch.start_time),
        end_time: localToUTC(editingBatch.end_time),
        duration: editingBatch.duration,
        blueprint: blueprintPayload,
        record_mode: editingBatch.record_mode || 'none',
        exam_type: editingBatch.exam_type === 'quiz' ? 'quiz' : 'essay',
      });
      loadBatches();
      setEditingBatch(null);
    } catch (err: any) {
      alert(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[BatchManagement] handleSubmit called, blueprintMode:', blueprintMode, 'formData:', formData);
    setLoading(true);
    setFeasibilityErrors([]);

    // Compute total based on active mode
    const activeItems = blueprintMode === 'type' ? formData.blueprintByType : formData.blueprint;
    const total = activeItems.reduce((sum, item) => sum + (item.easy || 0) + (item.medium || 0) + (item.hard || 0), 0);
    console.log('[BatchManagement] Total questions:', total);
    if (total < 1 || total > 100) {
      setFeasibilityErrors([`Total questions must be between 1 and 100. Current: ${total}`]);
      setLoading(false);
      return;
    }

    // Validate against question bank availability
    let statsErrors: string[] = [];
    if (blueprintMode === 'type') {
      statsErrors = validateTypesBlueprintAgainstStats(formData.blueprintByType);
    } else {
      statsErrors = validateBlueprintAgainstStats(formData.blueprint);
    }
    if (statsErrors.length > 0) {
      setFeasibilityErrors(statsErrors);
      setLoading(false);
      return;
    }

    const blueprintPayload = buildBlueprintPayload(blueprintMode, formData.blueprint, formData.blueprintByType);

    try {
      console.log('[BatchManagement] Submitting blueprintPayload:', JSON.stringify(blueprintPayload));
      const res = await adminApi.createBatch({
        name: formData.name,
        start_time: localToUTC(formData.start_time),
        end_time: localToUTC(formData.end_time),
        duration: formData.duration,
        blueprint: blueprintPayload,
        record_mode: formData.record_mode,
        exam_type: formData.exam_type,
      });
      console.log('[BatchManagement] Response:', res.data);
      const batchId = res.data.id;
      setShowForm(false);
      setFormData({ name: '', start_time: '', end_time: '', duration: 30, blueprint: [], blueprintByType: [], record_mode: 'none', exam_type: 'essay' });
      setBlueprintMode('module');
      loadBatches();
      setSelectedBatchId(batchId);
      setShowInviteForm(true);
    } catch (error: any) {
      console.error('[BatchManagement] Error:', error, error.response);
      setFeasibilityErrors([error.response?.data?.error || error.message || 'Error creating batch']);
    }
    setLoading(false);
  };

  const handleInviteStudents = async () => {
    if (!selectedBatchId || !emails.trim()) return;

    setLoading(true);
    try {
      const emailList = emails.split('\n').map(e => e.trim()).filter(e => e && e.includes('@'));

      if (emailList.length === 0) {
        alert('Please enter valid email addresses');
        setLoading(false);
        return;
      }

      const res = await adminApi.importStudents(selectedBatchId, emailList);

      const skipped = res.data.skippedEmails;
      if (skipped && skipped.length > 0) {
        alert(`Skipped ${skipped.length} duplicate email(s):\n${skipped.join('\n')}`);
      }

      setInviteResult({
        success: res.data.count,
        emails: res.data.students
      });

      setEmails('');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error inviting students');
    }
    setLoading(false);
  };

  const exportStudents = async (batchId: number) => {
    try {
      const res = await adminApi.exportStudents(batchId);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `students-${batchId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    }
  };

  // ─── Derived state ───────────────────────────────────────────────────────────

  const activeCreateItems = blueprintMode === 'type' ? formData.blueprintByType : formData.blueprint;
  const totalQuestions = activeCreateItems.reduce((sum, item) => sum + (item.easy || 0) + (item.medium || 0) + (item.hard || 0), 0);

  const createBlueprintErrors = blueprintMode === 'type'
    ? validateTypesBlueprintAgainstStats(formData.blueprintByType)
    : validateBlueprintAgainstStats(formData.blueprint);

  const editBlueprintErrors = editBlueprintMode === 'type'
    ? validateTypesBlueprintAgainstStats((editingBatch?.blueprintByType || []) as BlueprintItemByType[])
    : validateBlueprintAgainstStats(editingBatch?.blueprint || []);

  // ─── Batch pagination derived state ──────────────────────────────────────────

  const batchTotalPages = Math.max(1, Math.ceil(batches.length / batchPageSize));

  const paginatedBatches = useMemo(() =>
    batches.slice((batchCurrentPage - 1) * batchPageSize, batchCurrentPage * batchPageSize),
    [batches, batchCurrentPage, batchPageSize]
  );

  const handleBatchPageSizeChange = (size: BatchPageSize) => {
    setBatchPageSize(size);
    setBatchCurrentPage(1);
  };

  const getBatchPageNumbers = () => {
    const delta = 2;
    const range: (number | '...')[] = [];
    const left = Math.max(2, batchCurrentPage - delta);
    const right = Math.min(batchTotalPages - 1, batchCurrentPage + delta);
    range.push(1);
    if (left > 2) range.push('...');
    for (let i = left; i <= right; i++) range.push(i);
    if (right < batchTotalPages - 1) range.push('...');
    if (batchTotalPages > 1) range.push(batchTotalPages);
    return range;
  };

  /** Mod chỉ được CRUD batch của mình; admin được tất cả */
  const canEditBatch = (batch: any) => isAdmin || batch.created_by === userId;

  // ─── Sub-components ─────────────────────────────────────────────────────────

  /** Tab-style blueprint mode toggle */
  const BlueprintModeToggle = ({
    value,
    onChange,
  }: {
    value: BlueprintMode;
    onChange: (m: BlueprintMode) => void;
  }) => (
    <div className="mb-4 flex w-fit overflow-hidden rounded-lg border-[1.5px] border-indigo-500">
      {(['module', 'type'] as BlueprintMode[]).map(mode => (
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

  /** Panel showing available question counts by module */
  const QuestionBankStatsPanel = () => {
    if (moduleStats.length === 0) return null;
    return (
      <div className="mb-5 rounded-[10px] border border-blue-300 bg-gradient-to-br from-blue-50 to-green-50 px-[18px] py-3.5">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-lg">📊</span>
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
            {moduleStats.map((stat, i) => (
              <tr key={stat.module} className={`border-t border-slate-200 ${i % 2 === 0 ? '' : 'bg-white/50'}`}>
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
  };

  /** Panel showing available question counts by module × type */
  const QuestionBankTypeStatsPanel = () => {
    if (moduleTypeStats.length === 0) return null;
    const typeEmoji: Record<string, string> = { Coding: '💻', Conceptual: '🧠', 'Fill-in': '✏️', Debug: '🐛' };
    // Group by module
    const grouped = modules.reduce<Record<string, ModuleTypeStats[]>>((acc, m) => {
      acc[m] = moduleTypeStats.filter(s => s.module === m);
      return acc;
    }, {});
    return (
      <div className="mb-5 rounded-[10px] border border-violet-300 bg-gradient-to-br from-violet-50 to-green-50 px-[18px] py-3.5">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-lg">🏷</span>
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
            {Object.entries(grouped).map(([mod, stats]) =>
              stats.map((stat, i) => (
                <tr key={`${mod}-${stat.type}`} className={`border-t border-slate-200 ${i % 2 === 0 ? '' : 'bg-white/50'}`}>
                  {i === 0 && (
                    <td rowSpan={stats.length} className="border-r border-slate-200 px-2.5 py-1 align-top font-semibold text-slate-800">
                      {mod}
                    </td>
                  )}
                  <td className="px-2.5 py-1 text-slate-700">{typeEmoji[stat.type] || '❓'} {stat.type}</td>
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
  };

  /** A number input cell with inline validation warning */
  const ValidatedInput = ({
    value,
    max,
    onChange,
  }: {
    value: number;
    max: number;
    onChange: (v: string) => void;
  }) => {
    const exceeded = value > max;
    return (
      <div className="flex flex-col items-center gap-0.5">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`w-[70px] rounded-md px-2 py-1.5 text-center outline-none ${
            exceeded
              ? 'border-2 border-red-500 bg-red-50 font-bold text-red-700'
              : 'border border-slate-300 bg-white font-normal text-slate-900'
          }`}
        />
        {exceeded && (
          <span className="whitespace-nowrap text-[10px] text-red-500">
            ⚠️ Max: {max}
          </span>
        )}
      </div>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 pb-4 border-b border-slate-200 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
              <FolderKanban size={24} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight m-0 border-none pb-0">Batch Management</h1>
          </div>
          <Link to="/admin/dashboard" className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors shadow-sm">
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Back to Dashboard</span>
          </Link>
        </div>

        <AdminNav />

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white px-6 py-4 rounded-xl shadow-sm border border-slate-200 gap-4">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 m-0 border-none pb-0">
            <ListChecks size={18} className="text-slate-500" />
            Batches List
          </h3>
          <button onClick={() => setShowForm(!showForm)} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm ${showForm ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {showForm ? 'Cancel' : (
              <>
                <Plus size={16} />
                Create New Batch
              </>
            )}
          </button>
        </div>

      {/* ── Create Batch Form ──────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create New Batch
            </h3>
          </div>
          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">Batch Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                    placeholder="e.g. Midterm Fall 2023"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">Duration (minutes)</label>
                  <input
                    type="number"
                    value={formData.duration}
                    onChange={e => setFormData(prev => ({ ...prev, duration: parseInt(e.target.value) }))}
                    min={10}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">Start Time</label>
                  <input
                    type="datetime-local"
                    value={formData.start_time}
                    onChange={e => setFormData(prev => ({ ...prev, start_time: e.target.value }))}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">End Time</label>
                  <input
                    type="datetime-local"
                    value={formData.end_time}
                    onChange={e => setFormData(prev => ({ ...prev, end_time: e.target.value }))}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">Exam Type</label>
                  <select
                    value={formData.exam_type}
                    onChange={e => setFormData(prev => ({ ...prev, exam_type: e.target.value as 'essay' | 'quiz' }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
                  >
                    <option value="essay">Tự luận / Coding (Essay)</option>
                    <option value="quiz">Trắc nghiệm (Quiz)</option>
                  </select>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-slate-700">Screen Recording</label>
                  <select
                    value={formData.record_mode}
                    disabled={!recordingConfig.canChange}
                    onChange={e => setFormData(prev => ({ ...prev, record_mode: e.target.value as 'none' | 'local' | 's3' }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none disabled:opacity-60 disabled:bg-slate-100"
                  >
                    <option value="none">Default (No recording)</option>
                    {recordingConfig.allowed.includes('local') && (
                      <option value="local">Record Local (Save on student's machine)</option>
                    )}
                    {recordingConfig.allowed.includes('s3') && (
                      <option value="s3">Record S3 (Save to AWS S3)</option>
                    )}
                  </select>
                  {!recordingConfig.canChange && (
                    <p className="text-xs text-amber-600 font-medium">Chỉ tenant admin đổi được cấu hình này.</p>
                  )}
                  {recordingConfig.canChange && recordingConfig.allowed.length === 1 && (
                    <p className="text-xs text-slate-500">
                      Tenant chưa được cấp chế độ ghi màn hình nào. Liên hệ superadmin để bật ở trang quản lý tenant.
                    </p>
                  )}
                  {formData.record_mode === 's3' && !recordingConfig.s3Configured && (
                    <p className="text-xs text-amber-600 font-medium">
                      ⚠ Máy chủ chưa cấu hình S3 — video sẽ không tải lên được.
                    </p>
                  )}
                </div>
              </div>

            <h4 className="mt-6 mb-3 text-base font-bold text-slate-900">Exam Blueprint (Total: {totalQuestions}/100)</h4>

            {/* Blueprint Mode Toggle */}
            <BlueprintModeToggle value={blueprintMode} onChange={switchBlueprintMode} />

            {modules.length === 0 && blueprintMode === 'module' ? (
              <p className="error">Please import questions first to configure the blueprint.</p>
            ) : typeStats.length === 0 && blueprintMode === 'type' ? (
              <p className="error">Please import questions first to configure the blueprint.</p>
            ) : blueprintMode === 'module' ? (
              <>
                {/* Stats panel – By Module */}
                <QuestionBankStatsPanel />

                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>🟢 Easy</th>
                      <th>🟡 Medium</th>
                      <th>🔴 Hard</th>
                      <th>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.blueprint.map((item, index) => {
                      const stats = getStatsForModuleGroup(item.module, item.question_group || '');
                      return (
                        <tr key={item.rowId ?? index}>
                          <td>
                            <select
                              name={`module_${index}`}
                              id={`module_${index}`}
                              value={comboKey(item.module, item.question_group || '')}
                              onChange={e => {
                                const d = decodeComboKey(e.target.value);
                                updateBlueprintModuleGroup(index, d.module, d.question_group);
                              }}
                            >
                              {moduleGroups.map(mg => (
                                <option key={comboKey(mg.module, mg.question_group)} value={comboKey(mg.module, mg.question_group)}>
                                  {comboLabel(mg.module, mg.question_group)}
                                </option>
                              ))}
                            </select>
                            <div className="mt-1 pl-0.5 text-[11px] text-slate-500">
                              Available: {stats.easy}E / {stats.medium}M / {stats.hard}H
                            </div>
                          </td>
                          <td>
                            <ValidatedInput value={item.easy} max={stats.easy} onChange={v => updateBlueprint(index, 'easy', v)} />
                          </td>
                          <td>
                            <ValidatedInput value={item.medium} max={stats.medium} onChange={v => updateBlueprint(index, 'medium', v)} />
                          </td>
                          <td>
                            <ValidatedInput value={item.hard} max={stats.hard} onChange={v => updateBlueprint(index, 'hard', v)} />
                          </td>
                          <td className="text-center font-semibold">
                            {Number(item.easy) + Number(item.medium) + Number(item.hard)}
                          </td>
                          <td>
                            <button type="button" onClick={() => removeBlueprintRow(index)} className="btn btn-danger px-2.5 py-1 text-xs">
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button type="button" onClick={addBlueprintRow} className="btn btn-secondary mt-2.5">
                  + Add Module
                </button>
              </>
            ) : (
              <>
                {/* Stats panel – By Module + Type */}
                <QuestionBankTypeStatsPanel />

                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Type</th>
                      <th>🟢 Easy</th>
                      <th>🟡 Medium</th>
                      <th>🔴 Hard</th>
                      <th>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.blueprintByType.map((item, index) => {
                      const stats = getStatsForModuleGroupType(item.module, item.question_group || '', item.type);
                      // Combos used by OTHER rows
                      const otherCombos = formData.blueprintByType
                        .filter((_, i) => i !== index)
                        .map(i => `${i.module}||${i.type}`);
                      return (
                        <tr key={item.rowId ?? index}>
                          <td className="min-w-[8.75rem]">
                            <select
                              value={comboKey(item.module, item.question_group || '')}
                              onChange={e => {
                                const d = decodeComboKey(e.target.value);
                                updateTypeBlueprintModuleGroup(index, d.module, d.question_group);
                              }}
                            >
                              {moduleGroups.map(mg => (
                                <option key={comboKey(mg.module, mg.question_group)} value={comboKey(mg.module, mg.question_group)}>
                                  {comboLabel(mg.module, mg.question_group)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="min-w-[7.5rem]">
                            <select
                              value={item.type}
                              onChange={e => updateTypeBlueprint(index, 'type', e.target.value as QuestionType)}
                            >
                              {QUESTION_TYPES.map(t => {
                                const combo = `${item.module}||${t}`;
                                const isUsed = otherCombos.includes(combo);
                                return (
                                  <option key={t} value={t} disabled={isUsed}>
                                    {t}{isUsed ? ' (selected)' : ''}
                                  </option>
                                );
                              })}
                            </select>
                            <div className="mt-1 pl-0.5 text-[11px] text-slate-500">
                              Available: {stats.easy}E / {stats.medium}M / {stats.hard}H
                            </div>
                          </td>
                          <td>
                            <ValidatedInput value={item.easy} max={stats.easy} onChange={v => updateTypeBlueprint(index, 'easy', v)} />
                          </td>
                          <td>
                            <ValidatedInput value={item.medium} max={stats.medium} onChange={v => updateTypeBlueprint(index, 'medium', v)} />
                          </td>
                          <td>
                            <ValidatedInput value={item.hard} max={stats.hard} onChange={v => updateTypeBlueprint(index, 'hard', v)} />
                          </td>
                          <td className="text-center font-semibold">
                            {Number(item.easy) + Number(item.medium) + Number(item.hard)}
                          </td>
                          <td>
                            <button type="button" onClick={() => removeTypeBlueprintRow(index)} className="btn btn-danger px-2.5 py-1 text-xs">
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <button
                  type="button"
                  onClick={addTypeBlueprintRow}
                  disabled={!nextAvailableModuleType}
                  className="btn btn-secondary mt-2.5"
                  title={!nextAvailableModuleType ? 'All combinations have been added' : ''}
                >
                  + Add Module / Type
                </button>
              </>
            )}

              {/* Validation errors */}
              {(feasibilityErrors.length > 0 || createBlueprintErrors.length > 0) && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
                  <strong className="text-red-800 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Blueprint Errors:
                  </strong>
                  {[...feasibilityErrors, ...createBlueprintErrors.filter(e => !feasibilityErrors.includes(e))].map((err, i) => (
                    <p key={i} className="text-red-700 text-sm ml-6">{err}</p>
                  ))}
                </div>
              )}

              <div className="pt-6 border-t border-slate-100 flex justify-end">
                <button
                  type="submit"
                  disabled={
                    loading ||
                    totalQuestions < 1 ||
                    totalQuestions > 100 ||
                    (blueprintMode === 'module' && modules.length === 0) ||
                    (blueprintMode === 'type' && moduleTypeStats.length === 0) ||
                    createBlueprintErrors.length > 0
                  }
                  className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Batch'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Invite Students Form ───────────────────────────────────────── */}
      {showInviteForm && selectedBatchId && (
        <div className="bg-emerald-50 rounded-2xl shadow-sm border border-emerald-200 overflow-hidden mb-6">
          <div className="p-6 border-b border-emerald-100 bg-emerald-100/50">
            <h3 className="text-lg font-bold text-emerald-800 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Invite Students to Batch #{selectedBatchId}
            </h3>
            <p className="text-emerald-700 text-sm mt-1">Enter email addresses (one per line)</p>
          </div>
          <div className="p-6 space-y-4">
            <textarea
              value={emails}
              onChange={e => setEmails(e.target.value)}
              placeholder="student1@example.com&#10;student2@example.com"
              rows={6}
              className="w-full px-4 py-3 rounded-xl border border-emerald-200 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none font-mono text-sm shadow-inner"
            />
            <div className="flex gap-3">
              <button
                onClick={handleInviteStudents}
                disabled={loading || !emails.trim()}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {loading ? 'Inviting...' : 'Invite Students'}
              </button>
              <button
                onClick={() => { setShowInviteForm(false); setInviteResult(null); }}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-white text-slate-700 border border-slate-300 rounded-lg font-bold hover:bg-slate-50 transition-colors shadow-sm"
              >
                Close
              </button>
            </div>

            {inviteResult && (
              <div className="mt-6 pt-6 border-t border-emerald-200">
                <h4 className="text-emerald-800 font-bold mb-4">Invited {inviteResult.success} students successfully:</h4>
                <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-emerald-50 text-emerald-800 border-b border-emerald-100">
                      <tr>
                        <th className="px-6 py-3 font-bold">Email</th>
                        <th className="px-6 py-3 font-bold">Access Code</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-50">
                      {inviteResult.emails.map((s, i) => (
                        <tr key={i} className="hover:bg-emerald-50/50 transition-colors">
                          <td className="px-6 py-3">{s.email}</td>
                          <td className="px-6 py-3 font-mono font-bold text-emerald-600">{s.code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  onClick={() => exportStudents(selectedBatchId)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg font-bold hover:bg-emerald-200 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export to Excel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Batches Table ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h3 className="text-lg font-bold text-slate-900 m-0 border-none pb-0">
            Batches List <span className="text-slate-400 font-normal ml-1">({batches.length} total)</span>
          </h3>
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
            <span className="text-sm font-medium text-slate-600">Show:</span>
            <select
              value={batchPageSize}
              onChange={e => handleBatchPageSizeChange(Number(e.target.value) as BatchPageSize)}
              className="bg-transparent text-sm font-bold text-slate-800 outline-none cursor-pointer"
            >
              {BATCH_PAGE_SIZE_OPTIONS.map(s => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-slate-800 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-bold">ID</th>
                <th className="px-6 py-4 font-bold">Name</th>
                <th className="px-6 py-4 font-bold">Start Time</th>
                <th className="px-6 py-4 font-bold">End Time</th>
                <th className="px-6 py-4 font-bold">Duration</th>
                <th className="px-6 py-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedBatches.map(batch => {
                const editable = canEditBatch(batch);
                return (
                  <tr key={batch.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-slate-500">#{batch.id}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{batch.name}</span>
                        {!editable && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500 uppercase tracking-wider">
                            View Only
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">{formatGMT7(batch.start_time)}</td>
                    <td className="px-6 py-4">{formatGMT7(batch.end_time)}</td>
                    <td className="px-6 py-4 font-medium">{batch.duration} min</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <div className="inline-flex items-center justify-end gap-2">
                        {editable && (
                          <button
                            onClick={() => { setSelectedBatchId(batch.id); setShowInviteForm(true); setInviteResult(null); }}
                            className="inline-flex items-center px-3 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-md text-xs font-bold transition-colors"
                          >
                            Invite
                          </button>
                        )}
                        <Link to={`/admin/batches/${batch.id}/students`} className="inline-flex items-center px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-md text-xs font-bold transition-colors">
                          Students
                        </Link>
                        <Link to={`/admin/batches/${batch.id}/results`} className="inline-flex items-center px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 rounded-md text-xs font-bold transition-colors">
                          Results
                        </Link>
                        {editable && (
                          <>
                            <button
                              onClick={() => handleEditBatch(batch)}
                              className="inline-flex items-center px-3 py-1.5 bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-md text-xs font-bold transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this batch? All students and exam data will be lost.')) {
                                  adminApi.deleteBatch(batch.id).then(() => {
                                    setBatches(prev => prev.filter(b => b.id !== batch.id));
                                  });
                                }
                              }}
                              className="inline-flex items-center px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-md text-xs font-bold transition-colors"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                      No batches found.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {batchTotalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/50">
            <span className="text-sm text-slate-500 font-medium">
              Page {batchCurrentPage} of {batchTotalPages} <span className="mx-2 text-slate-300">|</span> 
              Showing {(batchCurrentPage - 1) * batchPageSize + 1} to {Math.min(batchCurrentPage * batchPageSize, batches.length)} of {batches.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setBatchCurrentPage(p => Math.max(1, p - 1))}
                disabled={batchCurrentPage === 1}
                className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              {getBatchPageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`el-${i}`} className="px-3 py-1.5 text-slate-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setBatchCurrentPage(p as number)}
                    className={`px-3 py-1.5 rounded-md text-sm font-bold transition-colors min-w-[32px] ${
                      batchCurrentPage === p 
                        ? 'bg-blue-600 text-white shadow-sm' 
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setBatchCurrentPage(p => Math.min(batchTotalPages, p + 1))}
                disabled={batchCurrentPage === batchTotalPages}
                className="px-3 py-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit Batch Form ────────────────────────────────────────────── */}
      {editingBatch && (
        <div className="bg-blue-50 rounded-2xl shadow-sm border border-blue-200 overflow-hidden mt-8">
          <div className="p-6 border-b border-blue-100 bg-blue-100/50">
            <h3 className="text-lg font-bold text-blue-800 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Batch #{editingBatch.id}
            </h3>
          </div>

          <div className="p-6 space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Batch Name</label>
                <input
                  type="text"
                  value={editingBatch.name}
                  onChange={e => setEditingBatch({ ...editingBatch, name: e.target.value })}
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Start Time</label>
                  <input
                    type="datetime-local"
                    value={editingBatch.start_time || ''}
                    onChange={e => setEditingBatch({ ...editingBatch, start_time: e.target.value })}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">End Time</label>
                  <input
                    type="datetime-local"
                    value={editingBatch.end_time || ''}
                    onChange={e => setEditingBatch({ ...editingBatch, end_time: e.target.value })}
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Duration (minutes)</label>
                <input
                  type="number"
                  value={editingBatch.duration}
                  onChange={e => setEditingBatch({ ...editingBatch, duration: parseInt(e.target.value) })}
                  min={1}
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900"
                />
              </div>

              {/* Exam type */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Exam Type</label>
                <select
                  value={editingBatch.exam_type === 'quiz' ? 'quiz' : 'essay'}
                  onChange={e => setEditingBatch({ ...editingBatch, exam_type: e.target.value })}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900 min-w-[200px]"
                >
                  <option value="essay">Tự luận / Coding</option>
                  <option value="quiz">Trắc nghiệm (Quiz)</option>
                </select>
              </div>

              {/* Chế độ ghi màn hình */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Screen Recording</label>
                <select
                  value={editingBatch.record_mode || 'none'}
                  disabled={!isAdmin}
                  onChange={e => setEditingBatch({ ...editingBatch, record_mode: e.target.value })}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none text-slate-900 min-w-[300px] disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="none">Default (No recording)</option>
                  <option value="local">Record Local (Save on student's machine, encrypted)</option>
                  <option value="s3">Record S3 (Save to AWS S3)</option>
                </select>
                {!isAdmin && (
                  <p className="mt-2 text-sm text-amber-600 font-medium">Only admin accounts can change this setting.</p>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-blue-200">
              <h4 className="text-lg font-bold text-blue-800 mb-4">Exam Blueprint</h4>

              {/* Blueprint Mode Toggle */}
              <div className="mb-4">
                <BlueprintModeToggle value={editBlueprintMode} onChange={switchEditBlueprintMode} />
              </div>

              {editBlueprintMode === 'module' ? (
                modules.length === 0 ? (
                  <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200">No modules available</div>
                ) : (
                  <>
                    <QuestionBankStatsPanel />
                    <div className="overflow-x-auto bg-white rounded-xl border border-blue-100 shadow-sm">
                      <table className="w-full text-left text-sm text-slate-600">
                        <thead className="bg-blue-50 text-blue-800 border-b border-blue-100">
                          <tr>
                            <th className="px-4 py-3 font-bold">Module</th>
                            <th className="px-4 py-3 font-bold text-center">🟢 Easy</th>
                            <th className="px-4 py-3 font-bold text-center">🟡 Medium</th>
                            <th className="px-4 py-3 font-bold text-center">🔴 Hard</th>
                            <th className="px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {(editingBatch.blueprint || []).map((item: any, index: number) => {
                            const stats = getStatsForModuleGroup(item.module, item.question_group || '');
                            return (
                              <tr key={item.rowId ?? index} className="hover:bg-blue-50/30 transition-colors">
                                <td className="px-4 py-3 align-top min-w-[200px]">
                                  <select
                                    value={comboKey(item.module, item.question_group || '')}
                                    onChange={e => {
                                      const d = decodeComboKey(e.target.value);
                                      const newBlueprint = [...editingBatch.blueprint];
                                      newBlueprint[index] = { ...newBlueprint[index], module: d.module, question_group: d.question_group };
                                      setEditingBatch({ ...editingBatch, blueprint: newBlueprint });
                                    }}
                                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-slate-700"
                                  >
                                    {moduleGroups.map(mg => (
                                      <option key={comboKey(mg.module, mg.question_group)} value={comboKey(mg.module, mg.question_group)}>
                                        {comboLabel(mg.module, mg.question_group)}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="text-[11px] text-slate-500 mt-1.5 ml-1 font-medium">
                                    Available: {stats.easy}E / {stats.medium}M / {stats.hard}H
                                  </div>
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <ValidatedInput value={item.easy || 0} max={stats.easy} onChange={v => {
                                    const nb = [...editingBatch.blueprint]; nb[index].easy = parseInt(v) || 0;
                                    setEditingBatch({ ...editingBatch, blueprint: nb });
                                  }} />
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <ValidatedInput value={item.medium || 0} max={stats.medium} onChange={v => {
                                    const nb = [...editingBatch.blueprint]; nb[index].medium = parseInt(v) || 0;
                                    setEditingBatch({ ...editingBatch, blueprint: nb });
                                  }} />
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <ValidatedInput value={item.hard || 0} max={stats.hard} onChange={v => {
                                    const nb = [...editingBatch.blueprint]; nb[index].hard = parseInt(v) || 0;
                                    setEditingBatch({ ...editingBatch, blueprint: nb });
                                  }} />
                                </td>
                                <td className="px-4 py-3 align-top text-right">
                                  <button
                                    onClick={() => setEditingBatch({
                                      ...editingBatch,
                                      blueprint: editingBatch.blueprint.filter((_: any, i: number) => i !== index)
                                    })}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Remove"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              ) : (
                moduleTypeStats.length === 0 ? (
                  <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200">No type data available</div>
                ) : (
                  <>
                    <QuestionBankTypeStatsPanel />
                    <div className="overflow-x-auto bg-white rounded-xl border border-blue-100 shadow-sm">
                      <table className="w-full text-left text-sm text-slate-600">
                        <thead className="bg-blue-50 text-blue-800 border-b border-blue-100">
                          <tr>
                            <th className="px-4 py-3 font-bold">Module</th>
                            <th className="px-4 py-3 font-bold">Type</th>
                            <th className="px-4 py-3 font-bold text-center">🟢 Easy</th>
                            <th className="px-4 py-3 font-bold text-center">🟡 Medium</th>
                            <th className="px-4 py-3 font-bold text-center">🔴 Hard</th>
                            <th className="px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-blue-50">
                          {((editingBatch.blueprintByType || []) as BlueprintItemByType[]).map((item, index) => {
                            const stats = getStatsForModuleGroupType(item.module, item.question_group || '', item.type);
                            const otherCombos = ((editingBatch.blueprintByType || []) as BlueprintItemByType[])
                              .filter((_, i) => i !== index)
                              .map(i => `${i.module}||${i.type}`);
                            return (
                              <tr key={item.rowId ?? index} className="hover:bg-blue-50/30 transition-colors">
                                <td className="px-4 py-3 align-top min-w-[140px]">
                                  <select
                                    value={comboKey(item.module, item.question_group || '')}
                                    onChange={e => {
                                      const d = decodeComboKey(e.target.value);
                                      const nb = [...editingBatch.blueprintByType];
                                      nb[index] = { ...nb[index], module: d.module, question_group: d.question_group };
                                      setEditingBatch({ ...editingBatch, blueprintByType: nb });
                                    }}
                                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-slate-700"
                                  >
                                    {moduleGroups.map(mg => (
                                      <option key={comboKey(mg.module, mg.question_group)} value={comboKey(mg.module, mg.question_group)}>
                                        {comboLabel(mg.module, mg.question_group)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-4 py-3 align-top min-w-[140px]">
                                  <select
                                    value={item.type}
                                    onChange={e => {
                                      const nb = [...editingBatch.blueprintByType];
                                      nb[index].type = e.target.value;
                                      setEditingBatch({ ...editingBatch, blueprintByType: nb });
                                    }}
                                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-slate-700"
                                  >
                                    {QUESTION_TYPES.map(t => {
                                      const combo = `${item.module}||${t}`;
                                      const isUsed = otherCombos.includes(combo);
                                      return (
                                        <option key={t} value={t} disabled={isUsed}>
                                          {t}{isUsed ? ' (selected)' : ''}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <div className="text-[11px] text-slate-500 mt-1.5 ml-1 font-medium">
                                    Available: {stats.easy}E / {stats.medium}M / {stats.hard}H
                                  </div>
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <ValidatedInput value={item.easy || 0} max={stats.easy} onChange={v => {
                                    const nb = [...editingBatch.blueprintByType]; nb[index].easy = parseInt(v) || 0;
                                    setEditingBatch({ ...editingBatch, blueprintByType: nb });
                                  }} />
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <ValidatedInput value={item.medium || 0} max={stats.medium} onChange={v => {
                                    const nb = [...editingBatch.blueprintByType]; nb[index].medium = parseInt(v) || 0;
                                    setEditingBatch({ ...editingBatch, blueprintByType: nb });
                                  }} />
                                </td>
                                <td className="px-4 py-3 align-top">
                                  <ValidatedInput value={item.hard || 0} max={stats.hard} onChange={v => {
                                    const nb = [...editingBatch.blueprintByType]; nb[index].hard = parseInt(v) || 0;
                                    setEditingBatch({ ...editingBatch, blueprintByType: nb });
                                  }} />
                                </td>
                                <td className="px-4 py-3 align-top text-right">
                                  <button
                                    onClick={() => setEditingBatch({
                                      ...editingBatch,
                                      blueprintByType: (editingBatch.blueprintByType || []).filter((_: any, i: number) => i !== index)
                                    })}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Remove"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              )}

              {/* Edit blueprint validation errors */}
              {editBlueprintErrors.length > 0 && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <strong className="text-red-800 text-sm font-bold flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Blueprint exceeds available question count:
                  </strong>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    {editBlueprintErrors.map((err, i) => (
                      <li key={i} className="text-red-700 text-sm">{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-8 flex flex-wrap gap-3 items-center">
                {editBlueprintMode === 'module' ? (
                  <button
                    onClick={() => setEditingBatch({
                      ...editingBatch,
                      blueprint: [...(editingBatch.blueprint || []), { rowId: newRowId(), module: moduleGroups[0]?.module || modules[0], question_group: moduleGroups[0]?.question_group || '', easy: 0, medium: 0, hard: 0 }]
                    })}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-bold hover:bg-slate-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Module
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (!nextAvailableModuleTypeEdit) return;
                      setEditingBatch({
                        ...editingBatch,
                        blueprintByType: [
                          ...(editingBatch.blueprintByType || []),
                          { module: nextAvailableModuleTypeEdit.module, type: nextAvailableModuleTypeEdit.type, easy: 0, medium: 0, hard: 0 }
                        ]
                      });
                    }}
                    disabled={!nextAvailableModuleTypeEdit}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg font-bold hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!nextAvailableModuleTypeEdit ? 'All combinations have been added' : ''}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Module / Type
                  </button>
                )}

                <button
                  onClick={handleUpdateBatch}
                  disabled={loading || editBlueprintErrors.length > 0}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>

                <button
                  onClick={() => setEditingBatch(null)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default BatchManagement;
