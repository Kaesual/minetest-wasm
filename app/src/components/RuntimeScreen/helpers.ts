export function fixGeometry(canvas: HTMLCanvasElement, container: HTMLDivElement, resolution: string, aspectRatio: string) {
  // Get container dimensions
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  let targetWidth = containerWidth;
  let targetHeight = containerHeight;

  // Apply resolution setting
  let resolutionFactor = 1.0;
  switch (resolution) {
    case 'low':
      resolutionFactor = 0.5;
      break;
    case 'medium':
      resolutionFactor = 0.75;
      break;
    case 'high':
    default:
      resolutionFactor = 1.0;
      break;
  }

  targetWidth *= resolutionFactor;
  targetHeight *= resolutionFactor;

  // Apply aspect ratio constraint if needed
  if (aspectRatio !== 'any') {
    const ratioValues = aspectRatio.split(':').map(Number);
    if (ratioValues.length === 2 && !ratioValues.includes(NaN)) {
      const targetRatio = ratioValues[0] / ratioValues[1];
      const currentRatio = targetWidth / targetHeight;

      if (currentRatio > targetRatio) {
        // Too wide, adjust width
        targetWidth = targetHeight * targetRatio;
      } else if (currentRatio < targetRatio) {
        // Too tall, adjust height
        targetHeight = targetWidth / targetRatio;
      }
    }
  }

  // Set canvas dimensions
  canvas.width = Math.floor(targetWidth);
  canvas.height = Math.floor(targetHeight);

  // Set CSS dimensions to handle any scaling
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  // Notify the Module if it exists
  if (window.Module && window.irrlicht_resize) {
    window.irrlicht_resize(canvas.width, canvas.height);
  }
}

export function queryProxy(cmd: string, proxy: string) {
  return new Promise<[string, string, string]>((resolve, reject) => {
    let finished = false;
    const ws = new WebSocket(proxy);
    ws.addEventListener('open', (event) => {
      ws.send(cmd);
    });
    ws.addEventListener('error', (event) => {
      alert('Error initiating proxy connection');
      finished = true;
      reject(new Error('Received error'));
    });
    ws.addEventListener('close', (event) => {
      if (!finished) {
        alert('Proxy connection closed unexpectedly');
        finished = true;
        reject(new Error('Received close'));
      }
    });
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        alert('Invalid message received from proxy');
        finished = true;
        reject(new Error('Invalid message'));
        return;
      }
      finished = true;
      ws.close();
      resolve(event.data.split(' ') as [string, string, string]);
    });
  });
}