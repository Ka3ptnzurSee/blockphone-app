(function() {
  'use strict';

  if (!/youtube\.com$/i.test(window.location.hostname)) return;
  if (window.__dullPremiumBackgroundPlaybackInstalled) return;
  if (typeof window.ManagedMediaSource !== 'function') return;

  window.__dullPremiumBackgroundPlaybackInstalled = true;

  var MIRROR_ATTRIBUTE = 'data-dull-premium-background-audio';
  var MAX_UNKNOWN_ENTITLEMENT_BYTES = 12 * 1024 * 1024;
  var RECENT_PLAYBACK_WINDOW_MS = 5000;
  var MAX_RECORDS = 6;
  var records = [];
  var recordBySource = new WeakMap();
  var objectURLBySource = new WeakMap();
  var errors = [];
  var activeHandoff = null;
  var lastPrimaryVideo = null;
  var lastPrimaryPlayingAt = 0;
  /* WebKit may transiently pause the primary element while the scene resigns
     active. Remember page-requested play/pause intent separately from the
     native `paused` flag so that lifecycle pauses can still hand off, while a
     deliberate YouTube pause remains authoritative across Home and lock. */
  var primaryPlaybackIntent = new WeakMap();
  var syntheticTimeUpdates = 0;
  var lastTransition = 'installed';

  var mediaPrototype = HTMLMediaElement.prototype;
  var nativeCurrentTime = Object.getOwnPropertyDescriptor(mediaPrototype, 'currentTime');
  var nativePaused = Object.getOwnPropertyDescriptor(mediaPrototype, 'paused');
  var nativePlay = mediaPrototype.play;
  var nativePause = mediaPrototype.pause;
  var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  var nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  var nativeAddSourceBuffer = ManagedMediaSource.prototype.addSourceBuffer;

  function rememberError(context, error) {
    errors.push(context + ': ' + String(error));
    if (errors.length > 20) errors.shift();
  }

  function premiumState() {
    try {
      var topbar = window.ytInitialData
        && window.ytInitialData.topbar
        && window.ytInitialData.topbar.mobileTopbarRenderer;
      var iconType = topbar
        && topbar.topbarLogo
        && topbar.topbarLogo.topbarLogoRenderer
        && topbar.topbarLogo.topbarLogoRenderer.iconImage
        && topbar.topbarLogo.topbarLogoRenderer.iconImage.iconType;
      if (iconType === 'YOUTUBE_PREMIUM_LOGO') return true;
      if (iconType) return false;
    } catch (_) {}
    return null;
  }

  function isEligibleWatchPage() {
    return window.location.pathname === '/watch' && premiumState() === true;
  }

  function isMirror(element) {
    return !!(element && element.hasAttribute && element.hasAttribute(MIRROR_ATTRIBUTE));
  }

  function nativeTime(element) {
    try { return Number(nativeCurrentTime.get.call(element)); } catch (_) { return -1; }
  }

  function nativeIsPaused(element) {
    try { return !!nativePaused.get.call(element); } catch (_) { return true; }
  }

  function copyBytes(data) {
    try {
      if (data instanceof ArrayBuffer) return data.slice(0);
      if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
    } catch (error) {
      rememberError('copy-audio', error);
    }
    return null;
  }

  function sourceBufferProperties(sourceBuffer) {
    var properties = {};
    try { properties.mode = sourceBuffer.mode; } catch (_) {}
    try { properties.timestampOffset = sourceBuffer.timestampOffset; } catch (_) {}
    try { properties.appendWindowStart = sourceBuffer.appendWindowStart; } catch (_) {}
    try { properties.appendWindowEnd = sourceBuffer.appendWindowEnd; } catch (_) {}
    return properties;
  }

  function applySourceBufferProperties(sourceBuffer, properties) {
    try {
      if (properties.mode && sourceBuffer.mode !== properties.mode) {
        sourceBuffer.mode = properties.mode;
      }
    } catch (_) {}
    try {
      if (Number.isFinite(properties.timestampOffset)) {
        sourceBuffer.timestampOffset = properties.timestampOffset;
      }
    } catch (_) {}
    try {
      if (Number.isFinite(properties.appendWindowStart)) {
        sourceBuffer.appendWindowStart = properties.appendWindowStart;
      }
    } catch (_) {}
    try {
      if (Number.isFinite(properties.appendWindowEnd)) {
        sourceBuffer.appendWindowEnd = properties.appendWindowEnd;
      }
    } catch (_) {}
  }

  function queueOperation(record, operation) {
    if (record.disposed) return;
    record.operations.push(operation);
    drainOperations(record);
  }

  function drainOperations(record) {
    var mirrorBuffer = record.mirrorBuffer;
    if (!mirrorBuffer || record.draining || mirrorBuffer.updating || !record.operations.length) return;

    var operation = record.operations.shift();
    record.draining = true;
    try {
      if (operation.kind === 'append') {
        applySourceBufferProperties(mirrorBuffer, operation.properties);
        mirrorBuffer.appendBuffer(operation.bytes);
        record.mirroredBytes += operation.bytes.byteLength;
      } else if (operation.kind === 'remove') {
        mirrorBuffer.remove(operation.start, operation.end);
      } else if (operation.kind === 'abort') {
        mirrorBuffer.abort();
      } else if (operation.kind === 'changeType' && typeof mirrorBuffer.changeType === 'function') {
        mirrorBuffer.changeType(operation.type);
      } else if (operation.kind === 'end') {
        if (record.mirrorSource.readyState === 'open') record.mirrorSource.endOfStream();
      }
    } catch (error) {
      rememberError('mirror-' + operation.kind, error);
    }

    if (mirrorBuffer.updating) {
      var finish = function() {
        mirrorBuffer.removeEventListener('updateend', finish);
        mirrorBuffer.removeEventListener('error', finish);
        record.draining = false;
        settlePendingSeek(record);
        drainOperations(record);
      };
      mirrorBuffer.addEventListener('updateend', finish);
      mirrorBuffer.addEventListener('error', finish);
    } else {
      record.draining = false;
      settlePendingSeek(record);
      queueMicrotask(function() { drainOperations(record); });
    }
  }

  function promotePendingChunks(record) {
    if (!record.pendingChunks.length) return;
    var pending = record.pendingChunks;
    record.pendingChunks = [];
    record.pendingBytes = 0;
    for (var index = 0; index < pending.length; index += 1) {
      queueOperation(record, pending[index]);
    }
  }

  function attachMirrorElement(record) {
    var mirror = document.createElement('video');
    mirror.setAttribute(MIRROR_ATTRIBUTE, 'true');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.setAttribute('playsinline', '');
    mirror.playsInline = true;
    mirror.controls = false;
    mirror.preload = 'auto';
    mirror.muted = true;
    mirror.volume = 1;
    mirror.disableRemotePlayback = true;
    mirror.style.cssText = 'position:fixed!important;width:1px!important;height:1px!important;left:-10000px!important;top:-10000px!important;opacity:0!important;pointer-events:none!important;';
    (document.documentElement || document).appendChild(mirror);
    record.mirrorElement = mirror;
  }

  function ensureMirror(record) {
    if (record.disposed || record.mirrorSource || premiumState() !== true) return;

    try {
      record.mirrorSource = new ManagedMediaSource();
      attachMirrorElement(record);
      record.mirrorSource.addEventListener('sourceopen', function() {
        if (record.disposed || record.mirrorBuffer) return;
        try {
          record.mirrorBuffer = nativeAddSourceBuffer.call(record.mirrorSource, record.type);
          promotePendingChunks(record);
          drainOperations(record);
          lastTransition = 'mirror-ready';
        } catch (error) {
          rememberError('mirror-open', error);
        }
      }, { once: true });

      record.mirrorObjectURL = URL.createObjectURL(record.mirrorSource);
      record.mirrorElement.src = record.mirrorObjectURL;
      record.mirrorElement.load();
    } catch (error) {
      rememberError('mirror-install', error);
    }
  }

  function captureAudioAppend(record, bytes, properties) {
    if (!bytes || record.disposed) return;

    var entitlement = premiumState();
    var operation = { kind: 'append', bytes: bytes, properties: properties };
    if (entitlement === true) {
      ensureMirror(record);
      promotePendingChunks(record);
      queueOperation(record, operation);
      return;
    }

    if (entitlement === null
        && record.pendingBytes + bytes.byteLength <= MAX_UNKNOWN_ENTITLEMENT_BYTES) {
      record.pendingChunks.push(operation);
      record.pendingBytes += bytes.byteLength;
    } else {
      record.pendingChunks = [];
      record.pendingBytes = 0;
    }
  }

  function disposeRecord(record) {
    record.disposed = true;
    record.operations = [];
    record.pendingChunks = [];
    try { nativePause.call(record.mirrorElement); } catch (_) {}
    try { record.mirrorElement.remove(); } catch (_) {}
    try {
      if (record.mirrorObjectURL) nativeRevokeObjectURL(record.mirrorObjectURL);
    } catch (_) {}
  }

  function installAudioBufferMirror(source, sourceBuffer, type) {
    var record = {
      primarySource: source,
      primaryBuffer: sourceBuffer,
      primaryObjectURL: objectURLBySource.get(source) || '',
      type: type,
      mirrorSource: null,
      mirrorBuffer: null,
      mirrorElement: null,
      mirrorObjectURL: '',
      pendingChunks: [],
      pendingBytes: 0,
      operations: [],
      draining: false,
      mirroredBytes: 0,
      disposed: false,
    };
    records.push(record);
    recordBySource.set(source, record);

    if (records.length > MAX_RECORDS) disposeRecord(records.shift());
    if (premiumState() === true) ensureMirror(record);

    var originalAppendBuffer = sourceBuffer.appendBuffer.bind(sourceBuffer);
    sourceBuffer.appendBuffer = function(data) {
      var bytes = copyBytes(data);
      var properties = sourceBufferProperties(sourceBuffer);
      var result = originalAppendBuffer(data);
      captureAudioAppend(record, bytes, properties);
      return result;
    };

    if (typeof sourceBuffer.remove === 'function') {
      var originalRemove = sourceBuffer.remove.bind(sourceBuffer);
      sourceBuffer.remove = function(start, end) {
        var result = originalRemove(start, end);
        if (premiumState() === true) queueOperation(record, { kind: 'remove', start: start, end: end });
        return result;
      };
    }

    if (typeof sourceBuffer.abort === 'function') {
      var originalAbort = sourceBuffer.abort.bind(sourceBuffer);
      sourceBuffer.abort = function() {
        var result = originalAbort();
        if (premiumState() === true) queueOperation(record, { kind: 'abort' });
        return result;
      };
    }

    if (typeof sourceBuffer.changeType === 'function') {
      var originalChangeType = sourceBuffer.changeType.bind(sourceBuffer);
      sourceBuffer.changeType = function(nextType) {
        var result = originalChangeType(nextType);
        record.type = nextType;
        if (premiumState() === true) queueOperation(record, { kind: 'changeType', type: nextType });
        return result;
      };
    }
  }

  URL.createObjectURL = function(object) {
    var objectURL = nativeCreateObjectURL(object);
    try {
      objectURLBySource.set(object, objectURL);
      var record = recordBySource.get(object);
      if (record) record.primaryObjectURL = objectURL;
    } catch (_) {}
    return objectURL;
  };

  ManagedMediaSource.prototype.addSourceBuffer = function(type) {
    var sourceBuffer = nativeAddSourceBuffer.call(this, type);
    if (/^audio\//i.test(String(type))) {
      try { installAudioBufferMirror(this, sourceBuffer, String(type)); }
      catch (error) { rememberError('source-buffer-install', error); }
    }
    return sourceBuffer;
  };

  function promoteKnownPremiumRecords() {
    var entitlement = premiumState();
    if (entitlement === false) {
      records.forEach(function(record) {
        record.pendingChunks = [];
        record.pendingBytes = 0;
      });
      return;
    }
    if (entitlement !== true) return;
    records.forEach(function(record) {
      ensureMirror(record);
      promotePendingChunks(record);
    });
  }

  document.addEventListener('DOMContentLoaded', promoteKnownPremiumRecords, { once: true });
  window.addEventListener('load', promoteKnownPremiumRecords, { once: true });

  function recordForPrimary(primary) {
    var source = '';
    try { source = primary.currentSrc || primary.src || ''; } catch (_) {}
    for (var index = records.length - 1; index >= 0; index -= 1) {
      var record = records[index];
      if (record.disposed || !record.mirrorBuffer || !record.mirrorElement) continue;
      if (source && record.primaryObjectURL === source) return record;
    }
    for (var fallback = records.length - 1; fallback >= 0; fallback -= 1) {
      var candidate = records[fallback];
      if (!candidate.disposed && candidate.mirrorBuffer && candidate.mirrorElement) return candidate;
    }
    return null;
  }

  function bufferContainsTime(sourceBuffer, time) {
    try {
      var ranges = sourceBuffer.buffered;
      for (var index = 0; index < ranges.length; index += 1) {
        if (time >= ranges.start(index) - 0.25 && time <= ranges.end(index) + 0.25) return true;
      }
    } catch (_) {}
    return false;
  }

  function seekTargetIsBuffered(sourceBuffer, time) {
    try {
      var ranges = sourceBuffer.buffered;
      for (var index = 0; index < ranges.length; index += 1) {
        if (time >= ranges.start(index) && time <= ranges.end(index)) return true;
      }
    } catch (_) {}
    return false;
  }

  function normalizedBackgroundSeekTime(handoff, time) {
    var targetTime = Math.max(0, time);
    try {
      var duration = Number(handoff.primary.duration);
      if (Number.isFinite(duration) && duration >= 0) {
        targetTime = Math.min(targetTime, duration);
      }
    } catch (_) {}
    return targetTime;
  }

  function routeBackgroundSeek(time) {
    if (!activeHandoff || !Number.isFinite(time)) return false;
    var handoff = activeHandoff;
    var targetTime = normalizedBackgroundSeekTime(handoff, time);
    if (!seekTargetIsBuffered(handoff.record.mirrorBuffer, targetTime)) {
      /* Keep the working audio handoff playing while YouTube fetches the
         requested segment through the primary element. The next mirrored
         append settles this seek without introducing a pause/resume race. */
      handoff.pendingSeekTime = targetTime;
      lastTransition = 'background-seek-waiting';
      return false;
    }

    try {
      var mirror = handoff.record.mirrorElement;
      if (Math.abs(nativeTime(mirror) - targetTime) > 0.01) {
        nativeCurrentTime.set.call(mirror, targetTime);
      }
      handoff.pendingSeekTime = null;
      lastTransition = 'background-seeked';
      return true;
    } catch (error) {
      rememberError('background-seek', error);
      return false;
    }
  }

  function settlePendingSeek(record) {
    if (!activeHandoff || activeHandoff.record !== record) return;
    var targetTime = activeHandoff.pendingSeekTime;
    if (Number.isFinite(targetTime)) routeBackgroundSeek(targetTime);
  }

  function backgroundPlaybackRequestedFor(primary) {
    if (!primary || isMirror(primary) || primary.ended || primary.muted || primary.volume <= 0) {
      return false;
    }
    if (primaryPlaybackIntent.get(primary) === false) return false;
    if (activeHandoff && primary === activeHandoff.primary) {
      return activeHandoff.resumeOnForeground
        && !nativeIsPaused(activeHandoff.record.mirrorElement);
    }
    if (!nativeIsPaused(primary)) return true;
    return primary === lastPrimaryVideo
      && primaryPlaybackIntent.get(primary) === true
      && Date.now() - lastPrimaryPlayingAt <= RECENT_PLAYBACK_WINDOW_MS;
  }

  /* The native audio-session bridge is injected immediately after this helper.
     Give it the same intent signal used by the handoff gate so a user pause and
     a WebKit lifecycle pause are not collapsed into the same `paused` bit. */
  window.__dullYouTubeBackgroundPlaybackRequested = backgroundPlaybackRequestedFor;

  function currentPrimaryVideo() {
    if (lastPrimaryVideo
        && lastPrimaryVideo.isConnected
        && backgroundPlaybackRequestedFor(lastPrimaryVideo)) {
      return lastPrimaryVideo;
    }

    var videos = Array.prototype.slice.call(document.querySelectorAll('video:not([' + MIRROR_ATTRIBUTE + '])'));
    var playing = videos.find(function(video) {
      return backgroundPlaybackRequestedFor(video);
    });
    if (playing) return playing;
    return null;
  }

  function startBackgroundHandoff() {
    if (activeHandoff || !isEligibleWatchPage()) return !!activeHandoff;
    var primary = currentPrimaryVideo();
    if (!primary || primary.muted || primary.volume <= 0) return false;

    var record = recordForPrimary(primary);
    var departureTime = nativeTime(primary);
    if (!record || departureTime < 0 || !bufferContainsTime(record.mirrorBuffer, departureTime)) return false;

    var mirror = record.mirrorElement;
    activeHandoff = {
      primary: primary,
      record: record,
      departureTime: departureTime,
      resumeOnForeground: true,
      pendingSeekTime: null,
    };
    lastTransition = 'background-starting';

    try {
      mirror.disableRemotePlayback = true;
      mirror.playbackRate = primary.playbackRate || 1;
      mirror.defaultPlaybackRate = primary.defaultPlaybackRate || 1;
      mirror.volume = primary.volume;
      mirror.muted = false;
      nativeCurrentTime.set.call(mirror, departureTime);
      var playResult = nativePlay.call(mirror);
      if (playResult && typeof playResult.then === 'function') {
        playResult.then(function() {
          if (activeHandoff && activeHandoff.record === record) lastTransition = 'background-playing';
        }).catch(function(error) {
          rememberError('background-play', error);
          if (activeHandoff && activeHandoff.record === record) activeHandoff = null;
          mirror.muted = true;
        });
      }
      return true;
    } catch (error) {
      rememberError('background-start', error);
      activeHandoff = null;
      mirror.muted = true;
      return false;
    }
  }

  function finishBackgroundHandoff() {
    if (!activeHandoff) return;
    var handoff = activeHandoff;
    var primary = handoff.primary;
    var mirror = handoff.record.mirrorElement;
    var returnTime = Number.isFinite(handoff.pendingSeekTime)
      ? handoff.pendingSeekTime
      : nativeTime(mirror);
    var shouldResume = handoff.resumeOnForeground && !mirror.ended;

    try { nativePause.call(mirror); } catch (_) {}
    mirror.muted = true;
    activeHandoff = null;

    try {
      if (returnTime >= handoff.departureTime) nativeCurrentTime.set.call(primary, returnTime);
    } catch (error) {
      rememberError('foreground-seek', error);
    }

    if (shouldResume) {
      try {
        var playResult = nativePlay.call(primary);
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(function(error) { rememberError('foreground-play', error); });
        }
      } catch (error) {
        rememberError('foreground-play', error);
      }
    }
    lastTransition = shouldResume ? 'foreground-resumed' : 'foreground-paused';
  }

  try {
    Object.defineProperty(mediaPrototype, 'currentTime', {
      configurable: nativeCurrentTime.configurable,
      enumerable: nativeCurrentTime.enumerable,
      get: function() {
        if (activeHandoff && this === activeHandoff.primary) {
          if (Number.isFinite(activeHandoff.pendingSeekTime)) {
            return activeHandoff.pendingSeekTime;
          }
          var mirroredTime = nativeTime(activeHandoff.record.mirrorElement);
          if (mirroredTime >= 0) return mirroredTime;
        }
        return nativeCurrentTime.get.call(this);
      },
      set: function(value) {
        if (activeHandoff && this === activeHandoff.primary) {
          var numericValue = Number(value);
          if (Number.isFinite(numericValue)) {
            var targetTime = normalizedBackgroundSeekTime(activeHandoff, numericValue);
            routeBackgroundSeek(targetTime);
            return nativeCurrentTime.set.call(this, targetTime);
          }
        }
        return nativeCurrentTime.set.call(this, value);
      },
    });

    Object.defineProperty(mediaPrototype, 'paused', {
      configurable: nativePaused.configurable,
      enumerable: nativePaused.enumerable,
      get: function() {
        if (activeHandoff && this === activeHandoff.primary) {
          return nativeIsPaused(activeHandoff.record.mirrorElement);
        }
        return nativePaused.get.call(this);
      },
    });

    mediaPrototype.play = function() {
      if (activeHandoff && this === activeHandoff.primary) {
        activeHandoff.resumeOnForeground = true;
        primaryPlaybackIntent.set(this, true);
        return nativePlay.call(activeHandoff.record.mirrorElement);
      }
      if (this.tagName === 'VIDEO' && !isMirror(this)) {
        primaryPlaybackIntent.set(this, true);
      }
      return nativePlay.apply(this, arguments);
    };

    mediaPrototype.pause = function() {
      if (activeHandoff && this === activeHandoff.primary) {
        activeHandoff.resumeOnForeground = false;
        primaryPlaybackIntent.set(this, false);
        try { nativePause.call(activeHandoff.record.mirrorElement); } catch (_) {}
        try { return nativePause.call(this); } catch (_) { return; }
      }
      if (this.tagName === 'VIDEO' && !isMirror(this)) {
        primaryPlaybackIntent.set(this, false);
      }
      return nativePause.apply(this, arguments);
    };
  } catch (error) {
    rememberError('media-property-shim', error);
  }

  ['play', 'playing', 'timeupdate'].forEach(function(eventName) {
    document.addEventListener(eventName, function(event) {
      var video = event.target;
      if (!video || video.tagName !== 'VIDEO') return;
      if (isMirror(video)) {
        if (activeHandoff
            && video === activeHandoff.record.mirrorElement
            && !nativeIsPaused(video)
            && (eventName === 'play' || eventName === 'playing')) {
          activeHandoff.resumeOnForeground = true;
          lastTransition = 'background-playing';
        }
        return;
      }
      if (!nativeIsPaused(video)) {
        if (eventName === 'play' || eventName === 'playing') {
          primaryPlaybackIntent.set(video, true);
        }
        lastPrimaryVideo = video;
        lastPrimaryPlayingAt = Date.now();
      }
    }, true);
  });

  document.addEventListener('pause', function(event) {
    var video = event.target;
    if (!document.hidden || !isEligibleWatchPage() || !video || video.tagName !== 'VIDEO') return;
    if (activeHandoff && video === activeHandoff.record.mirrorElement) {
      activeHandoff.resumeOnForeground = false;
      lastTransition = 'background-paused';
      return;
    }
    if (video === lastPrimaryVideo || (activeHandoff && video === activeHandoff.primary)) {
      event.stopImmediatePropagation();
    }
  }, true);

  ['seeking', 'seeked'].forEach(function(eventName) {
    document.addEventListener(eventName, function(event) {
      var video = event.target;
      if (!document.hidden || !activeHandoff || video !== activeHandoff.primary) return;
      var targetTime = nativeTime(video);
      if (targetTime >= 0) routeBackgroundSeek(targetTime);
    }, true);
  });

  document.addEventListener('visibilitychange', function(event) {
    if (document.hidden) {
      if (startBackgroundHandoff()) event.stopImmediatePropagation();
    } else {
      finishBackgroundHandoff();
    }
  }, true);

  window.addEventListener('dull-navigation', function() {
    if (activeHandoff && !isEligibleWatchPage()) finishBackgroundHandoff();
    promoteKnownPremiumRecords();
  });

  setInterval(function() {
    if (!activeHandoff) return;
    var mirror = activeHandoff.record.mirrorElement;
    if (!mirror || nativeIsPaused(mirror)) return;
    syntheticTimeUpdates += 1;
    try { activeHandoff.primary.dispatchEvent(new Event('timeupdate')); } catch (_) {}
    if (syntheticTimeUpdates % 4 === 0) {
      try { activeHandoff.primary.dispatchEvent(new Event('progress')); } catch (_) {}
    }
  }, 250);

  window.__dullPremiumBackgroundPlaybackDebug = {
    snapshot: function() {
      return {
        premium: premiumState() === true,
        recordCount: records.filter(function(record) { return !record.disposed; }).length,
        mirroredBytes: records.reduce(function(total, record) { return total + record.mirroredBytes; }, 0),
        active: !!activeHandoff,
        pendingSeekTime: activeHandoff ? activeHandoff.pendingSeekTime : null,
        syntheticTimeUpdates: syntheticTimeUpdates,
        lastTransition: lastTransition,
        errors: errors.slice(),
      };
    },
  };
})();
