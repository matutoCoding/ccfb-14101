import { useState } from 'preact/hooks';
import { AppProvider } from './store';
import { PackagesPage } from './pages/PackagesPage';
import { DevicesPage } from './pages/DevicesPage';
import { LayoutPage } from './pages/LayoutPage';
import { SimulationPage } from './pages/SimulationPage';
import { StatsPage } from './pages/StatsPage';

export type PageKey = 'packages' | 'devices' | 'layout' | 'simulation' | 'stats';

const NAV: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'packages', label: '包裹样本', icon: '📦' },
  { key: 'devices', label: '相机光源', icon: '📷' },
  { key: 'layout', label: '安装布局', icon: '🏗️' },
  { key: 'simulation', label: '成像仿真', icon: '🎞️' },
  { key: 'stats', label: '读码统计', icon: '📊' },
];

export function App() {
  const [page, setPage] = useState<PageKey>('packages');
  return (
    <AppProvider>
      <nav class="side">
        <div class="brand">读码相机仿真</div>
        {NAV.map((n) => (
          <a key={n.key} class={page === n.key ? 'active' : ''} onClick={() => setPage(n.key)}>
            <span style="margin-right:8px">{n.icon}</span>
            {n.label}
          </a>
        ))}
      </nav>
      <main>
        {page === 'packages' && <PackagesPage />}
        {page === 'devices' && <DevicesPage />}
        {page === 'layout' && <LayoutPage />}
        {page === 'simulation' && <SimulationPage />}
        {page === 'stats' && <StatsPage />}
      </main>
    </AppProvider>
  );
}
