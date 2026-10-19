import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist/src/renderer', { recursive: true });
for (const file of ['index.html', 'styles.css']) await copyFile(`src/renderer/${file}`, `dist/src/renderer/${file}`);
await copyFile('src/desktop/wayland.py', 'dist/src/desktop/wayland.py');
