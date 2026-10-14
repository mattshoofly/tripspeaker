import { captureWorkletUrl, rendererWorkletUrl } from './audio/workletUrls';

document.getElementById('root')!.textContent = `${captureWorkletUrl} ${rendererWorkletUrl}`;
