import { useEffect, useRef } from 'react'

const NOTE_COLORS = {
  C: '#FF4D4D',
  'C#': '#FF7A33', Db: '#FF7A33',
  D: '#FFA500',
  'D#': '#FFD700', Eb: '#FFD700',
  E: '#AACC00',
  F: '#44BB44',
  'F#': '#11AA88', Gb: '#11AA88',
  G: '#1199CC',
  'G#': '#3366FF', Ab: '#3366FF',
  A: '#7744EE',
  'A#': '#BB33CC', Bb: '#BB33CC',
  B: '#EE3399',
}

const DEFAULT_TRACK_COLORS = [
  '#7F77DD', '#1D9E75', '#D85A30', '#D4537E',
  '#378ADD', '#BA7517', '#639922', '#9B59B6',
  '#E74C3C', '#1ABC9C', '#F39C12', '#2980B9',
]

function colorToRgba(color, alpha) {
  if (color.startsWith('hsl(')) {
    return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`)
  }
  if (color.startsWith('#')) {
    const { r, g, b } = hexToRgb(color)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}

function getLetter(noteName) {
  const match = noteName.match(/^([A-Ga-g][#b]?)/)
  return match ? match[1] : noteName.charAt(0).toUpperCase()
}

function getMidiNumber(noteName) {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  let name = noteName.replace(/[0-9]/g, '')
  name = name.replace('Db', 'C#').replace('Eb', 'D#').replace('Fb', 'E')
    .replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#').replace('Cb', 'B')
  const octave = parseInt(noteName.replace(/[^0-9]/g, ''))
  return notes.indexOf(name) + (octave + 1) * 12
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

function lighten(hex, amount = 60) {
  try {
    const { r, g, b } = hexToRgb(hex)
    return `rgb(${Math.min(255, r + amount)},${Math.min(255, g + amount)},${Math.min(255, b + amount)})`
  } catch { return hex }
}

function darken(hex, amount = 60) {
  try {
    const { r, g, b } = hexToRgb(hex)
    return `rgb(${Math.max(0, r - amount)},${Math.max(0, g - amount)},${Math.max(0, b - amount)})`
  } catch { return hex }
}

function colorToHex(color) {
  return color.startsWith('#') ? color : '#7F77DD'
}

function pitchColor(midi) {
  const ratio = (midi - 21) / (108 - 21)
  const h = Math.round((1 - ratio) * 240)
  return `hsl(${h}, 80%, 55%)`
}

function velocityColor(velocity) {
  const v = velocity / 127
  const h = 220
  const s = Math.round(80 - v * 50)
  const l = Math.round(30 + v * 45)
  return `hsl(${h},${s}%,${l}%)`
}

const BLACK_KEYS = [1, 3, 6, 8, 10]
function isBlackKey(midi) { return BLACK_KEYS.includes(midi % 12) }

function SynthesiaRenderer({
  notes, playing, paused, pausedAtRef, playVisualStartRef, playStartSongPosRef, speedRef, scrollSpeed,
  colorMode, styleMode, singleColor, cornerRadius, bgColor, trackColors,
  showOctaveLines, hitEffect, glowIntensity, colorScale, canvasHeightRef
}) {
  const canvasRef = useRef(null)

  const notesRef = useRef(notes)
  const scrollSpeedRef = useRef(scrollSpeed)
  const colorModeRef = useRef(colorMode)
  const styleModeRef = useRef(styleMode)
  const singleColorRef = useRef(singleColor)
  const cornerRadiusRef = useRef(cornerRadius ?? 4)
  const bgColorRef = useRef(bgColor ?? '#1a1a2e')
  const trackColorsRef = useRef(trackColors ?? {})
  const showOctaveLinesRef = useRef(showOctaveLines ?? true)
  const hitEffectRef = useRef(hitEffect ?? 'particles')
  const glowIntensityRef = useRef(glowIntensity ?? 1)
  const colorScaleRef = useRef(colorScale ?? 'spectrum')

  const pianoHeightRef = useRef(160)
  const particlesRef = useRef([])
  const prevActiveRef = useRef(new Set())
  const glowStateRef = useRef({})

  notesRef.current = notes
  scrollSpeedRef.current = scrollSpeed
  colorModeRef.current = colorMode
  styleModeRef.current = styleMode
  singleColorRef.current = singleColor
  cornerRadiusRef.current = cornerRadius ?? 4
  bgColorRef.current = bgColor ?? '#1a1a2e'
  trackColorsRef.current = trackColors ?? {}
  showOctaveLinesRef.current = showOctaveLines ?? true
  hitEffectRef.current = hitEffect ?? 'particles'
  glowIntensityRef.current = glowIntensity ?? 1
  colorScaleRef.current = colorScale ?? 'spectrum'

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animationId
    const minMidi = 21
    const maxMidi = 108

    let layoutCache = null

    function getLayout() {
      const w = canvas.width
      if (layoutCache && layoutCache.canvasW === w) return layoutCache
      const whiteKeyX = {}
      let wi = 0
      for (let m = minMidi; m < maxMidi; m++) {
        if (!isBlackKey(m)) { whiteKeyX[m] = wi; wi++ }
      }
      layoutCache = { whiteKeyX, wkw: w / wi, canvasW: w }
      return layoutCache
    }

    function applySize(w, h) {
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
        layoutCache = null
        if (canvasHeightRef) canvasHeightRef.current = h
      }
    }

    const container = canvas.parentElement
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        applySize(Math.round(width), Math.round(height))
      }
    })
    ro.observe(container)
    applySize(Math.round(container.offsetWidth), Math.round(container.offsetHeight))

    function getKeyX(midi, whiteKeyX, wkw) {
      if (!isBlackKey(midi)) return whiteKeyX[midi] * wkw
      return (whiteKeyX[midi - 1] * wkw + wkw + whiteKeyX[midi + 1] * wkw) / 2 - wkw * 0.3
    }

    function getKeyWidth(midi, wkw) { return isBlackKey(midi) ? wkw * 0.6 : wkw - 1 }

    function getNoteColor(note, midi) {
      const mode = colorModeRef.current
      if (mode === 'single') return singleColorRef.current
      if (mode === 'pitch') return pitchColor(midi)
      if (mode === 'velocity') return velocityColor(note.velocity ?? 80)
      if (mode === 'track') {
        const custom = trackColorsRef.current[note.trackIndex]
        return custom || DEFAULT_TRACK_COLORS[(note.trackIndex ?? 0) % DEFAULT_TRACK_COLORS.length]
      }
      const letter = getLetter(note.name)
      const normalized = letter
        .replace('Db', 'C#').replace('Eb', 'D#').replace('Fb', 'E')
        .replace('Gb', 'F#').replace('Ab', 'G#').replace('Bb', 'A#').replace('Cb', 'B')
      const semitone = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(normalized)
      const t = semitone < 0 ? 0 : semitone / 11
      const scale = colorScaleRef.current
      try {
        if (scale === 'spectrum') return `hsl(${Math.round(t * 300)}, 85%, 55%)`
        if (scale === 'warm') return `hsl(${Math.round(t * 60)}, 90%, ${50 + t * 15}%)`
        if (scale === 'cool') return `hsl(${180 + Math.round(t * 120)}, 80%, 55%)`
        if (scale === 'pastel') return `hsl(${Math.round(t * 300)}, 60%, 72%)`
        if (scale === 'neon') return `hsl(${Math.round(t * 300)}, 100%, 60%)`
      } catch { return '#7F77DD' }
      return NOTE_COLORS[normalized] || '#7F77DD'
    }

    function spawnParticles(x, noteWidth, color) {
      const effect = hitEffectRef.current
      const cy = canvas.height - pianoHeightRef.current
      if (effect === 'none') return

      if (effect === 'particles') {
        for (let i = 0; i < 12; i++) {
          const spread = noteWidth * 0.6
          particlesRef.current.push({
            x: x + noteWidth / 2 + (Math.random() - 0.5) * spread,
            y: cy - Math.random() * 4,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -(0.8 + Math.random() * 2.5),
            alpha: 0.7 + Math.random() * 0.3,
            size: 1.5 + Math.random() * 2.5,
            color, shape: 'circle', decay: 0.012 + Math.random() * 0.008,
            wobble: (Math.random() - 0.5) * 0.08
          })
        }
      }
      if (effect === 'sparkles') {
        for (let i = 0; i < 14; i++) {
          const angle = Math.random() * Math.PI * 2
          const speed = 0.5 + Math.random() * 2.5
          particlesRef.current.push({
            x: x + noteWidth / 2 + (Math.random() - 0.5) * noteWidth * 0.4,
            y: cy - Math.random() * 6,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1.5,
            alpha: 0.9, size: 1 + Math.random() * 2,
            color, shape: 'star', decay: 0.015 + Math.random() * 0.01,
            wobble: (Math.random() - 0.5) * 0.05
          })
        }
      }
      if (effect === 'ripple') {
        for (let i = 0; i < 2; i++) {
          particlesRef.current.push({
            x: x + noteWidth / 2, y: cy, vx: 0, vy: 0,
            alpha: 0.6 - i * 0.15, size: noteWidth * 0.3,
            color, shape: 'ripple', maxSize: noteWidth * (3 + i),
            decay: 0.025 + i * 0.008
          })
        }
        for (let i = 0; i < 6; i++) {
          particlesRef.current.push({
            x: x + noteWidth / 2 + (Math.random() - 0.5) * noteWidth,
            y: cy - Math.random() * 3,
            vx: (Math.random() - 0.5) * 1.2,
            vy: -(0.5 + Math.random() * 1.5),
            alpha: 0.5, size: 1 + Math.random() * 1.5,
            color, shape: 'circle', decay: 0.018,
            wobble: (Math.random() - 0.5) * 0.06
          })
        }
      }
      if (effect === 'glow') {
        for (let i = 0; i < 16; i++) {
          particlesRef.current.push({
            x: x + Math.random() * noteWidth,
            y: cy - Math.random() * 8,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -(0.4 + Math.random() * 1.8),
            alpha: 0.6 + Math.random() * 0.4,
            size: 1 + Math.random() * 2.5,
            color: 'white', shape: 'glow-dot', decay: 0.01 + Math.random() * 0.012,
            wobble: (Math.random() - 0.5) * 0.04
          })
        }
        particlesRef.current.push({
          x: x + noteWidth / 2, y: cy, vx: 0, vy: 0, alpha: 0.4,
          size: noteWidth * 0.8, color, shape: 'ripple',
          maxSize: noteWidth * 2.5, decay: 0.03
        })
      }
      if (effect === 'explosion') {
        for (let i = 0; i < 30; i++) {
          const angle = Math.random() * Math.PI * 2
          const speed = 1 + Math.random() * 5
          particlesRef.current.push({
            x: x + noteWidth / 2 + (Math.random() - 0.5) * noteWidth * 0.3,
            y: cy - Math.random() * 4,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            alpha: 0.8 + Math.random() * 0.2,
            size: 1 + Math.random() * 3,
            color, shape: 'circle', decay: 0.015 + Math.random() * 0.015,
            wobble: (Math.random() - 0.5) * 0.1
          })
        }
      }
    }

    function updateParticles() {
      particlesRef.current = particlesRef.current.filter(p => p.alpha > 0.01)
      particlesRef.current.forEach(p => {
        if (p.shape === 'ripple') {
          p.size += (p.maxSize - p.size) * 0.08
          p.alpha -= p.decay
        } else {
          if (p.wobble) p.vx += p.wobble * Math.sin(Date.now() * 0.01 + p.x)
          p.x += p.vx
          p.y += p.vy
          p.vy += 0.04
          p.vx *= 0.98
          p.alpha -= p.decay
          p.size *= 0.995
        }
      })
    }

    function drawParticles() {
      particlesRef.current.forEach(p => {
        ctx.save()
        ctx.globalAlpha = p.alpha
        if (p.shape === 'ripple') {
          ctx.strokeStyle = p.color
          ctx.shadowColor = p.color
          ctx.shadowBlur = 16
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(p.x, p.y, Math.max(0.1, p.size), 0, Math.PI * 2)
          ctx.stroke()
        } else if (p.shape === 'star') {
          ctx.fillStyle = p.color
          ctx.shadowColor = p.color
          ctx.shadowBlur = 8
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.beginPath()
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2
            ctx.lineTo(Math.cos(a) * p.size * 2.2, Math.sin(a) * p.size * 2.2)
            ctx.lineTo(Math.cos(a + Math.PI / 4) * p.size * 0.6, Math.sin(a + Math.PI / 4) * p.size * 0.6)
          }
          ctx.closePath()
          ctx.fill()
          ctx.restore()
        } else if (p.shape === 'glow-dot') {
          const r = Math.max(0.1, p.size * 2.5)
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
          grad.addColorStop(0, `rgba(255,255,255,${p.alpha})`)
          grad.addColorStop(1, `rgba(255,255,255,0)`)
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
        } else {
          const r = Math.max(0.1, p.size * 2)
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
          grad.addColorStop(0, colorToRgba(p.color, 1))
          grad.addColorStop(1, colorToRgba(p.color, 0))
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      })
    }

    function drawNote(note, midi, x, y, noteWidth, noteHeight, color) {
      const style = styleModeRef.current
      const r = cornerRadiusRef.current
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      const radii = [r, r, 0, 0]

      if (style === 'glow') {
        ctx.shadowColor = color
        ctx.shadowBlur = 14
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(x, y, noteWidth, noteHeight, radii)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      } else if (style === 'outlined') {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.fillStyle = color + '22'
        ctx.beginPath()
        ctx.roundRect(x, y, noteWidth, noteHeight, radii)
        ctx.fill()
        ctx.stroke()
      } else if (style === 'gradient') {
        const hex = colorToHex(color)
        const grad = ctx.createLinearGradient(x, y, x, y + noteHeight)
        grad.addColorStop(0, lighten(hex, 40))
        grad.addColorStop(1, darken(hex, 30))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.roundRect(x, y, noteWidth, noteHeight, radii)
        ctx.fill()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(x, y, noteWidth, noteHeight, radii)
        ctx.fill()
      }

      if (style !== 'outlined') {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
        ctx.fillStyle = 'rgba(0,0,0,0.4)'
        ctx.fillRect(x, y + noteHeight - 3, noteWidth, 3)
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.beginPath()
        ctx.roundRect(x, y, noteWidth, 4, [r, r, 0, 0])
        ctx.fill()
      }

      if (noteHeight > 16) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
        ctx.fillStyle = style === 'outlined' ? color : 'white'
        ctx.font = '9px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(getLetter(note.name), x + noteWidth / 2, y + noteHeight / 2 + 4)
      }
    }

    function drawOctaveLines(whiteKeyX, wkw, rollHeight) {
      if (!showOctaveLinesRef.current) return
      ctx.save()
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      for (let midi = 24; midi <= 108; midi += 12) {
        if (isBlackKey(midi)) continue
        const x = Math.round(whiteKeyX[midi] * wkw)
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 6])
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, rollHeight)
        ctx.stroke()
        const octave = Math.floor(midi / 12) - 1
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.font = '10px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`C${octave}`, x + 3, 14)
      }
      ctx.setLineDash([])
      ctx.restore()
    }

    function drawPiano(activeNotes, activeColors, whiteKeyX, wkw) {
      const ph = pianoHeightRef.current
      const pianoY = canvas.height - ph
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'

      for (let midi = minMidi; midi < maxMidi; midi++) {
        if (isBlackKey(midi)) continue
        const isActive = activeNotes.has(midi)
        const letter = getLetter(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12])
        const x = whiteKeyX[midi] * wkw
        ctx.fillStyle = isActive ? (activeColors.get(midi) || NOTE_COLORS[letter] || '#7F77DD') : 'white'
        ctx.strokeStyle = '#333'
        ctx.lineWidth = 0.5
        ctx.fillRect(x, pianoY, wkw - 1, ph)
        ctx.strokeRect(x, pianoY, wkw - 1, ph)
        if (midi % 12 === 0) {
          ctx.fillStyle = isActive ? 'white' : '#555'
          ctx.font = `${Math.max(wkw * 0.5, 7)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText('C' + (Math.floor(midi / 12) - 1), x + wkw / 2, pianoY + ph - 5)
        }
      }
      for (let midi = minMidi; midi < maxMidi; midi++) {
        if (!isBlackKey(midi)) continue
        const isActive = activeNotes.has(midi)
        const x = getKeyX(midi, whiteKeyX, wkw)
        ctx.fillStyle = isActive ? (activeColors.get(midi) || '#888') : '#222'
        ctx.fillRect(x, pianoY, wkw * 0.6, ph * 0.6)
      }
      for (let midi = minMidi; midi < maxMidi; midi++) {
        if (!activeNotes.has(midi)) continue
        const color = activeColors.get(midi) || '#7F77DD'
        const x = isBlackKey(midi) ? getKeyX(midi, whiteKeyX, wkw) : whiteKeyX[midi] * wkw
        const kw = isBlackKey(midi) ? wkw * 0.6 : wkw - 1
        const kh = isBlackKey(midi) ? ph * 0.6 : ph
        const cx = x + kw / 2
        ctx.save()
        const gi = glowIntensityRef.current
        const gs = glowStateRef.current
        const key = `p${midi}`
        if (!gs[key]) gs[key] = { spread: 1.4, spreadY: 0.8, offsetX: 0, alpha1: 0.5, blur: 16 }
        const g = gs[key]
        g.spread += ((1.2 + Math.random() * 0.6) - g.spread) * 0.04
        g.spreadY += ((0.7 + Math.random() * 0.35) - g.spreadY) * 0.04
        g.offsetX += ((Math.random() - 0.5) * kw * 0.2 - g.offsetX) * 0.03
        g.alpha1 += ((0.35 + Math.random() * 0.35) - g.alpha1) * 0.04
        g.blur += ((12 + Math.random() * 10) - g.blur) * 0.04
        const spread = Math.max(1, kw * g.spread * gi)
        const grad = ctx.createRadialGradient(cx + g.offsetX, pianoY, 0, cx + g.offsetX, pianoY, spread)
        grad.addColorStop(0, colorToRgba(color, g.alpha1))
        grad.addColorStop(0.4, colorToRgba(color, 0.2))
        grad.addColorStop(1, colorToRgba(color, 0))
        ctx.fillStyle = grad
        ctx.shadowColor = color
        ctx.shadowBlur = Math.max(0, g.blur * gi)
        ctx.beginPath()
        ctx.ellipse(cx + g.offsetX, pianoY + kh * g.spreadY * 0.2, spread * 0.9, Math.max(0.1, kh * g.spreadY * 0.8), 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    function drawNotes(songPosition, whiteKeyX, wkw) {
      const ph = pianoHeightRef.current
      const rollHeight = canvas.height - ph
      const fallSpeed = scrollSpeedRef.current
      const activeNotes = new Set()
      const activeColors = new Map()
      const currentNotes = notesRef.current

      if (!currentNotes) return { activeNotes, activeColors }

      currentNotes.forEach(note => {
        const midi = getMidiNumber(note.name)
        if (midi < minMidi || midi >= maxMidi) return

        const color = getNoteColor(note, midi)
        const x = getKeyX(midi, whiteKeyX, wkw)
        const noteWidth = getKeyWidth(midi, wkw)
        const noteHeight = Math.max(note.duration * fallSpeed, 10)
        const timeUntilHit = note.time - songPosition
        const y = rollHeight - timeUntilHit * fallSpeed - noteHeight

        const isActive = note.time <= songPosition && note.time + note.duration >= songPosition
        if (isActive) {
          activeNotes.add(midi)
          activeColors.set(midi, color)

          const cx = x + noteWidth / 2
          const cy = y + noteHeight
          ctx.save()
          const gi = glowIntensityRef.current
          const gs = glowStateRef.current
          const key = `n${midi}`
          if (!gs[key]) gs[key] = { spread: 1.2, spreadY: 0.6, offsetX: 0, offsetY: 0, alpha1: 0.7 }
          const g = gs[key]
          g.spread += ((1.1 + Math.random() * 0.5) - g.spread) * 0.04
          g.spreadY += ((0.4 + Math.random() * 0.5) - g.spreadY) * 0.04
          g.offsetX += ((Math.random() - 0.5) * noteWidth * 0.3 - g.offsetX) * 0.03
          g.offsetY += ((Math.random() - 0.5) * noteWidth * 0.2 - g.offsetY) * 0.03
          g.alpha1 += ((0.5 + Math.random() * 0.35) - g.alpha1) * 0.04
          const spread = Math.max(1, noteWidth * g.spread * gi)
          const spreadY = Math.max(1, noteWidth * g.spreadY * gi)
          const a1 = g.alpha1
          const a2 = g.alpha1 * 0.3
          const grad = ctx.createRadialGradient(cx + g.offsetX, cy + g.offsetY, 0, cx + g.offsetX, cy + g.offsetY, spread)
          grad.addColorStop(0, colorToRgba(color, a1))
          grad.addColorStop(0.5, colorToRgba(color, a2))
          grad.addColorStop(1, colorToRgba(color, 0))
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.ellipse(cx + g.offsetX, cy + g.offsetY, spread, spreadY, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()

          if (hitEffectRef.current !== 'none' && !prevActiveRef.current.has(midi) && playVisualStartRef.current) {
            spawnParticles(x, noteWidth, color)
          }
        }

        if (y + noteHeight < 0 || y > rollHeight) return
        drawNote(note, midi, x, y, noteWidth, noteHeight, color)
      })

      prevActiveRef.current = activeNotes
      Object.keys(glowStateRef.current).forEach(k => {
        const midi = parseInt(k.slice(1))
        if (!activeNotes.has(midi)) delete glowStateRef.current[k]
      })
      return { activeNotes, activeColors }
    }

    function draw() {
      try {
        if (canvas.width === 0 || canvas.height === 0) {
          const p = canvas.parentElement
          if (p) applySize(Math.round(p.offsetWidth), Math.round(p.offsetHeight))
          animationId = requestAnimationFrame(draw)
          return
        }

        const { whiteKeyX, wkw } = getLayout()
        const ph = pianoHeightRef.current
        const rollHeight = canvas.height - ph

        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
        ctx.fillStyle = bgColorRef.current
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const vStart = playVisualStartRef.current
        const isPaused = pausedAtRef.current !== null && !vStart

        // Idle: nothing loaded or playing yet — just draw empty piano
        if (!vStart && !isPaused) {
          drawOctaveLines(whiteKeyX, wkw, rollHeight)
          drawPiano(new Set(), new Map(), whiteKeyX, wkw)
          animationId = requestAnimationFrame(draw)
          return
        }

        let songPosition
        if (isPaused) {
          songPosition = pausedAtRef.current
        } else {
          // Unified formula: playStartSongPosRef already encodes the lead-in offset.
          // Fresh play:  playStartSongPosRef = resumeFrom - leadIn * speed  (negative during countdown)
          // Resume:      playStartSongPosRef = resumeFrom                   (no offset needed)
          // Both cases:  songPosition = playStartSongPosRef + elapsed * speed
          const elapsed = performance.now() / 1000 - vStart
          songPosition = (playStartSongPosRef ? playStartSongPosRef.current : 0) + elapsed * speedRef.current
        }

        drawOctaveLines(whiteKeyX, wkw, rollHeight)
        const { activeNotes, activeColors } = drawNotes(songPosition, whiteKeyX, wkw)
        updateParticles()
        drawParticles()

        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
        drawPiano(activeNotes, activeColors, whiteKeyX, wkw)

        if (isPaused) {
          ctx.shadowBlur = 0
          ctx.shadowColor = 'transparent'
          ctx.fillStyle = 'rgba(0,0,0,0.35)'
          ctx.fillRect(0, 0, canvas.width, canvas.height - ph)
          ctx.fillStyle = 'rgba(255,255,255,0.7)'
          ctx.font = 'bold 32px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('⏸ Paused', canvas.width / 2, (canvas.height - ph) / 2)
        }
      } catch (e) {
        console.error('KeyFlow draw error:', e)
      }
      animationId = requestAnimationFrame(draw)
    }

    animationId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animationId)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
  )
}

export default SynthesiaRenderer