// ===================================================================
//  model-worker.js — Worker para descarga y ejecución de modelos ONNX
//  Envía/recibe ArrayBuffers (no Blobs) para máxima compatibilidad.
// ===================================================================

importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

let currentSession = null;

// -------------- Descarga con progreso --------------
async function downloadWithProgress(url, onProgress) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    mode: 'cors',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} en ${url}`);
  }

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) {
        onProgress({ received, total, percent: Math.round((received / total) * 100) });
      } else {
        onProgress({ received, total: 0, percent: -1 });
      }
    }

    // Concatenar chunks en un único ArrayBuffer
    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    return buffer.buffer;
  } else {
    onProgress({ received: 0, total: 0, percent: -1 });
    const buf = await response.arrayBuffer();
    onProgress({ received: buf.byteLength, total: buf.byteLength, percent: 100 });
    return buf;
  }
}

// -------------- Preprocesamiento --------------
function preprocessImage(imageBitmap, size = 320) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const float32 = new Float32Array(3 * size * size);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    float32[j] = (data[i] / 255 - mean[0]) / std[0];
    float32[size * size + j] = (data[i + 1] / 255 - mean[1]) / std[1];
    float32[2 * size * size + j] = (data[i + 2] / 255 - mean[2]) / std[2];
  }
  return float32;
}

// -------------- Inferencia --------------
async function runInference(modelBuffer, imageBitmap) {
  if (currentSession) {
    try { await currentSession.release(); } catch (_) {}
    currentSession = null;
  }

  currentSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  });

  const SIZE = 320;
  const float32 = preprocessImage(imageBitmap, SIZE);
  const tensor = new ort.Tensor('float32', float32, [1, 3, SIZE, SIZE]);

  const inputName = currentSession.inputNames[0];
  const results = await currentSession.run({ [inputName]: tensor });

  const outputName = currentSession.outputNames[0];
  const out = results[outputName];
  const outData = out.data;
  const outDims = out.dims;
  const ow = outDims[outDims.length - 1];
  const oh = outDims[outDims.length - 2];

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < outData.length; i++) {
    if (outData[i] < min) min = outData[i];
    if (outData[i] > max) max = outData[i];
  }
  const range = max - min || 1;

  const mask = new Uint8ClampedArray(ow * oh);
  for (let i = 0; i < ow * oh; i++) {
    let v = ((outData[i] - min) / range) * 255;
    v = Math.max(0, Math.min(255, (v - 30) / 225 * 255));
    mask[i] = v;
  }

  return { mask, width: ow, height: oh };
}

// -------------- Mensajes --------------
self.onmessage = async (e) => {
  const { id, action, payload } = e.data;

  try {
    if (action === 'download') {
      const { url } = payload;
      const arrayBuffer = await downloadWithProgress(url, (progress) => {
        self.postMessage({ id, type: 'progress', progress });
      });
      self.postMessage(
        { id, type: 'result', result: { arrayBuffer, size: arrayBuffer.byteLength } },
        [arrayBuffer]
      );
    }
    else if (action === 'run') {
      const { modelBuffer, imageBitmap } = payload;
      const out = await runInference(modelBuffer, imageBitmap);
      self.postMessage(
        { id, type: 'result', result: { mask: out.mask, width: out.width, height: out.height } },
        [out.mask.buffer]
      );
    }
    else {
      throw new Error('Acción desconocida: ' + action);
    }
  } catch (err) {
    console.error('[worker]', err);
    self.postMessage({
      id,
      type: 'error',
      error: (err && err.message) ? err.message : String(err)
    });
  }
};