// popup.js - Kairos Controller | Created by Zeyn
(function () {
  'use strict';

  const storage = (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local :
    (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage.local : null;

  const toggleEnabled = document.getElementById('toggle-enabled');
  const toggleAutoPause = document.getElementById('toggle-auto-pause');
  const togglePlaylist = document.getElementById('toggle-playlist');
  const toggleSubChapters = document.getElementById('toggle-sub-chapters');
  const toggleAutoSplit = document.getElementById('toggle-auto-split');
  const selectSplitMinutes = document.getElementById('select-split-minutes');
  const selectAutoAdvance = document.getElementById('select-auto-advance');

  // Modals & Buttons
  const btnSettings = document.getElementById('btn-settings');
  const btnInfo = document.getElementById('btn-info');
  const modalSettings = document.getElementById('modal-settings');
  const modalInfo = document.getElementById('modal-info');
  const closeSettings = document.getElementById('close-settings');
  const closeInfo = document.getElementById('close-info');
  const btnReset = document.getElementById('btn-reset');
  const inputApiKey = document.getElementById('input-api-key');
  const btnToggleKey = document.getElementById('btn-toggle-key');
  const btnSaveKey = document.getElementById('btn-save-key');
  const aiStatusMsg = document.getElementById('ai-status-msg');

  function loadSettings() {
    if (storage) {
      storage.get(['enabled', 'autoPauseAtEnd', 'autoAdvanceSeconds', 'showPlaylist', 'enableSubChapters', 'autoSplitLongVideos', 'splitIntervalMinutes', 'apiKey'], (res) => {
        if (res) {
          if (typeof res.enabled === 'boolean') toggleEnabled.checked = res.enabled;
          if (typeof res.autoPauseAtEnd === 'boolean') toggleAutoPause.checked = res.autoPauseAtEnd;
          if (typeof res.showPlaylist === 'boolean') togglePlaylist.checked = res.showPlaylist;
          if (toggleSubChapters) {
            toggleSubChapters.checked = (typeof res.enableSubChapters === 'boolean') ? res.enableSubChapters : true;
          }
          toggleAutoSplit.checked = Boolean(res.autoSplitLongVideos); // Default false
          if (typeof res.splitIntervalMinutes === 'number') selectSplitMinutes.value = res.splitIntervalMinutes;
          if (typeof res.autoAdvanceSeconds === 'number') selectAutoAdvance.value = res.autoAdvanceSeconds;
          if (typeof res.apiKey === 'string' && inputApiKey) {
            inputApiKey.value = res.apiKey;
            if (aiStatusMsg) {
              aiStatusMsg.textContent = res.apiKey.length > 5 ? '✓ Key active' : '';
              aiStatusMsg.style.color = '#2ecc71';
            }
          }
        }
      });
    }
  }

  loadSettings();

  // Storage bindings
  toggleEnabled.addEventListener('change', () => {
    if (storage) storage.set({ enabled: toggleEnabled.checked });
  });

  toggleAutoPause.addEventListener('change', () => {
    if (storage) storage.set({ autoPauseAtEnd: toggleAutoPause.checked });
  });

  togglePlaylist.addEventListener('change', () => {
    if (storage) storage.set({ showPlaylist: togglePlaylist.checked });
  });

  if (toggleSubChapters) {
    toggleSubChapters.addEventListener('change', () => {
      if (storage) storage.set({ enableSubChapters: toggleSubChapters.checked });
    });
  }

  toggleAutoSplit.addEventListener('change', () => {
    if (storage) storage.set({ autoSplitLongVideos: toggleAutoSplit.checked });
  });

  selectSplitMinutes.addEventListener('change', () => {
    const val = parseInt(selectSplitMinutes.value, 10) || 20;
    if (storage) storage.set({ splitIntervalMinutes: val });
  });

  selectAutoAdvance.addEventListener('change', () => {
    const val = parseInt(selectAutoAdvance.value, 10) || 0;
    if (storage) storage.set({ autoAdvanceSeconds: val });
  });

  if (btnSaveKey && inputApiKey) {
    btnSaveKey.addEventListener('click', () => {
      const keyVal = inputApiKey.value.trim();
      if (storage) {
        storage.set({ apiKey: keyVal }, () => {
          if (aiStatusMsg) {
            aiStatusMsg.textContent = keyVal ? '✓ Saved!' : 'Cleared';
            aiStatusMsg.style.color = keyVal ? '#2ecc71' : 'rgba(255,255,255,0.4)';
            setTimeout(() => {
              if (aiStatusMsg && keyVal) aiStatusMsg.textContent = '✓ Key active';
            }, 1800);
          }
        });
      }
    });
  }

  if (btnToggleKey && inputApiKey) {
    btnToggleKey.addEventListener('click', () => {
      const isPwd = inputApiKey.type === 'password';
      inputApiKey.type = isPwd ? 'text' : 'password';
      btnToggleKey.textContent = isPwd ? '🔒' : '👁';
    });
  }

  // Modal Controls
  if (btnSettings && modalSettings) {
    btnSettings.addEventListener('click', () => {
      modalSettings.classList.add('is-active');
      if (modalInfo) modalInfo.classList.remove('is-active');
    });
  }

  if (closeSettings && modalSettings) {
    closeSettings.addEventListener('click', () => {
      modalSettings.classList.remove('is-active');
    });
  }

  if (btnInfo && modalInfo) {
    btnInfo.addEventListener('click', () => {
      modalInfo.classList.add('is-active');
      if (modalSettings) modalSettings.classList.remove('is-active');
    });
  }

  if (closeInfo && modalInfo) {
    closeInfo.addEventListener('click', () => {
      modalInfo.classList.remove('is-active');
    });
  }

  // Click outside to close
  window.addEventListener('click', (e) => {
    if (e.target === modalSettings) modalSettings.classList.remove('is-active');
    if (e.target === modalInfo) modalInfo.classList.remove('is-active');
  });

  // Reset to Defaults
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      const defaults = {
        enabled: true,
        autoPauseAtEnd: true,
        autoAdvanceSeconds: 0,
        showPlaylist: true,
        enableSubChapters: true,
        autoSplitLongVideos: false,
        splitIntervalMinutes: 20
      };

      if (storage) {
        storage.set(defaults, () => {
          toggleEnabled.checked = true;
          toggleAutoPause.checked = true;
          togglePlaylist.checked = true;
          if (toggleSubChapters) toggleSubChapters.checked = true;
          toggleAutoSplit.checked = false;
          selectSplitMinutes.value = 20;
          selectAutoAdvance.value = 0;

          btnReset.textContent = '✓ Done';
          setTimeout(() => {
            btnReset.textContent = 'Reset';
            if (modalSettings) modalSettings.classList.remove('is-active');
          }, 600);
        });
      }
    });
  }
})();
