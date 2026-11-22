import type { NodeDTO } from '@shared/types';

export interface ChronosElectron {
  platform: NodeJS.Platform;
  openFloatingWidget: (node?: NodeDTO | null) => Promise<boolean>;
  closeFloatingWidget: () => Promise<boolean>;
  resizeFloatingWidget: (width: number, height: number) => Promise<boolean>;
  openMainWindow: () => Promise<boolean>;
  syncActiveNode: (node: NodeDTO | null) => void;
  onSyncActiveNode: (cb: (node: NodeDTO | null) => void) => () => void;
  notifyTreeChanged: (from: string) => void;
  onTreeChanged: (cb: (from: string) => void) => () => void;
  microphoneStatus: () => Promise<{
    status: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
    appName: string;
  }>;
  openMicrophoneSettings: () => Promise<boolean>;
  notify: (options: { title: string; subtitle?: string; body: string }) => void;
  bounceDock: (type?: 'critical' | 'informational') => void;
  openExternal: (url: string) => Promise<void>;
  onNavigateToNode: (cb: (nodeId: string) => void) => () => void;
}

declare global {
  interface Window {
    chronos?: ChronosElectron;
    documentPictureInPicture?: {
      window: Window | null;
      requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
    };
  }
}

export {};
