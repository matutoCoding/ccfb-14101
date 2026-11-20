import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { defaultPackageConfig } from '../sim/packageGen';
import { defaultLayout, alternativeLayout } from '../sim/presets';
import type { LayoutSpec, PackageGenConfig } from '../sim/types';
import { idbGet, idbPut, idbGetAll, STORE } from '../sim/storage';

export interface AppData {
  pkgConfig: PackageGenConfig;
  layouts: LayoutSpec[];
  activeLayoutId: string;
  loaded: boolean;
}

interface AppStore extends AppData {
  setPkgConfig: (c: PackageGenConfig) => void;
  saveLayout: (l: LayoutSpec) => void;
  setActiveLayout: (id: string) => void;
}

const Ctx = createContext<AppStore | null>(null);

const PKG_CFG_KEY = 'current-package-config';
const ACTIVE_LAYOUT_KEY = 'active-layout-id';

export function AppProvider({ children }: { children: ComponentChildren }) {
  const [data, setData] = useState<AppData>({
    pkgConfig: defaultPackageConfig(),
    layouts: [defaultLayout(), alternativeLayout()],
    activeLayoutId: defaultLayout().id,
    loaded: false,
  });

  useEffect(() => {
    (async () => {
      const savedCfg = await idbGet<PackageGenConfig>(STORE.configs, PKG_CFG_KEY);
      const savedLayouts = await idbGetAll<LayoutSpec>(STORE.layouts);
      const activeId = localStorage.getItem(ACTIVE_LAYOUT_KEY) ?? defaultLayout().id;
      setData((d) => ({
        ...d,
        pkgConfig: savedCfg ?? d.pkgConfig,
        layouts: savedLayouts.length ? savedLayouts : d.layouts,
        activeLayoutId: savedLayouts.length ? activeId : d.activeLayoutId,
        loaded: true,
      }));
    })();
  }, []);

  const store: AppStore = {
    ...data,
    async setPkgConfig(c) {
      setData((d) => ({ ...d, pkgConfig: c }));
      await idbPut(STORE.configs, { ...c, id: PKG_CFG_KEY });
    },
    async saveLayout(l) {
      setData((d) => {
        const idx = d.layouts.findIndex((x) => x.id === l.id);
        const layouts = idx >= 0 ? d.layouts.map((x) => (x.id === l.id ? l : x)) : [...d.layouts, l];
        return { ...d, layouts };
      });
      await idbPut(STORE.layouts, l);
    },
    setActiveLayout(id) {
      setData((d) => ({ ...d, activeLayoutId: id }));
      localStorage.setItem(ACTIVE_LAYOUT_KEY, id);
    },
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useApp(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
