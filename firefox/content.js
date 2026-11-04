// content.js - Kairos: Better Chapters for YouTube | Created by Zeyn
(function () {
  'use strict';

  // --- State ---
  const state = {
    enabled: true,
    autoPauseAtEnd: true,
    autoAdvanceSeconds: 0,
    showPlaylist: true,
    enableSubChapters: true,
    autoSplitLongVideos: false, // Default OFF as requested
    splitIntervalMinutes: 20,
    isCollapsed: false,
    isFloating: false,
    chapters: [],
    rawChapters: [],
    completedIndices: new Set(),
    currentChapterIndex: -1,
    currentSubIndex: -1,
    hasPromptedForEnd: false,
    totalDuration: 0,
    videoId: '',
    countdownTimer: null,
    isDraggingSeek: false,
    lastSecFormatted: '',
    isAutoSplit: false,
    isSmartTranscript: false,
    captionTracks: [],
    apiKey: '',
    isAiLoading: false,
    expandedGroups: new Set()
  };

  // Cached DOM element references to avoid DOM queries during playback
  const dom = {
    player: null,
    video: null,
    timeContainer: null,
    curSpan: null,
    durSpan: null,
    tagSpan: null,
    seekbar: null,
    playBar: null,
    scrubber: null,
    bufferBar: null,
    toggleBtn: null,
    sidebarContainer: null,
    playlistCard: null,
    statusText: null,
    courseFill: null,
    itemsList: null
  };

  const storage = (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local :
    (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null;

  function loadSettings() {
    if (storage) {
      storage.get(['enabled', 'autoPauseAtEnd', 'autoAdvanceSeconds', 'showPlaylist', 'enableSubChapters', 'autoSplitLongVideos', 'splitIntervalMinutes', 'isFloating', 'apiKey'], (res) => {
        if (res) {
          if (typeof res.enabled === 'boolean') state.enabled = res.enabled;
          if (typeof res.autoPauseAtEnd === 'boolean') state.autoPauseAtEnd = res.autoPauseAtEnd;
          if (typeof res.autoAdvanceSeconds === 'number') state.autoAdvanceSeconds = res.autoAdvanceSeconds;
          if (typeof res.showPlaylist === 'boolean') state.showPlaylist = res.showPlaylist;
          state.enableSubChapters = (typeof res.enableSubChapters === 'boolean') ? res.enableSubChapters : true;
          state.autoSplitLongVideos = Boolean(res.autoSplitLongVideos); // Default false
          if (typeof res.splitIntervalMinutes === 'number') state.splitIntervalMinutes = res.splitIntervalMinutes;
          if (typeof res.isFloating === 'boolean') state.isFloating = res.isFloating;
          if (typeof res.apiKey === 'string') state.apiKey = res.apiKey.trim();
        }
        applyModeState();
      });
    }
  }

  function saveSetting(key, val) {
    state[key] = val;
    if (storage) storage.set({ [key]: val });
  }

  function injectMainScript() {
    try {
      const scriptUrl = (typeof browser !== 'undefined' ? browser.runtime : chrome.runtime).getURL('inject.js');
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) { }
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const sStr = s < 10 ? '0' + s : s;
    if (h > 0) {
      const mStr = m < 10 ? '0' + m : m;
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  }

  function parseTimestampToSeconds(str) {
    if (!str) return 0;
    const clean = str.replace(/[^\d:]/g, '');
    const parts = clean.trim().split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function getVideoElement() {
    if (dom.video && dom.video.isConnected) return dom.video;
    dom.video = document.querySelector('#movie_player video') || document.querySelector('video');
    return dom.video;
  }

  function getPlayerElement() {
    if (dom.player && dom.player.isConnected) return dom.player;
    dom.player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    return dom.player;
  }

  function isAdPlaying() {
    const p = getPlayerElement();
    return p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }

  // Universal chapters scraper: Macro Markers ("In this video" panel) + Description parser
  function scrapeChaptersFromDescription() {
    const vId = state.videoId;
    const defaultThumb = vId ? `https://i.ytimg.com/vi/${vId}/mqdefault.jpg` : '';
    const items = [];

    // Source 1: Check YouTube's native Macro Markers (In this video / Timeline panel)
    const markerElements = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
    if (markerElements && markerElements.length > 0) {
      markerElements.forEach((el, idx) => {
        const timeEl = el.querySelector('#time') || el.querySelector('[class*="time"]');
        const titleEl = el.querySelector('#details #title') || el.querySelector('h4') || el.querySelector('#endpoint');
        const imgEl = el.querySelector('img');
        const timeStr = timeEl ? timeEl.textContent.trim() : '';
        const title = titleEl ? titleEl.textContent.trim() : `Chapter ${idx + 1}`;
        const thumb = (imgEl && imgEl.src && !imgEl.src.includes('data:image')) ? imgEl.src : defaultThumb;

        if (timeStr) {
          const start = parseTimestampToSeconds(timeStr);
          items.push({ title, start, thumbnail: thumb });
        }
      });
      if (items.length >= 2) return items;
    }

    // Source 2: Line-by-line universal scraper for description
    const descContainer = document.getElementById('description-inline-expander') || 
                          document.getElementById('description') || 
                          document.querySelector('ytd-watch-metadata') || 
                          document.querySelector('ytd-text-inline-expander');

    if (descContainer) {
      const rawText = descContainer.textContent || descContainer.innerText || '';
      if (rawText) {
        const lines = rawText.split(/\r?\n/);
        // Matches "(00:00:00)", "[02:05:47]", "00:00", "* (02:05:47)"
        const timeRegex = /[\(\[]?\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b[\)\]]?/;

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
            items.push({ title, start, thumbnail: defaultThumb });
          }
        }
        if (items.length >= 2) return items;
      }
    }

    return items;
  }

  function generateAutoSplitChapters(totalDuration) {
    const intervalSec = Math.max(300, (state.splitIntervalMinutes || 20) * 60);
    const vId = state.videoId;
    const defaultThumb = vId ? `https://i.ytimg.com/vi/${vId}/mqdefault.jpg` : '';
    const chapters = [];
    let start = 0;
    let count = 1;

    while (start < totalDuration) {
      const end = Math.min(start + intervalSec, totalDuration);
      chapters.push({
        index: count - 1,
        number: count,
        title: `${formatTime(start)} – ${formatTime(end)}`,
        start: start,
        end: end,
        duration: end - start,
        thumbnail: defaultThumb,
        videoId: vId
      });
      start = end;
      count++;
    }
    return chapters;
  }

  // --- Smart Transcript Topic Segmentation Engine ---

  function decodeHtmlEntities(str) {
    if (!str || !str.includes('&')) return str;
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  }

  function cleanTranscriptText(text) {
    if (!text) return '';
    return decodeHtmlEntities(text)
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^\)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatTitleCase(str) {
    if (!str || /[\u0600-\u06FF]/.test(str)) return str;
    const minorWords = /^(a|an|the|and|but|or|for|nor|on|at|to|from|by|in|of|with|into|as)$/i;
    return str.split(/\s+/).map((word, idx) => {
      if (idx > 0 && minorWords.test(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  }

  function extractTopicTitle(text) {
    if (!text) return '';
    let clean = cleanTranscriptText(text)
      .replace(/^[\s,.\-–—:;!?]+/, '')
      .replace(/[\s,.\-–—:;!?]+$/, '')
      // Remove conversational filler prefixes in Arabic
      .replace(/^(طيب|يعني|حسناً|حسنا|إذن|اذن|الآن|الان|سنتحدث عن|سنتكلم عن|دعونا نرى|سوف نقوم ب|ننتقل إلى|ننتقل الى|الخطوة التالية هي|نبدأ ب|سوف نتعلم|سنتعلم|دعنا نتحدث عن)\s+/i, '')
      // Remove conversational filler prefixes in English
      .replace(/^(so|well|okay|ok|now|and now|alright|right|so basically|as you can see|like i said|let's talk about|let's look at|let's examine|let's dive into|let's jump into|we are going to|we're going to|moving on to|moving to|next we have|first let's|today we are going to learn|in this video|in this section)\s+/i, '')
      // Remove conversational filler prefixes in French
      .replace(/^(alors|bien|maintenant|voyons|passons à|nous allons voir|dans cette vidéo)\s+/i, '');

    clean = clean.trim();
    if (!clean) return '';

    const words = clean.split(/\s+/);
    if (words.length > 7) {
      clean = words.slice(0, 7).join(' ');
    }

    return formatTitleCase(clean);
  }

  async function fetchTranscriptCues(track) {
    if (!track || !track.baseUrl) return null;
    try {
      let url = track.baseUrl;
      if (!url.includes('fmt=')) {
        url += '&fmt=json3';
      }
      const res = await fetch(url, { credentials: 'same-origin' });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          if (Array.isArray(data.events)) {
            const cues = [];
            for (const ev of data.events) {
              if (!ev.segs || !Array.isArray(ev.segs)) continue;
              const t = ev.segs.map(s => s.utf8 || '').join('').trim();
              if (!t) continue;
              cues.push({
                start: (ev.tStartMs || 0) / 1000,
                duration: (ev.dDurationMs || 0) / 1000,
                text: t
              });
            }
            if (cues.length > 0) return cues;
          }
        } else if (text && text.includes('<text')) {
          const doc = new DOMParser().parseFromString(text, 'text/xml');
          const nodes = doc.querySelectorAll('text');
          if (nodes && nodes.length > 0) {
            const cues = [];
            nodes.forEach(n => {
              const start = parseFloat(n.getAttribute('start') || '0');
              const dur = parseFloat(n.getAttribute('dur') || '0');
              const t = (n.textContent || '').trim();
              if (t) cues.push({ start, duration: dur, text: t });
            });
            if (cues.length > 0) return cues;
          }
        }
      }

      // Fallback: try raw baseUrl without fmt
      const rawUrl = track.baseUrl.replace(/&fmt=[^&]+/, '');
      if (rawUrl !== url) {
        const rawRes = await fetch(rawUrl, { credentials: 'same-origin' });
        if (rawRes.ok) {
          const xmlText = await rawRes.text();
          if (xmlText && xmlText.includes('<text')) {
            const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            const nodes = doc.querySelectorAll('text');
            if (nodes && nodes.length > 0) {
              const cues = [];
              nodes.forEach(n => {
                const start = parseFloat(n.getAttribute('start') || '0');
                const dur = parseFloat(n.getAttribute('dur') || '0');
                const t = (n.textContent || '').trim();
                if (t) cues.push({ start, duration: dur, text: t });
              });
              if (cues.length > 0) return cues;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Kairos] Transcript fetch failed:', err);
    }
    return null;
  }

  function scrapeTranscriptFromDOM() {
    const segments = document.querySelectorAll('ytd-transcript-segment-renderer');
    if (!segments || segments.length === 0) return null;

    const cues = [];
    segments.forEach(seg => {
      const timeEl = seg.querySelector('.segment-timestamp') || seg.querySelector('[class*="segment-timestamp"]');
      const textEl = seg.querySelector('.segment-text') || seg.querySelector('[class*="segment-text"]');
      if (timeEl && textEl) {
        const timeStr = timeEl.textContent.trim();
        const text = textEl.textContent.trim();
        const start = parseTimestampToSeconds(timeStr);
        if (text) {
          cues.push({ start, duration: 2.0, text });
        }
      }
    });

    return cues.length >= 5 ? cues : null;
  }

  async function getBestTranscriptCues() {
    if (state.captionTracks && state.captionTracks.length > 0) {
      const pageLang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
      let bestTrack = state.captionTracks.find(t => t.languageCode?.startsWith(pageLang));
      if (!bestTrack) {
        bestTrack = state.captionTracks.find(t => t.languageCode?.startsWith('ar')) ||
                    state.captionTracks.find(t => t.languageCode?.startsWith('en')) ||
                    state.captionTracks[0];
      }
      if (bestTrack) {
        const cues = await fetchTranscriptCues(bestTrack);
        if (cues && cues.length >= 5) return cues;
      }
    }
    return scrapeTranscriptFromDOM();
  }

  function segmentTranscriptSlice(cues, chStart, chEnd, parentTitle, thumbnail, videoId) {
    if (!Array.isArray(cues) || cues.length === 0) return null;

    const transitionRegex = /\b(الآن|ننتقل|الخطوة|أولاً|ثانياً|ثالثاً|رابعاً|خامساً|المفهوم|مفهوم|الفكرة|القانون|قاعدة|قواعد|طريقة|طرق|مثال|أمثلة|تمرين|تمارين|سؤال|حل|برهان|إثبات|ملاحظة|خلاصة|ملخص|الخاتمة|في البداية|وأخيراً|سنتحدث|نتحدث|ندرس|شرح|تعريف|now|next|first|second|third|concept|definition|rule|formula|method|example|exercise|problem|solution|proof|note|in summary|summary|conclusion|moving on|let's look at|we will discuss|architecture|implementation|overview|demo|walkthrough|tutorial|step 1|step 2|step 3|part 1|part 2|section 1|section 2|maintenant|ensuite|premièrement|deuxièmement|concept|définition|règle|formule|méthode|exemple|exercice|solution|conclusion|en résumé|ahora|siguiente|primero|segundo|concepto|ejemplo)\b/i;

    const subChapters = [];
    const minSubDuration = 90;     // ~1.5 minutes
    const targetSubDuration = 360; // ~6 minutes
    const hardCapDuration = 600;   // ~10 minutes

    let currentStart = chStart;
    let currentTitle = '';
    let lastCueEnd = chStart;

    const firstText = cleanTranscriptText(cues[0]?.text || '');
    currentTitle = extractTopicTitle(firstText) || 'Introduction';

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const text = cleanTranscriptText(cue.text || '');
      if (!text) continue;

      const cueStart = cue.start;
      if (cueStart < chStart || cueStart >= chEnd - 20) continue;

      const pause = cueStart - lastCueEnd;
      const elapsed = cueStart - currentStart;

      let isBoundary = false;
      let candidate = '';

      if (elapsed >= minSubDuration) {
        const hasKey = transitionRegex.test(text);
        const isPause = pause >= 2.0;

        if (hasKey && isPause) {
          isBoundary = true;
          candidate = extractTopicTitle(text);
        } else if (hasKey && elapsed >= 180) {
          isBoundary = true;
          candidate = extractTopicTitle(text);
        } else if (isPause && elapsed >= targetSubDuration) {
          isBoundary = true;
          candidate = extractTopicTitle(text);
        } else if (elapsed >= hardCapDuration) {
          isBoundary = true;
          candidate = extractTopicTitle(text);
        }
      }

      if (isBoundary && candidate) {
        subChapters.push({
          title: candidate,
          start: currentStart,
          end: cueStart,
          duration: Math.max(1, cueStart - currentStart)
        });
        currentStart = cueStart;
        currentTitle = candidate;
      }

      lastCueEnd = cueStart + (cue.duration || 2.0);
    }

    if (chEnd > currentStart) {
      subChapters.push({
        title: subChapters.length === 0 ? 'Overview' : (currentTitle || 'Summary'),
        start: currentStart,
        end: chEnd,
        duration: Math.max(1, chEnd - currentStart)
      });
    }

    return subChapters.length >= 2 ? subChapters : null;
  }

  async function decomposeLongChaptersWithTranscript(chapters, maxSec) {
    if (!Array.isArray(chapters) || chapters.length === 0) return chapters;
    const vId = state.videoId;
    const defaultThumb = vId ? `https://i.ytimg.com/vi/${vId}/mqdefault.jpg` : '';

    const hasLong = chapters.some(ch => (ch.end - ch.start) > maxSec);
    if (!hasLong) return chapters;

    const cues = await getBestTranscriptCues();
    const result = [];
    const targetSubDuration = Math.min(maxSec, 600); // 8-10 min target

    for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
      const ch = chapters[cIdx];
      const chDuration = ch.end - ch.start;

      if (chDuration <= maxSec) {
        result.push({
          ...ch,
          index: result.length,
          number: result.length + 1,
          subChapters: []
        });
        continue;
      }

      let chCues = null;
      if (Array.isArray(cues) && cues.length > 0) {
        chCues = cues.filter(q => q.start >= ch.start - 2 && q.start < ch.end - 5);
      }

      let subs = [];
      if (chCues && chCues.length >= 8) {
        const semanticSubs = segmentTranscriptSlice(chCues, ch.start, ch.end, ch.title, ch.thumbnail || defaultThumb, vId);
        if (semanticSubs && semanticSubs.length >= 2) {
          subs = semanticSubs;
        }
      }

      // Clean fallback: Evenly decompose long chapter into sub-parts WITHOUT fraction clutter
      if (subs.length === 0) {
        const numParts = Math.max(2, Math.round(chDuration / targetSubDuration));
        const partDuration = Math.round(chDuration / numParts);

        let curStart = ch.start;
        for (let p = 0; p < numParts; p++) {
          const isLast = (p === numParts - 1);
          const pEnd = isLast ? ch.end : Math.min(ch.end, curStart + partDuration);
          const pDur = pEnd - curStart;

          if (pDur >= 60 || subs.length === 0) {
            subs.push({
              title: `Part ${subs.length + 1}`,
              start: curStart,
              end: pEnd,
              duration: pDur
            });
          } else if (subs.length > 0) {
            subs[subs.length - 1].end = ch.end;
            subs[subs.length - 1].duration = ch.end - subs[subs.length - 1].start;
          }
          curStart = pEnd;
        }
      }

      // Ensure no sub-chapter has duration < 60s
      if (subs.length >= 2) {
        const filteredSubs = [];
        for (let s = 0; s < subs.length; s++) {
          if (subs[s].start >= ch.end - 60) continue;
          filteredSubs.push(subs[s]);
        }
        for (let s = 0; s < filteredSubs.length; s++) {
          const sNext = (s < filteredSubs.length - 1) ? filteredSubs[s + 1].start : ch.end;
          filteredSubs[s].end = Math.max(filteredSubs[s].start + 1, sNext);
          filteredSubs[s].duration = filteredSubs[s].end - filteredSubs[s].start;
        }
        if (filteredSubs.length >= 2 && filteredSubs[filteredSubs.length - 1].duration < 60) {
          filteredSubs.pop();
          filteredSubs[filteredSubs.length - 1].end = ch.end;
          filteredSubs[filteredSubs.length - 1].duration = ch.end - filteredSubs[filteredSubs.length - 1].start;
        }
        subs = filteredSubs;
      }

      result.push({
        ...ch,
        index: result.length,
        number: result.length + 1,
        subChapters: subs
      });
    }

    return result;
  }

  function segmentTranscriptIntoChapters(cues, totalDuration, videoId) {
    if (!Array.isArray(cues) || cues.length === 0) return null;

    const defaultThumb = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '';
    const transitionRegex = /\b(الآن|ننتقل|الخطوة|أولاً|ثانياً|ثالثاً|رابعاً|خامساً|المفهوم|مفهوم|الفكرة|القانون|قاعدة|قواعد|طريقة|طرق|مثال|أمثلة|تمرين|تمارين|سؤال|حل|برهان|إثبات|ملاحظة|خلاصة|ملخص|الخاتمة|في البداية|وأخيراً|سنتحدث|نتحدث|ندرس|شرح|تعريف|now|next|first|second|third|concept|definition|rule|formula|method|example|exercise|problem|solution|proof|note|in summary|summary|conclusion|moving on|let's look at|we will discuss|architecture|implementation|overview|demo|walkthrough|tutorial|step 1|step 2|step 3|part 1|part 2|section 1|section 2|maintenant|ensuite|premièrement|deuxièmement|concept|définition|règle|formule|méthode|exemple|exercice|solution|conclusion|en résumé|ahora|siguiente|primero|segundo|concepto|ejemplo)\b/i;

    const chapters = [];
    const minChapterDuration = 100; // minimum ~1.6 minutes
    const maxChapterDuration = 480; // target max ~8 minutes before seeking break
    const hardCapDuration = 720;    // max 12 minutes without split

    let currentChapterStart = 0;
    let currentChapterTitle = '';
    let lastCueEndTime = 0;

    const firstCueText = cleanTranscriptText(cues[0]?.text || '');
    currentChapterTitle = extractTopicTitle(firstCueText) || 'Introduction';

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const text = cleanTranscriptText(cue.text || '');
      if (!text) continue;

      const cueStart = cue.start;
      const pauseDuration = cueStart - lastCueEndTime;
      const elapsedInChapter = cueStart - currentChapterStart;

      let isBoundary = false;
      let candidateTitle = '';

      if (elapsedInChapter >= minChapterDuration) {
        const hasKeyword = transitionRegex.test(text);
        const isLongPause = pauseDuration >= 2.5;

        if (hasKeyword && isLongPause) {
          isBoundary = true;
          candidateTitle = extractTopicTitle(text);
        } else if (hasKeyword && elapsedInChapter >= 180) {
          isBoundary = true;
          candidateTitle = extractTopicTitle(text);
        } else if (isLongPause && elapsedInChapter >= maxChapterDuration) {
          isBoundary = true;
          candidateTitle = extractTopicTitle(text);
        } else if (elapsedInChapter >= hardCapDuration) {
          if (pauseDuration >= 1.0 || text.length > 0) {
            isBoundary = true;
            candidateTitle = extractTopicTitle(text);
          }
        }
      }

      if (isBoundary && candidateTitle) {
        const chapterDuration = Math.max(1, cueStart - currentChapterStart);
        chapters.push({
          index: chapters.length,
          number: chapters.length + 1,
          title: currentChapterTitle,
          start: currentChapterStart,
          end: cueStart,
          duration: chapterDuration,
          thumbnail: defaultThumb,
          videoId: videoId,
          subChapters: []
        });

        currentChapterStart = cueStart;
        currentChapterTitle = candidateTitle;
      }

      lastCueEndTime = cueStart + (cue.duration || 2.0);
    }

    if (totalDuration > currentChapterStart) {
      chapters.push({
        index: chapters.length,
        number: chapters.length + 1,
        title: currentChapterTitle || `Chapter ${chapters.length + 1}`,
        start: currentChapterStart,
        end: totalDuration,
        duration: Math.max(1, totalDuration - currentChapterStart),
        thumbnail: defaultThumb,
        videoId: videoId,
        subChapters: []
      });
    }

    return chapters.length >= 2 ? chapters : null;
  }

  async function tryBuildSmartTranscriptChapters(totalDuration) {
    const vId = state.videoId;
    const cues = await getBestTranscriptCues();
    if (!cues || cues.length < 5) return null;

    return segmentTranscriptIntoChapters(cues, totalDuration, vId);
  }

  // --- Real AI Integration with Google Gemini API ---

  function updateAiButtonState() {
    const btn = dom.sidebarContainer?.querySelector('#yt-ch-ai-btn');
    if (btn) {
      btn.classList.toggle('is-loading', Boolean(state.isAiLoading));
      btn.title = state.isAiLoading ? 'Analyzing with Gemini AI...' : 'Generate AI Chapters (Gemini)';
      const badge = btn.querySelector('.yt-ch-ai-badge');
      if (badge) {
        badge.textContent = state.isAiLoading ? '...' : 'AI';
      }
    }
  }

  function showAiBanner(msg, type = 'info', autoHideMs = 3500) {
    let banner = document.getElementById('yt-ch-ai-banner');
    if (!banner && dom.sidebarContainer) {
      banner = document.createElement('div');
      banner.id = 'yt-ch-ai-banner';
      const header = dom.sidebarContainer.querySelector('.yt-ch-pl-header');
      if (header) {
        header.insertAdjacentElement('afterend', banner);
      }
    }
    if (!banner) return;

    banner.className = `yt-ch-ai-banner banner-${type}`;
    banner.innerHTML = `
      <span class="yt-ch-banner-text">${msg}</span>
      <button class="yt-ch-banner-close" aria-label="Dismiss">✕</button>
    `;
    banner.style.display = 'flex';
    banner.querySelector('.yt-ch-banner-close')?.addEventListener('click', () => {
      banner.style.display = 'none';
    });

    if (autoHideMs > 0) {
      setTimeout(() => {
        if (banner) banner.style.display = 'none';
      }, autoHideMs);
    }
  }

  let cachedWorkingModel = null;

  async function resolveCandidateModels(apiKey) {
    if (cachedWorkingModel) {
      return [cachedWorkingModel];
    }

    const discovered = [];
    const versions = ['v1beta', 'v1'];

    for (const ver of versions) {
      try {
        const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (resp.ok) {
          const data = await resp.json();
          if (data && Array.isArray(data.models)) {
            const suitable = data.models
              .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
              .map(m => ({
                version: ver,
                id: m.name.replace(/^models\//, '')
              }));

            if (suitable.length > 0) {
              suitable.sort((a, b) => {
                const aName = a.id.toLowerCase();
                const bName = b.id.toLowerCase();
                const aFlash = aName.includes('flash') ? 1 : 0;
                const bFlash = bName.includes('flash') ? 1 : 0;
                if (aFlash !== bFlash) return bFlash - aFlash;
                return bName.localeCompare(aName, undefined, { numeric: true });
              });

              for (const m of suitable) {
                if (!discovered.some(d => d.id === m.id && d.version === m.version)) {
                  discovered.push(m);
                }
              }
            }
          }
        } else {
          const errData = await resp.json().catch(() => ({}));
          const errMsg = errData.error?.message || '';
          if (resp.status === 400 && (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID'))) {
            throw new Error('API key not valid. Please verify your Gemini API key in Kairos Settings.');
          }
        }
      } catch (err) {
        if (err.message && err.message.includes('API key not valid')) throw err;
        console.warn(`[Kairos] ListModels ${ver} check:`, err);
      }
    }

    if (discovered.length > 0) {
      console.log('[Kairos] Discovered working Gemini models via ListModels:', discovered.map(d => `${d.version}/${d.id}`));
      return discovered;
    }

    return [
      { version: 'v1beta', id: 'gemini-2.5-flash' },
      { version: 'v1beta', id: 'gemini-2.0-flash' },
      { version: 'v1', id: 'gemini-1.5-flash' },
      { version: 'v1beta', id: 'gemini-1.5-flash-latest' },
      { version: 'v1beta', id: 'gemini-1.5-pro' },
      { version: 'v1beta', id: 'gemini-3.8-flash' },
      { version: 'v1beta', id: 'gemini-3.5-flash' },
      { version: 'v1', id: 'gemini-pro' }
    ];
  }

  async function generateAIChaptersWithGemini() {
    if (state.isAiLoading) return;
    const vId = state.videoId;
    if (!vId) return;

    if (!state.apiKey) {
      showAiBanner('🔑 Add your free Google Gemini API key in Kairos Settings (⚙ in popup) to enable AI Chapters.', 'warning', 6500);
      return;
    }

    state.isAiLoading = true;
    updateAiButtonState();
    showAiBanner('Analyzing video transcript with Gemini AI...', 'info', 0);

    try {
      const cues = await getBestTranscriptCues();
      const video = getVideoElement();
      const dur = (video && !isNaN(video.duration) && video.duration > 0) ? video.duration : state.totalDuration;
      const title = document.title.replace(/\s*-\s*YouTube$/i, '').trim();

      let nativeSummary = '';
      if (state.rawChapters && state.rawChapters.length >= 2) {
        nativeSummary = '\nExisting main chapters in video:\n' + state.rawChapters.map(c => `- [${formatTime(c.start)}] ${c.title}`).join('\n');
      }

      let cuesText = '';
      if (Array.isArray(cues) && cues.length > 0) {
        const step = cues.length > 3000 ? Math.ceil(cues.length / 2500) : 1;
        const sampled = [];
        for (let i = 0; i < cues.length; i += step) {
          sampled.push(`[${formatTime(cues[i].start)}] ${cleanTranscriptText(cues[i].text)}`);
        }
        cuesText = sampled.join('\n');
      }

      if (!cuesText && (!state.rawChapters || state.rawChapters.length === 0)) {
        showAiBanner('⚠️ No transcript or chapters available for this video.', 'error', 4000);
        state.isAiLoading = false;
        updateAiButtonState();
        return;
      }

      const prompt = `You are an expert educational video chapter editor.
Video Title: "${title}"
Total Duration: ${formatTime(dur)} (${Math.round(dur)} seconds)
${nativeSummary}

Transcript excerpts:
${cuesText ? cuesText.slice(0, 100000) : '(No transcript, use existing chapters to create sub-chapters)'}

Task:
Generate a clean, structured JSON array of chapters and sub-chapters.
Guidelines:
1. If existing main chapters are listed above, PRESERVE THEM as the main chapters, and generate 3 to 7 focused, descriptive sub-chapters for each.
2. If no existing chapters are listed, create 4 to 12 logical main chapters, each with 2 to 6 sub-chapters.
3. Sub-chapter titles MUST be short, clean, descriptive topic titles (e.g. "Binary Numbers", "Variables & Types", "Memory Allocation").
4. NEVER include numbers like "Part 1/6" or fractions in titles.
5. "start" MUST be in seconds as an integer.
6. Return ONLY a valid JSON array in this exact schema without markdown backticks:
[
  {
    "title": "Main Chapter Name",
    "start": 0,
    "subChapters": [
      { "title": "Sub Topic Name", "start": 0 },
      { "title": "Second Sub Topic", "start": 340 }
    ]
  }
]`;

      const candidates = await resolveCandidateModels(state.apiKey);
      let res = null;
      let lastErrMsg = '';

      for (let mIdx = 0; mIdx < candidates.length; mIdx++) {
        const modelObj = candidates[mIdx];
        try {
          const endpoint = `https://generativelanguage.googleapis.com/${modelObj.version}/models/${modelObj.id}:generateContent?key=${encodeURIComponent(state.apiKey)}`;
          const candidateRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': state.apiKey
            },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: prompt }]
                }
              ],
              generationConfig: {
                temperature: 0.2
              }
            })
          });

          if (candidateRes.ok) {
            res = candidateRes;
            cachedWorkingModel = modelObj;
            break;
          } else {
            const errData = await candidateRes.json().catch(() => ({}));
            lastErrMsg = errData.error?.message || `HTTP ${candidateRes.status}`;
            console.warn(`[Kairos] Candidate model ${modelObj.id} (${modelObj.version}) failed:`, lastErrMsg);

            const match = lastErrMsg.match(/models\/(gemini-[\w\.-]+)/);
            if (match && match[1] && !candidates.some(c => c.id === match[1])) {
              candidates.push({ version: modelObj.version, id: match[1] });
            }
          }
        } catch (fetchErr) {
          lastErrMsg = fetchErr.message;
        }
      }

      if (!res) {
        throw new Error(lastErrMsg || 'Gemini API request failed');
      }

      const resData = await res.json();
      let rawJson = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) throw new Error('Empty response from Gemini');

      rawJson = rawJson.trim();
      if (rawJson.startsWith('```')) {
        rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      const arrayMatch = rawJson.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        rawJson = arrayMatch[0];
      }

      const parsed = JSON.parse(rawJson);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid JSON structure');

      const defaultThumb = `https://i.ytimg.com/vi/${vId}/mqdefault.jpg`;
      const aiProcessed = [];

      function toSec(val) {
        if (typeof val === 'number') return Math.max(0, Math.round(val));
        if (typeof val === 'string') {
          if (/^\d+$/.test(val.trim())) return parseInt(val.trim(), 10);
          return parseTimestampToSeconds(val);
        }
        return 0;
      }

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const nextStart = (i < parsed.length - 1) ? toSec(parsed[i + 1].start) : dur;
        const pStart = toSec(item.start);
        const pEnd = Math.max(pStart + 1, nextStart);

        const rawSubs = Array.isArray(item.subChapters) ? item.subChapters :
                        (Array.isArray(item.sub_chapters) ? item.sub_chapters :
                        (Array.isArray(item.subtopics) ? item.subtopics :
                        (Array.isArray(item.topics) ? item.topics : [])));

        const subList = [];
        if (rawSubs.length > 0) {
          const cands = [];
          for (let s = 0; s < rawSubs.length; s++) {
            const sub = rawSubs[s];
            const sStart = toSec(sub.start);
            const title = (sub.title || sub.name || '').replace(/^[\d\s.\-–—:]+/, '').trim() || `Topic ${s + 1}`;
            if (sStart < pStart || sStart >= pEnd - 60) continue;
            cands.push({ title, start: sStart });
          }

          cands.sort((a, b) => a.start - b.start);

          const filtered = [];
          for (const cand of cands) {
            if (filtered.length === 0 || (cand.start - filtered[filtered.length - 1].start) >= 60) {
              filtered.push(cand);
            }
          }

          if (filtered.length > 0) {
            filtered[0].start = pStart;
            for (let s = 0; s < filtered.length; s++) {
              const sNext = (s < filtered.length - 1) ? filtered[s + 1].start : pEnd;
              const sEnd = Math.max(filtered[s].start + 1, sNext);
              subList.push({
                title: filtered[s].title,
                start: filtered[s].start,
                end: sEnd,
                duration: sEnd - filtered[s].start
              });
            }

            if (subList.length >= 2 && subList[subList.length - 1].duration < 60) {
              subList.pop();
              subList[subList.length - 1].end = pEnd;
              subList[subList.length - 1].duration = pEnd - subList[subList.length - 1].start;
            }
          }
        }

        aiProcessed.push({
          index: i,
          number: i + 1,
          title: (item.title || item.name || '').replace(/^[\d\s.\-–—:]+/, '').trim() || `Chapter ${i + 1}`,
          start: pStart,
          end: pEnd,
          duration: pEnd - pStart,
          thumbnail: defaultThumb,
          videoId: vId,
          subChapters: subList
        });
      }

      if (storage) {
        storage.set({ [`ai_chapters_${vId}`]: aiProcessed });
      }

      state.chapters = aiProcessed;
      state.isSmartTranscript = true;
      state.isAutoSplit = false;
      state.expandedGroups.clear();
      state.expandedGroups.add(Math.max(0, state.currentChapterIndex));
      if (state.chapters.length > 1) state.expandedGroups.add(0);

      dom.playlistCard = null; // Force DOM re-render with sub-chapters
      applyChaptersToUI();
      showAiBanner('AI Chapters & Sub-chapters successfully generated!', 'success', 3500);

    } catch (err) {
      console.error('[Kairos] Gemini AI Error:', err);
      showAiBanner(`⚠️ AI Error: ${err.message || 'Failed to generate'}`, 'error', 5500);
    } finally {
      state.isAiLoading = false;
      updateAiButtonState();
    }
  }

  function applyChaptersToUI() {
    state.hasPromptedForEnd = false;
    if (state.chapters.length > 0) {
      initPlayerControls();
      initSeekBar();
      mountSidebarPlaylist();
      applyModeState();
      updatePlaylistActiveItem();
    } else {
      removeCustomUI();
    }
  }

  function normalizeChapters(rawList, duration) {
    const v = getVideoElement();
    const totalDur = duration || (v && !isNaN(v.duration) && v.duration > 0 ? v.duration : state.totalDuration) || 0;
    const vId = state.videoId;
    const defaultThumb = vId ? `https://i.ytimg.com/vi/${vId}/mqdefault.jpg` : '';

    if (!Array.isArray(rawList) || rawList.length === 0) {
      return [];
    }

    state.isAutoSplit = false;
    state.isSmartTranscript = false;
    const sorted = [...rawList].sort((a, b) => a.start - b.start);
    const unique = [];

    for (const item of sorted) {
      if (unique.length === 0 || Math.abs(unique[unique.length - 1].start - item.start) > 1) {
        unique.push({
          title: (item.title || '').trim().replace(/^[\d\s.\-–—:]+/, '') || `Chapter ${unique.length + 1}`,
          start: Math.max(0, item.start),
          thumbnail: item.thumbnail || defaultThumb
        });
      }
    }

    return unique.map((c, i) => {
      const nextStart = (i < unique.length - 1) ? unique[i + 1].start : totalDur;
      const chDuration = Math.max(1, nextStart - c.start);
      return {
        index: i,
        number: i + 1,
        title: c.title,
        start: c.start,
        end: nextStart,
        duration: chDuration,
        thumbnail: c.thumbnail,
        videoId: vId,
        subChapters: []
      };
    });
  }

  async function updateChapters(rawList, duration) {
    let list = rawList;
    if (!list || list.length === 0) {
      list = scrapeChaptersFromDescription();
    }
    if (Array.isArray(list) && list.length > 0) {
      state.rawChapters = list;
    }

    const video = getVideoElement();
    const dur = duration || (video && !isNaN(video.duration) ? video.duration : 0);
    if (dur > 0) state.totalDuration = dur;

    const maxSec = Math.max(300, (state.splitIntervalMinutes || 20) * 60);
    const vId = state.videoId;

    // Check if AI chapters are cached for this video
    if (storage && vId) {
      try {
        const cachedKey = `ai_chapters_${vId}`;
        const cached = await new Promise(resolve => storage.get([cachedKey], resolve));
        if (cached && Array.isArray(cached[cachedKey]) && cached[cachedKey].length >= 2) {
          state.chapters = cached[cachedKey];
          state.isSmartTranscript = true;
          state.isAutoSplit = false;
          applyChaptersToUI();
          return;
        }
      } catch (e) { }
    }

    // Level 1 & 2: Native or Description Chapters exist
    if (Array.isArray(list) && list.length > 0) {
      const normalized = normalizeChapters(list, dur);
      state.isAutoSplit = false;
      state.isSmartTranscript = false;
      state.chapters = normalized;
      applyChaptersToUI();

      // Decompose long main chapters (> 10 min) into hierarchical sub-chapters (if enabled)
      const longThreshold = 600;
      if (state.enableSubChapters && normalized.some(ch => (ch.end - ch.start) > longThreshold)) {
        try {
          const decomposed = await decomposeLongChaptersWithTranscript(normalized, longThreshold);
          if (decomposed && decomposed.length > 0 && (!state.videoId || state.videoId === decomposed[0]?.videoId)) {
            state.chapters = decomposed;
            state.expandedGroups.add(Math.max(0, state.currentChapterIndex));
            dom.playlistCard = null; // Force DOM re-render with sub-chapters
            applyChaptersToUI();
          }
        } catch (err) {
          console.warn('[Kairos] Long chapter decomposition error:', err);
        }
      }
      return;
    }

    // Level 3 & 4: Video has NO chapters, but is long (dur >= 180s)
    // Only auto-split if user enabled autoSplitLongVideos
    if (state.autoSplitLongVideos && dur >= 180) {
      state.isAutoSplit = true;
      state.isSmartTranscript = false;
      state.chapters = generateAutoSplitChapters(dur);
      applyChaptersToUI();

      try {
        const smartChapters = await tryBuildSmartTranscriptChapters(dur);
        if (smartChapters && smartChapters.length >= 2 && (!state.videoId || state.videoId === smartChapters[0]?.videoId)) {
          state.isAutoSplit = false;
          state.isSmartTranscript = true;
          state.chapters = smartChapters;
          applyChaptersToUI();
          return;
        }
      } catch (err) {
        console.warn('[Kairos] Smart chaptering fallback:', err);
      }
      return;
    }

    state.isAutoSplit = false;
    state.isSmartTranscript = false;
    state.chapters = [];
    removeCustomUI();
  }

  function getCurrentChapter(currentTime) {
    if (state.chapters.length === 0) return null;
    let parent = null;
    let parentIdx = 0;

    for (let i = 0; i < state.chapters.length; i++) {
      const ch = state.chapters[i];
      if (currentTime >= ch.start && currentTime < ch.end) {
        parent = ch;
        parentIdx = i;
        break;
      }
    }
    if (!parent) {
      if (currentTime >= state.chapters[state.chapters.length - 1].start) {
        parent = state.chapters[state.chapters.length - 1];
        parentIdx = state.chapters.length - 1;
      } else {
        parent = state.chapters[0];
        parentIdx = 0;
      }
    }

    state.currentChapterIndex = parentIdx;

    // Check if parent has sub-chapters (only if enabled)
    if (state.enableSubChapters && Array.isArray(parent.subChapters) && parent.subChapters.length > 0) {
      let activeSub = null;
      let activeSubIdx = 0;
      for (let s = 0; s < parent.subChapters.length; s++) {
        const sub = parent.subChapters[s];
        if (currentTime >= sub.start && currentTime < sub.end) {
          activeSub = sub;
          activeSubIdx = s;
          break;
        }
      }
      if (!activeSub && currentTime >= parent.subChapters[parent.subChapters.length - 1].start) {
        activeSub = parent.subChapters[parent.subChapters.length - 1];
        activeSubIdx = parent.subChapters.length - 1;
      }

      state.currentSubIndex = activeSubIdx;

      if (activeSub) {
        return {
          ...activeSub,
          parentIndex: parentIdx,
          parentTitle: parent.title,
          parentNumber: parent.number,
          thumbnail: parent.thumbnail,
          displayTitle: `${parent.title} • ${activeSub.title}`,
          isSub: true
        };
      }
    }

    state.currentSubIndex = -1;
    return parent;
  }

  function seekToTime(timeSec) {
    const video = getVideoElement();
    if (video) video.currentTime = timeSec;
    window.postMessage({ source: 'YT_CHAPTER_EXT', type: 'SEEK_TO', time: timeSec }, '*');
  }

  function playVideo() {
    const video = getVideoElement();
    if (video) video.play();
    window.postMessage({ source: 'YT_CHAPTER_EXT', type: 'PLAY' }, '*');
  }

  function pauseVideo() {
    const video = getVideoElement();
    if (video) video.pause();
    window.postMessage({ source: 'YT_CHAPTER_EXT', type: 'PAUSE' }, '*');
  }

  function applyModeState() {
    const player = getPlayerElement();
    if (!player) return;

    // Purge any legacy badges
    document.querySelectorAll('.yt-chapter-header-badge').forEach(e => e.remove());

    const isModeActive = state.enabled && state.chapters.length > 0;

    if (isModeActive) {
      player.classList.add('yt-chapter-isolated-active');
      document.body.classList.add('yt-chapter-isolated-active');
    } else {
      player.classList.remove('yt-chapter-isolated-active');
      document.body.classList.remove('yt-chapter-isolated-active');
      hideEndModal();
    }

    if (dom.timeContainer) {
      dom.timeContainer.style.setProperty('display', isModeActive ? 'inline-flex' : 'none', 'important');
    }
    if (dom.seekbar) {
      dom.seekbar.style.display = isModeActive ? 'block' : 'none';
    }
    if (dom.sidebarContainer) {
      dom.sidebarContainer.style.display = (isModeActive && state.showPlaylist) ? 'block' : 'none';
    }
    if (dom.toggleBtn) {
      dom.toggleBtn.classList.toggle('active', state.enabled);
      dom.toggleBtn.title = state.enabled ? 'Chapter Mode: ON (Shift+C)' : 'Chapter Mode: OFF (Shift+C)';
    }
  }

  // --- UI Components ---

  function initPlayerControls() {
    const timeDisplay = document.querySelector('.ytp-time-display');
    const rightControls = document.querySelector('.ytp-right-controls') || document.querySelector('.ytp-left-controls');

    if (timeDisplay && (!dom.timeContainer || !dom.timeContainer.isConnected)) {
      dom.timeContainer = document.createElement('span');
      dom.timeContainer.className = 'yt-ch-time-span';
      dom.timeContainer.style.display = (state.enabled && state.chapters.length > 0) ? 'inline-flex' : 'none';
      dom.timeContainer.innerHTML = `
        <span class="yt-ch-time-cur">0:00</span>
        <span class="yt-ch-time-sep"> / </span>
        <span class="yt-ch-time-dur">0:00</span>
        <span class="yt-ch-time-tag"></span>
      `;
      timeDisplay.appendChild(dom.timeContainer);
      dom.curSpan = dom.timeContainer.querySelector('.yt-ch-time-cur');
      dom.durSpan = dom.timeContainer.querySelector('.yt-ch-time-dur');
      dom.tagSpan = dom.timeContainer.querySelector('.yt-ch-time-tag');
    }

    if (rightControls && (!dom.toggleBtn || !dom.toggleBtn.isConnected)) {
      dom.toggleBtn = document.createElement('button');
      dom.toggleBtn.className = 'ytp-button yt-chapter-toggle-btn active';
      dom.toggleBtn.title = 'Chapter Mode (Shift+C)';
      dom.toggleBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="yt-chapter-svg" width="100%" height="100%">
          <path class="yt-ch-svg-path" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-3 5-3v6zm7-1H5V5h14v11z"/>
        </svg>
      `;
      dom.toggleBtn.addEventListener('click', () => {
        state.enabled = !state.enabled;
        saveSetting('enabled', state.enabled);
        applyModeState();
      });
      rightControls.insertBefore(dom.toggleBtn, rightControls.firstChild);
    }
  }

  function initSeekBar() {
    const progressBarContainer = document.querySelector('.ytp-progress-bar-container');
    if (!progressBarContainer || (dom.seekbar && dom.seekbar.isConnected)) return;

    dom.seekbar = document.createElement('div');
    dom.seekbar.className = 'yt-chapter-seekbar';
    dom.seekbar.innerHTML = `
      <div class="yt-chapter-seekbar-bg">
        <div class="yt-chapter-seekbar-buffer"></div>
        <div class="yt-chapter-seekbar-play"></div>
        <div class="yt-chapter-seekbar-scrubber"></div>
      </div>
      <div class="yt-chapter-hover-indicator"></div>
      <div class="yt-chapter-hover-tooltip">0:00</div>
    `;

    const bg = dom.seekbar.querySelector('.yt-chapter-seekbar-bg');
    dom.playBar = dom.seekbar.querySelector('.yt-chapter-seekbar-play');
    dom.scrubber = dom.seekbar.querySelector('.yt-chapter-seekbar-scrubber');
    dom.bufferBar = dom.seekbar.querySelector('.yt-chapter-seekbar-buffer');

    const hoverIndicator = dom.seekbar.querySelector('.yt-chapter-hover-indicator');
    const tooltip = dom.seekbar.querySelector('.yt-chapter-hover-tooltip');

    function updateHover(e) {
      const rect = bg.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const video = getVideoElement();
      if (!video) return;

      const currentCh = getCurrentChapter(video.currentTime);
      if (!currentCh) return;

      tooltip.textContent = formatTime(p * currentCh.duration);
      tooltip.style.left = `${p * 100}%`;
      hoverIndicator.style.left = `${p * 100}%`;
      hoverIndicator.style.display = 'block';
      tooltip.style.display = 'block';
    }

    function doSeek(e) {
      const rect = bg.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const video = getVideoElement();
      if (!video) return;

      const currentCh = getCurrentChapter(video.currentTime);
      if (!currentCh) return;

      state.hasPromptedForEnd = false;
      seekToTime(currentCh.start + (p * currentCh.duration));
    }

    dom.seekbar.addEventListener('mousemove', (e) => {
      updateHover(e);
      if (state.isDraggingSeek) doSeek(e);
    });

    dom.seekbar.addEventListener('mouseleave', () => {
      if (!state.isDraggingSeek) {
        hoverIndicator.style.display = 'none';
        tooltip.style.display = 'none';
      }
    });

    dom.seekbar.addEventListener('mousedown', (e) => {
      state.isDraggingSeek = true;
      doSeek(e);
      const onMouseUp = () => {
        state.isDraggingSeek = false;
        hoverIndicator.style.display = 'none';
        tooltip.style.display = 'none';
        window.removeEventListener('mouseup', onMouseUp);
      };
      window.addEventListener('mouseup', onMouseUp);
    });

    progressBarContainer.appendChild(dom.seekbar);
  }

  function getNextPlayableChapter(currentCh) {
    if (!currentCh) return null;
    if (currentCh.isSub) {
      const parent = state.chapters[currentCh.parentIndex];
      if (parent && Array.isArray(parent.subChapters)) {
        const nextSub = parent.subChapters[state.currentSubIndex + 1];
        if (nextSub) {
          return {
            ...nextSub,
            thumbnail: parent.thumbnail,
            parentIndex: currentCh.parentIndex,
            parentTitle: parent.title,
            displayTitle: `${parent.title} • ${nextSub.title}`,
            isSub: true,
            number: state.currentSubIndex + 2
          };
        }
      }
      const nextParent = state.chapters[currentCh.parentIndex + 1];
      if (nextParent) {
        if (Array.isArray(nextParent.subChapters) && nextParent.subChapters.length > 0) {
          return {
            ...nextParent.subChapters[0],
            thumbnail: nextParent.thumbnail,
            parentIndex: currentCh.parentIndex + 1,
            parentTitle: nextParent.title,
            displayTitle: `${nextParent.title} • ${nextParent.subChapters[0].title}`,
            isSub: true,
            number: 1
          };
        }
        return nextParent;
      }
      return null;
    }
    return (currentCh.index < state.chapters.length - 1) ? state.chapters[currentCh.index + 1] : null;
  }

  function getPrevPlayableChapter(currentCh) {
    if (!currentCh) return null;
    if (currentCh.isSub) {
      const parent = state.chapters[currentCh.parentIndex];
      if (parent && Array.isArray(parent.subChapters) && state.currentSubIndex > 0) {
        const prevSub = parent.subChapters[state.currentSubIndex - 1];
        if (prevSub) {
          return {
            ...prevSub,
            thumbnail: parent.thumbnail,
            parentIndex: currentCh.parentIndex,
            parentTitle: parent.title,
            displayTitle: `${parent.title} • ${prevSub.title}`,
            isSub: true,
            number: state.currentSubIndex
          };
        }
      }
      const prevParent = state.chapters[currentCh.parentIndex - 1];
      if (prevParent) {
        if (Array.isArray(prevParent.subChapters) && prevParent.subChapters.length > 0) {
          const lastSub = prevParent.subChapters[prevParent.subChapters.length - 1];
          return {
            ...lastSub,
            thumbnail: prevParent.thumbnail,
            parentIndex: currentCh.parentIndex - 1,
            parentTitle: prevParent.title,
            displayTitle: `${prevParent.title} • ${lastSub.title}`,
            isSub: true,
            number: prevParent.subChapters.length
          };
        }
        return prevParent;
      }
      return null;
    }
    return (currentCh.index > 0) ? state.chapters[currentCh.index - 1] : null;
  }

  function showEndModal(currentCh, nextCh) {
    let modal = document.querySelector('.yt-chapter-end-modal');
    const player = getPlayerElement();
    if (!player) return;

    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'yt-chapter-end-modal';
      player.appendChild(modal);
    }

    const hasNext = Boolean(nextCh);
    const modalChTitle = currentCh.displayTitle || `${currentCh.number ? currentCh.number + '. ' : ''}${currentCh.title}`;
    const nextChTitle = nextCh ? (nextCh.displayTitle || nextCh.title) : '';

    modal.innerHTML = `
      <div class="yt-ch-modal-card">
        <h3 class="yt-ch-modal-title">Chapter Complete</h3>
        <p class="yt-ch-modal-sub">${modalChTitle}</p>

        ${hasNext ? `
          <div class="yt-ch-next-box">
            <div class="yt-ch-next-thumb-wrap">
              <img class="yt-ch-next-thumb" src="${nextCh.thumbnail}" alt="" />
              <span class="yt-ch-thumb-dur">${formatTime(nextCh.duration)}</span>
            </div>
            <div class="yt-ch-next-info">
              <span class="yt-ch-next-label">Up Next</span>
              <div class="yt-ch-next-title">${nextChTitle}</div>
            </div>
          </div>
        ` : `
          <div class="yt-ch-finished-box">🎉 All chapters completed!</div>
        `}

        ${(hasNext && state.autoAdvanceSeconds > 0) ? `
          <div class="yt-ch-modal-countdown" id="yt-ch-countdown-wrap">
            Autoplay next chapter in <span id="yt-ch-timer-sec">${state.autoAdvanceSeconds}</span>s...
          </div>
        ` : ''}

        <div class="yt-ch-modal-actions">
          ${hasNext ? `<button class="yt-ch-btn yt-ch-btn-primary" id="yt-ch-btn-next">Play Next ▶</button>` : ''}
          <button class="yt-ch-btn yt-ch-btn-secondary" id="yt-ch-btn-replay">Replay ↺</button>
        </div>
        <button class="yt-ch-btn-text" id="yt-ch-btn-resume">Continue full video</button>
      </div>
    `;

    modal.style.display = 'flex';

    modal.querySelector('#yt-ch-btn-next')?.addEventListener('click', () => {
      clearCountdown();
      hideEndModal();
      seekToTime(nextCh.start);
      playVideo();
    });

    modal.querySelector('#yt-ch-btn-replay')?.addEventListener('click', () => {
      clearCountdown();
      hideEndModal();
      seekToTime(currentCh.start);
      playVideo();
    });

    modal.querySelector('#yt-ch-btn-resume')?.addEventListener('click', () => {
      clearCountdown();
      hideEndModal();
      playVideo();
    });

    if (hasNext && state.autoAdvanceSeconds > 0) {
      startCountdown(nextCh);
    }
  }

  function startCountdown(nextCh) {
    const timerSec = document.getElementById('yt-ch-timer-sec');
    let remaining = state.autoAdvanceSeconds;
    if (state.countdownTimer) clearInterval(state.countdownTimer);

    state.countdownTimer = setInterval(() => {
      remaining--;
      if (timerSec) timerSec.textContent = remaining;
      if (remaining <= 0) {
        clearCountdown();
        hideEndModal();
        seekToTime(nextCh.start);
        playVideo();
      }
    }, 1000);
  }

  function clearCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  function hideEndModal() {
    clearCountdown();
    const modal = document.querySelector('.yt-chapter-end-modal');
    if (modal) modal.style.display = 'none';
  }

  // Fast Unhook-Resilient Sidebar Placement
  function mountSidebarPlaylist() {
    if (state.chapters.length === 0) return;

    if (!dom.sidebarContainer || !dom.sidebarContainer.isConnected) {
      dom.sidebarContainer = document.getElementById('yt-chapter-sidebar-container') || document.createElement('div');
      dom.sidebarContainer.id = 'yt-chapter-sidebar-container';
    }

    const secondary = document.getElementById('secondary');
    const secondaryInner = document.getElementById('secondary-inner');
    const columns = document.getElementById('columns');
    const primary = document.getElementById('primary');

    // Fast check if secondary is hidden (e.g. Unhook) without triggering layout reflow
    const isSecHidden = !secondary || secondary.offsetWidth === 0 || secondary.style.display === 'none';

    if (isSecHidden && columns && primary) {
      if (dom.sidebarContainer.parentElement !== columns) {
        columns.insertBefore(dom.sidebarContainer, secondary || primary.nextSibling);
      }
      dom.sidebarContainer.className = 'yt-chapter-sidebar-container unhook-mode';
      document.body.classList.add('yt-chapter-unhook-layout');
    } else {
      const target = secondaryInner || secondary;
      if (target && dom.sidebarContainer.parentElement !== target) {
        target.insertBefore(dom.sidebarContainer, target.firstChild);
      }
      dom.sidebarContainer.className = 'yt-chapter-sidebar-container';
      document.body.classList.remove('yt-chapter-unhook-layout');
    }

    dom.sidebarContainer.classList.toggle('is-floating', state.isFloating);
    dom.sidebarContainer.style.display = (state.enabled && state.showPlaylist && state.chapters.length > 0) ? 'block' : 'none';

    const totalSubs = state.chapters.reduce((sum, ch) => sum + (Array.isArray(ch.subChapters) ? ch.subChapters.length : 0), 0);
    const cardRenderKey = `${state.videoId}_${state.chapters.length}_${totalSubs}_${state.isSmartTranscript ? 1 : 0}`;

    // Check if card is already built for current video, chapter count, and sub-chapters
    if (dom.playlistCard &&
      dom.playlistCard.isConnected &&
      dom.playlistCard.getAttribute('data-render-key') === cardRenderKey) {
      updatePlaylistActiveItem();
      return;
    }

    const headerTitle = 'Chapters';
    const subBadge = state.isSmartTranscript ? `${state.chapters.length} chapters (AI)` : `${state.chapters.length} chapters`;

    dom.sidebarContainer.innerHTML = `
      <div class="yt-chapter-playlist-card ${state.isCollapsed ? 'is-collapsed' : ''}" data-video-id="${state.videoId}" data-count="${state.chapters.length}" data-render-key="${cardRenderKey}">
        <div class="yt-ch-pl-header" id="yt-ch-header-toggle">
          <div class="yt-ch-pl-header-top">
            <div class="yt-ch-pl-title-wrap">
              <span class="yt-ch-pl-icon">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
              </span>
              <div class="yt-ch-pl-titles">
                <h3 class="yt-ch-pl-main-title">${headerTitle}</h3>
                <span class="yt-ch-pl-sub">${subBadge}</span>
              </div>
            </div>
            <div class="yt-ch-pl-actions">
              <span class="yt-ch-pl-counter" id="yt-ch-pl-status">1 / ${state.chapters.length}</span>
              <button class="yt-ch-pl-action-btn yt-ch-ai-btn" id="yt-ch-ai-btn" title="Generate AI Chapters (Gemini)" aria-label="AI Chapters">
                <span class="yt-ch-ai-badge">AI</span>
              </button>
              <button class="yt-ch-pl-action-btn" id="yt-ch-float-btn" title="Toggle Float / Dock" aria-label="Float window">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
              </button>
              <button class="yt-ch-pl-action-btn yt-ch-pl-toggle-btn" id="yt-ch-collapse-btn" title="Collapse / Expand" aria-label="Toggle Chapters">
                <svg viewBox="0 0 24 24" class="yt-ch-arrow-icon" width="20" height="20">
                  <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="yt-ch-course-progress-bar">
            <div class="yt-ch-course-progress-fill" id="yt-ch-course-fill" style="width: 0%;"></div>
          </div>
        </div>

        <div class="yt-ch-pl-list" id="yt-ch-list-container">
          ${state.chapters.map((ch, idx) => {
            const hasSubs = state.enableSubChapters && Array.isArray(ch.subChapters) && ch.subChapters.length > 0;
            const isExpanded = state.expandedGroups.has(idx);
            return `
              <div class="yt-ch-group ${hasSubs ? 'has-subchapters' : ''} ${isExpanded ? 'is-expanded' : ''}" data-group-index="${idx}">
                <div class="yt-ch-pl-item yt-ch-parent-item" data-index="${idx}" data-start="${ch.start}">
                  <div class="yt-ch-thumb-box">
                    <img class="yt-ch-item-thumb" src="${ch.thumbnail}" loading="lazy" alt="" />
                    <span class="yt-ch-thumb-dur">${formatTime(ch.duration)}</span>
                    <div class="yt-ch-thumb-badge" id="yt-ch-badge-${idx}">
                      <span class="yt-ch-icon-play">▶</span>
                      <span class="yt-ch-icon-check">✓</span>
                    </div>
                  </div>
                  <div class="yt-ch-item-content">
                    <span class="yt-ch-item-num">Chapter ${ch.number}</span>
                    <span class="yt-ch-item-title" title="${ch.title}">${ch.title}</span>
                  </div>
                  ${hasSubs ? `
                    <button class="yt-ch-expand-btn" data-toggle="${idx}" title="Toggle sub-chapters">
                      <span class="yt-ch-sub-badge">${ch.subChapters.length} topics</span>
                      <svg class="yt-ch-chevron" viewBox="0 0 24 24" width="14" height="14">
                        <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                      </svg>
                    </button>
                  ` : ''}
                </div>

                ${hasSubs ? `
                  <div class="yt-ch-sub-list ${isExpanded ? 'is-visible' : ''}" id="yt-ch-sub-list-${idx}">
                    ${ch.subChapters.map((sub, sIdx) => `
                      <div class="yt-ch-sub-item" data-parent="${idx}" data-sub="${sIdx}" data-start="${sub.start}" title="${sub.title}">
                        <div class="yt-ch-sub-indicator">
                          <span class="yt-ch-sub-dot"></span>
                        </div>
                        <div class="yt-ch-sub-content">
                          <span class="yt-ch-sub-title">${sub.title}</span>
                          <span class="yt-ch-sub-dur">${formatTime(sub.duration)}</span>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    dom.playlistCard = dom.sidebarContainer.querySelector('.yt-chapter-playlist-card');
    dom.statusText = dom.sidebarContainer.querySelector('#yt-ch-pl-status');
    dom.courseFill = dom.sidebarContainer.querySelector('#yt-ch-course-fill');
    dom.itemsList = dom.sidebarContainer.querySelector('#yt-ch-list-container');

    const headerToggle = dom.sidebarContainer.querySelector('#yt-ch-header-toggle');
    const collapseBtn = dom.sidebarContainer.querySelector('#yt-ch-collapse-btn');
    const floatBtn = dom.sidebarContainer.querySelector('#yt-ch-float-btn');
    const aiBtn = dom.sidebarContainer.querySelector('#yt-ch-ai-btn');

    function toggleCollapse() {
      state.isCollapsed = !state.isCollapsed;
      if (dom.playlistCard) dom.playlistCard.classList.toggle('is-collapsed', state.isCollapsed);
    }

    if (headerToggle) headerToggle.onclick = toggleCollapse;
    if (collapseBtn) collapseBtn.onclick = (e) => { e.stopPropagation(); toggleCollapse(); };

    if (floatBtn) {
      floatBtn.onclick = (e) => {
        e.stopPropagation();
        state.isFloating = !state.isFloating;
        saveSetting('isFloating', state.isFloating);
        if (dom.sidebarContainer) dom.sidebarContainer.classList.toggle('is-floating', state.isFloating);
      };
    }

    if (aiBtn) {
      aiBtn.onclick = (e) => {
        e.stopPropagation();
        generateAIChaptersWithGemini();
      };
    }

    // Expand / Collapse sub-chapters
    dom.sidebarContainer.querySelectorAll('.yt-ch-expand-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const gIdx = parseInt(btn.getAttribute('data-toggle'), 10);
        if (state.expandedGroups.has(gIdx)) {
          state.expandedGroups.delete(gIdx);
        } else {
          state.expandedGroups.add(gIdx);
        }
        const groupEl = dom.sidebarContainer.querySelector(`.yt-ch-group[data-group-index="${gIdx}"]`);
        const subListEl = dom.sidebarContainer.querySelector(`#yt-ch-sub-list-${gIdx}`);
        if (groupEl) groupEl.classList.toggle('is-expanded', state.expandedGroups.has(gIdx));
        if (subListEl) subListEl.classList.toggle('is-visible', state.expandedGroups.has(gIdx));
      };
    });

    // Parent chapter click
    dom.sidebarContainer.querySelectorAll('.yt-ch-parent-item').forEach(item => {
      item.onclick = () => {
        const start = parseFloat(item.getAttribute('data-start'));
        const idx = parseInt(item.getAttribute('data-index'), 10);
        hideEndModal();
        state.hasPromptedForEnd = false;
        seekToTime(start);
        playVideo();

        // Auto-expand this chapter's sub-chapters dropdown
        if (!isNaN(idx)) {
          state.expandedGroups.add(idx);
          const groupEl = dom.sidebarContainer.querySelector(`.yt-ch-group[data-group-index="${idx}"]`);
          const subListEl = dom.sidebarContainer.querySelector(`#yt-ch-sub-list-${idx}`);
          if (groupEl) groupEl.classList.add('is-expanded');
          if (subListEl) subListEl.classList.add('is-visible');
        }
      };
    });

    // Sub-chapter click
    dom.sidebarContainer.querySelectorAll('.yt-ch-sub-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const start = parseFloat(item.getAttribute('data-start'));
        hideEndModal();
        state.hasPromptedForEnd = false;
        seekToTime(start);
        playVideo();
      };
    });

    updatePlaylistActiveItem();
  }

  function updatePlaylistActiveItem() {
    if (!dom.sidebarContainer) return;

    const video = getVideoElement();
    if (video && !isNaN(video.currentTime) && state.chapters.length > 0) {
      getCurrentChapter(video.currentTime);
    }

    if (dom.statusText && state.currentChapterIndex >= 0) {
      dom.statusText.textContent = `${state.currentChapterIndex + 1} / ${state.chapters.length}`;
    }

    if (dom.courseFill && state.chapters.length > 0) {
      const pct = Math.round((state.completedIndices.size / state.chapters.length) * 100);
      dom.courseFill.style.width = `${pct}%`;
    }

    dom.sidebarContainer.querySelectorAll('.yt-ch-group').forEach(grp => {
      const gIdx = parseInt(grp.getAttribute('data-group-index'), 10);
      const isCurrentParent = (gIdx === state.currentChapterIndex);
      grp.classList.toggle('is-current-group', isCurrentParent);

      const parentItem = grp.querySelector('.yt-ch-parent-item');
      if (parentItem) {
        parentItem.classList.toggle('active', isCurrentParent);
      }

      const badge = grp.querySelector(`#yt-ch-badge-${gIdx}`);
      if (badge) {
        const isDone = state.completedIndices.has(gIdx);
        badge.classList.toggle('completed', isDone);
        badge.classList.toggle('playing', isCurrentParent);
      }

      // Auto-expand active group if it has sub-chapters
      if (isCurrentParent && grp.classList.contains('has-subchapters') && !state.expandedGroups.has(gIdx)) {
        state.expandedGroups.add(gIdx);
        grp.classList.add('is-expanded');
        const subList = grp.querySelector('.yt-ch-sub-list');
        if (subList) subList.classList.add('is-visible');
      }

      // Update sub-item active states
      grp.querySelectorAll('.yt-ch-sub-item').forEach(subItem => {
        const sIdx = parseInt(subItem.getAttribute('data-sub'), 10);
        const isCurrentSub = (isCurrentParent && sIdx === state.currentSubIndex);
        subItem.classList.toggle('is-active-sub', isCurrentSub);
        if (isCurrentSub && !state.isCollapsed) {
          subItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      if (isCurrentParent && state.currentSubIndex < 0 && !state.isCollapsed && parentItem) {
        parentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function removeCustomUI() {
    const player = getPlayerElement();
    if (player) player.classList.remove('yt-chapter-isolated-active');
    document.body.classList.remove('yt-chapter-isolated-active', 'yt-chapter-unhook-layout');

    document.querySelectorAll('.yt-chapter-header-badge').forEach(e => e.remove());
    dom.toggleBtn?.remove();
    dom.timeContainer?.remove();
    dom.seekbar?.remove();
    document.querySelector('.yt-chapter-end-modal')?.remove();
    dom.sidebarContainer?.remove();

    dom.toggleBtn = null;
    dom.timeContainer = null;
    dom.seekbar = null;
    dom.sidebarContainer = null;
    dom.playlistCard = null;
  }

  // --- Ultra-Lightweight Time Tick (Driven by standard HTML5 timeupdate: 0% CPU!) ---
  function onTimeTick() {
    const video = getVideoElement();
    if (!video || state.chapters.length === 0 || isAdPlaying()) return;

    const currentTime = video.currentTime;
    const prevSubIdx = state.currentSubIndex;
    const currentCh = getCurrentChapter(currentTime);
    if (!currentCh) return;

    if (state.currentChapterIndex !== currentCh.index || state.currentSubIndex !== prevSubIdx) {
      updatePlaylistActiveItem();
    }

    const chElapsed = Math.max(0, Math.min(currentTime - currentCh.start, currentCh.duration));
    const progress = Math.max(0, Math.min(1, chElapsed / currentCh.duration));

    if (progress >= 0.88 && !state.completedIndices.has(currentCh.index)) {
      state.completedIndices.add(currentCh.index);
      updatePlaylistActiveItem();
    }

    if (state.enabled) {
      const curTimeStr = formatTime(chElapsed);
      if (state.lastSecFormatted !== curTimeStr) {
        state.lastSecFormatted = curTimeStr;
        if (dom.curSpan) dom.curSpan.textContent = curTimeStr;
        if (dom.durSpan) dom.durSpan.textContent = formatTime(currentCh.duration);
        if (dom.tagSpan) {
          dom.tagSpan.textContent = currentCh.displayTitle ? `• ${currentCh.displayTitle}` : `• ${currentCh.title}`;
        }
      }

      if (dom.playBar) dom.playBar.style.transform = `scaleX(${progress})`;
      if (dom.scrubber) dom.scrubber.style.left = `${progress * 100}%`;

      if (dom.bufferBar && video.buffered.length > 0) {
        let maxBuf = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          const bStart = video.buffered.start(i);
          const bEnd = video.buffered.end(i);
          if (bEnd >= currentCh.start && bStart <= currentCh.end) {
            maxBuf = Math.max(maxBuf, Math.min(bEnd, currentCh.end) - currentCh.start);
          }
        }
        dom.bufferBar.style.transform = `scaleX(${Math.min(1, maxBuf / currentCh.duration)})`;
      }
    }

    // Auto-pause at end: ONLY FOR MAIN CHAPTER END! Never pause on internal sub-topics!
    const parentCh = state.chapters[state.currentChapterIndex];
    if (parentCh) {
      const timeUntilMainEnd = parentCh.end - currentTime;
      if (timeUntilMainEnd <= 0.35 && timeUntilMainEnd >= -0.8) {
        if (state.enabled && state.autoPauseAtEnd && !state.hasPromptedForEnd && !video.paused) {
          state.hasPromptedForEnd = true;
          state.completedIndices.add(state.currentChapterIndex);
          updatePlaylistActiveItem();
          pauseVideo();
          const nextParent = state.chapters[state.currentChapterIndex + 1] || null;
          showEndModal(parentCh, nextParent);
        }
      } else if (timeUntilMainEnd > 1.5) {
        state.hasPromptedForEnd = false;
      }
    }
  }

  // --- Keyboard Shortcuts ---
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) {
      return;
    }

    const video = getVideoElement();
    if (e.shiftKey && e.code === 'KeyC') {
      state.enabled = !state.enabled;
      saveSetting('enabled', state.enabled);
      applyModeState();
      e.preventDefault();
    } else if (e.shiftKey && e.code === 'KeyN') {
      if (state.chapters.length > 0 && video) {
        const cur = getCurrentChapter(video.currentTime);
        const next = getNextPlayableChapter(cur);
        if (next) {
          hideEndModal();
          seekToTime(next.start);
          playVideo();
          e.preventDefault();
        }
      }
    } else if (e.shiftKey && e.code === 'KeyP') {
      if (state.chapters.length > 0 && video) {
        const cur = getCurrentChapter(video.currentTime);
        const prev = getPrevPlayableChapter(cur);
        if (prev) {
          hideEndModal();
          seekToTime(prev.start);
          playVideo();
          e.preventDefault();
        }
      }
    }
  });

  // --- Message & Navigation Handling ---
  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'YT_CHAPTER_PAGE') return;

    if (event.data.type === 'CHAPTERS_DATA') {
      const { videoId, chapters, duration, captionTracks } = event.data;
      if (videoId) state.videoId = videoId;
      if (Array.isArray(captionTracks) && captionTracks.length > 0) {
        state.captionTracks = captionTracks;
      }
      updateChapters(chapters, duration);
    }
  });

  if (storage && storage.onChanged) {
    storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        if ('enabled' in changes) {
          state.enabled = changes.enabled.newValue;
          applyModeState();
        }
        if ('autoPauseAtEnd' in changes) state.autoPauseAtEnd = changes.autoPauseAtEnd.newValue;
        if ('autoAdvanceSeconds' in changes) state.autoAdvanceSeconds = changes.autoAdvanceSeconds.newValue;
        if ('showPlaylist' in changes) {
          state.showPlaylist = changes.showPlaylist.newValue;
          if (dom.sidebarContainer) dom.sidebarContainer.style.display = state.showPlaylist ? 'block' : 'none';
        }
        if ('enableSubChapters' in changes) {
          state.enableSubChapters = changes.enableSubChapters.newValue;
          dom.playlistCard = null;
          const v = getVideoElement();
          if (v) updateChapters(state.rawChapters.length > 0 ? state.rawChapters : state.chapters, v.duration);
        }
        if ('autoSplitLongVideos' in changes || 'splitIntervalMinutes' in changes) {
          if ('autoSplitLongVideos' in changes) state.autoSplitLongVideos = changes.autoSplitLongVideos.newValue;
          if ('splitIntervalMinutes' in changes) state.splitIntervalMinutes = changes.splitIntervalMinutes.newValue;
          const v = getVideoElement();
          if (v) updateChapters(state.rawChapters.length > 0 ? state.rawChapters : state.chapters, v.duration);
        }
      }
    });
  }

  function handleNavigation() {
    const vId = new URLSearchParams(window.location.search).get('v') || '';
    if (vId && vId !== state.videoId) {
      state.videoId = vId;
      state.chapters = [];
      state.completedIndices.clear();
      state.currentChapterIndex = -1;
      state.hasPromptedForEnd = false;
      removeCustomUI();

      const tryScrape = (delay) => {
        setTimeout(() => {
          if (state.chapters.length === 0 || state.isAutoSplit) {
            const descChapters = scrapeChaptersFromDescription();
            const v = getVideoElement();
            if (descChapters.length > 0) {
              updateChapters(descChapters, v?.duration || 0);
            }
          }
        }, delay);
      };

      tryScrape(150);
      tryScrape(700);
      tryScrape(1600);
      tryScrape(3200);

      window.postMessage({ source: 'YT_CHAPTER_EXT', type: 'REQUEST_CHAPTERS' }, '*');
      bindVideoEvents();
    }
  }

  function bindVideoEvents() {
    const v = getVideoElement();
    if (v && !v.hasAttribute('data-yt-chapter-bound')) {
      v.setAttribute('data-yt-chapter-bound', 'true');
      v.addEventListener('timeupdate', onTimeTick, { passive: true });
      v.addEventListener('loadedmetadata', () => {
        if (state.chapters.length === 0 || state.isAutoSplit) {
          updateChapters(state.chapters, v.duration);
        }
      }, { passive: true });
      v.addEventListener('durationchange', () => {
        if (state.chapters.length === 0 || state.isAutoSplit) {
          updateChapters(state.chapters, v.duration);
        }
      }, { passive: true });
    }
  }

  window.addEventListener('yt-navigate-finish', handleNavigation);
  window.addEventListener('popstate', handleNavigation);

  document.addEventListener('click', (e) => {
    if (e.target && (e.target.closest('#description') || e.target.closest('ytd-watch-metadata') || e.target.closest('ytd-macro-markers-list-item-renderer') || e.target.closest('#expand') || e.target.closest('tp-yt-paper-button#more'))) {
      setTimeout(() => {
        if (state.chapters.length === 0 || state.isAutoSplit) {
          const desc = scrapeChaptersFromDescription();
          const v = getVideoElement();
          if (desc.length > 0) updateChapters(desc, v?.duration || 0);
        }
      }, 250);
    }
  }, { passive: true });

  // Initialize once
  loadSettings();
  injectMainScript();
  bindVideoEvents();

  // Passive check every 2 seconds ONLY to catch video element if loaded slowly
  setInterval(bindVideoEvents, 2000);
})();
