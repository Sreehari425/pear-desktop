export type CommandPalettePluginConfig = {
  enabled: boolean;
};

export type CommandPaletteAction =
  | 'playPause'
  | 'next'
  | 'previous'
  | 'like'
  | 'dislike';
