#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const emitTemplate = args.includes('--emit-template')
const positional = args.filter((arg) => !arg.startsWith('--'))
const [specFile, taskFile] = positional
if (!specFile || (!emitTemplate && !taskFile)) {
  console.error('用法：node .claude/reference/spex/scripts/traceability-lint.mjs <spec.md> <task.md> | node .claude/reference/spex/scripts/traceability-lint.mjs --emit-template <spec.md>')
  process.exit(2)
}

const spec = readFileSync(specFile, 'utf8')
const task = taskFile ? readFileSync(taskFile, 'utf8') : ''
const missing = []

function section(title) {
  const heading = `## ${title}`
  const start = spec.indexOf(heading)
  if (start < 0) return ''
  const bodyStart = spec.indexOf('\n', start)
  if (bodyStart < 0) return ''
  const next = spec.indexOf('\n## ', bodyStart + 1)
  return spec.slice(bodyStart + 1, next < 0 ? spec.length : next)
}

function plain(value) {
  return value.replace(/[*`✅❌]/gu, '').replace(/\s+/gu, ' ').trim()
}

const requirements = []
for (const match of spec.matchAll(/^AC-(\d+):/gmu)) {
  requirements.push({ id: `AC-${match[1]}`, text: `AC-${match[1]}` })
}

let index = 0
for (const match of section('In Scope').matchAll(/^\s*-\s+(.+)$/gmu)) {
  index += 1
  requirements.push({ id: `IN-${String(index).padStart(2, '0')}`, text: plain(match[1]) })
}

index = 0
for (const line of section('邊界條件').split('\n')) {
  if (!/^\|/.test(line) || /^\|\s*(?:---|維度)/u.test(line)) continue
  const cells = line.split('|').slice(1, -1).map(plain)
  const condition = cells[1]
  if (!condition) continue
  index += 1
  const clauses = condition.split(/\s*(?:、|或|／)\s*/u).map(plain).filter(Boolean)
  clauses.forEach((text, clauseIndex) => {
    requirements.push({ id: `BD-${String(index).padStart(2, '0')}.${clauseIndex + 1}`, text })
  })
}

index = 0
for (const line of section('列舉完整性清單').split('\n')) {
  if (!/^\|/.test(line) || /^\|\s*(?:---|路由|成員|項目)/u.test(line)) continue
  const member = plain(line.split('|')[1] ?? '')
  if (!member) continue
  index += 1
  requirements.push({ id: `ENUM-${String(index).padStart(2, '0')}`, text: member })
}

if (requirements.length === 0) missing.push('SPEC-NONE「規格未解析出 AC／In Scope／邊界／列舉」')

if (emitTemplate) {
  console.log('## 規格需求索引')
  console.log('')
  console.log('| ID | 規格條目 | 對應 Task | 可執行證據 |')
  console.log('|---|---|---|---|')
  for (const requirement of requirements) {
    console.log(`| ${requirement.id} | ${requirement.text.replaceAll('|', '\\|')} | TODO | TODO |`)
  }
  process.exit(missing.length > 0 ? 1 : 0)
}

const matrixStart = task.indexOf('## 規格需求索引')
if (matrixStart >= 0) {
  const matrixEnd = task.indexOf('\n## ', matrixStart + 3)
  const matrix = task.slice(matrixStart, matrixEnd < 0 ? task.length : matrixEnd)
  for (const requirement of requirements) {
    const row = matrix.split('\n').find((line) => new RegExp(`^\\|\\s*${requirement.id.replace('.', '\\.')}\\s*\\|`, 'u').test(line))
    if (!row) {
      missing.push(`${requirement.id}「缺少索引列」`)
      continue
    }
    const cells = row.split('|').slice(1, -1).map(plain)
    if (!/^T-\d+(?:\s*[,、]\s*T-\d+)*$/u.test(cells[2] ?? '')) {
      missing.push(`${requirement.id}「對應 Task 必須是 T-XXX」`)
    }
    if (!cells[3] || /^(?:TODO|TBD|—|-|無)$/iu.test(cells[3])) {
      missing.push(`${requirement.id}「缺少可執行證據」`)
    }
  }
} else {
  // 舊卡相容模式：尚無需求索引時維持逐字錨點檢查；新卡一律使用上方穩定 ID 矩陣。
  for (const requirement of requirements) {
    if (!task.includes(requirement.text)) missing.push(`${requirement.id}「${requirement.text}」`)
  }
}

if (missing.length > 0) {
  console.error(`traceability-lint: PRODUCT_INPUT_FAIL (${missing.length}/${requirements.length})`)
  for (const item of missing) console.error(`  缺少 ${item}`)
  process.exit(1)
}

console.log(`traceability-lint: PASS requirements=${requirements.length}`)
