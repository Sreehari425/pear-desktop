import { t } from '@/i18n';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { Response } from '@/types/datahost-get-state';
import type {
  CommandPaletteAction,
  CommandPalettePluginConfig,
} from './types';

const IPC_OPEN = 'peard:command-palette-open';
const IPC_SEARCH = 'peard:command-palette-search';
const IPC_ACTION = 'peard:command-palette-action';

const MAX_RESULTS = 25;

type WatchEndpoint = {
  videoId?: string;
  playlistId?: string;
};

type PaletteItem = {
  type: 'command' | 'song';
  group: string;
  title: string;
  subtitle?: string;
  action?: CommandPaletteAction;
  videoId?: string;
  playlistId?: string;
  thumbnailUrl?: string;
};

let playerApi: MusicPlayer | null = null;
let paletteRoot: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLDivElement | null = null;
let open = false;
let items: PaletteItem[] = [];
let selectedIndex = -1;
let searchTimer: number | undefined;
let searchToken = 0;
let ipcRef: RendererContext<CommandPalettePluginConfig>['ipc'] | null = null;

const commandItems = (): PaletteItem[] => [
  {
    type: 'command',
    group: t('plugins.command-palette.groups.commands'),
    title: t('plugins.command-palette.commands.play-pause'),
    action: 'playPause',
  },
  {
    type: 'command',
    group: t('plugins.command-palette.groups.commands'),
    title: t('plugins.command-palette.commands.next'),
    action: 'next',
  },
  {
    type: 'command',
    group: t('plugins.command-palette.groups.commands'),
    title: t('plugins.command-palette.commands.previous'),
    action: 'previous',
  },
  {
    type: 'command',
    group: t('plugins.command-palette.groups.commands'),
    title: t('plugins.command-palette.commands.like'),
    action: 'like',
  },
  {
    type: 'command',
    group: t('plugins.command-palette.groups.commands'),
    title: t('plugins.command-palette.commands.dislike'),
    action: 'dislike',
  },
];

const normalizeText = (value: string) => value.toLowerCase().trim();

const getTextFromRuns = (runs?: { text: string }[]) =>
  runs?.map((run) => run.text).join('').trim() ?? '';

const getThumbnailUrl = (thumbnails?: { url: string }[]) => {
  if (!thumbnails || thumbnails.length === 0) return undefined;
  return thumbnails[thumbnails.length - 1].url;
};

const findWatchEndpointFromRuns = (
  runs?: { navigationEndpoint?: { watchEndpoint?: WatchEndpoint } }[],
) => {
  if (!runs) return undefined;
  for (const run of runs) {
    const endpoint = run.navigationEndpoint?.watchEndpoint;
    if (endpoint?.videoId) return endpoint;
  }
  return undefined;
};

const findWatchEndpoint = (item: {
  overlay?: {
    musicItemThumbnailOverlayRenderer?: {
      content?: {
        musicPlayButtonRenderer?: {
          playNavigationEndpoint?: {
            watchEndpoint?: WatchEndpoint;
            watchPlaylistEndpoint?: { playlistId?: string };
          };
        };
      };
    };
  };
  navigationEndpoint?: { watchEndpoint?: WatchEndpoint };
  flexColumns?: {
    musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: unknown[] } };
  }[];
}) => {
  const playEndpoint =
    item.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const playWatch = playEndpoint?.watchEndpoint;
  if (playWatch?.videoId) return playWatch;

  const navWatch = item.navigationEndpoint?.watchEndpoint;
  if (navWatch?.videoId) return navWatch;

  for (const column of item.flexColumns ?? []) {
    const runs = column.musicResponsiveListItemFlexColumnRenderer?.text
      ?.runs as { navigationEndpoint?: { watchEndpoint?: WatchEndpoint } }[] | undefined;
    const endpoint = findWatchEndpointFromRuns(runs);
    if (endpoint?.videoId) return endpoint;
  }

  const playlistId = playEndpoint?.watchPlaylistEndpoint?.playlistId;
  return playlistId ? { playlistId } : undefined;
};

