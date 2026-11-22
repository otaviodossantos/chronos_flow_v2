import { contextBridge, ipcRenderer } from 'electron';

/** Superficie minima e tipada entre o main e o renderer. */
contextBridge.exposeInMainWorld('chronos', {
  platform: process.platform,

  openExternal: (url: string) => ipcRenderer.invoke('chronos:open-external', url),

  // Widget flutuante de foco
  openFloatingWidget: (node?: unknown) => ipcRenderer.invoke('chronos:open-floating-widget', node),
  closeFloatingWidget: () => ipcRenderer.invoke('chronos:close-floating-widget'),
  resizeFloatingWidget: (width: number, height: number) =>
    ipcRenderer.invoke('chronos:resize-floating-widget', { width, height }),
  openMainWindow: () => ipcRenderer.invoke('chronos:open-main-window'),

  syncActiveNode: (node: unknown) => ipcRenderer.send('chronos:sync-active-node', node),

  // Aviso de "mexi na arvore" entre as duas janelas. Sao processos separados,
  // entao BroadcastChannel nao as alcanca: tem que passar pelo main.
  notifyTreeChanged: (from: string) => ipcRenderer.send('chronos:tree-changed', from),
  onTreeChanged: (cb: (from: string) => void) => {
    const handler = (_e: unknown, from: string) => cb(from);
    ipcRenderer.on('chronos:tree-changed', handler);
    return () => ipcRenderer.removeListener('chronos:tree-changed', handler);
  },
  onSyncActiveNode: (cb: (node: unknown) => void) => {
    const handler = (_e: unknown, node: unknown) => cb(node);
    ipcRenderer.on('chronos:sync-active-node', handler);
    return () => ipcRenderer.removeListener('chronos:sync-active-node', handler);
  },

  microphoneStatus: () => ipcRenderer.invoke('chronos:microphone-status'),
  openMicrophoneSettings: () => ipcRenderer.invoke('chronos:open-microphone-settings'),

  notify: (options: { title: string; subtitle?: string; body: string }) =>
    ipcRenderer.send('chronos:notify', options),
  bounceDock: (type?: 'critical' | 'informational') =>
    ipcRenderer.send('chronos:bounce-dock', { type }),

  onNavigateToNode: (cb: (nodeId: string) => void) => {
    const handler = (_e: unknown, nodeId: string) => cb(nodeId);
    ipcRenderer.on('chronos:navigate-node', handler);
    return () => ipcRenderer.removeListener('chronos:navigate-node', handler);
  },
});
