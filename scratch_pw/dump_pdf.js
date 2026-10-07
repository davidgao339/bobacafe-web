const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

(async () => {
  const data = new Uint8Array(fs.readFileSync('C:\\Users\\david\\Downloads\\Вложения от 05.10.26 17-47.pdf'));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  
  // Group by Y roughly
  const items = textContent.items.map(i => ({
    str: i.str,
    x: Math.round(i.transform[4]),
    y: Math.round(i.transform[5])
  }));
  
  // Print sorted by Y (descending) then X (ascending)
  items.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });
  
  let currentY = -1;
  let line = '';
  for (const item of items) {
    if (currentY !== -1 && Math.abs(currentY - item.y) > 2) {
      console.log(`[Y:${currentY.toString().padStart(3)}]`, line);
      line = '';
    }
    line += ` | [X:${item.x}] ${item.str}`;
    currentY = item.y;
  }
  if (line) console.log(`[Y:${currentY.toString().padStart(3)}]`, line);
})();
