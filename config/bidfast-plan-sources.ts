export type PlanAccessClass =
  | 'PUBLIC_DIRECT'
  | 'PUBLIC_WITH_LICENSE_ACCEPTANCE'
  | 'PUBLIC_GUEST_VIEW'
  | 'RESTRICTED_MANUAL_ACTION'

export type PlanSource = {
  id: string
  name: string
  jurisdiction: string
  officialUrl: string
  probeUrl: string
  allowedHosts: string[]
  accessClass: PlanAccessClass
  sourceKind: 'federal' | 'state' | 'county' | 'school-district'
  notes: string
  planHints: string[]
}

export const BIDFAST_PLAN_SOURCES: PlanSource[] = [
  {
    id: 'sam-public-construction',
    name: 'SAM.gov Public Construction Attachments',
    jurisdiction: 'United States',
    officialUrl: 'https://sam.gov/opportunities',
    probeUrl: 'https://sam.gov/opp/e4edd3bc68884c8fb98631ec6ebfb3c0/view',
    allowedHosts: ['sam.gov', 'api.sam.gov'],
    accessClass: 'PUBLIC_DIRECT',
    sourceKind: 'federal',
    notes: 'Public federal solicitation attachments. Controlled attachments must never be downloaded automatically.',
    planHints: ['plan', 'plans', 'drawing', 'drawings', 'spec', 'specification', 'scope of work', 'addendum'],
  },
  {
    id: 'miami-dade-stratproc',
    name: 'Miami-Dade Strategic Procurement',
    jurisdiction: 'Miami-Dade County, Florida',
    officialUrl: 'https://www.miamidade.gov/apps/isd/StratProc/Home/',
    probeUrl: 'https://www.miamidade.gov/apps/isd/StratProc/Home/SolicitationDetails?solNumber=20230219-R%20%28MCC%207360%29',
    allowedHosts: ['www.miamidade.gov', 'miamidade.gov'],
    accessClass: 'PUBLIC_DIRECT',
    sourceKind: 'county',
    notes: 'Public solicitation packages and plan PDFs when the county exposes them directly. Confidentiality-controlled packages remain manual.',
    planHints: ['plan', 'plans', 'drawing', 'drawings', 'spec', 'solicitation document', 'addendum'],
  },
  {
    id: 'orange-county-orangebids',
    name: 'Orange County OrangeBids',
    jurisdiction: 'Orange County, Florida',
    officialUrl: 'https://ftp.orangecountyfl.net/orangebids/bidopen.asp',
    probeUrl: 'https://ftp.orangecountyfl.net/orangebids/Bid_Plans.asp?FN=Y17-778Drawings.pdf&ID=14221&OID=177441&OrangeBids=&Plans=1&PrinterFriendly=1&ViewOnly=1%2F1000&Visitor=Guest',
    allowedHosts: ['ftp.orangecountyfl.net', 'apps.ocfl.net', 'www.orangecountyfl.net', 'orangecountyfl.net'],
    accessClass: 'PUBLIC_GUEST_VIEW',
    sourceKind: 'county',
    notes: 'Guest plan viewing is permitted. Registering as a plan holder is a separate human action and must not be automated.',
    planHints: ['drawing', 'drawings', 'specification', 'specifications', 'bid document', 'addendum'],
  },
  {
    id: 'fdot-central-lettings',
    name: 'FDOT Central Office Lettings',
    jurisdiction: 'Florida',
    officialUrl: 'https://www.fdot.gov/contracts/lettings',
    probeUrl: 'https://www.fdot.gov/contracts/lettings',
    allowedHosts: ['www.fdot.gov', 'fdot.gov', 'ftp.fdot.gov', 'fdotwp1.dot.state.fl.us', 'fdotwww.blob.core.windows.net'],
    accessClass: 'PUBLIC_WITH_LICENSE_ACCEPTANCE',
    sourceKind: 'state',
    notes: 'Project and letting records are public. Plan ordering or license acceptance steps must remain explicit and human-controlled.',
    planHints: ['proposal', 'supplement', 'addendum', 'plans', 'online ordering', 'bid items'],
  },
  {
    id: 'txdot-plans-online',
    name: 'TxDOT Plans Online',
    jurisdiction: 'Texas',
    officialUrl: 'https://www.txdot.gov/content/txdotreimagine/us/en/home/business/plans-online-bid-lettings.html',
    probeUrl: 'https://www.txdot.gov/content/txdotreimagine/us/en/home/business/plans-online-bid-lettings.html',
    allowedHosts: ['www.txdot.gov', 'txdot.gov', 'www.dot.state.tx.us', 'ftp.dot.state.tx.us'],
    accessClass: 'PUBLIC_WITH_LICENSE_ACCEPTANCE',
    sourceKind: 'state',
    notes: 'Free plan, proposal, addenda, bid-tab and contract-plan access after the user accepts TxDOT terms.',
    planHints: ['plans online', 'plan', 'proposal', 'addenda', 'contract plans', 'ftp'],
  },
  {
    id: 'palm-beach-schools',
    name: 'Palm Beach County Schools Construction Solicitations',
    jurisdiction: 'Palm Beach County, Florida',
    officialUrl: 'https://www.palmbeachschools.org/doing-business-with-the-district/construction-vendorssuppliers/currentfuture-solicitations',
    probeUrl: 'https://www.palmbeachschools.org/doing-business-with-the-district/construction-vendorssuppliers/currentfuture-solicitations',
    allowedHosts: ['www.palmbeachschools.org', 'palmbeachschools.org', 'www2.palmbeachschools.org'],
    accessClass: 'RESTRICTED_MANUAL_ACTION',
    sourceKind: 'school-district',
    notes: 'Opportunity metadata is public, but bid packages may be hosted in BidNet Direct and require user registration or authentication.',
    planHints: ['construction', 'remodel', 'itb', 'rfp', 'project', 'solicitation'],
  },
]

export function getPlanSource(sourceId: string): PlanSource | undefined {
  return BIDFAST_PLAN_SOURCES.find((source) => source.id === sourceId)
}
