import { sign } from 'node:crypto'

const { ASC_API_PRIVATE_KEY, ASC_API_KEY_ID, ASC_API_ISSUER_ID } = process.env
if (!ASC_API_PRIVATE_KEY || !ASC_API_KEY_ID || !ASC_API_ISSUER_ID) {
  throw new Error('ASC_API_PRIVATE_KEY, ASC_API_KEY_ID and ASC_API_ISSUER_ID are required.')
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const content = `${encode({ alg: 'ES256', kid: ASC_API_KEY_ID, typ: 'JWT' })}.${encode({ iss: ASC_API_ISSUER_ID, iat: now, exp: now + 300, aud: 'appstoreconnect-v1' })}`
const signature = sign('sha256', Buffer.from(content), { key: ASC_API_PRIVATE_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url')
const token = `${content}.${signature}`
async function get(endpoint) {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) throw new Error(`Apple API ${response.status}: ${await response.text()}`)
  return response.json()
}
const app = '6792231571'
const versions = await get(`apps/${app}/appStoreVersions?filter[platform]=MAC_OS&include=build&limit=10`)
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), versions: versions.data.map(version => ({
  id: version.id, ...version.attributes,
  build: versions.included?.find(item => item.type === 'builds' && item.id === version.relationships?.build?.data?.id)?.attributes?.version
})) }, null, 2))
const submissions = await get(`apps/${app}/reviewSubmissions?limit=10`)
console.log(JSON.stringify({ submissions: submissions.data.map(item => ({ id: item.id, ...item.attributes })) }, null, 2))
