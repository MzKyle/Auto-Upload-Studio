import {
  HashRouter,
  Routes,
  Route,
  NavLink,
  Outlet,
} from "react-router-dom";
import { LayoutDashboard, Settings, Clock, Server } from "lucide-react";
import { ToastContainer } from "@/components/ui/toast";
import Dashboard from "@/pages/Dashboard";
import SettingsPage from "@/pages/Settings";
import History from "@/pages/History";
import SSHMachines from "@/pages/SSHMachines";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "任务面板" },
  { to: "/settings", icon: Settings, label: "设置" },
  { to: "/history", icon: Clock, label: "历史记录" },
  { to: "/ssh", icon: Server, label: "远程机器" },
];

function MainLayout() {
  return (
    <div className="flex h-screen">
      <ToastContainer />
      {/* 侧边栏 */}
      <nav className="w-48 border-r bg-muted/30 flex flex-col py-4 flex-shrink-0">
        <div className="px-4 mb-6">
          <h1 className="text-sm font-bold text-foreground">
            云桥上传器
          </h1>
        </div>
        <div className="flex flex-col gap-1 px-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/history" element={<History />} />
          <Route path="/ssh" element={<SSHMachines />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
