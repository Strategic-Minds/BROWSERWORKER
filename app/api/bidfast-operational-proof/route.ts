import { closeBrowser, launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const ORIGIN = 'https://bidfast-git-auto-builder-bidfas-2c6093-strategic-minds-advisory.vercel.app'

type StepReceipt = {
  step: string
  passed: boolean
  detail: string
  timestamp: string
}

function receipt(step: string, passed: boolean, detail: string): StepReceipt {
  return { step, passed, detail: detail.slice(0, 500), timestamp: new Date().toISOString() }
}

export async function GET() {
  const runId = crypto.randomUUID().slice(0, 8)
  const email = `bidfast-proof-${Date.now()}-${runId}@example.com`
  const password = `Bf!${crypto.randomUUID()}9a`
  const title = `BrowserWorker parity proof ${runId}`
  const receipts: StepReceipt[] = []
  const consoleErrors: string[] = []
  const appNetworkErrors: string[] = []
  let browser: Awaited<ReturnType<typeof launchBrowser>>['browser'] | null = null

  try {
    const launched = await launchBrowser()
    browser = launched.browser
    const context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()

    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 800))
    })
    page.on('pageerror', error => consoleErrors.push(error.message.slice(0, 800)))
    page.on('requestfailed', request => {
      const url = request.url()
      if (url.includes('/.well-known/vercel/jwe') || url.includes('_rsc=') || url.includes('vercel.live/_next-live/')) return
      appNetworkErrors.push(`${request.method()} ${url}: ${request.failure()?.errorText || 'failed'}`.slice(0, 1000))
    })

    await page.goto(`${ORIGIN}/api/health/config`, { waitUntil: 'networkidle', timeout: 90000 })
    const healthText = await page.locator('body').innerText()
    const health = JSON.parse(healthText) as { ok?: boolean; checks?: Record<string, boolean> }
    receipts.push(receipt('configuration_health', health.ok === true, JSON.stringify(health.checks || {})))
    if (!health.ok) throw new Error('BIDFAST Supabase public configuration is incomplete.')

    await page.goto(`${ORIGIN}/signup`, { waitUntil: 'networkidle', timeout: 90000 })
    await page.fill('#owner-name', 'BIDFAST Proof Operator')
    await page.fill('#signup-email', email)
    await page.fill('#signup-password', password)
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForSelector('#company-name', { timeout: 15000 })
    await page.fill('#company-name', `BIDFAST Proof ${runId}`)
    await page.selectOption('#industry', { label: 'Flooring & Coating' })
    await page.fill('#city', 'Fort Lauderdale')
    await page.fill('#state', 'FL')
    await page.getByRole('button', { name: 'Create BIDFAST Account' }).click()

    await page.waitForTimeout(2500)
    const afterSignupUrl = page.url()
    const bodyAfterSignup = await page.locator('body').innerText()
    const confirmationRequired = bodyAfterSignup.includes('Check your email')
    receipts.push(receipt('account_signup', afterSignupUrl.includes('/opportunities') || confirmationRequired, confirmationRequired ? 'Account created; email confirmation required by project policy.' : `Redirected to ${new URL(afterSignupUrl).pathname}`))

    if (confirmationRequired) {
      return Response.json({
        ok: false,
        operational_pass: false,
        blocked_by: 'email_confirmation_required',
        run_id: runId,
        receipts,
        console_errors: consoleErrors,
        app_network_errors: appNetworkErrors,
        browser_version: launched.version,
        timestamp: new Date().toISOString(),
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
    }

    await page.waitForURL('**/opportunities', { timeout: 30000 })
    await page.waitForSelector('#opportunity-title', { state: 'attached', timeout: 30000 }).catch(() => undefined)
    const addButton = page.getByRole('button', { name: 'Add Opportunity' })
    if (await addButton.isVisible()) await addButton.click()
    await page.waitForSelector('#opportunity-title', { timeout: 15000 })
    await page.fill('#opportunity-title', title)
    await page.fill('#opportunity-client', 'BrowserWorker Validation Client')
    await page.fill('#opportunity-source', 'governed-proof')
    await page.fill('#opportunity-value', '125000')
    await page.getByRole('button', { name: 'Create Opportunity' }).click()
    await page.getByRole('link', { name: title }).waitFor({ timeout: 30000 })
    receipts.push(receipt('opportunity_create', true, 'Created and rendered through RLS-backed UI.'))

    const row = page.getByRole('row').filter({ hasText: title })
    const status = row.getByRole('combobox')
    await status.selectOption('qualified')
    await page.waitForTimeout(1200)
    receipts.push(receipt('opportunity_update', await status.inputValue() === 'qualified', `status=${await status.inputValue()}`))

    page.once('dialog', dialog => dialog.accept())
    await row.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('link', { name: title }).waitFor({ state: 'detached', timeout: 30000 })
    receipts.push(receipt('opportunity_delete', true, 'Deleted and removed from rendered pipeline.'))

    const operationalPass = receipts.every(item => item.passed) && consoleErrors.length === 0 && appNetworkErrors.length === 0
    await page.close()

    return Response.json({
      ok: true,
      operational_pass: operationalPass,
      run_id: runId,
      receipts,
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      browser_version: launched.version,
      timestamp: new Date().toISOString(),
    }, { status: operationalPass ? 200 : 422, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({
      ok: false,
      operational_pass: false,
      run_id: runId,
      receipts,
      console_errors: consoleErrors,
      app_network_errors: appNetworkErrors,
      error: error instanceof Error ? error.message.slice(0, 1500) : String(error).slice(0, 1500),
      timestamp: new Date().toISOString(),
    }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    await closeBrowser(browser)
  }
}
