'use strict'

const fs = require('fs')
const path = require('path')
const { Linter } = require('eslint')
const vueParser = require('vue-eslint-parser')
const tsParser = require('@typescript-eslint/parser')
const plugin = require('../lib')

const targetDir = process.argv[2]
if (!targetDir) {
  console.error('usage: node test/scan.js <directory>')
  process.exit(1)
}

const linter = new Linter({ configType: 'flat', cwd: path.resolve(targetDir) })

const config = [
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { local: plugin },
    rules: {
      'local/localize-bindings': ['warn', { minLocalizedBindings: 2 }],
    },
  },
]

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) yield* walk(full)
    else if (ent.isFile() && ent.name.endsWith('.vue')) yield full
  }
}

const files = [...walk(targetDir)]
console.error(`scanning ${files.length} .vue files under ${targetDir}`)

let totalIssues = 0
let filesWithIssues = 0
let totalParseErrors = 0
const subtreeReports = []

for (const file of files) {
  let messages
  try {
    const source = fs.readFileSync(file, 'utf8')
    messages = linter.verify(source, config, { filename: file })
  } catch (e) {
    totalParseErrors++
    continue
  }
  const fatal = messages.filter((m) => m.fatal)
  if (fatal.length > 0) {
    totalParseErrors++
    continue
  }
  const ours = messages.filter((m) => m.ruleId === 'local/localize-bindings')
  if (ours.length === 0) continue
  filesWithIssues++
  totalIssues += ours.length
  const rel = path.relative(targetDir, file)
  console.log(`\n${rel}`)
  for (const m of ours) {
    console.log(
      `  ${String(m.line).padStart(3)}:${String(m.column).padEnd(3)} ${m.message}`
    )
    if (m.message.startsWith('<')) {
      subtreeReports.push({ file: rel, line: m.line, message: m.message })
    }
  }
}

console.log(`\n---`)
console.log(`files scanned          : ${files.length}`)
console.log(`files with issues      : ${filesWithIssues}`)
console.log(`total issues           : ${totalIssues}`)
console.log(`subtree candidates     : ${subtreeReports.length}`)
console.log(`parse errors           : ${totalParseErrors}`)
