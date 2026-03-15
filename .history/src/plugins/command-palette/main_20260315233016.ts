import {
  register as registerElectronLocalShortcut,
  unregister as unregisterElectronLocalShortcut,
} from 'electron-localshortcut';

import type { BackendContext } from '@/types/contexts';
import type { CommandPalettePluginConfig } from './types';

const OPEN_SHORTCUT = 'Control+Space';
const IPC_OPEN = 'peard:command-palette-open';
const IPC_SEARCH = 'peard:command-palette-search';

const normalizeQuery = (value: string) => value.trim();

export const onMainLoad = ({
  window,
  ipc,
}: BackendContext<CommandPalettePluginConfig>) => {
  const openPalette = () => {
    window.webContents.send(IPC_OPEN);
  };

  registerElectronLocalShortcut(window, OPEN_SHORTCUT, () => {
    openPalette();
  });

  ipc.handle(IPC_SEARCH, async (query: string) => {
    const normalized = normalizeQuery(query);
    if (!normalized) return null;
    const songControls = getSongControls(window);
    return songControls.search(normalized);
  });
};

export const onMainStop = ({
  window,
  ipc,
}: BackendContext<CommandPalettePluginConfig>) => {
  unregisterElectronLocalShortcut(window, OPEN_SHORTCUT);
  ipc.removeHandler(IPC_SEARCH);
};
