import { useState, useRef, useEffect } from 'react'
import { Midi } from '@tonejs/midi'
import * as Tone from 'tone'
import JSZip from 'jszip'
import SynthesiaRenderer from './SynthesiaRenderer'

function ControlKnob({ label, value, min, max, step, onChange, disabled, format }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function increment() {
    const next = Math.min(max, parseFloat((value + step).toFixed(10)))
    onChange(next)
  }
  function decrement() {
    const next = Math.max(min, parseFloat((value - step).toFixed(10)))
    onChange(next)
  }
  function startEdit() {
    if (disabled) return
    setDraft(String(value))
    setEditing(true)
  }
  function commitEdit() {
    const parsed = parseFloat(draft)
    if (!isNaN(parsed)) onChange(Math.min(max, Math.max(min, parsed)))
    setEditing(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', opacity: disabled ? 0.4 : 1 }}>
      <span style={{ fontSize: '11px', color: '#aaa' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button onClick={decrement} disabled={disabled}
          style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #555', background: '#2a2a40', color: 'white', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}>
          −
        </button>
        {editing ? (
          <input autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false) }}
            style={{ width: '52px', textAlign: 'center', background: '#2a2a40', border: '1px solid #7F77DD', borderRadius: '4px', color: 'white', fontSize: '12px', padding: '2px 4px' }} />
        ) : (
          <span onClick={startEdit} title="Click to type a value"
            style={{ width: '52px', textAlign: 'center', fontSize: '12px', cursor: disabled ? 'default' : 'pointer', background: '#2a2a40', border: '1px solid #444', borderRadius: '4px', padding: '2px 4px', userSelect: 'none' }}>
            {format ? format(value) : value}
          </span>
        )}
        <button onClick={increment} disabled={disabled}
          style={{ width: '24px', height: '24px', borderRadius: '4px', border: '1px solid #555', background: '#2a2a40', color: 'white', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}>
          +
        </button>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{ width: '80px', accentColor: '#7F77DD' }} />
    </div>
  )
}

function TimeDisplay({ seekBarRef, formatTime, songLengthRef }) {
  const spanRef = useRef(null)
  useEffect(() => {
    let rafId
    function update() {
      if (spanRef.current && seekBarRef.current) {
        const pos = seekBarRef.current.dataset.pos ?? '0:00'
        const total = formatTime(songLengthRef.current)
        spanRef.current.textContent = `${pos} / ${total}`
      }
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafId)
  }, [])
  return (
    <span ref={spanRef} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#aaa', pointerEvents: 'none', userSelect: 'none' }} />
  )
}

