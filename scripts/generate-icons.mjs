// scripts/generate-icons.mjs
// Run: node scripts/generate-icons.mjs
// Requires: npm install canvas (dev only)

import { createCanvas } from 'canvas'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../public/icons')
mkdirSync(OUT, { recursive: true })

function drawIcon(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  const r = size * 0.18   // corner radius

  // Background
  ctx.fillStyle = '#1a237e'
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(size - r, 0)
  ctx.quadraticCurveTo(size, 0, size, r)
  ctx.lineTo(size, size - r)
  ctx.quadraticCurveTo(size, size, size - r, size)
  ctx.lineTo(r, size)
  ctx.quadraticCurveTo(0, size, 0, size - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fill()

  // Chart bars (simple rising bars)
  const pad = size * 0.18
  const barW = size * 0.11
  const gap  = size * 0.06
  const bottom = size - pad
  const heights = [0.25, 0.45, 0.65, 0.85]
  const totalW = heights.length * barW + (heights.length - 1) * gap
  const startX = (size - totalW) / 2

  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  heights.forEach((h, i) => {
    const x = startX + i * (barW + gap)
    const barH = (size - pad * 2) * h
    const y = bottom - barH
    ctx.beginPath()
    ctx.roundRect(x, y, barW, barH, barW * 0.3)
    ctx.fill()
  })

  // Highlight the last two bars
  ctx.fillStyle = '#ffffff'
  ;[2, 3].forEach(i => {
    const h = heights[i]
    const x = startX + i * (barW + gap)
    const barH = (size - pad * 2) * h
    const y = bottom - barH
    ctx.beginPath()
    ctx.roundRect(x, y, barW, barH, barW * 0.3)
    ctx.fill()
  })

  // Trend line
  const lineY = [0.78, 0.55, 0.38, 0.18].map((h, i) => ({
    x: startX + i * (barW + gap) + barW / 2,
    y: bottom - (size - pad * 2) * h
  }))
  ctx.strokeStyle = '#69f0ae'
  ctx.lineWidth = size * 0.035
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  lineY.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.stroke()

  return canvas.toBuffer('image/png')
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512]
sizes.forEach(size => {
  const buf = drawIcon(size)
  writeFileSync(join(OUT, `icon-${size}.png`), buf)
  console.log(`✓ icon-${size}.png`)
})

console.log('\nAll icons generated in public/icons/')
