import {
  register as registerElectronLocalShortcut,
  unregister as unregisterElectronLocalShortcut,
} from 'electron-localshortcut';

import { getSongControls } from '@/providers/song-controls';

import type { BackendContext } from '@/types/contexts';
import type { CommandPaletteAction, CommandPalettePluginConfig } from './types';

const OPEN_SHORTCUT = 'Control+Space';
const IPC_OPEN = 'peard:command-palette-open';
const IPC_SEARCH = 'peard:command-palette-search';
const IPC_ACTION = 'peard:command-palette-action';

const normalizeQuery = (value: string) => value.trim();

export const onMainLoad = ({
  window,
  ipc,
}: BackendContext<CommandPalettePluginConfig>) => {
  const songControls = getSongControls(window);

  const openPalette = () => {
    window.webContents.send(IPC_OPEN);
  };

  registerElectronLocalShortcut(window, OPEN_SHORTCUT, () => {
    openPalette();
  });

  ipc.handle(IPC_SEARCH, async (query: string) => {
    const normalized = normalizeQuery(query);
    if (!normalized) return null;
    return songControls.search(normalized);
  });

  ipc.handle(IPC_ACTION, (action: CommandPaletteAction) => {
    const actionMap: Record<CommandPaletteAction, () => void> = {
      playPause: songControls.playPause,
      next: songControls.next,
      previous: songControls.previous,
      like: songControls.like,
      dislike: songControls.dislike,
    };

    const handler = actionMap[action];
    if (!handler) return false;
    handler();
    return true;
  });
};

export const onMainStop = ({
  window,
  ipc,
}: BackendContext<CommandPalettePluginConfig>) => {
  unregisterElectronLocalShortcut(window, OPEN_SHORTCUT);
  ipc.removeHandler(IPC_SEARCH);
  ipc.removeHandler(IPC_ACTION);
};