function parseMusicXML(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

  function buildTempoMap(partEl) {
    const tempoMap = [{ tick: 0, bpm: 120 }]
    let tick = 0
    let divisions = 1
    for (const measure of partEl.querySelectorAll('measure')) {
      const divEl = measure.querySelector('attributes > divisions')
      if (divEl) divisions = parseInt(divEl.textContent)
      for (const child of measure.children) {
        if (child.tagName === 'direction') {
          const soundEl = child.querySelector('sound')
          if (soundEl?.getAttribute('tempo')) {
            tempoMap.push({ tick, bpm: parseFloat(soundEl.getAttribute('tempo')) })
          }
        }
        if (child.tagName === 'note') {
          const isChord = child.querySelector('chord') !== null
          const dur = parseInt(child.querySelector('duration')?.textContent ?? '0')
          if (!isChord) tick += dur
        }
      }
    }
    return { tempoMap }
  }

  function ticksToSeconds(tick, tempoMap, divisions) {
    let seconds = 0
    let cursor = 0
    for (let i = 0; i < tempoMap.length; i++) {
      if (cursor >= tick) break
      const effectiveStart = Math.max(cursor, tempoMap[i].tick)
      const effectiveEnd = Math.min(tick, tempoMap[i + 1]?.tick ?? tick)
      if (effectiveEnd > effectiveStart) {
        seconds += ((effectiveEnd - effectiveStart) / divisions) * (60 / tempoMap[i].bpm)
      }
      cursor = effectiveEnd
    }
    return seconds
  }

  const parts = doc.querySelectorAll('part')
  const partListEls = doc.querySelectorAll('part-list > score-part')
  const tracks = []

  parts.forEach((partEl, partIndex) => {
    const partId = partEl.getAttribute('id') ?? `P${partIndex + 1}`
    const scorePartEl = [...partListEls].find(el => el.getAttribute('id') === partId)
    const partName = scorePartEl?.querySelector('part-name')?.textContent?.trim() || `Part ${partIndex + 1}`
    const instrName = scorePartEl?.querySelector('score-instrument instrument-name')?.textContent?.trim() || 'unknown'
    const midiChannel = parseInt(scorePartEl?.querySelector('midi-instrument midi-channel')?.textContent ?? '0')
    const isDrums = midiChannel === 10 || /drum|perc/i.test(instrName)

    const { tempoMap } = buildTempoMap(partEl)
    const notes = []
    let tick = 0
    let divisions = 1

    for (const measure of partEl.querySelectorAll('measure')) {
      const divEl = measure.querySelector('attributes > divisions')
      if (divEl) divisions = parseInt(divEl.textContent)

      const measureStartTick = tick
      const voiceTicks = {}
      const voiceLastTick = {}

      for (const child of measure.children) {
        if (child.tagName !== 'note') continue
        const isChord = child.querySelector('chord') !== null
        const isRest = child.querySelector('rest') !== null
        const dur = parseInt(child.querySelector('duration')?.textContent ?? '0')
        const voice = child.querySelector('voice')?.textContent?.trim() ?? '1'

        if (!(voice in voiceTicks)) voiceTicks[voice] = measureStartTick
        if (!(voice in voiceLastTick)) voiceLastTick[voice] = measureStartTick

        const noteTick = isChord ? voiceLastTick[voice] : voiceTicks[voice]

        if (!isRest) {
          const stepEl = child.querySelector('pitch > step')
          const alterEl = child.querySelector('pitch > alter')
          const octaveEl = child.querySelector('pitch > octave')
          if (stepEl && octaveEl) {
            const step = stepEl.textContent.trim()
            const alter = alterEl ? parseInt(alterEl.textContent) : 0
            const octave = parseInt(octaveEl.textContent)
            const stepIndex = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(step)
            const semitones = [0, 2, 4, 5, 7, 9, 11][stepIndex] + alter
            const noteIndex = ((semitones % 12) + 12) % 12
            const noteName = NOTE_NAMES[noteIndex] + octave
            const startSec = ticksToSeconds(noteTick, tempoMap, divisions)
            const endSec = ticksToSeconds(noteTick + dur, tempoMap, divisions)
            const velocityEl = child.querySelector('dynamics')
            const velocity = velocityEl ? Math.min(1, parseFloat(velocityEl.textContent) / 90) : 0.8
            notes.push({ name: noteName, time: startSec, duration: Math.max(0.05, endSec - startSec), velocity })
          }
        }

        if (!isChord) {
          voiceLastTick[voice] = voiceTicks[voice]
          voiceTicks[voice] += dur
        }
      }

      tick = measureStartTick + Math.max(...Object.values(voiceTicks).map(v => v - measureStartTick))
    }

    tracks.push({ name: partName, instrument: instrName, family: isDrums ? 'drums' : 'pitched', channel: isDrums ? 9 : 0, noteCount: notes.length, isDrums, notes })
  })

  return { tracks }
}

async function parseMxl(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer)
  let xmlText = null
  const containerFile = zip.file('META-INF/container.xml')
  if (containerFile) {
    const containerText = await containerFile.async('text')
    const containerDoc = new DOMParser().parseFromString(containerText, 'application/xml')
    const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path')
    if (rootfilePath) {
      const rootFile = zip.file(rootfilePath)
      if (rootFile) xmlText = await rootFile.async('text')
    }
  }
  if (!xmlText) {
    const xmlFiles = Object.keys(zip.files).filter(f => f.endsWith('.xml') && !f.startsWith('META-INF'))
    if (xmlFiles.length > 0) xmlText = await zip.files[xmlFiles[0]].async('text')
  }
  if (!xmlText) throw new Error('No MusicXML found inside .mxl file')
  return parseMusicXML(xmlText)
}

