'use strict';
/**
 * Unit tests for mediaManager.js
 *
 * Key Jest constraint: jest.mock() is hoisted to the top of the file by babel.
 * The factory function cannot reference variables declared in the outer scope
 * (unless prefixed with 'mock'). We use purely inline factories.
 *
 * jest.resetModules() is called in beforeEach, so each test gets a clean
 * require() of mediaManager with the freshly-configured fs/ffmpeg mocks.
 *
 * IMPORTANT: call setExists() and configure ffmpegFn BEFORE calling require('../mediaManager')
 * inside each test, because resetModules() clears the module registry and re-runs
 * the jest.mock() factory on the next require().
 */

// ── inline mock factories ──────────────────────────────────────────────────────

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
}));

jest.mock('fluent-ffmpeg', () => {
  const factory = jest.fn();
  factory.ffprobe = jest.fn();
  return factory;
});

// ── post-hoist imports ─────────────────────────────────────────────────────────

const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const request = require('supertest');

const MEDIA_DIR = path.join(__dirname, '..', 'public', 'media');
const MOVIE_PATH = path.join(MEDIA_DIR, 'movie.mp4');
const SUBTITLE_PATH = path.join(MEDIA_DIR, 'subtitles.vtt');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Configure which paths existsSync returns true for.
 * Call this AFTER resetModules() / BEFORE require('../mediaManager').
 */
function setExists(paths) {
  const fs = jest.requireMock('fs');
  fs.existsSync.mockImplementation((p) => {
    if (p === MEDIA_DIR) return true; // let mkdirSync be skipped
    return paths.includes(p);
  });
}

/** Build a no-op ffmpeg instance that calls onEvent(event, cb) for each .on() call */
function makeFfmpegInst(onEvent) {
  const inst = {
    outputOptions: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function (event, cb) {
      if (onEvent) onEvent(event, cb);
      return this;
    }),
  };
  return inst;
}

