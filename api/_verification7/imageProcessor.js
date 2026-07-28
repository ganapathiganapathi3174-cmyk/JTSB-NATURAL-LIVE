let Jimp = null;
try { Jimp = require('jimp'); } catch (e) { Jimp = null; }

async function process(imageBuffer) {
  if (!Jimp) return { buffer: imageBuffer, steps: ['jimp_unavailable'], dimensions: null };
  const steps = [];
  try {
    let img = await Jimp.read(imageBuffer);
    const origW = img.bitmap.width;
    const origH = img.bitmap.height;
    steps.push('loaded:' + origW + 'x' + origH);

    img = img.autocrop({ tolerance: 0, cropOnlyFrames: true });
    if (img.bitmap.width !== origW || img.bitmap.height !== origH) {
      steps.push('cropped:' + img.bitmap.width + 'x' + img.bitmap.height);
    }

    img = img.contrast(0.15);
    steps.push('contrast');

    img = img.normalize();
    steps.push('normalize');

    img = img.greyscale();
    steps.push('greyscale');

    const buf = await img.getBufferAsync(Jimp.MIME_PNG);
    return {
      buffer: buf,
      steps,
      dimensions: { width: img.bitmap.width, height: img.bitmap.height },
      originalDimensions: { width: origW, height: origH },
    };
  } catch (err) {
    steps.push('error:' + err.message);
    return { buffer: imageBuffer, steps, dimensions: null };
  }
}

module.exports = { process };
