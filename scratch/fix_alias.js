const fs = require('fs');
const path = require('path');

let config = fs.readFileSync('apps/warehouse-app/vite.config.js', 'utf8');
config = config.replace("import { defineConfig } from 'vite'", "import { defineConfig } from 'vite'\nimport path from 'path'");
config = config.replace("plugins: [react()],", "plugins: [react()],\n  resolve: { alias: { '@inventory': path.resolve(__dirname, '../inventory-app/src') } },");
fs.writeFileSync('apps/warehouse-app/vite.config.js', config);

function replaceInDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceInDir(fullPath);
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let newContent = content.replace(/from '\.\.\/\.\.\/inventory-app\/src\//g, "from '@inventory/");
      if (newContent !== content) fs.writeFileSync(fullPath, newContent);
    }
  }
}
replaceInDir('apps/warehouse-app/src');
console.log('Alias fixed');
