import type { RadarApi } from '../../shared/ipc';

declare global {
  interface Window {
    radar: RadarApi;
  }
}
