import { app, dialog } from 'electron';
// Ozone is selected before application JS on current Electron. Pass the flag
// at process launch, including when an AppImage is opened directly.
if (process.platform === 'linux' && !process.argv.includes('--ozone-platform=x11')) {
  app.relaunch({
    execPath: process.env.APPIMAGE || process.execPath,
    args: [...process.argv.slice(1).filter(arg => !arg.startsWith('--ozone-platform=')), '--ozone-platform=x11']
  });
  app.exit(0);
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.OPENCOOKIE_DATA_DIR) app.setPath('userData', process.env.OPENCOOKIE_DATA_DIR);
void import('./main.js').catch(error => {
  dialog.showErrorBox('OpenCookie could not start', String(error));
  app.quit();
});
