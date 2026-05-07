'use strict'

const fs = require('fs')
const path = require('path')
const { Linter } = require('eslint')
const vueParser = require('vue-eslint-parser')
const plugin = require('../lib')

const linter = new Linter({ configType: 'flat' })

const config = {
  files: ['**/*.vue'],
  languageOptions: {
    parser: vueParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: { local: plugin },
  rules: {
    'local/localize-bindings': 'warn',
  },
}

const fixturesDir = path.join(__dirname, 'fixtures')
const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.vue'))

let totalIssues = 0
for (const file of files) {
  const filePath = path.join(fixturesDir, file)
  const source = fs.readFileSync(filePath, 'utf8')
  const messages = linter.verify(source, config, { filename: filePath })
  console.log(`\n=== ${file} ===`)
  if (messages.length === 0) {
    console.log('  (no issues)')
  } else {
    for (const m of messages) {
      const sev = m.severity === 1 ? 'warn ' : 'error'
      console.log(
        `  ${String(m.line).padStart(3)}:${String(m.column).padEnd(3)} ${sev}  ${m.message}`
      )
    }
    totalIssues += messages.length
  }
}

console.log(`\nTotal issues: ${totalIssues}`)
