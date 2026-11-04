// inject.js - Kairos Page Context Bridge | Created by Zeyn
(function () {
  'use strict';

  function getVideoId() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('v') || '';
    } catch (e) {
      return '';
    }
  }

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function parseChaptersFromText(text, fallbackThumb) {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    const timeRegex = /[\(\[]?\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b[\)\]]?/;
    const items = [];

    for (const line of lines) {
      const m = timeRegex.exec(line);
      if (!m) continue;

      const h = m[1] ? parseInt(m[1], 10) : 0;
      const mm = parseInt(m[2], 10);
      const ss = parseInt(m[3], 10);
      if (isNaN(mm) || isNaN(ss)) continue;
      const start = h * 3600 + mm * 60 + ss;

      let title = (line.slice(0, m.index) + line.slice(m.index + m[0].length)).trim();
      title = title
        .replace(/^[\s\*\-\•\–\—\:\.\|\#\>\(\)\[\]]+/, '')
        .replace(/[\s\*\-\•\–\—\:\.\|\#\>\(\)\[\]]+$/, '')
        .trim();

      if (title.length >= 2) {
        items.push({ title, start, thumbnail: fallbackThumb });
      }
    }
    return items;
  }

  function extractChaptersFromPlayer() {
    const videoId = getVideoId();
    const fallbackThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '';
    const player = getPlayer();
    const playerResp = (player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null) || window.ytInitialPlayerResponse;

    // 1. markersMap (High quality chapter thumbnails)
    try {
      const markersMap = playerResp?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer?.markersMap;
      if (Array.isArray(markersMap)) {
        for (const marker of markersMap) {
          const chapters = marker.value?.chapters;
          if (Array.isArray(chapters) && chapters.length > 0) {
            return chapters.map((c, idx) => {
              const r = c.chapterRenderer;
              const title = r?.title?.simpleText || (r?.title?.runs && r.title.runs.map(x => x.text).join('')) || `Chapter ${idx + 1}`;
              const startSec = (r?.timeRangeStartMillis || 0) / 1000;
              const thumbs = r?.thumbnail?.thumbnails;
              const thumbUrl = (thumbs && thumbs.length > 0) ? thumbs[thumbs.length - 1].url : fallbackThumb;
              return { title, start: startSec, thumbnail: thumbUrl };
            });
          }
        }
      }
    } catch (err) { }

    // 2. ytInitialData engagement panels
    try {
      const initialData = window.ytInitialData;
      const panels = initialData?.engagementPanels;
      if (Array.isArray(panels)) {
        for (const p of panels) {
          const content = p.engagementPanelSectionListRenderer?.content?.macroMarkersListRenderer?.contents;
          if (Array.isArray(content) && content.length > 0) {
            const result = [];
            for (let i = 0; i < content.length; i++) {
              const item = content[i]?.macroMarkersListItemRenderer;
              if (item) {
                const title = item.title?.simpleText || (item.title?.runs && item.title.runs.map(x => x.text).join('')) || `Chapter ${i + 1}`;
                const timeStr = item.timeDescription?.simpleText || '';
                const parts = timeStr.split(':').map(Number);
                let start = 0;
                if (parts.length === 3) start = parts[0] * 3600 + parts[1] * 60 + parts[2];
                else if (parts.length === 2) start = parts[0] * 60 + parts[1];
                const thumbs = item.thumbnail?.thumbnails;
                const thumbUrl = (thumbs && thumbs.length > 0) ? thumbs[thumbs.length - 1].url : fallbackThumb;
                result.push({ title, start, thumbnail: thumbUrl });
              }
            }
            if (result.length > 0) return result;
          }
        }
      }
    } catch (err) { }

    // 3. Player API getChapters()
    if (player && typeof player.getChapters === 'function') {
      try {
        const list = player.getChapters();
        if (Array.isArray(list) && list.length > 0) {
          return list.map((item, idx) => ({
            title: item.title || `Chapter ${idx + 1}`,
            start: typeof item.time === 'number' ? item.time : 0,
            thumbnail: fallbackThumb
          }));
        }
      } catch (err) { }
    }

    // 4. Macro markers in DOM ("In this video" panel)
    try {
      const markers = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
      if (markers && markers.length >= 2) {
        const list = [];
        markers.forEach((m, idx) => {
          const timeEl = m.querySelector('#time') || m.querySelector('[class*="time"]');
          const titleEl = m.querySelector('#details #title') || m.querySelector('h4') || m.querySelector('#endpoint');
          const imgEl = m.querySelector('img');
          const timeStr = timeEl ? timeEl.textContent.trim() : '';
          const title = titleEl ? titleEl.textContent.trim() : `Chapter ${idx + 1}`;
          const thumb = (imgEl && imgEl.src && !imgEl.src.includes('data:image')) ? imgEl.src : fallbackThumb;
          if (timeStr) {
            const parts = timeStr.replace(/[^\d:]/g, '').split(':').map(Number);
            let start = 0;
            if (parts.length === 3) start = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else if (parts.length === 2) start = parts[0] * 60 + parts[1];
            list.push({ title, start, thumbnail: thumb });
          }
        });
        if (list.length >= 2) return list;
      }
    } catch (e) { }

    // 5. Player Response shortDescription scraper (covers descriptions with timestamps)
    try {
      const desc = playerResp?.videoDetails?.shortDescription;
      if (desc) {
        const parsed = parseChaptersFromText(desc, fallbackThumb);
        if (parsed.length >= 2) return parsed;
      }
    } catch (e) { }

    return null;
  }

  function getCaptionTracks() {
    const player = getPlayer();
    try {
      const resp = (player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null) || window.ytInitialPlayerResponse;
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks.map(t => ({
          baseUrl: t.baseUrl,
          languageCode: t.languageCode,
          name: t.name?.simpleText || (t.name?.runs && t.name.runs.map(x => x.text).join('')) || t.languageCode,
          isAuto: t.kind === 'asr'
        }));
      }
    } catch (e) { }

    try {
      const player = getPlayer();
      if (player && typeof player.getOption === 'function') {
        const list = player.getOption('captions', 'tracklist');
        if (Array.isArray(list) && list.length > 0) {
          return list.map(t => ({
            baseUrl: t.baseUrl || t.url || '',
            languageCode: t.languageCode,
            name: t.displayName || t.name || t.languageCode,
            isAuto: Boolean(t.is_default || t.kind === 'asr')
          })).filter(t => Boolean(t.baseUrl));
        }
      }
    } catch (e) { }

    return [];
  }

  function broadcastChapters() {
    const videoId = getVideoId();
    if (!videoId) return;

    const chapters = extractChaptersFromPlayer();
    const player = getPlayer();
    const duration = player && typeof player.getDuration === 'function' ? player.getDuration() : 0;
    const captionTracks = getCaptionTracks();

    window.postMessage({
      source: 'YT_CHAPTER_PAGE',
      type: 'CHAPTERS_DATA',
      videoId: videoId,
      chapters: chapters,
      duration: duration,
      captionTracks: captionTracks
    }, '*');
  }

  // Fast proactive polling (polls every 400ms for up to 10 attempts / 4 seconds)
  function startFastPolling() {
    let attempts = 0;
    if (chapterPollInterval) clearInterval(chapterPollInterval);

    chapterPollInterval = setInterval(() => {
      attempts++;
      const chapters = extractChaptersFromPlayer();

      if (chapters && chapters.length > 0) {
        broadcastChapters();
        clearInterval(chapterPollInterval);
        chapterPollInterval = null;
      } else if (attempts >= 10) {
        broadcastChapters();
        clearInterval(chapterPollInterval);
        chapterPollInterval = null;
      }
    }, 400);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'YT_CHAPTER_EXT') return;
    const { type, time } = event.data;
    const player = getPlayer();

    if (type === 'SEEK_TO' && player && typeof player.seekTo === 'function') {
      player.seekTo(time, true);
    } else if (type === 'PAUSE' && player && typeof player.pauseVideo === 'function') {
      player.pauseVideo();
    } else if (type === 'PLAY' && player && typeof player.playVideo === 'function') {
      player.playVideo();
    } else if (type === 'REQUEST_CHAPTERS') {
      broadcastChapters();
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    startFastPolling();
  });

  window.addEventListener('yt-page-data-updated', () => {
    startFastPolling();
  });

  // Instant check immediately
  startFastPolling();
})();
