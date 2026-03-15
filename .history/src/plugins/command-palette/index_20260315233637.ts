import style from './style.css?inline';

import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { onMainLoad, onMainStop } from './main';
import { onPlayerApiReady, onRendererLoad, onRendererStop } from './renderer';

import type { CommandPalettePluginConfig } from './types';

const defaultConfig: CommandPalettePluginConfig = {
  enabled: false,
};

export default createPlugin({
  name: () => t('plugins.command-palette.name'),
  description: () => t('plugins.command-palette.description'),
  restartNeeded: false,
  config: defaultConfig,
  stylesheets: [style],
  backend: {
    start: onMainLoad,
    stop: onMainStop,
  },
  renderer: {
    start: onRendererLoad,
    stop: onRendererStop,
    onPlayerApiReady,
  },
});
