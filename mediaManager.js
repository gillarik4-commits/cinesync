const express = require('express');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { getWss } = require('./syncManager');

const router = express.Router();
const MEDIA_DIR = path.join(__dirname, 'public', 'media');
const MOVIE_PATH = path.join(MEDIA_DIR, 'movie.mp4');
const SUBTITLE_PATH = path.join(MEDIA_DIR, 'subtitles.vtt');

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

let appStateRef = null;

function setAppState(state) {
  appStateRef = state;
}

function handleInspect(filePath, res) {
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File not found' });
  }

  ffmpeg.ffprobe(filePath, (err, metadata) => {
    if (err) return res.status(500).json({ error: 'ffprobe failed', details: err.message });
    
    const result = { videoCodec: 'Unknown', audio: [], subtitle: [] };
    
    metadata.streams.forEach(stream => {
      const label = (stream.tags?.language || 'Unknown') + ` (${stream.codec_name})`;
      if (stream.codec_type === 'video') {
        result.videoCodec = stream.codec_name;
      } else if (stream.codec_type === 'audio') {
        result.audio.push({ index: stream.index, label });
      } else if (stream.codec_type === 'subtitle') {
        result.subtitle.push({ index: stream.index, label });
      }
    });

    res.json(result);
  });
}

router.get('/api/inspect', (req, res) => {
  handleInspect(req.query.filePath, res);
});

router.post('/api/inspect', (req, res) => {
  handleInspect(req.body.filePath, res);
});

const handlePrepare = (req, res) => {
  const { filePath, audioIndex, subIndex } = req.body;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'File not found' });
  }

  res.json({ success: true, message: 'Processing started' });

  if (fs.existsSync(MOVIE_PATH)) fs.unlinkSync(MOVIE_PATH);
  if (fs.existsSync(SUBTITLE_PATH)) fs.unlinkSync(SUBTITLE_PATH);

  const extractSubtitles = () => {
    return new Promise((resolve) => {
      if (subIndex === 'none' || subIndex === undefined) return resolve();
      ffmpeg(filePath)
        .outputOptions([`-map 0:${subIndex}`, '-c:s webvtt'])
        .save(SUBTITLE_PATH)
        .on('end', () => resolve())
        .on('error', () => resolve());
    });
  };

  extractSubtitles().then(() => {
    const cmd = ffmpeg(filePath)
      .outputOptions([
        '-map 0:v:0',
        `-map 0:${audioIndex}`,
        '-c:v copy',
        '-c:a aac',
        '-ac 2',
        '-movflags +faststart'
      ])
      .save(MOVIE_PATH);
      
    cmd.on('progress', (progress) => {
      const wss = getWss();
      if (wss) {
        wss.clients.forEach(c => {
          c.send(JSON.stringify({ type: 'TRANSCODE_PROGRESS', percent: progress.percent }));
        });
      }
    });

    cmd.on('end', () => {
      if (appStateRef) {
        appStateRef.isPartyActive = true;
      }
      const wss = getWss();
      if (wss) {
        wss.clients.forEach(c => {
          if (c.readyState === 1) {
            c.send(JSON.stringify({ type: 'TRANSCODE_COMPLETE' }));
            c.send(JSON.stringify({ type: 'MEDIA_READY' }));
          }
        });
      }
    });
    
    cmd.on('error', (err) => {
      console.error('Transcode error:', err.message);
    });
  });
};

router.post('/api/prepare', handlePrepare);
router.post('/api/start-party', handlePrepare);

router.get('/video', (req, res) => {
  if (!fs.existsSync(MOVIE_PATH)) {
    return res.status(404).send('Movie not ready');
  }

  const stat = fs.statSync(MOVIE_PATH);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).send('Requested range not satisfiable\\n' + start + ' >= ' + fileSize);
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(MOVIE_PATH, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    res.writeHead(200, head);
    fs.createReadStream(MOVIE_PATH).pipe(res);
  }
});

module.exports = { router, setAppState };