const buildWatchUrl = (videoId: string, playlistId?: string) => {
  const base = `https://music.youtube.com/watch?v=${videoId}`;
  return playlistId ? `${base}&list=${playlistId}` : base;
};

const extractSongResults = (response: Response | null): PaletteItem[] => {
  if (!response) return [];

  const tabs = response.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
  const selectedTab =
    tabs.find((tab) => tab.tabRenderer?.selected) ?? tabs[0];
  const sections =
    selectedTab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

  const results: PaletteItem[] = [];
  for (const section of sections) {
    const shelf = section.musicShelfRenderer;
    if (!shelf?.contents) continue;

    for (const shelfItem of shelf.contents) {
      const renderer = shelfItem.musicResponsiveListItemRenderer;
      if (!renderer) continue;

      const title = getTextFromRuns(
        renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
          ?.text?.runs,
      );
      if (!title) continue;

      const subtitle = getTextFromRuns(
        renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
          ?.text?.runs,
      );

      const watchEndpoint = findWatchEndpoint(renderer);
      const videoId = watchEndpoint?.videoId;
      if (!videoId) continue;

      const thumbnailUrl = getThumbnailUrl(
        renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails,
      );

      results.push({
        type: 'song',
        group: t('plugins.command-palette.groups.songs'),
        title,
        subtitle,
        videoId,
        playlistId: watchEndpoint?.playlistId,
        thumbnailUrl,
      });

      if (results.length >= MAX_RESULTS) return results;
    }
  }

  return results;
};

const renderItems = () => {
  if (!listEl) return;

  listEl.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'peard-command-palette__empty';
    empty.textContent = t('plugins.command-palette.empty');
    listEl.appendChild(empty);
    return;
  }

  let currentGroup = '';
  items.forEach((item, index) => {
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      const groupEl = document.createElement('div');
      groupEl.className = 'peard-command-palette__group';
      groupEl.textContent = currentGroup;
      listEl.appendChild(groupEl);
    }

    const row = document.createElement('div');
    row.className = 'peard-command-palette__item';
    row.dataset.index = String(index);
    if (index === selectedIndex) row.classList.add('is-selected');

    if (item.thumbnailUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'peard-command-palette__thumb';
      thumb.src = item.thumbnailUrl;
      thumb.alt = '';
      row.appendChild(thumb);
    } else {
      const spacer = document.createElement('div');
      spacer.className = 'peard-command-palette__thumb';
      row.appendChild(spacer);
    }

    const textWrap = document.createElement('div');
    textWrap.className = 'peard-command-palette__item-text';

    const title = document.createElement('div');
    title.className = 'peard-command-palette__item-title';
    title.textContent = item.title;
    textWrap.appendChild(title);

    if (item.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.className = 'peard-command-palette__item-subtitle';
      subtitle.textContent = item.subtitle;
      textWrap.appendChild(subtitle);
    }

    row.appendChild(textWrap);

    row.addEventListener('mouseenter', () => {
      selectIndex(index);
    });

    row.addEventListener('click', () => {
      selectIndex(index);
      triggerSelection(false);
    });

    listEl.appendChild(row);
  });

  scrollSelectedIntoView();
};

const scrollSelectedIntoView = () => {
  if (!listEl || selectedIndex < 0) return;
  const selected = listEl.querySelector<HTMLElement>(
    `[data-index="${selectedIndex}"]`,
  );
  selected?.scrollIntoView({ block: 'nearest' });
};

const selectIndex = (index: number) => {
  if (index < 0 || index >= items.length) return;
  selectedIndex = index;
  renderItems();
};

const closePalette = () => {
  if (!paletteRoot || !inputEl) return;
  open = false;
  paletteRoot.classList.remove('is-open');
  inputEl.blur();
};

