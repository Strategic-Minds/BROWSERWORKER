import { closeBrowser, launchBrowser } from '@/lib/browser'
import { validatePublicUrl } from '@/lib/ssrf'
import { getPlanSource, type PlanAccessClass } from '@/config/bidfast-plan-sources'

export type DiscoveredPlanLink = {
  title: string
  url: string
  documentType: 'plans' | 'drawings' | 'specifications' | 'addendum' | 'solicitation' | 'proposal' | 'project' | 'other'
  accessClass: PlanAccessClass
  score: number
  context: string
  fileExtension: string | null
}

const FILE_PATTERN = /\.(pdf|zip|docx?|xlsx?|dwg|dxf)(?:$|[?#])/i

function documentType(value: string): DiscoveredPlanLink['documentType'] {
  const text = value.toLowerCase()
  if (/\bplans?\b/.test(text)) return 'plans'
  if (/drawing|blueprint|sheet set/.test(text)) return 'drawings'
  if (/specification|\bspecs?\b/.test(text)) return 'specifications'
  if (/addendum|amendment|supplement/.test(text)) return 'addendum'
  if (/solicitation|invitation to bid|\bitb\b|\brfq\b|\brfp\b/.test(text)) return 'solicitation'
  if (/proposal|bid item|bid tab/.test(text)) return 'proposal'
  if (/project|letting|construction|remodel/.test(text)) return 'project'
  return 'other'
}

function relevanceScore(value: string, hints: string[]): number {
  const text = value.toLowerCase()
  let score = FILE_PATTERN.test(text) ? 20 : 0
  for (const hint of hints) {
    if (text.includes(hint.toLowerCase())) score += hint.length > 7 ? 18 : 11
  }
  if (/plan|drawing|specification|solicitation|addendum|proposal/.test(text)) score += 18
  if (/floor|finish|remodel|building|school|office|concrete|coating|terrazzo/.test(text)) score += 9
  if (/login|sign in|register|privacy|terms|facebook|linkedin|instagram/.test(text)) score -= 30
  return Math.max(0, Math.min(100, score))
}

function normalizeExtension(url: string): string | null {
  const match = url.match(FILE_PATTERN)
  return match?.[1]?.toLowerCase() ?? null
}

export async function discoverPlanSource(sourceId: string, maxLinks = 60) {
  const source = getPlanSource(sourceId)
  if (!source) throw new Error(`Unknown BIDFAST plan source: ${sourceId}`)

  const urlCheck = await validatePublicUrl(source.probeUrl)
  if (!urlCheck.ok) throw new Error(urlCheck.error || 'Source URL failed SSRF validation')

  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  const warnings: string[] = []
  let browser = null

  try {
    const launched = await launchBrowser()
    browser = launched.browser
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      userAgent: 'BIDFAST-PlanDiscovery/1.0 (+public-procurement-source-audit)',
      acceptDownloads: false,
    })

    const validatedHosts = new Map<string, boolean>()
    await context.route('**', async (route) => {
      const requestUrl = route.request().url()
      if (requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) {
        const host = new URL(requestUrl).hostname.toLowerCase()
        let allowed = validatedHosts.get(host)
        if (allowed === undefined) {
          const check = await validatePublicUrl(requestUrl)
          allowed = check.ok
          validatedHosts.set(host, allowed)
        }
        if (!allowed) {
          warnings.push(`Blocked unsafe subrequest: ${host}`)
          await route.abort('blockedbyclient')
          return
        }
      }
      await route.continue()
    })

    const page = await context.newPage()
    const response = await page.goto(source.probeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(1800)

    const title = await page.title()
    const finalUrl = page.url()
    const rawLinks = await page.locator('a').evaluateAll((anchors) => anchors.map((anchor) => {
      const element = anchor as HTMLAnchorElement
      const container = element.closest('tr,li,article,section,div')
      return {
        title: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
        href: element.href,
        context: (container?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      }
    }))

    const seen = new Set<string>()
    const candidates: DiscoveredPlanLink[] = []
    for (const link of rawLinks) {
      if (!link.href || seen.has(link.href)) continue
      seen.add(link.href)
      const combined = `${link.title} ${link.href} ${link.context}`
      const score = relevanceScore(combined, source.planHints)
      if (score < 20) continue
      const controlled = /controlled|confidential|nda|login required|sign in required/i.test(combined)
      candidates.push({
        title: link.title || link.href.split('/').pop() || 'Construction document',
        url: link.href,
        documentType: documentType(combined),
        accessClass: controlled ? 'RESTRICTED_MANUAL_ACTION' : source.accessClass,
        score,
        context: link.context,
        fileExtension: normalizeExtension(link.href),
      })
    }

    candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    await page.close()
    await context.close()

    return {
      ok: true,
      source,
      page: {
        requestedUrl: source.probeUrl,
        finalUrl,
        title,
        httpStatus: response?.status() ?? null,
      },
      candidates: candidates.slice(0, Math.max(1, Math.min(maxLinks, 100))),
      evidence: {
        browserProvider: launched.provider,
        browserVersion: launched.version,
        discoveredAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        candidateCount: candidates.length,
        warnings: Array.from(new Set(warnings)).slice(0, 20),
      },
      policy: {
        downloadsPerformed: false,
        registrationsPerformed: false,
        licenseAccepted: false,
        restrictedFilesDownloaded: false,
      },
    }
  } finally {
    await closeBrowser(browser)
  }
}
