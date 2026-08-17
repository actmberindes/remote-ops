import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const assetTagsRouter = Router();

// Code 39 supports the asset-tag character set used by Remote Ops (A-Z and 0-9).
const CODE39 = {
  '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011',
  '5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
  'A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101',
  'F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101',
  'K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001',
  'P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001',
  'U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101',
  'Z':'100110110101'
};

function code39Svg(value) {
  const text = `*${String(value).toUpperCase()}*`;
  const narrow = 2, wide = 5, gap = 2;
  let x = 10;
  let bars = '';
  for (const ch of text) {
    const pattern = CODE39[ch];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i++) {
      const width = pattern[i] === '1' ? (i % 2 === 0 ? wide : narrow) : narrow;
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${width}" height="70"/>`;
      x += width;
    }
    x += gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x + 10}" height="95" viewBox="0 0 ${x + 10} 95"><rect width="100%" height="100%" fill="white"/>${bars}<text x="50%" y="88" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700">${value}</text></svg>`;
}

assetTagsRouter.get('/:id/print', requireAuth(db), requireRole('Admin'), (req, res) => {
  const asset = db.data.assets.find(a => a.id === Number(req.params.id));
  if (!asset) return res.status(404).send('Asset not found.');

  const barcode = code39Svg(asset.assetTag);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Asset Tag ${asset.assetTag}</title><style>
    @page{size:3in 1.5in;margin:0}html,body{margin:0;padding:0;background:#eee}body{font-family:Arial,sans-serif}.sticker{width:3in;height:1.5in;box-sizing:border-box;background:#fff;padding:.12in;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center}.header{font-size:10px;font-weight:700;letter-spacing:.3px}.barcode{width:100%;display:flex;justify-content:center}.barcode svg{width:100%;height:auto;max-height:.72in}.footer{font-size:13px;font-weight:800;letter-spacing:1px}@media print{body{background:#fff}.sticker{break-inside:avoid}}</style></head><body><div class="sticker"><div class="header">PROPERTY OF EIGHTY-EIGHT FLOOR GIFTS INC</div><div class="barcode">${barcode}</div><div class="footer">${asset.assetTag}</div></div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
  res.type('html').send(html);
});
