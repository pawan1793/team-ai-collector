import { useState, useMemo, useRef } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js'
import { Line } from 'react-chartjs-2'
import { editorColor, editorLabel } from '../lib/constants'
import { useTheme } from '../lib/theme'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const CELL_SIZE = 11
const CELL_GAP = 2
const WEEK_COLS = 53
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

function getIntensity(count, maxCount) {
  if (count === 0) return 0
  if (maxCount <= 0) return 1
  const ratio = count / maxCount
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

const INTENSITY_COLORS_DARK = ['rgba(255,255,255,0.03)', '#0e4429', '#006d32', '#26a641', '#39d353']
const INTENSITY_COLORS_LIGHT = ['rgba(0,0,0,0.04)', '#9be9a8', '#40c463', '#30a14e', '#216e39']

export default function ActivityHeatmap({ dailyData }) {
  const { dark } = useTheme()
  const [selectedDay, setSelectedDay] = useState(null)
  const containerRef = useRef(null)

  // Build a full year grid (53 weeks × 7 days)
  const grid = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return { weeks: [], months: [], maxCount: 0 }

    const dayMap = {}
    let maxCount = 0
    for (const d of dailyData) {
      dayMap[d.day] = d
      if (d.total > maxCount) maxCount = d.total
    }

    // End on Saturday of the current week, start WEEK_COLS-1 weeks before
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(today)
    start.setDate(start.getDate() - start.getDay() - (WEEK_COLS - 1) * 7)

    const weeks = []
    const months = []
    let lastMonth = -1
    const cursor = new Date(start)

    for (let w = 0; w < WEEK_COLS; w++) {
      const week = []
      for (let d = 0; d < 7; d++) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        const data = dayMap[key] || null
        const count = data ? data.total : 0
        const isFuture = cursor > today

        if (cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth()
          months.push({ week: w, label: cursor.toLocaleString('default', { month: 'short' }) })
        }

        week.push({ key, count, data, isFuture, day: d })
        cursor.setDate(cursor.getDate() + 1)
      }
      weeks.push(week)
    }

    return { weeks, months, maxCount }
  }, [dailyData])

  // Hourly drill-down for selected day
  const hourlyChart = useMemo(() => {
    if (!selectedDay?.data) return null
    const hours = selectedDay.data.hours || {}
    const editors = Object.keys(hours)
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)

    return {
      labels,
      datasets: editors.map(eid => ({
        label: editorLabel(eid),
        data: hours[eid],
        borderColor: editorColor(eid),
        backgroundColor: editorColor(eid) + '20',
        borderWidth: 1.5,
        tension: 0.3,
        pointRadius: 1,
        pointHoverRadius: 3,
        fill: true,
      })),
    }
  }, [selectedDay])

  if (!grid.weeks.length) return null

  const COLORS = dark ? INTENSITY_COLORS_DARK : INTENSITY_COLORS_LIGHT
  const txtDim = dark ? '#555' : '#999'
  const gridColor = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)'
  const legendColor = dark ? '#888' : '#555'
  const svgWidth = WEEK_COLS * (CELL_SIZE + CELL_GAP) + 28
  const svgHeight = 7 * (CELL_SIZE + CELL_GAP) + 20

  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin" ref={containerRef}>
        <svg width={svgWidth} height={svgHeight} className="block">
          {/* Month labels */}
          {grid.months.map((m, i) => (
            <text key={i} x={28 + m.week * (CELL_SIZE + CELL_GAP)} y={8} fill="var(--c-text3)" fontSize={8}>{m.label}</text>
          ))}
          {DAY_LABELS.map((label, i) => (
            <text key={i} x={0} y={14 + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2} fill="var(--c-text3)" fontSize={8}>{label}</text>
          ))}
          {/* Cells */}
          {grid.weeks.map((week, w) =>
            week.map((cell, d) => {
              if (cell.isFuture) return null
              const intensity = getIntensity(cell.count, grid.maxCount)
              const isSelected = selectedDay?.key === cell.key
              return (
                <rect
                  key={cell.key}
                  x={28 + w * (CELL_SIZE + CELL_GAP)}
                  y={12 + d * (CELL_SIZE + CELL_GAP)}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={0}
                  fill={COLORS[intensity]}
                  stroke={isSelected ? '#818cf8' : 'transparent'}
                  strokeWidth={isSelected ? 2 : 0}
                  className="cursor-pointer transition-all"
                  onClick={() => setSelectedDay(cell.count > 0 ? cell : null)}
                >
                  <title>{`${cell.key}: ${cell.count} session${cell.count !== 1 ? 's' : ''}`}</title>
                </rect>
              )
            })
          )}
        </svg>
      </div>

      <div className="flex items-center gap-1.5 mt-1 text-[10px]" style={{ color: 'var(--c-text3)' }}>
        <span>less</span>
        {COLORS.map((color, i) => (
          <span key={i} className="inline-block w-[9px] h-[9px] rounded-sm" style={{ background: color }} />
        ))}
        <span>more</span>
      </div>

      {/* Drill-down: hourly activity for selected day */}
      {selectedDay && selectedDay.data && (
        <div className="mt-2 card p-3 fade-in">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-medium" style={{ color: 'var(--c-white)' }}>{selectedDay.key}</span>
              <span className="text-[11px] ml-2" style={{ color: 'var(--c-text2)' }}>
                {selectedDay.count} session{selectedDay.count !== 1 ? 's' : ''}
                {' · '}
                {Object.entries(selectedDay.data.editors || {}).map(([e, c]) => `${editorLabel(e)}: ${c}`).join(', ')}
              </span>
            </div>
            <button onClick={() => setSelectedDay(null)} className="text-[11px] transition" style={{ color: 'var(--c-text2)' }}>close</button>
          </div>
          {hourlyChart && (
            <div style={{ height: 140 }}>
              <Line
                data={hourlyChart}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: {
                    x: {
                      grid: { color: gridColor },
                      ticks: { color: txtDim, font: { size: 9, family: 'JetBrains Mono, monospace' }, maxRotation: 0 },
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: gridColor },
                      ticks: { color: txtDim, stepSize: 1, font: { size: 9, family: 'JetBrains Mono, monospace' } },
                    },
                  },
                  plugins: {
                    legend: {
                      position: 'top',
                      labels: { color: legendColor, font: { size: 9, family: 'JetBrains Mono, monospace' }, usePointStyle: true, pointStyle: 'circle', padding: 8 },
                    },
                    tooltip: {
                      bodyFont: { family: 'JetBrains Mono, monospace', size: 10 },
                      titleFont: { family: 'JetBrains Mono, monospace', size: 10 },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