/** Wire up a fresh mediaManager with an optional appState */
function buildApp(partyActive = false) {
  // NOTE: do NOT call resetModules() here — caller already did it in beforeEach.
  // Calling it here would undo the setExists() configuration.
  const mediaManager = require('../mediaManager');
  const appState = { isPartyActive: partyActive };
  mediaManager.setAppState(appState);

  const app = express();
  app.use(express.json());
  app.use('/', mediaManager.router);
  return { app, appState, mediaManager };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('mediaManager', () => {
  beforeEach(() => {
    // Reset module registry + clear mock state each test
    jest.resetModules();
    jest.clearAllMocks();

    // Re-apply default implementations after clearAllMocks
    setExists([]);

    const ffmpegFn = jest.requireMock('fluent-ffmpeg');
    ffmpegFn.mockImplementation(() => makeFfmpegInst(null));
    ffmpegFn.ffprobe = jest.fn();
  });

  // ── setAppState / transcode end ───────────────────────────────────────────

  describe('setAppState()', () => {
    test('sets isPartyActive=true when ffmpeg transcode ends', async () => {
      setExists(['/valid/movie.mkv']);

      let capturedEndCb = null;

      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.mockImplementation(() => {
        return makeFfmpegInst((event, cb) => {
          if (event === 'end') capturedEndCb = cb;
        });
      });

      const { app, appState } = buildApp(false);

      const res = await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Wait for subtitle promise to resolve + ffmpeg chain to be set up
      await new Promise((r) => setTimeout(r, 150));

      expect(capturedEndCb).toBeTruthy();
      capturedEndCb();
      await new Promise((r) => setTimeout(r, 30));

      expect(appState.isPartyActive).toBe(true);
    });
  });

  // ── GET /api/inspect ──────────────────────────────────────────────────────

  describe('GET /api/inspect', () => {
    test('returns 400 when filePath query param is absent', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/inspect');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/File not found/);
    });

    test('returns 400 when file does not exist on disk', async () => {
      // nothing in existsMap for /nonexistent/...
      const { app } = buildApp();
      const res = await request(app).get('/api/inspect?filePath=/nonexistent/file.mkv');
      expect(res.status).toBe(400);
    });

    test('returns 500 on ffprobe error', async () => {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.ffprobe = jest.fn((_p, cb) => cb(new Error('probe failed'), null));

      const { app } = buildApp();
      const res = await request(app).get('/api/inspect?filePath=/valid/movie.mkv');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/ffprobe failed/);
    });

    test('returns 200 with codec and stream info', async () => {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.ffprobe = jest.fn((_p, cb) =>
        cb(null, {
          streams: [
            { codec_type: 'video', codec_name: 'h264', index: 0 },
            { codec_type: 'audio', codec_name: 'aac', index: 1, tags: { language: 'eng' } },
            { codec_type: 'subtitle', codec_name: 'subrip', index: 2, tags: { language: 'fra' } },
          ],
        })
      );

      const { app } = buildApp();
      const res = await request(app).get('/api/inspect?filePath=/valid/movie.mkv');
      expect(res.status).toBe(200);
      expect(res.body.videoCodec).toBe('h264');
      expect(res.body.audio).toHaveLength(1);
      expect(res.body.audio[0].label).toContain('aac');
      expect(res.body.subtitle).toHaveLength(1);
      expect(res.body.subtitle[0].label).toContain('subrip');
    });
  });

  // ── POST /api/inspect ─────────────────────────────────────────────────────

  describe('POST /api/inspect', () => {
    test('returns 400 for empty body', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/api/inspect').send({});
      expect(res.status).toBe(400);
    });

    test('returns 200 with codec info for valid body', async () => {
      setExists(['/valid/movie.mkv']);
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.ffprobe = jest.fn((_p, cb) =>
        cb(null, {
          streams: [{ codec_type: 'video', codec_name: 'hevc', index: 0 }],
        })
      );

      const { app } = buildApp();
      const res = await request(app).post('/api/inspect').send({ filePath: '/valid/movie.mkv' });
      expect(res.status).toBe(200);
      expect(res.body.videoCodec).toBe('hevc');
    });
  });

  // ── POST /api/prepare ─────────────────────────────────────────────────────

  describe('POST /api/prepare', () => {
    test('returns 400 when filePath body field is absent', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/api/prepare').send({ audioIndex: '1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/File not found/);
    });

    test('returns 400 when file does not exist on disk', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/prepare')
        .send({ filePath: '/nonexistent/file.mkv', audioIndex: '1' });
      expect(res.status).toBe(400);
    });

    test('removes existing movie.mp4 and subtitles.vtt before transcoding', async () => {
      setExists(['/valid/movie.mkv', MOVIE_PATH, SUBTITLE_PATH]);

      let callIndex = 0;
      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.mockImplementation(() => {
        callIndex++;
        const ci = callIndex;
        // resolve subtitle extraction immediately; don't trigger main transcode end
        return makeFfmpegInst((event, cb) => {
          if (ci === 1 && event === 'end') setTimeout(cb, 0);
        });
      });

      const { app } = buildApp();
      await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });

      // Allow async prepare body to run
      await new Promise((r) => setTimeout(r, 150));

      const fs = jest.requireMock('fs');
      expect(fs.unlinkSync).toHaveBeenCalledWith(MOVIE_PATH);
      expect(fs.unlinkSync).toHaveBeenCalledWith(SUBTITLE_PATH);
    });

    test('does NOT set isPartyActive when ffmpeg emits error', async () => {
      setExists(['/valid/movie.mkv']);

      let capturedErrorCb = null;

      const ffmpegFn = jest.requireMock('fluent-ffmpeg');
      ffmpegFn.mockImplementation(() => {
        return makeFfmpegInst((event, cb) => {
          if (event === 'error') capturedErrorCb = cb;
        });
      });

      const { app, appState } = buildApp(false);

      await request(app)
        .post('/api/prepare')
        .send({ filePath: '/valid/movie.mkv', audioIndex: '1', subIndex: 'none' });

      await new Promise((r) => setTimeout(r, 150));
      if (capturedErrorCb) capturedErrorCb(new Error('codec error'));
      await new Promise((r) => setTimeout(r, 30));

      expect(appState.isPartyActive).toBe(false);
    });

    test('/api/start-party alias returns 400 for invalid path (edge case 5 — retry path)', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/api/start-party')
        .send({ filePath: '/nonexistent/file.mkv', audioIndex: '1' });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /video ────────────────────────────────────────────────────────────

  describe('GET /video', () => {
    test('returns 404 when movie.mp4 is absent', async () => {
      // MOVIE_PATH not included in setExists → false
      const { app } = buildApp();
      const res = await request(app).get('/video');
      expect(res.status).toBe(404);
    });

    test('returns 200 with video/mp4 for full (no-range) request', async () => {
      setExists([MOVIE_PATH]);

      const fs = jest.requireMock('fs');
      fs.statSync.mockReturnValue({ size: 2048 });
      const fakeStream = new Readable({
        read() {
          this.push(Buffer.alloc(2048));
          this.push(null);
        },
      });
      fs.createReadStream.mockReturnValue(fakeStream);

      const { app } = buildApp();
      const res = await request(app).get('/video');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('video/mp4');
      expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('returns 206 Partial Content for a Range header request', async () => {
      setExists([MOVIE_PATH]);

      const fs = jest.requireMock('fs');
      fs.statSync.mockReturnValue({ size: 4096 });
      const { Readable } = require('stream');
      const fakeStream = new Readable({
        read() {
          this.push(Buffer.alloc(100));
          this.push(null);
        },
      });
      fs.createReadStream.mockReturnValue(fakeStream);

      const { app } = buildApp();
      const res = await request(app).get('/video').set('Range', 'bytes=0-99');
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toMatch(/bytes 0-99\/4096/);
      expect(res.headers['content-length']).toBe('100');
    });

    test('returns 416 when range start exceeds file size', async () => {
      setExists([MOVIE_PATH]);

      const fs = jest.requireMock('fs');
      fs.statSync.mockReturnValue({ size: 100 });

      const { app } = buildApp();
      const res = await request(app).get('/video').set('Range', 'bytes=200-299');
      expect(res.status).toBe(416);
    });
  });
});