const openPalette = () => {
  if (!paletteRoot || !inputEl) return;
  open = true;
  paletteRoot.classList.add('is-open');
  inputEl.value = '';
  inputEl.focus();
  scheduleSearch();
};

const togglePalette = () => {
  if (open) closePalette();
  else openPalette();
};

const scheduleSearch = () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    void refreshItems();
  }, 120);
};

const refreshItems = async () => {
  const query = inputEl?.value ?? '';
  const normalizedQuery = normalizeText(query);
  const commands = commandItems().filter((item) => {
    if (!normalizedQuery) return true;
    return normalizeText(item.title).includes(normalizedQuery);
  });

  if (!ipcRef || !normalizedQuery) {
    items = commands;
    selectedIndex = items.length ? 0 : -1;
    renderItems();
    return;
  }

  const token = ++searchToken;
  const response = (await ipcRef.invoke(IPC_SEARCH, query)) as Response | null;
  if (token !== searchToken) return;

  const songs = extractSongResults(response);
  items = [...commands, ...songs];
  selectedIndex = items.length ? 0 : -1;
  renderItems();
};

const triggerSelection = async (playOnly: boolean) => {
  const selected = items[selectedIndex];
  if (!selected || !ipcRef) return;

  if (selected.type === 'command') {
    await ipcRef.invoke(IPC_ACTION, selected.action);
    closePalette();
    return;
  }

  if (!selected.videoId) return;
  const url = buildWatchUrl(selected.videoId, selected.playlistId);

  const api = playerApi as unknown as {
    loadVideoByPlayerVars?: (vars: {
      videoId: string;
      playlistId?: string;
    }) => void;
  };

  if (playOnly && api?.loadVideoByPlayerVars) {
    try {
      api.loadVideoByPlayerVars({
        videoId: selected.videoId,
        playlistId: selected.playlistId,
      });
      closePalette();
      return;
    } catch (error) {
      console.warn('[CommandPalette] loadVideoByPlayerVars failed', error);
    }
  }

  window.location.assign(url);
  closePalette();
};

const handleInputKeyDown = (event: KeyboardEvent) => {
  if (!open) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectIndex(Math.min(selectedIndex + 1, items.length - 1));
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectIndex(Math.max(selectedIndex - 1, 0));
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    const playOnly = event.ctrlKey || event.metaKey;
    void triggerSelection(playOnly);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closePalette();
  }
};

export const onRendererLoad = async ({ ipc }: RendererContext<CommandPalettePluginConfig>) => {
  ipcRef = ipc;

  paletteRoot = document.createElement('div');
  paletteRoot.className = 'peard-command-palette';

  const panel = document.createElement('div');
  panel.className = 'peard-command-palette__panel';

  const input = document.createElement('input');
  input.className = 'peard-command-palette__input';
  input.placeholder = t('plugins.command-palette.placeholder');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', scheduleSearch);
  input.addEventListener('keydown', handleInputKeyDown);
  inputEl = input;

  const divider = document.createElement('div');
  divider.className = 'peard-command-palette__divider';

  const list = document.createElement('div');
  list.className = 'peard-command-palette__list';
  listEl = list;

  panel.appendChild(input);
  panel.appendChild(divider);
  panel.appendChild(list);
  paletteRoot.appendChild(panel);
  document.body.appendChild(paletteRoot);

  paletteRoot.addEventListener('mousedown', (event) => {
    if (event.target === paletteRoot) {
      closePalette();
    }
  });

  ipc.on(IPC_OPEN, () => {
    togglePalette();
  });

  renderItems();
};

export const onRendererStop = () => {
  if (ipcRef) {
    ipcRef.removeAllListeners(IPC_OPEN);
  }
  if (searchTimer) {
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
  }
  paletteRoot?.remove();
  paletteRoot = null;
  inputEl = null;
  listEl = null;
  open = false;
  items = [];
  selectedIndex = -1;
  ipcRef = null;
};

export const onPlayerApiReady = (api: MusicPlayer) => {
  playerApi = api;
};
