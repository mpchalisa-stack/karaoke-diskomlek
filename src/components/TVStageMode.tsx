import React, { useEffect, useState, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Zap,
  Mic,
  Smartphone,
  Play,
  Pause,
  SkipForward,
  Tablet,
  Check,
  Maximize2,
  Minimize2,
  Radio,
  Music2,
  Tv,
} from 'lucide-react';
import { useKaraoke } from '../context/KaraokeContext';
import { fetchServerNetworkInfo, getUniversalBarcodeUrl, NetworkInfo } from '../services/network';
import { PWAInstallButton } from './PWAInstallButton';
import { MasterWirelessMicStatus } from './MasterWirelessMicStatus';
import { KaraokeScoreHUD } from './KaraokeScoreHUD';

interface TVStageModeProps {
  standalone?: boolean;
}

export const TVStageMode: React.FC<TVStageModeProps> = ({ standalone = false }) => {
  const {
    isTvMode,
    setIsTvMode,
    currentSong,
    queue,
    roomId,
    remoteConnectedDevices,
    triggerSoundFx,
    activeReactions,
    isPlaying,
    togglePlayPause,
    skipNextSong,
  } = useKaraoke();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [tvQrUrl, setTvQrUrl] = useState<string>('');
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Fetch server detected URL on mount
  useEffect(() => {
    fetchServerNetworkInfo().then((info) => {
      if (info) setNetworkInfo(info);
    });
  }, []);

  // Monitor fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Synchronize TV YouTube iframe with play/pause state from Tablet / HP
  useEffect(() => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func: isPlaying ? 'playVideo' : 'pauseVideo',
          args: '',
        }),
        '*'
      );
    } catch (e) {}
  }, [isPlaying]);

  const clientUrl = getUniversalBarcodeUrl(roomId, networkInfo);

  // Instant fallback QR code URL so it never renders blank
  const instantFallbackQr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
    clientUrl
  )}&color=000000&bgcolor=ffffff&margin=2`;

  // High-definition local QRCode generation with pure black high-contrast optics
  useEffect(() => {
    if (!isTvMode && !standalone) return;
    let isMounted = true;

    QRCode.toDataURL(clientUrl, {
      width: 360,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (isMounted) setTvQrUrl(url);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [isTvMode, standalone, clientUrl]);

  const handleExit = () => {
    if (standalone) {
      window.location.href = `/?room=${encodeURIComponent(roomId)}`;
    } else {
      setIsTvMode(false);
    }
  };

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(clientUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = clientUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  }, [clientUrl]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    if (!isTvMode && !standalone) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleExit();
      } else if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === '1') {
        triggerSoundFx('applause');
      } else if (e.key === '2') {
        triggerSoundFx('cheer');
      } else if (e.key === '3') {
        triggerSoundFx('airhorn');
      } else if (e.key === '4') {
        triggerSoundFx('boo');
      } else if (e.key === '5') {
        triggerSoundFx('laugh');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTvMode, standalone, togglePlayPause, triggerSoundFx]);

  if (!isTvMode && !standalone) return null;

  const nextSong = queue.length > 0 ? queue[0] : null;
  const currentQrImage = tvQrUrl || instantFallbackQr;

  // Check if any active reaction is a HUUU / BOO for screen alerts
  const latestBooReaction = activeReactions.find((r) => r.type === 'boo');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#040915] text-white select-none overflow-hidden font-sans">
      {/* Subtle non-intrusive screen alert when HUUU reaction arrives */}
      {latestBooReaction && (
        <div className="absolute inset-0 z-40 border-4 border-rose-500/40 pointer-events-none animate-pulse bg-transparent transition-all duration-300" />
      )}

      {/* =========================================================================
          TOP COMMAND HEADER (Structured & Non-Overlapping)
          Buttons and text have dedicated columns and flex-nowrap to prevent overlap
         ========================================================================= */}
      <header className="h-14 sm:h-16 shrink-0 z-30 flex items-center justify-between px-3 sm:px-5 bg-gradient-to-r from-[#061229] via-[#071838] to-[#050e22] border-b border-sky-900/80 shadow-lg">
        {/* Left Column: Tactical Brand Logo + Title + Military Slogan */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          {/* Logo Badge: Petir & Mic */}
          <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-600 via-blue-700 to-indigo-950 text-white shadow-lg shadow-sky-500/40 border-2 border-sky-400/50 shrink-0">
            <Mic className="h-4.5 w-4.5 sm:h-5 sm:w-5 text-sky-200" />
            <Zap className="h-3.5 w-3.5 text-amber-300 fill-amber-300 absolute -top-1 -right-1 drop-shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse" />
          </div>

          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-display text-sm sm:text-base md:text-lg font-black tracking-wider text-white drop-shadow-[0_0_15px_rgba(56,189,248,0.55)]">
                DISKOMLEK<span className="text-sky-400">AU</span>
              </span>
              <span className="rounded bg-sky-900/90 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-black text-sky-200 border border-sky-400/50 shadow shrink-0">
                TNI AU
              </span>
            </div>

            <span className="text-sky-500/40 font-bold shrink-0 hidden md:inline-block">·</span>

            {/* Slogan: Responsively truncated so it NEVER overlaps the control buttons */}
            <span className="font-display text-[11px] sm:text-xs lg:text-sm font-black text-amber-300 uppercase tracking-wide drop-shadow-[0_0_10px_rgba(251,191,36,0.7)] bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 bg-clip-text text-transparent truncate hidden md:inline-block">
              &ldquo;Prajurit Yang Pantang Mundur Walau Suara Hancur&rdquo;
            </span>
          </div>
        </div>

        {/* Center / Right Integrated Badges: Room Code & Mobile Clients Count */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-3">
          {/* Room Badge */}
          <div
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 rounded-xl border border-sky-500/50 bg-[#040e24]/90 px-2.5 py-1 text-xs font-mono font-bold text-sky-200 shadow backdrop-blur-md cursor-pointer hover:bg-sky-900/60 transition"
            title="Klik untuk menyalin tautan HP"
          >
            <Smartphone className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <span className="text-[10px] text-slate-300 hidden sm:inline">ROOM:</span>
            <span className="text-amber-300 font-black">{roomId}</span>
            <span className="text-emerald-400 text-[10px]">({remoteConnectedDevices} HP)</span>
            {isCopied && <Check className="h-3.5 w-3.5 text-emerald-300 ml-0.5" />}
          </div>

          {/* Action Buttons: Play/Pause, Next Song, Fullscreen, Mode Tablet (ESC) */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Play/Pause Button */}
            <button
              onClick={() => togglePlayPause()}
              className="flex items-center gap-1.5 rounded-xl bg-sky-900/80 hover:bg-sky-800 border border-sky-600/50 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-white transition active:scale-95 shadow cursor-pointer"
              title={isPlaying ? 'Jeda Lagu di TV (Spasi)' : 'Putar Lagu di TV (Spasi)'}
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5 fill-current text-amber-300" />
                  <span className="hidden sm:inline">Jeda</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current text-emerald-400" />
                  <span className="hidden sm:inline">Putar</span>
                </>
              )}
            </button>

            {/* Skip / Next Song Button */}
            <button
              onClick={() => skipNextSong()}
              className="flex items-center gap-1.5 rounded-xl bg-sky-900/80 hover:bg-sky-800 border border-sky-600/50 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-white transition active:scale-95 shadow cursor-pointer"
              title="Ganti ke Lagu Berikutnya di Antrean TV"
            >
              <SkipForward className="h-3.5 w-3.5 text-sky-300" />
              <span className="hidden sm:inline">Ganti</span>
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={toggleFullscreen}
              className="flex items-center justify-center h-8 w-8 rounded-xl bg-[#081738] border border-sky-600/50 text-sky-300 hover:text-white hover:bg-sky-800/80 transition cursor-pointer"
              title={isFullscreen ? 'Keluar Layar Penuh (F11)' : 'Layar Penuh TV (F11)'}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>

            {/* Exit to Tablet Console */}
            <button
              onClick={handleExit}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-950 to-indigo-950 border border-sky-500/60 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-600 hover:text-white transition shadow cursor-pointer"
              title="Beralih ke Tampilan Konsol Tablet / Layar Sentuh (ESC)"
            >
              <Tablet className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden sm:inline">Konsol (ESC)</span>
              <span className="sm:hidden">ESC</span>
            </button>
          </div>
        </div>
      </header>

      {/* WebRTC Wireless Microphone Banner (Active when mobile clients stream mic) */}
      <div className="w-full px-3 py-1 bg-[#020b18] shrink-0 empty:hidden border-b border-sky-950">
        <MasterWirelessMicStatus />
      </div>

      {/* =========================================================================
          MAIN STAGE: Full-Scale YouTube Player Stage + Score HUD
         ========================================================================= */}
      <main className="relative flex-1 min-h-0 w-full flex items-center justify-center bg-black overflow-hidden">
        <iframe
          ref={iframeRef}
          src={`https://www.youtube.com/embed/${
            currentSong?.id || 'BnlzOzdP8Is'
          }?autoplay=1&enablejsapi=1&rel=0&iv_load_policy=3&playsinline=1`}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title="Karaoke Diskomlekau TV Player"
        />

        {/* Real-time Web Audio Karaoke Scoring HUD (TV Stage) - Safely positioned */}
        <div className="absolute top-4 left-4 z-20 pointer-events-none hidden sm:block">
          <KaraokeScoreHUD />
        </div>
        <div className="absolute top-3 left-3 z-20 pointer-events-none sm:hidden">
          <KaraokeScoreHUD compact />
        </div>

        {/* ON-SCREEN REACTION OVERLAY: HUUU, CHEERS, APPLAUSE, AIRHORN (Lyrics-Friendly) */}
        {activeReactions.length > 0 && (
          <div className="absolute inset-x-4 top-6 z-35 flex flex-col items-center pointer-events-none space-y-2.5">
            {activeReactions.map((rx) => {
              const isHuuu = rx.type === 'boo';

              return (
                <div
                  key={rx.id}
                  className={`animate-in zoom-in-90 fade-in slide-in-from-top-4 duration-300 flex items-center gap-3 px-5 py-2.5 rounded-2xl backdrop-blur-md border shadow-xl max-w-lg mx-auto transition-all ${
                    isHuuu
                      ? 'bg-rose-950/40 border-rose-500/60 text-rose-100 shadow-rose-950/40'
                      : 'bg-black/40 border-sky-400/50 text-white shadow-sky-950/40'
                  }`}
                >
                  <span className="text-3xl sm:text-4xl drop-shadow-[0_0_10px_rgba(255,255,255,0.4)] animate-bounce shrink-0">
                    {rx.emoji}
                  </span>

                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2
                        className={`font-display text-base sm:text-lg font-black tracking-wide drop-shadow truncate ${
                          isHuuu ? 'text-amber-300' : 'text-sky-300'
                        }`}
                      >
                        {rx.label}
                      </h2>
                      {isHuuu && (
                        <span className="rounded bg-rose-500/30 px-1.5 py-0.5 text-[9px] font-black text-rose-200 border border-rose-400/40">
                          HUUU!
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-bold text-slate-200 truncate mt-0.5">
                      Dari: <span className="text-amber-300 font-black underline decoration-sky-400">🎖️ {rx.senderName} (HP)</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* =========================================================================
          BOTTOM STAGE FOOTER (Strict 3-Zone, Non-Wrapping Layout)
          Zone 1 (Left): Song Ticker (Truncated, never expands into center buttons)
          Zone 2 (Center): Reaction / Sound FX buttons (Dedicated pill container)
          Zone 3 (Right): Smart TV Install + Persistent Barcode
         ========================================================================= */}
      <footer className="h-14 sm:h-16 shrink-0 z-30 flex items-center justify-between px-3 sm:px-5 bg-gradient-to-r from-[#040c1d] via-[#061226] to-[#040b19] border-t border-sky-900/80 shadow-2xl gap-3">
        {/* Zone 1 (Left): Song Ticker & Singer Name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1 max-w-[36%]">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500" />
          </span>

          <div className="flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider">
              <span>MENGUDARA:</span>
              {nextSong && (
                <span className="hidden xl:inline text-amber-300/90 truncate font-semibold">
                  (Selanjutnya: {nextSong.singerName})
                </span>
              )}
            </div>
            <p
              className="text-xs sm:text-sm font-bold text-white truncate drop-shadow"
              title={currentSong ? currentSong.title : 'Pilih lagu...'}
            >
              {currentSong ? currentSong.title : 'Pilih lagu karaoke...'}
            </p>
          </div>
        </div>

        {/* Zone 2 (Center): Pasukan Sound FX & Sorak Buttons (Pill Box Container) */}
        <div className="flex items-center gap-1 bg-[#06142e]/90 px-2 sm:px-3 py-1 rounded-2xl border border-sky-800/80 shadow-inner shrink-0">
          <span className="text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider mr-1 hidden lg:inline">
            Sorak:
          </span>

          {/* Button 4: HUUU */}
          <button
            onClick={() => triggerSoundFx('boo')}
            className="px-2 sm:px-2.5 py-1 text-xs bg-rose-950/80 hover:bg-rose-900 rounded-xl text-rose-200 font-black border border-rose-600/70 transition shadow flex items-center gap-1 active:scale-95 cursor-pointer"
            title="Tombol [4]: Sorak HUUU Suara Hancur"
          >
            <span>👎</span>
            <span className="font-extrabold text-[11px]">HUUU [4]</span>
          </button>

          {/* Button 1: Tepuk */}
          <button
            onClick={() => triggerSoundFx('applause')}
            className="px-2 sm:px-2.5 py-1 text-xs bg-sky-950/60 hover:bg-sky-900/80 rounded-xl text-sky-200 font-bold border border-sky-700/50 transition active:scale-95 flex items-center gap-1 cursor-pointer"
            title="Tombol [1]: Tepuk Tangan"
          >
            <span>👏</span>
            <span className="text-[11px] hidden sm:inline">Tepuk [1]</span>
          </button>

          {/* Button 2: Sorak */}
          <button
            onClick={() => triggerSoundFx('cheer')}
            className="px-2 sm:px-2.5 py-1 text-xs bg-sky-950/60 hover:bg-sky-900/80 rounded-xl text-sky-200 font-bold border border-sky-700/50 transition active:scale-95 flex items-center gap-1 cursor-pointer"
            title="Tombol [2]: Sorak Riuh"
          >
            <span>🎉</span>
            <span className="text-[11px] hidden sm:inline">Sorak [2]</span>
          </button>

          {/* Button 3: Sirine */}
          <button
            onClick={() => triggerSoundFx('airhorn')}
            className="px-2 sm:px-2.5 py-1 text-xs bg-sky-950/60 hover:bg-sky-900/80 rounded-xl text-sky-200 font-bold border border-sky-700/50 transition active:scale-95 flex items-center gap-1 cursor-pointer"
            title="Tombol [3]: Sirine"
          >
            <span>📢</span>
            <span className="text-[11px] hidden md:inline">Sirine [3]</span>
          </button>

          {/* Button 5: Tawa */}
          <button
            onClick={() => triggerSoundFx('laugh')}
            className="px-2 sm:px-2.5 py-1 text-xs bg-sky-950/60 hover:bg-sky-900/80 rounded-xl text-amber-300 font-bold border border-sky-700/50 transition active:scale-95 flex items-center gap-1 cursor-pointer"
            title="Tombol [5]: Tawa"
          >
            <span>😂</span>
            <span className="text-[11px] hidden md:inline">Tawa [5]</span>
          </button>
        </div>

        {/* Zone 3 (Right): Smart TV Install + High-Contrast Barcode */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 justify-end">
          {/* Install on TV */}
          <PWAInstallButton variant="tv" />

          {/* Permanent Barcode Scanner */}
          <div
            onClick={handleCopyLink}
            className="flex items-center gap-2 bg-[#051126] border border-sky-500/70 p-1 sm:p-1.5 rounded-xl transition-all shrink-0 group shadow-md cursor-pointer hover:border-sky-400"
            title="Arahkan kamera HP ke barcode untuk mencari & antre lagu dari smartphone"
          >
            <div className="rounded-lg bg-white p-0.5 shrink-0 shadow">
              <img
                src={currentQrImage}
                alt="Scan Barcode HP"
                className="h-8 w-8 sm:h-9 sm:w-9 object-contain rounded"
              />
            </div>

            <div className="flex flex-col text-left pr-1 hidden sm:flex">
              <div className="flex items-center gap-1 text-[10px] font-mono font-bold">
                <span className="text-sky-300">HP:</span>
                <span className="text-amber-300 font-black">{roomId}</span>
              </div>
              <span className="text-[9px] text-slate-300 font-medium group-hover:text-amber-300">
                {isCopied ? '✓ Tersalin!' : 'Scan Barcode'}
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
