const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function inspectMedia(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,tags:format=duration',
      '-of', 'json',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (chunk) => output += chunk);
    ffprobe.stderr.on('data', (chunk) => console.error(chunk.toString()));

    ffprobe.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const data = JSON.parse(output);
        const tracks = { audio: [], subtitle: [], durationMs: 0 };
        
        if (data.format && data.format.duration) {
           tracks.durationMs = parseFloat(data.format.duration) * 1000000;
        }

        data.streams.forEach(stream => {
          if (stream.codec_type === 'audio') {
            const lang = stream.tags?.language || 'Unknown';
            tracks.audio.push({ id: stream.index, label: `${lang} (${stream.codec_name})` });
          } else if (stream.codec_type === 'subtitle') {
            const lang = stream.tags?.language || 'Unknown';
            tracks.subtitle.push({ id: stream.index, label: `${lang} (${stream.codec_name})` });
          }
        });
        resolve(tracks);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function startTranscode(filePath, audioIndex, subIndex, wss) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(__dirname, '..', 'movie.mp4');
    const subPath = path.join(__dirname, '..', 'subtitles.vtt');
    
    // Cleanup old files
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(subPath)) fs.unlinkSync(subPath);

    let extractionPromise = Promise.resolve();
    if (subIndex !== 'none') {
      extractionPromise = new Promise((res) => {
        const subProc = spawn('ffmpeg', ['-y', '-i', filePath, '-map', `0:${subIndex}`, subPath]);
        subProc.on('close', () => res());
      });
    }

    extractionPromise.then(() => {
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', filePath,
        '-map', '0:v:0',
        '-map', `0:${audioIndex}`,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        outputPath
      ]);

      ffmpeg.stdout.on('data', (data) => {
        const str = data.toString();
        const outTimeMatch = str.match(/out_time_ms=(\d+)/);
        if (outTimeMatch) {
          const processedMs = parseInt(outTimeMatch[1], 10);
          wss.clients.forEach(client => {
             client.send(JSON.stringify({ type: 'TRANSCODE_PROGRESS', processedMs }));
          });
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) resolve(outputPath);
        else reject(new Error('Transcode failed'));
      });
    });
  });
}

module.exports = { inspectMedia, startTranscode };
