import { readFileSync, writeFileSync } from 'node:fs'

const path='lib/bidfast-parity.ts'
let source=readFileSync(path,'utf8')
const before="const instrumentation = (value: string) => value.includes('/.well-known/vercel/jwe') || value.includes('_vercel') || value.includes('vercel.live');"
const after="const instrumentation = (value: string) => value.startsWith('OPTIONS ') || value.startsWith('HEAD ') || value.includes('/.well-known/vercel/jwe') || value.includes('_vercel') || value.includes('vercel.live');"
if(!source.includes(before)) throw new Error('Expected instrumentation filter was not found')
source=source.replace(before,after)
writeFileSync(path,source)
console.log('Filtered Browserbase and Vercel preview control probes from operational receipts.')
