import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const projectRoot = process.cwd();
const staticRoot = resolve(projectRoot, 'static/tesseract');
const coreSource = resolve(projectRoot, 'node_modules/tesseract.js-core');
const workerSource = resolve(projectRoot, 'node_modules/tesseract.js/dist/worker.min.js');
const languageSource = resolve(
  projectRoot,
  'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
);

async function copyOcrAssets() {
  await rm(staticRoot, { recursive: true, force: true });
  await mkdir(join(staticRoot, 'core'), { recursive: true });
  await mkdir(join(staticRoot, 'lang'), { recursive: true });

  await copyFile(workerSource, join(staticRoot, 'worker.min.js'));

  const coreEntries = await readdir(coreSource, { withFileTypes: true });
  const coreFiles = coreEntries
    .filter((entry) => entry.isFile() && entry.name.startsWith('tesseract-core'))
    .map((entry) => entry.name);

  if (!coreFiles.some((name) => name.endsWith('.wasm.js'))) {
    throw new Error('The Tesseract.js WebAssembly core files were not found.');
  }

  for (const fileName of coreFiles) {
    await copyFile(join(coreSource, fileName), join(staticRoot, 'core', fileName));
  }

  await copyFile(languageSource, join(staticRoot, 'lang', 'eng.traineddata.gz'));

  console.info(
    'Prepared local OCR assets: worker, ' +
      coreFiles.length +
      ' WebAssembly core files, and the English language model.'
  );
}

copyOcrAssets().catch((error) => {
  console.error('Could not prepare local OCR assets.', error);
  process.exitCode = 1;
});
