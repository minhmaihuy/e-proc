import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LayoutDashboard, Database, FolderKanban, Settings, Users, FileText, AlertCircle } from 'lucide-react';

function AdminNav() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const location = useLocation();

  // Mọi mục trong thanh này trỏ vào /admin/* — đúng những route mà superadmin CỐ TÌNH
  // không được vào (requireTenantDataAdmin loại trừ superadmin). Hiện chúng ra ở trang
  // quản lý tenant nghĩa là mời người dùng bấm vào bốn liên kết chỉ trả về 403.
  // Chặn tại nguồn để lỗi không quay lại khi có trang superadmin mới.
  if (isSuperAdmin) return null;

  // /admin/practice và /admin/issues từng không có mục nào ở đây, nên hai trang đó chỉ
  // tới được bằng cách gõ URL — thực tế là không ai dùng tới.
  const navItems = [
    { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/admin/questions', label: 'Question Bank', icon: Database },
    { path: '/admin/batches', label: 'Batches', icon: FolderKanban },
    { path: '/admin/practice', label: 'Practice', icon: FileText },
    { path: '/admin/issues', label: 'Issues', icon: AlertCircle },
    { path: '/admin/settings', label: 'AI Settings', icon: Settings },
  ];

  if (isAdmin) {
    navItems.push({ path: '/admin/users', label: 'Users', icon: Users });
  }

  return (
    <div className="flex flex-wrap gap-2 mb-6 bg-slate-100/80 p-1.5 rounded-xl border border-slate-200/60 shadow-inner">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.pathname.startsWith(item.path);
        
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`
              flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all
              ${isActive 
                ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/50' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }
            `}
          >
            <Icon size={16} className={isActive ? "text-blue-600" : "text-slate-400"} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export default AdminNav;
