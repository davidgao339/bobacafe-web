const fs = require('fs');
const path = require('path');

function replaceInDir(dir, replacements) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceInDir(fullPath, replacements);
    } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let newContent = content;
      for (const [from, to] of replacements) {
        newContent = newContent.replace(from, to);
      }
      if (newContent !== content) {
        fs.writeFileSync(fullPath, newContent);
      }
    }
  }
}

let invIconsFile = 'apps/inventory-app/src/icons.jsx';
if (fs.existsSync(invIconsFile)) {
  let c = fs.readFileSync(invIconsFile, 'utf8');
  c = c.replace(/export const TapiocaIcon = \(\) => \([\s\S]*?<\/svg>\r?\n\)\r?\n/m, '');
  fs.writeFileSync(invIconsFile, c);
}

const toDelete = [
  'apps/warehouse-app/src/data/sales-data.json',
  'apps/warehouse-app/src/data/fakeData.js',
  'apps/warehouse-app/src/data/productMap.js',
  'apps/warehouse-app/src/utils/productTypes.js',
  'apps/warehouse-app/src/utils/tapiocaCalculations.js',
  'apps/warehouse-app/src/services/api.js',
  'apps/warehouse-app/src/icons.jsx'
];
toDelete.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

const replacements = [
  [/from '(\.\.\/)*data\/(.*?)'/g, "from '../../inventory-app/src/data/$2'"],
  [/from '(\.\.\/)*utils\/(productTypes|tapiocaCalculations)'/g, "from '../../inventory-app/src/utils/$2'"],
  [/from '(\.\.\/)*services\/(api)'/g, "from '../../inventory-app/src/services/$2'"],
  [/from '(\.\.\/)*icons'/g, "from '../../inventory-app/src/icons'"]
];
replaceInDir('apps/warehouse-app/src', replacements);

console.log('Cleanup done.');
