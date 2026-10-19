import { contextBridge, ipcRenderer } from 'electron';
import type { CookieBridge, SpawnCookie } from '../shared.js';
const bridge: CookieBridge = {
  onCountdown: callback => { ipcRenderer.on('cookie:countdown', (_event, seconds: number) => callback(seconds)); },
  onSpawn: callback => { ipcRenderer.on('cookie:spawn', (_event, data: SpawnCookie) => callback(data)); },
  onDrop: callback => { ipcRenderer.on('cookie:drop', () => callback()); },
  onHide: callback => { ipcRenderer.on('cookie:stop', () => callback()); },
  give: () => ipcRenderer.invoke('cookie:give'),
  hide: () => ipcRenderer.send('cookie:hide')
};
contextBridge.exposeInMainWorld('cookie', bridge);