function App() {
  const [file, setFile] = useState(null)
  const [tracks, setTracks] = useState([])
  const [enabledTracks, setEnabledTracks] = useState(new Set())
  const [notes, setNotes] = useState([])
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(60)
  const [scrollSpeed, setScrollSpeed] = useState(200)
  const [loading, setLoading] = useState(false)
  const [showTracks, setShowTracks] = useState(false)
  const [colorMode, setColorMode] = useState('note')
  const [styleMode, setStyleMode] = useState('solid')
  const [singleColor, setSingleColor] = useState('#7F77DD')
  const [cornerRadius, setCornerRadius] = useState(4)
  const [bgColor, setBgColor] = useState('#1a1a2e')
  const [trackColors, setTrackColors] = useState({})
  const [showOctaveLines, setShowOctaveLines] = useState(true)
  const [hitEffect, setHitEffect] = useState('particles')
  const [showSettings, setShowSettings] = useState(false)
  const [glowIntensity, setGlowIntensity] = useState(1)
  const [colorScale, setColorScale] = useState('spectrum')

  const seekBarRef = useRef(null)
  const rendererWrapperRef = useRef(null)
  const songLengthRef = useRef(0)
  const midiRef = useRef(null)
  const samplerRef = useRef(null)
  const samplerLoadingRef = useRef(false)
  const volRef = useRef(null)
  const speedRef = useRef(1)
  const scrollSpeedRef = useRef(200)
  const enabledTracksRef = useRef(new Set())
  const playVisualStartRef = useRef(null)
  const pausedAtRef = useRef(null)
  const endTimerRef = useRef(null)
  const schedulerRef = useRef(null)
  const nextNoteIndexRef = useRef(0)
  const sortedNotesRef = useRef([])
  const playbackStartToneRef = useRef(0)
  const resumeFromRef = useRef(0)
  const canvasHeightRef = useRef(0)
  // playStartSongPosRef: song position at the moment playVisualStartRef was set.
  // getCurrentSongPosition = playStartSongPosRef + (now - playVisualStartRef) * speed
  const playStartSongPosRef = useRef(0)

  const LOOKAHEAD = 0.3
  const INTERVAL = 50

  useEffect(() => {
    let rafId
    function updateBar() {
      if (seekBarRef.current && songLengthRef.current > 0) {
        const pos = getCurrentSongPosition()
        const ratio = Math.min(1, Math.max(0, pos / songLengthRef.current))
        seekBarRef.current.style.setProperty('--progress', `${ratio * 100}%`)
        seekBarRef.current.dataset.pos = formatTime(pos)
      }
      rafId = requestAnimationFrame(updateBar)
    }
    rafId = requestAnimationFrame(updateBar)
    return () => cancelAnimationFrame(rafId)
  }, [])

  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      if (e.key === ' ') {
        e.preventDefault()
        if (playing) handlePause()
        else if (paused) handleResume()
        else handlePlay()
      } else if (e.key === 'r' || e.key === 'R') {
        handleRestart()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleSeek(Math.max(0, getCurrentSongPosition() - 5) / songLengthRef.current)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleSeek(Math.min(1, (getCurrentSongPosition() + 5) / songLengthRef.current))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setVolume(prev => {
          const next = Math.min(100, prev + 5)
          if (volRef.current) volRef.current.volume.value = next === 0 ? -Infinity : (next - 100) * 0.3
          return next
        })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setVolume(prev => {
          const next = Math.max(0, prev - 5)
          if (volRef.current) volRef.current.volume.value = next === 0 ? -Infinity : (next - 100) * 0.3
          return next
        })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [playing, paused])

  // True song position in seconds, independent of lead-in.
  function getCurrentSongPosition() {
    if (pausedAtRef.current !== null && !playVisualStartRef.current) return pausedAtRef.current
    if (!playVisualStartRef.current) return 0
    const elapsed = performance.now() / 1000 - playVisualStartRef.current
    return Math.min(songLengthRef.current, Math.max(0, playStartSongPosRef.current + elapsed * speedRef.current))
  }

  async function ensureSampler() {
    if (samplerRef.current?.loaded && !samplerLoadingRef.current) return
    if (samplerLoadingRef.current) {
      await new Promise(resolve => {
        const check = setInterval(() => {
          if (!samplerLoadingRef.current) { clearInterval(check); resolve() }
        }, 50)
      })
      return
    }
    samplerLoadingRef.current = true
    if (samplerRef.current) { try { samplerRef.current.dispose() } catch { } }
    if (volRef.current) { try { volRef.current.dispose() } catch { } }
    await new Promise((resolve) => {
      const vol = new Tone.Volume(volume === 0 ? -Infinity : (volume - 100) * 0.3).toDestination()
      volRef.current = vol
      samplerRef.current = new Tone.Sampler({
        urls: {
          A0: 'A0.mp3', C1: 'C1.mp3', 'F#1': 'Fs1.mp3',
          A1: 'A1.mp3', C2: 'C2.mp3', 'F#2': 'Fs2.mp3',
          A2: 'A2.mp3', C3: 'C3.mp3', 'F#3': 'Fs3.mp3',
          A3: 'A3.mp3', C4: 'C4.mp3', 'F#4': 'Fs4.mp3',
          A4: 'A4.mp3', C5: 'C5.mp3', 'F#5': 'Fs5.mp3',
          A5: 'A5.mp3', C6: 'C6.mp3', 'F#6': 'Fs6.mp3',
          A6: 'A6.mp3', C7: 'C7.mp3', 'F#7': 'Fs7.mp3',
          A7: 'A7.mp3', C8: 'C8.mp3',
        },
        baseUrl: 'https://tonejs.github.io/audio/salamander/',
        onload: () => { samplerLoadingRef.current = false; resolve() },
        onerror: (e) => { console.error('Sampler error:', e); samplerLoadingRef.current = false; resolve() }
      }).connect(vol)
    })
  }

  function stopScheduler() {
    if (schedulerRef.current) { clearInterval(schedulerRef.current); schedulerRef.current = null }
  }

  function clearTimer() {
    if (endTimerRef.current) { clearTimeout(endTimerRef.current); endTimerRef.current = null }
  }

  function buildSortedNotes(resumeFrom) {
    const enabled = enabledTracksRef.current
    const all = []
    midiRef.current.tracks.forEach((track, i) => {
      if (!enabled.has(i) || track.isDrums) return
      track.notes.forEach(note => {
        if (note.time + note.duration < resumeFrom) return
        all.push(note)
      })
    })
    all.sort((a, b) => a.time - b.time)
    return all
  }

  function startScheduler() {
    stopScheduler()
    schedulerRef.current = setInterval(() => {
      const sampler = samplerRef.current
      if (!sampler?.loaded) return
      const s = speedRef.current
      const now = Tone.now()
      const scheduleUntil = now + LOOKAHEAD
      const notes = sortedNotesRef.current
      const resumeFrom = resumeFromRef.current
      const startTone = playbackStartToneRef.current
      while (nextNoteIndexRef.current < notes.length) {
        const note = notes[nextNoteIndexRef.current]
        const when = startTone + (note.time - resumeFrom) / s
        if (when > scheduleUntil) break
        if (when >= now - 0.01) {
          try { sampler.triggerAttackRelease(note.name, note.duration / s, Math.max(when, now)) } catch { }
        }
        nextNoteIndexRef.current++
      }
    }, INTERVAL)
  }

  // startPlayback: the core function for both fresh play and resume.
  //
  // Visual timing:
  //   The renderer draws notes at:  y = rollHeight - (note.time - songPosition) * scrollSpeed
  //   songPosition in renderer   =  (elapsed - leadIn) * speed   where elapsed = now - playVisualStartRef
  //
  //   We want songPosition == resumeFrom exactly when audio fires (leadIn seconds from now).
  //   So: (leadIn - leadIn) * speed = 0... that means we set playVisualStartRef such that
  //   elapsed = leadIn when song position = resumeFrom.
  //   elapsed = now - playVisualStartRef => playVisualStartRef = nowPerf - leadIn + resumeFrom/speed... wait:
  //
  //   Actually renderer uses: songPos = (elapsed - leadIn) * speed
  //   We want songPos = resumeFrom at elapsed = leadIn (audio fires at nowTone + leadIn):
  //   (leadIn - leadIn)*speed = 0 ≠ resumeFrom for resumeFrom > 0.
  //
  //   So renderer formula must be: songPos = resumeFrom + (elapsed - leadIn) * speed
  //   => at elapsed=leadIn: songPos = resumeFrom ✓
  //   => playVisualStartRef = nowPerf (elapsed starts at 0 now)
  //   => playStartSongPosRef = resumeFrom - leadIn * speed  (so getCurrentSongPosition is correct too)
  //
  // For RESUME (noLeadIn=true): audio fires immediately (leadIn=0), visual also starts immediately.
  //   songPos = resumeFrom + elapsed * speed
  //   playVisualStartRef = nowPerf, playStartSongPosRef = resumeFrom
  //   audio fires at nowTone (no delay)

  async function startPlayback(resumeFrom = 0, noLeadIn = false) {
    await Tone.start()
    if (!samplerRef.current?.loaded) {
      await ensureSampler()
    }

    const ss = scrollSpeedRef.current
    const rollHeight = Math.max(100, (canvasHeightRef.current || rendererWrapperRef.current?.offsetHeight || 500) - 160)
    const leadIn = noLeadIn ? 0 : rollHeight / ss
    const nowPerf = performance.now() / 1000
    const nowTone = Tone.now()

    // Encode leadIn into playStartSongPosRef so renderer formula is always:
    //   songPosition = playStartSongPosRef + elapsed * speed
    // Fresh play:  playStartSongPosRef = resumeFrom - leadIn * speed (negative, counts up to resumeFrom)
    // Resume:      playStartSongPosRef = resumeFrom (leadIn=0, starts immediately)
    playVisualStartRef.current = nowPerf
    playStartSongPosRef.current = resumeFrom - leadIn * speedRef.current

    playbackStartToneRef.current = nowTone + leadIn
    resumeFromRef.current = resumeFrom
    sortedNotesRef.current = buildSortedNotes(resumeFrom)
    nextNoteIndexRef.current = 0
    startScheduler()

    const remaining = songLengthRef.current - resumeFrom
    const timerDelay = (leadIn + remaining / speedRef.current) * 1000

    endTimerRef.current = setTimeout(() => {
      stopScheduler()
      playVisualStartRef.current = null
      pausedAtRef.current = null
      setPlaying(false)
      setPaused(false)
    }, timerDelay)

    setPlaying(true)
    setPaused(false)
  }

  async function handleSeek(ratio) {
    if (!midiRef.current || songLengthRef.current === 0) return
    const seekTo = Math.max(0, Math.min(songLengthRef.current, ratio * songLengthRef.current))
    stopScheduler()
    clearTimer()
    try { Tone.getContext().rawContext.suspend() } catch { }
    playVisualStartRef.current = null
    pausedAtRef.current = seekTo
    setPlaying(false)
    setPaused(true)
    try { await Tone.getContext().rawContext.resume() } catch { }
    setLoading(true)
    await startPlayback(seekTo, true)  // <-- true: no lead-in, fires immediately like resume
    setLoading(false)
  }

  function handleSeekBarClick(e) {
    if (!midiRef.current || songLengthRef.current === 0) return
    const bar = seekBarRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    handleSeek(ratio)
  }

  function loadNormalizedSong(parsed) {
    midiRef.current = parsed
    const allNotes = parsed.tracks.flatMap(t => t.notes)
    songLengthRef.current = allNotes.length > 0
      ? Math.max(...allNotes.map(n => n.time + n.duration)) : 0

    const trackMeta = parsed.tracks.map((track, i) => ({
      index: i,
      name: track.name || `Track ${i + 1}`,
      instrument: track.instrument || 'unknown',
      family: track.family || 'unknown',
      channel: track.channel ?? 0,
      noteCount: track.notes.length,
      isDrums: track.isDrums ?? false,
    }))

    const EXCLUDED_FAMILIES = ['drums', 'percussion']
    const EXCLUDED_INSTRUMENTS = ['drum', 'percussion', 'kick', 'snare', 'hi-hat', 'hihat', 'cymbal', 'tom', 'clap']
    const EXCLUDED_NAMES = ['drum', 'percussion', 'kick', 'snare', 'hi-hat', 'hihat', 'cymbal', 'sfx', 'effect', 'fx']

    const autoEnabled = new Set(
      trackMeta.filter(t => {
        if (t.isDrums || t.noteCount === 0) return false
        if (EXCLUDED_FAMILIES.some(f => t.family.toLowerCase().includes(f))) return false
        if (EXCLUDED_INSTRUMENTS.some(f => t.instrument.toLowerCase().includes(f))) return false
        if (EXCLUDED_NAMES.some(f => t.name.toLowerCase().includes(f))) return false
        return true
      }).map(t => t.index)
    )

    if (autoEnabled.size === 0) {
      const best = trackMeta
        .filter(t => !t.isDrums && t.noteCount > 0)
        .sort((a, b) => b.noteCount - a.noteCount)[0]
      if (best) autoEnabled.add(best.index)
    }

    setTracks(trackMeta)
    setEnabledTracks(autoEnabled)
    enabledTracksRef.current = autoEnabled
    setTrackColors({})
    rebuildNotes(parsed, autoEnabled)
  }

  async function handleUpload(e) {
    const uploaded = e.target.files[0]
    if (!uploaded) return
    stopScheduler()
    clearTimer()
    playVisualStartRef.current = null
    pausedAtRef.current = null
    songLengthRef.current = 0
    setPlaying(false)
    setPaused(false)
    setNotes([])
    setTracks([])
    setEnabledTracks(new Set())
    enabledTracksRef.current = new Set()
    setFile(uploaded)

    const name = uploaded.name.toLowerCase()
    if (name.endsWith('.mid') || name.endsWith('.midi')) {
      const buffer = await uploaded.arrayBuffer()
      const midi = new Midi(buffer)
      const parsed = {
        tracks: midi.tracks.map(track => ({
          name: track.name || '',
          instrument: track.instrument.name || 'unknown',
          family: track.instrument.family || 'unknown',
          channel: track.channel,
          noteCount: track.notes.length,
          isDrums: track.channel === 9,
          notes: track.notes.map(n => ({ name: n.name, time: n.time, duration: n.duration, velocity: n.velocity ?? 0.8 })),
        }))
      }
      loadNormalizedSong(parsed)
    } else if (name.endsWith('.xml') || name.endsWith('.musicxml')) {
      const text = await uploaded.text()
      loadNormalizedSong(parseMusicXML(text))
    } else if (name.endsWith('.mxl')) {
      const buffer = await uploaded.arrayBuffer()
      loadNormalizedSong(await parseMxl(buffer))
    }
  }

  function rebuildNotes(parsed, enabled) {
    const extracted = []
    parsed.tracks.forEach((track, i) => {
      if (!enabled.has(i)) return
      track.notes.forEach(note => {
        extracted.push({ name: note.name, time: note.time, duration: note.duration, velocity: note.velocity ?? 0.8, trackIndex: i })
      })
    })
    extracted.sort((a, b) => a.time - b.time || b.duration - a.duration)

    // Remove overlapping notes on the same pitch: keep the first (longest) one,
    // trim or drop anything that overlaps it.
    const perPitch = {}
    const deduped = []
    for (const note of extracted) {
      const key = note.name
      const prev = perPitch[key]
      if (prev && note.time < prev.time + prev.duration) {
        // Overlaps with previous note on this pitch — skip it
        continue
      }
      perPitch[key] = note
      deduped.push(note)
    }

    deduped.sort((a, b) => a.time - b.time)
    setNotes(deduped)
  }

  function toggleTrack(index) {
    if (playing) return
    setEnabledTracks(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      enabledTracksRef.current = next
      rebuildNotes(midiRef.current, next)
      return next
    })
  }

  async function handlePlay() {
    if (!midiRef.current || playing) return
    setLoading(true)
    await startPlayback(0, false)
    setLoading(false)
  }

  function handlePause() {
    if (!playing || paused) return
    const songPosition = getCurrentSongPosition()
    pausedAtRef.current = songPosition
    stopScheduler()
    clearTimer()
    Tone.getContext().rawContext.suspend()
    playVisualStartRef.current = null
    setPlaying(false)
    setPaused(true)
  }

  async function handleResume() {
    if (playing || !paused) return
    // Resume with noLeadIn=true: audio fires immediately, no countdown delay
    try { Tone.getContext().rawContext.resume() } catch { }
    await startPlayback(pausedAtRef.current, true)
  }

  async function handleRestart() {
    stopScheduler()
    clearTimer()
    try { await Tone.getContext().rawContext.resume() } catch { }
    playVisualStartRef.current = null
    pausedAtRef.current = null
    setPlaying(false)
    setPaused(false)
    setTimeout(async () => {
      setLoading(true)
      await startPlayback(0, false)
      setLoading(false)
    }, 100)
  }

  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const speedDisabled = playing

  const DEFAULT_TRACK_COLORS = [
    '#7F77DD', '#1D9E75', '#D85A30', '#D4537E',
    '#378ADD', '#BA7517', '#639922', '#9B59B6',
  ]

  return (
    <div style={{ fontFamily: 'sans-serif', background: '#1a1a2e', height: '100vh', color: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #333', flexShrink: 0, overflowX: 'auto' }}>

        <h1 style={{ fontSize: '18px', margin: 0, letterSpacing: '0.05em', color: '#7F77DD', flexShrink: 0 }}>KeyFlow</h1>

        <div style={{ width: '1px', height: '28px', background: '#333', flexShrink: 0 }} />

        <input type="file" accept=".mid,.midi,.xml,.musicxml,.mxl" onChange={handleUpload}
          style={{ fontSize: '12px', color: '#aaa', flexShrink: 0 }} />

        <div style={{ width: '1px', height: '28px', background: '#333', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {!playing && !paused && (
            <button onClick={handlePlay} disabled={loading || !midiRef.current || enabledTracks.size === 0}
              style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#7F77DD', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
              {loading ? '...' : '▶'}
            </button>
          )}
          {paused && (
            <button onClick={handleResume}
              style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#7F77DD', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
              ▶
            </button>
          )}
          {playing && (
            <button onClick={handlePause}
              style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#555', color: 'white', cursor: 'pointer', fontSize: '13px' }}>
              ⏸
            </button>
          )}
          <button onClick={handleRestart} disabled={!midiRef.current || loading}
            style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '13px' }}>
            ↺
          </button>
          <button onClick={() => handleSeek(Math.max(0, getCurrentSongPosition() - 10) / songLengthRef.current)}
            disabled={!midiRef.current || loading}
            style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '11px' }}>
            «10
          </button>
          <button onClick={() => handleSeek(Math.max(0, getCurrentSongPosition() - 5) / songLengthRef.current)}
            disabled={!midiRef.current || loading}
            style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '11px' }}>
            «5
          </button>
          <button onClick={() => handleSeek(Math.min(1, (getCurrentSongPosition() + 5) / songLengthRef.current))}
            disabled={!midiRef.current || loading}
            style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '11px' }}>
            5»
          </button>
          <button onClick={() => handleSeek(Math.min(1, (getCurrentSongPosition() + 10) / songLengthRef.current))}
            disabled={!midiRef.current || loading}
            style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '11px' }}>
            10»
          </button>
        </div>

        <div style={{ width: '1px', height: '28px', background: '#333', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <ControlKnob label="Vol" value={volume} min={0} max={100} step={1}
            onChange={v => { setVolume(v); if (volRef.current) volRef.current.volume.value = v === 0 ? -Infinity : (v - 100) * 0.3 }}
            format={v => `${v}%`} />
          <ControlKnob label="Speed" value={speed} min={0.25} max={2} step={0.05}
            disabled={speedDisabled}
            onChange={v => { setSpeed(v); speedRef.current = v }}
            format={v => `${v.toFixed(2)}x`} />
          <ControlKnob label="Scroll" value={scrollSpeed} min={50} max={1000} step={10}
            disabled={playing}
            onChange={v => { setScrollSpeed(v); scrollSpeedRef.current = v }}
            format={v => `${v}px`} />
        </div>

        <div style={{ width: '1px', height: '28px', background: '#333', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '10px', color: '#666' }}>Color</span>
            <select value={colorMode} onChange={e => setColorMode(e.target.value)}
              style={{ background: '#2a2a40', color: 'white', border: '1px solid #444', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
              <option value="note">By Note</option>
              <option value="track">By Track</option>
              <option value="velocity">By Velocity</option>
              <option value="pitch">By Pitch</option>
              <option value="single">Single</option>
            </select>
          </div>
          {colorMode === 'single' && (
            <input type="color" value={singleColor} onChange={e => setSingleColor(e.target.value)}
              style={{ width: '28px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0, marginTop: '14px' }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '10px', color: '#666' }}>Style</span>
            <select value={styleMode} onChange={e => setStyleMode(e.target.value)}
              style={{ background: '#2a2a40', color: 'white', border: '1px solid #444', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
              <option value="solid">Solid</option>
              <option value="gradient">Gradient</option>
              <option value="glow">Glow</option>
              <option value="outlined">Outlined</option>
            </select>
          </div>
        </div>

        <div style={{ width: '1px', height: '28px', background: '#333', flexShrink: 0 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {tracks.length > 0 && (
            <button onClick={() => setShowTracks(p => !p)}
              style={{ padding: '5px 12px', borderRadius: '6px', border: `1px solid ${showTracks ? '#7F77DD' : '#444'}`, background: showTracks ? '#7F77DD22' : 'transparent', color: showTracks ? '#7F77DD' : '#888', cursor: 'pointer', fontSize: '12px' }}>
              Tracks {enabledTracks.size}/{tracks.filter(t => t.noteCount > 0).length}
            </button>
          )}
          <button onClick={() => setShowSettings(p => !p)}
            style={{ padding: '5px 12px', borderRadius: '6px', border: `1px solid ${showSettings ? '#7F77DD' : '#444'}`, background: showSettings ? '#7F77DD22' : 'transparent', color: showSettings ? '#7F77DD' : '#888', cursor: 'pointer', fontSize: '12px' }}>
            ⚙ Settings
          </button>
        </div>
      </div>

      {midiRef.current && (
        <div ref={seekBarRef} onClick={handleSeekBarClick}
          style={{ position: 'relative', height: '20px', background: '#16213e', cursor: 'pointer', borderBottom: '1px solid #333', flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 'var(--progress, 0%)', background: '#7F77DD', pointerEvents: 'none' }} />
          <TimeDisplay seekBarRef={seekBarRef} formatTime={formatTime} songLengthRef={songLengthRef} />
        </div>
      )}

      {showSettings && (
        <div style={{ background: '#16213e', borderBottom: '1px solid #333', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0, flexWrap: 'wrap' }}>
          <ControlKnob label="Radius" value={cornerRadius} min={0} max={20} step={1}
            onChange={v => setCornerRadius(v)} format={v => `${v}px`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#666' }}>BG Color</span>
            <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
              style={{ width: '52px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#666' }}>Octave Lines</span>
            <button onClick={() => setShowOctaveLines(p => !p)}
              style={{ padding: '4px 10px', borderRadius: '4px', border: `1px solid ${showOctaveLines ? '#7F77DD' : '#444'}`, background: showOctaveLines ? '#7F77DD22' : 'transparent', color: showOctaveLines ? '#7F77DD' : '#888', cursor: 'pointer', fontSize: '12px' }}>
              {showOctaveLines ? 'On' : 'Off'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#666' }}>Hit Effect</span>
            <select value={hitEffect} onChange={e => setHitEffect(e.target.value)}
              style={{ background: '#2a2a40', color: 'white', border: '1px solid #444', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
              <option value="none">None</option>
              <option value="particles">Particles</option>
              <option value="sparkles">Sparkles</option>
              <option value="ripple">Ripple</option>
              <option value="glow">Glow Ring</option>
              <option value="explosion">Explosion</option>
            </select>
          </div>
          {colorMode === 'note' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '10px', color: '#666' }}>Note Scale</span>
              <select value={colorScale} onChange={e => setColorScale(e.target.value)}
                style={{ background: '#2a2a40', color: 'white', border: '1px solid #444', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }}>
                <option value="spectrum">Spectrum</option>
                <option value="warm">Warm</option>
                <option value="cool">Cool</option>
                <option value="pastel">Pastel</option>
                <option value="neon">Neon</option>
              </select>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#666' }}>Glow Intensity</span>
            <input type="range" min="0" max="2" step="0.1" value={glowIntensity} onChange={e => setGlowIntensity(parseFloat(e.target.value))}
              style={{ background: '#2a2a40', border: '1px solid #444', borderRadius: '4px', padding: '3px 6px', fontSize: '12px' }} />
          </div>
        </div>
      )}

      {showTracks && (
        <div style={{ background: '#16213e', borderBottom: '1px solid #333', padding: '12px 24px', display: 'flex', flexWrap: 'wrap', gap: '8px', flexShrink: 0 }}>
          {tracks.filter(t => t.noteCount > 0).map((track, i) => (
            <div key={track.index} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button onClick={() => toggleTrack(track.index)} disabled={playing}
                style={{
                  padding: '6px 12px', borderRadius: '6px',
                  border: `1px solid ${enabledTracks.has(track.index) ? (trackColors[track.index] || DEFAULT_TRACK_COLORS[i % DEFAULT_TRACK_COLORS.length]) : '#444'}`,
                  background: enabledTracks.has(track.index) ? (trackColors[track.index] || DEFAULT_TRACK_COLORS[i % DEFAULT_TRACK_COLORS.length]) + '33' : 'transparent',
                  color: enabledTracks.has(track.index) ? '#fff' : '#888',
                  cursor: playing ? 'not-allowed' : 'pointer', fontSize: '12px', textAlign: 'left',
                }}>
                <div style={{ fontWeight: 'bold' }}>{track.name}</div>
                <div style={{ opacity: 0.7 }}>{track.isDrums ? '🥁 Drums' : track.instrument} · {track.noteCount} notes</div>
              </button>
              {colorMode === 'track' && (
                <input type="color"
                  value={trackColors[track.index] || DEFAULT_TRACK_COLORS[i % DEFAULT_TRACK_COLORS.length]}
                  onChange={e => setTrackColors(prev => ({ ...prev, [track.index]: e.target.value }))}
                  title={`Color for ${track.name}`}
                  style={{ width: '24px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0 }} />
              )}
            </div>
          ))}
        </div>
      )}

      <div ref={rendererWrapperRef} style={{ flex: 1, minHeight: 0 }}>
        <SynthesiaRenderer
          notes={notes}
          playing={playing}
          paused={paused}
          pausedAtRef={pausedAtRef}
          playVisualStartRef={playVisualStartRef}
          playStartSongPosRef={playStartSongPosRef}
          speedRef={speedRef}
          scrollSpeed={scrollSpeed}
          colorMode={colorMode}
          styleMode={styleMode}
          singleColor={singleColor}
          cornerRadius={cornerRadius}
          bgColor={bgColor}
          trackColors={trackColors}
          showOctaveLines={showOctaveLines}
          hitEffect={hitEffect}
          glowIntensity={glowIntensity}
          colorScale={colorScale}
          canvasHeightRef={canvasHeightRef}
        />
      </div>
    </div>
  )
}

export default App